#!/usr/bin/env bash
# Weekly restore drill (NFR-015, D-069; docs/tech/13-observability-ops.md §8.4). A backup that has
# never been restored is not a backup, so this is the deliverable: the latest nightly artifact is
# decrypted into a throwaway Neon branch, migrated, verified, smoke-tested through a real server on
# that branch, and the branch is deleted again — on every exit path, including a failure or a Ctrl-C.
#
#   NEON_API_KEY=... NEON_PROJECT_ID=... BACKUP_ENCRYPTION_KEY=... bash scripts/restore-drill.sh
#
# Env: NEON_API_KEY, NEON_PROJECT_ID, BACKUP_ENCRYPTION_KEY; NEXT_PUBLIC_SENTRY_DSN for the cron
#      check-in (skipped while empty); KEEP_BRANCH=1 keeps the branch, which is how §8.4 promotes a
#      restore to production; PORT overrides the local port (3100).
# Requires: gh (authenticated), psql and pg_restore from PostgreSQL 17, pnpm, openssl.
#
# Two things this script must never get wrong, because it is the one drill that stands next to
# production data:
#   - it deletes only the branch this run created, and only when the name still has the drill shape.
#     A drill that deletes the wrong branch is unrecoverable; a drill that leaks branches costs money
#     quietly, so the delete runs from a trap and both halves are re-checked there (D-584).
#   - it refuses to restore over an endpoint that is production's. `pg_restore --clean` against the
#     wrong connection string would drop the live schema, so the branch endpoint is compared with
#     main's before anything is written (D-585).
set -euo pipefail
set +x
umask 077

: "${NEON_PROJECT_ID:?set NEON_PROJECT_ID}"
: "${NEON_API_KEY:?set NEON_API_KEY}"
: "${BACKUP_ENCRYPTION_KEY:?set BACKUP_ENCRYPTION_KEY}"

neon() { npx neon@4.14.0 "$@"; }

START=$(date +%s)
STAMP=$(date -u +%Y-%m-%d)
# The name says what it is and carries the day it was made; it can never collide with `main` or with
# a `preview/pr-<n>` branch, and the cleanup refuses any name that does not match this shape.
BRANCH="restore-drill-$STAMP"
BRANCH_PATTERN='^restore-drill-[0-9]{4}-[0-9]{2}-[0-9]{2}$'
WORK="$(mktemp -d)"
PORT="${PORT:-3100}"
SERVER_PID=""
CREATED=0
CLEANED=0
STATUS="error"

# Masks every `scheme://user:password@host` before a captured stream reaches the log: the branch
# connection string is a live credential for as long as the branch exists.
scrub() {
  [ -s "$1" ] || return 0
  sed -E 's#([a-zA-Z][a-zA-Z0-9+.-]*://)[^[:space:]/@]*@#\1[redacted]@#g' "$1" >&2
}

host_of() {
  local rest="${1#*://}"
  rest="${rest#*@}"
  printf '%s' "${rest%%/*}"
}

sentry_checkin() {
  # in_progress | ok | error; the shared helper upserts the monitor schedule on first use and is a
  # no-op when NEXT_PUBLIC_SENTRY_DSN is empty (15 §8).
  bash scripts/sentry-checkin.sh restore-drill "$1" '0 6 * * 1' 120 90 || true
}

