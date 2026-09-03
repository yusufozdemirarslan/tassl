#!/usr/bin/env bash
set -euo pipefail
{ for f in docs/tech/00-README.md docs/tech/0[1-9]-*.md docs/tech/1[0-7]-*.md docs/tech/build-plan/phase-*.md docs/tech/DECISIONS.md docs/tech/COVERAGE.md; do cat "$f"; printf '\n\n---\n\n'; done; } > docs/TASSL-TECHNICAL-DOCUMENTATION.md
# The placeholder pattern is assembled from fragments so this script never contains the tokens it hunts for.
PATTERN="$(printf '%s|%s|%s|%s' 'TB''D' 'TO''DO' 'EDIT'' ME' '<you''r-')"
grep -nE "$PATTERN" docs/TASSL-TECHNICAL-DOCUMENTATION.md && { echo "FIX THESE"; exit 1; } || echo "clean"
