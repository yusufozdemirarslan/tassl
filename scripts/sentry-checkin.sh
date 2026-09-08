#!/usr/bin/env bash
# Sentry Cron Monitor check-in (docs/tech/15-cicd-deployment.md §8, 13-observability-ops.md §8.4).
# Used by .github/workflows/backup.yml, scripts/restore-drill.sh, and the launch checklist.
#
#   bash scripts/sentry-checkin.sh <monitor-slug> <in_progress|ok|error> [<crontab>] [<margin-min>] [<max-runtime-min>]
#
# It posts to the DSN-authenticated cron endpoint
# (https://<dsn-host>/api/<project-id>/cron/<monitor-slug>/<public-key>/), so no org slug and no API
# token are needed. Passing the crontab upserts the monitor's schedule (monitor_config); ok and error
# check-ins omit it.
#
# Two silences are deliberate:
#   - an empty NEXT_PUBLIC_SENTRY_DSN skips the check-in and exits 0 (D-098), so the backup and the
#     drill run unchanged before a Sentry project exists;
#   - a delivery failure warns and exits 0 (D-582): telemetry must never fail the thing it measures,
#     and a check-in that never arrives is exactly what the monitor's missed-check-in alert is for.
set -euo pipefail
# Even when the caller ran `bash -x`, nothing from here is traced.
set +x

SLUG="${1:?monitor slug}"
STATUS="${2:?status: in_progress|ok|error}"
SCHEDULE="${3:-}"
MARGIN="${4:-30}"
MAXRUN="${5:-60}"
DSN="${NEXT_PUBLIC_SENTRY_DSN:-}"

case "$STATUS" in
  in_progress | ok | error) ;;
  *)
    echo "sentry-checkin: status must be in_progress, ok or error (got '$STATUS')" >&2
    exit 2
    ;;
esac

if [ -z "$DSN" ]; then
  echo "sentry-checkin: NEXT_PUBLIC_SENTRY_DSN empty; skipped"
  exit 0
fi

# A malformed DSN would otherwise be posted to a URL assembled out of its pieces; refuse instead.
if ! printf '%s' "$DSN" | grep -Eq '^https://[^@/]+@[^/@]+/[0-9]+$'; then
  echo "sentry-checkin: NEXT_PUBLIC_SENTRY_DSN is not a https://<key>@<host>/<project> DSN; skipped" >&2
  exit 0
fi

rest="${DSN#https://}"
key="${rest%%@*}"
rest="${rest#*@}"
host="${rest%%/*}"
project="${rest##*/}"

if [ -n "$SCHEDULE" ]; then
  BODY="{\"status\":\"$STATUS\",\"environment\":\"production\",\"monitor_config\":{\"schedule\":{\"type\":\"crontab\",\"value\":\"$SCHEDULE\"},\"checkin_margin\":$MARGIN,\"max_runtime\":$MAXRUN,\"timezone\":\"UTC\"}}"
else
  BODY="{\"status\":\"$STATUS\",\"environment\":\"production\"}"
fi

if curl -fsS --max-time 15 -o /dev/null -X POST "https://$host/api/$project/cron/$SLUG/$key/" \
  -H 'Content-Type: application/json' --data "$BODY"; then
  echo "sentry-checkin: $SLUG $STATUS"
else
  echo "sentry-checkin: $SLUG $STATUS not delivered; Sentry raises the missed check-in itself" >&2
fi