cleanup() {
  if [ "$CLEANED" = 1 ]; then return 0; fi
  CLEANED=1

  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi

  if [ "$CREATED" = 1 ] && [ "${KEEP_BRANCH:-0}" = 1 ]; then
    echo "restore-drill: KEEP_BRANCH=1; branch $BRANCH kept — delete it when the restore is done"
  elif [ "$CREATED" = 1 ]; then
    if [[ "$BRANCH" =~ $BRANCH_PATTERN ]]; then
      if neon branches delete "$BRANCH" --project-id "$NEON_PROJECT_ID" >/dev/null 2>&1; then
        echo "restore-drill: branch $BRANCH deleted"
      else
        echo "restore-drill: branch $BRANCH could not be deleted; delete it by hand before it bills" >&2
      fi
    else
      echo "restore-drill: refusing to delete '$BRANCH': not a drill branch name" >&2
    fi
  fi

  # Holds the decrypted dump, the branch connection string in a server log, and nothing else.
  rm -rf "$WORK"

  local duration=$(($(date +%s) - START))
  sentry_checkin "$STATUS"
  echo "restore drill $STAMP finished: $STATUS in ${duration} s (RTO target 3600 s)"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    {
      echo "### Restore drill $STAMP"
      echo
      echo "- outcome: \`$STATUS\`"
      echo "- duration: ${duration} s (NFR-015 RTO target 3600 s)"
    } >> "$GITHUB_STEP_SUMMARY"
  fi
  if [ "$duration" -gt 3600 ]; then
    echo "restore-drill: duration exceeds the NFR-015 RTO; open an issue (13 §8.4)" >&2
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

sentry_checkin in_progress

# 1. Latest successful nightly artifact, checked against its digest, decrypted into the work dir.
RUN_ID="$(gh run list --workflow backup.yml --status success --limit 1 --json databaseId --jq '.[0].databaseId')"
if [ -z "$RUN_ID" ]; then
  echo "restore-drill: no successful backup.yml run to restore from" >&2
  exit 1
fi
gh run download "$RUN_ID" --dir "$WORK/artifact"
ENC="$(find "$WORK/artifact" -name '*.dump.enc' | head -n 1)"
if [ -z "$ENC" ]; then
  echo "restore-drill: run $RUN_ID has no *.dump.enc artifact" >&2
  exit 1
fi
if [ -f "$ENC.sha256" ]; then
  (cd "$(dirname "$ENC")" && sha256sum -c "$(basename "$ENC").sha256")
fi
openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_ENCRYPTION_KEY -in "$ENC" -out "$WORK/backup.dump"
pg_restore --list "$WORK/backup.dump" > /dev/null
echo "restore-drill: artifact from run $RUN_ID decrypted and listed"

# 2. A fresh branch off main, then the restore over it.
neon branches create --project-id "$NEON_PROJECT_ID" --name "$BRANCH" --parent main > /dev/null
CREATED=1
RESTORE_URL="$(neon connection-string "$BRANCH" --project-id "$NEON_PROJECT_ID" --pooled false)"
MAIN_URL="$(neon connection-string main --project-id "$NEON_PROJECT_ID" --pooled false)"
if [ -z "$RESTORE_URL" ]; then
  echo "restore-drill: no connection string for $BRANCH" >&2
  exit 1
fi
if [ "$(host_of "$RESTORE_URL")" = "$(host_of "$MAIN_URL")" ]; then
  echo "restore-drill: $BRANCH resolves to production's endpoint; refusing to restore over it" >&2
  exit 1
fi
echo "restore-drill: restoring into $BRANCH (endpoint differs from main)"

pg_restore --clean --if-exists --no-owner -d "$RESTORE_URL" "$WORK/backup.dump" 2> "$WORK/pg_restore.err" ||
  echo "pg_restore exited non-zero (warnings on DROP of missing objects are expected); the verification below decides"
scrub "$WORK/pg_restore.err"

# 3. Schema, journal, and data.
DATABASE_URL="$RESTORE_URL" DATABASE_URL_UNPOOLED="$RESTORE_URL" pnpm db:migrate
psql "$RESTORE_URL" -v ON_ERROR_STOP=1 -At -c "select 'runs', count(*) from runs union all select 'run_events', count(*) from run_events union all select 'users', count(*) from \"user\";"
psql "$RESTORE_URL" -v ON_ERROR_STOP=1 -At -c "select count(*) from information_schema.schemata where schema_name = 'pgboss';" | grep -qx 1

# 4. Smoke against a local server pointed at the restored branch.
[ -f .next/BUILD_ID ] || pnpm build
PORT="$PORT" DATABASE_URL="$RESTORE_URL" DATABASE_URL_UNPOOLED="$RESTORE_URL" APP_ENV=test LLM_PROVIDER=mock FEATURE_AI=false EMAIL_TRANSPORT=console pnpm start > "$WORK/server.log" 2>&1 &
SERVER_PID=$!
READY=0
for _ in $(seq 1 60); do
  if curl -sf "http://localhost:$PORT/api/health" > /dev/null; then
    READY=1
    break
  fi
  sleep 1
done
if [ "$READY" != 1 ]; then
  tail -n 40 "$WORK/server.log" > "$WORK/server.tail"
  scrub "$WORK/server.tail"
  echo "restore-drill: the server on the restored branch never became healthy on :$PORT" >&2
  exit 1
fi
NEXT_PUBLIC_APP_URL="http://localhost:$PORT" bash scripts/smoke.sh
STATUS="ok"
