#!/usr/bin/env bash
# Regression gate: run each plugin's eval suite (`claude plugin eval`) and fail
# if any case scores below 1.0 on the with-plugin arm.
#
# Real MCP servers are never started -- every server is answered by the agent
# mock in <plugin>/evals/mocks/<server>/_server.md, and no shell tools are
# granted, so the runs cannot touch the fleet. Results go to
# $OUT (outside the tree: a directory-source marketplace sync copies the whole
# working tree, .gitignore not consulted).
#
#   ./scripts/eval.sh                 all plugins, 1 run per case
#   ./scripts/eval.sh homelab         one plugin
#   RUNS=3 ./scripts/eval.sh          more runs per case (variance check)
#
set -euo pipefail
cd "$(dirname "$0")/.."

PLUGINS=(homelab)
RUNS="${RUNS:-1}"
MAX_COST="${MAX_COST:-6}"
OUT="${OUT:-$HOME/.cache/homelab-plugin-evals}"

(( $# )) && PLUGINS=("$@")
failed=0
for p in "${PLUGINS[@]}"; do
  [[ -d "$p/evals" ]] || { echo "==> $p: no evals/, skipping"; continue; }
  stamp="$(date +%Y%m%dT%H%M%S)"
  dir="$OUT/$p/$stamp"
  mkdir -p "$dir"
  echo "==> $p (runs=$RUNS, cap \$$MAX_COST)"
  if (cd "$p" && claude plugin eval . --runs "$RUNS" --threshold 1.0 --max-cost-usd "$MAX_COST" \
        --no-publish --trust-plugin --output-dir "$dir" --report "$dir/report.html" \
        --json "$dir/result.json" >"$dir/eval.log" 2>&1); then
    echo "    ok  ($dir/report.html)"
  else
    failed=1
    echo "    FAIL -- $dir/eval.log" >&2
    python3 - "$dir/result.json" <<'PY' 2>/dev/null || true
import json,sys
d=json.load(open(sys.argv[1]))
for c in d['cases']:
    for r in c['arms'].get('with',[]):
        bad=[g['name'] for g in r['graders'] if not g['passed'] and g.get('scored',True)]
        if r['error'] or bad: print("    %s: %s%s" % (c['name'], r['error'] or '', ' failed: '+', '.join(bad) if bad else ''))
PY
  fi
  rm -rf "$p/evals/results"   # the runner still drops mock recordings here
done
(( failed )) && { echo; echo "Eval gate FAILED. Fix the skill (or the case, if the case is wrong) before shipping." >&2; exit 1; }
echo "Eval gate passed."
