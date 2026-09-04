#!/usr/bin/env bash
# Post-deploy smoke test. Usage: bash scripts/smoke.sh <base-url>
# Final form: docs/tech/15-cicd-deployment.md §9. Checks are added by the step that ships each
# route (D-144): /privacy, /terms (Phase 1); /sign-in and the /home → /sign-in redirect (Phase 3);
# /api/v1/openapi.yaml (Phase 14); strict-transport-security and content-security-policy (Phase 13).
set -euo pipefail
BASE="${1:-${NEXT_PUBLIC_APP_URL:-}}"
[ -n "$BASE" ] || { echo 'usage: scripts/smoke.sh <base-url> (or set NEXT_PUBLIC_APP_URL)'; exit 2; }
BASE="${BASE%/}"

expect_status() { # path expected-status
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "$BASE$1")"
  if [ "$code" != "$2" ]; then echo "FAIL $1 -> $code (expected $2)"; exit 1; fi
  echo "ok   $1 -> $code"
}

expect_redirect() { # path expected-location-prefix
  local code location
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "$BASE$1")"
  location="$(curl -sSI --max-time 20 "$BASE$1" | tr -d '' | awk 'tolower($1) == "location:" { print $2 }')"
  case "$code" in
    30[1278]) ;;
    *) echo "FAIL $1 -> $code (expected a redirect)"; exit 1 ;;
  esac
  case "$location" in
    "$2"*) ;;
    *) echo "FAIL $1 -> $location (expected $2...)"; exit 1 ;;
  esac
  echo "ok   $1 -> $code $location"
}

expect_status /api/health 200
expect_status /api/ready 200
# The entry points a signed-out visitor meets (UI-001, 09 §1): the root and every (app) route send
# them to the sign-in screen, which must render (D-190).
expect_redirect / /sign-in
expect_status /sign-in 200
expect_redirect /home /sign-in
curl -sS --max-time 20 "$BASE/api/health" | grep -q '"status":"ok"' || { echo "FAIL /api/health body"; exit 1; }
curl -sS --max-time 20 "$BASE/api/ready" | grep -q '"status":"ready"' || { echo "FAIL /api/ready body"; exit 1; }

# Security headers are asserted on https only (12-security.md; SYS-015).
case "$BASE" in
  https://*)
    HDRS="$(curl -sSI --max-time 20 "$BASE/")"
    for h in x-content-type-options x-frame-options referrer-policy x-request-id; do
      echo "$HDRS" | grep -qi "^$h:" || { echo "FAIL missing header $h"; exit 1; }
      echo "ok   header $h"
    done
    ;;
esac
echo "smoke passed for $BASE"
