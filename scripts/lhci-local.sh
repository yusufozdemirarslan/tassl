#!/usr/bin/env bash
# Local substitute for `pnpm lhci` on Windows (D-147). LHCI's chrome-launcher cannot delete its
# temporary profile on this platform (EPERM), so Lighthouse runs against a Chromium launched here
# (Playwright's build) and `lhci assert` evaluates the saved reports with the same lighthouserc.json.
# CI runs `lhci autorun` unchanged (docs/tech/15-cicd-deployment.md §4.2).
#
#   bash scripts/lhci-local.sh              # urls and run count from lighthouserc.json
#   bash scripts/lhci-local.sh <url> ...    # explicit urls
set -euo pipefail
cd "$(dirname "$0")/.."

PORT=9222
OUT=".lighthouseci"
rm -rf "$OUT" && mkdir -p "$OUT"
CHROME="$(node -e "console.log(require('@playwright/test').chromium.executablePath())")"
# Lighthouse is a dependency of @lhci/cli; pnpm does not hoist its bin.
LH_CLI="$(ls -d node_modules/.pnpm/lighthouse@*/node_modules/lighthouse | head -1)/cli/index.js"
[ -f "$LH_CLI" ] || { echo "lhci-local: lighthouse cli not found"; exit 1; }
PROFILE="$OUT/chrome-profile"
RUNS="$(node -e "console.log(require('./lighthouserc.json').ci.collect.numberOfRuns ?? 3)")"
URLS=("$@")
if [ ${#URLS[@]} -eq 0 ]; then
  mapfile -t URLS < <(node -e "for (const u of require('./lighthouserc.json').ci.collect.url) console.log(u)")
fi

stop_port() { # kill whatever listens on a port (Windows and POSIX)
  if command -v taskkill > /dev/null 2>&1; then
    for pid in $(netstat -ano 2>/dev/null | grep -E ":$1 " | grep LISTENING | awk '{print $5}' | sort -u); do
      taskkill //PID "$pid" //F > /dev/null 2>&1 || true
    done
  else
    for pid in $(lsof -ti tcp:"$1" 2>/dev/null); do kill "$pid" 2>/dev/null || true; done
  fi
}
cleanup() {
  stop_port "$PORT"
  stop_port 3000
}
trap cleanup EXIT

stop_port 3000
pnpm start > "$OUT/server.log" 2>&1 < /dev/null &
for _ in $(seq 1 60); do
  if curl -fsS http://localhost:3000/api/health > /dev/null 2>&1; then break; fi
  sleep 1
done
curl -fsS http://localhost:3000/api/health > /dev/null || { echo "lhci-local: server did not start (see $OUT/server.log)"; exit 1; }

"$CHROME" --headless=new --remote-debugging-port=$PORT --user-data-dir="$PROFILE" \
  --no-sandbox --disable-dev-shm-usage about:blank > "$OUT/chrome.log" 2>&1 < /dev/null &
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/json/version" > /dev/null 2>&1; then break; fi
  sleep 1
done

i=0
for url in "${URLS[@]}"; do
  for _ in $(seq 1 "$RUNS"); do
    i=$((i + 1))
    echo "lhci-local: run $i → $url"
    node "$LH_CLI" "$url" --port=$PORT --preset=desktop --quiet \
      --output=json --output-path="$OUT/lhr-$i.json"
  done
done

pnpm exec lhci assert --config=lighthouserc.json
echo "lhci-local: assertions passed for ${URLS[*]}"
