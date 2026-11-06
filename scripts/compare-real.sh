#!/usr/bin/env bash
# Runs isobar-pr compare on the company repos to read real-world noise before the demo.
# Usage: scripts/compare-real.sh [workspace-root] [base-ref]
set -euo pipefail
ROOT="${1:-$HOME/Projects/Command-Center}"
BASE_REF="${2:-development}"
CLI="$(cd "$(dirname "$0")/.." && pwd)/dist/cli.js"
OUT="${TMPDIR:-/tmp}/isobar-pr-real"
mkdir -p "$OUT"
for repo in arbites EQ-Command-Center; do
  echo "=== $repo vs $BASE_REF ==="
  start=$(date +%s)
  if node "$CLI" compare "$ROOT/$repo" --base-ref "$BASE_REF" --format markdown --out "$OUT/$repo" > /dev/null; then
    echo "--- $(( $(date +%s) - start )) s · findings by kind ---"
    node -e "const r=require('$OUT/$repo/report.json'); const c={}; for (const f of r.findings) c[f.kind]=(c[f.kind]||0)+1; console.log(JSON.stringify(c), 'changed', r.meta.changedFiles, 'analyzed', r.meta.analyzedChangedFiles, 'gate', r.gate, 'truncated', r.meta.truncated)"
  else
    echo "(exit $?)"
  fi
done
echo "Reports in $OUT"
