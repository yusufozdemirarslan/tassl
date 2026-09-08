#!/usr/bin/env bash
# Nightly logical backup (docs/tech/15-cicd-deployment.md §8, NFR-015, D-069): pg_dump in the custom
# format, encrypted with AES-256-CBC, written to an output directory that becomes the workflow
# artifact.
#
#   PRODUCTION_DATABASE_URL_UNPOOLED=... BACKUP_ENCRYPTION_KEY=... bash scripts/backup.sh [out-dir]
#
# This is the one script that reads a production credential, so three rules hold throughout:
#   - the connection string is never echoed. `${VAR:?msg}` prints the message, not the value; xtrace
#     is turned off here even when the caller enabled it; and every stderr stream from a tool that
#     was handed the URL passes through `scrub` first, because libpq reports the conninfo it failed
#     to reach (D-580).
#   - nothing but the ciphertext and its checksum ever enters the output directory: the error log is
#     a mktemp file outside it, so a failure cannot put a credential into the uploaded artifact.
#   - the plaintext dump is removed by an EXIT trap rather than on the happy path, so a failed
#     encryption cannot leave one on disk for the upload step to collect.
#
# Before it reports success the script proves the artifact is usable: the archive lists (a truncated
# dump does not) and the ciphertext decrypts under the key in the environment to a stream that still
# starts with the custom-format magic, which is what catches a rotated or mistyped key (D-581).
set -euo pipefail
set +x
umask 077

: "${PRODUCTION_DATABASE_URL_UNPOOLED:?set PRODUCTION_DATABASE_URL_UNPOOLED}"
: "${BACKUP_ENCRYPTION_KEY:?set BACKUP_ENCRYPTION_KEY}"

OUT_DIR="${1:-backups}"
DATE="$(date -u +%Y-%m-%d)"
BASE="tassl-$DATE.dump"
DUMP="$OUT_DIR/$BASE"
ERR="$(mktemp)"

cleanup() {
  rm -f "$DUMP" "$ERR"
}
trap cleanup EXIT

# Masks every `scheme://user:password@host` before a captured stream reaches the log.
scrub() {
  [ -s "$1" ] || return 0
  sed -E 's#([a-zA-Z][a-zA-Z0-9+.-]*://)[^[:space:]/@]*@#\1[redacted]@#g' "$1" >&2
}

mkdir -p "$OUT_DIR"

if ! pg_dump --format=custom --no-owner --file "$DUMP" "$PRODUCTION_DATABASE_URL_UNPOOLED" 2>"$ERR"; then
  scrub "$ERR"
  echo "backup: pg_dump failed" >&2
  exit 1
fi
scrub "$ERR"

if ! pg_restore --list "$DUMP" >/dev/null 2>"$ERR"; then
  scrub "$ERR"
  echo "backup: the dump is not a readable custom-format archive" >&2
  exit 1
fi

if ! openssl enc -aes-256-cbc -pbkdf2 -pass env:BACKUP_ENCRYPTION_KEY -in "$DUMP" -out "$DUMP.enc" 2>"$ERR"; then
  scrub "$ERR"
  rm -f "$DUMP.enc"
  echo "backup: encryption failed" >&2
  exit 1
fi

# Decrypt just far enough to read the archive magic; nothing plaintext is written back to disk.
MAGIC="$(openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_ENCRYPTION_KEY -in "$DUMP.enc" 2>/dev/null | head -c 5 || true)"
if [ "$MAGIC" != "PGDMP" ]; then
  rm -f "$DUMP.enc"
  echo "backup: the encrypted artifact does not decrypt under BACKUP_ENCRYPTION_KEY" >&2
  exit 1
fi

rm -f "$DUMP"
# Written from inside the directory so `sha256sum -c` works wherever the artifact is unpacked.
(cd "$OUT_DIR" && sha256sum "$BASE.enc" > "$BASE.enc.sha256")
echo "wrote $DUMP.enc ($(du -h "$DUMP.enc" | cut -f1))"
