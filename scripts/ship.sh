#!/usr/bin/env bash
# Prepare the marketplace working tree for distribution.
#
# Claude Code copies the WHOLE working tree when it syncs a directory-source
# marketplace -- .gitignore is not consulted. So node_modules/ (255MB) was being
# duplicated into ~/.claude/plugins/cache on every sync, even though both MCPs
# launch only from bundle/ (see each plugin's .mcp.json).
#
# This script rebuilds the bundles, proves each one boots with NO node_modules
# reachable, and only then prunes. The smoke test is the gate: a bundle that
# can't answer an MCP initialize on its own is never allowed to ship.
#
#   ./scripts/ship.sh          build + smoke-test + prune + eval gate  (run before syncing)
#   ./scripts/ship.sh --dev    reinstall deps for local development
#   SKIP_EVAL=1 ./scripts/ship.sh   skip the plugin eval gate (scripts/eval.sh)
#
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"

MCPS=(
  "homelab/mcp/homelab-ssh:bundle/index.js"
)

# Build output that must never reach the plugin cache. Both are gitignored (via
# the MCP's nested .gitignore) but a directory-source sync copies them anyway.
# bundle/ is the ONLY thing .mcp.json launches; dist/ is stale tsc output.
PRUNE=(node_modules dist)

INIT_REQ='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"ship-smoke","version":"1"}}}'

if [[ "${1:-}" == "--dev" ]]; then
  for entry in "${MCPS[@]}"; do
    dir="${entry%%:*}"
    echo "==> installing dev deps in $dir"
    (cd "$ROOT/$dir" && npm ci)
  done
  echo "Dev deps restored. Run ./scripts/ship.sh before syncing the marketplace."
  exit 0
fi

# Smoke test: copy the plugin dir WITHOUT node_modules to a scratch location and
# confirm the bundle answers an MCP initialize. This is what makes pruning safe --
# it fails loudly if esbuild ever leaves a runtime require unresolved.
smoke_test() {
  local dir="$1" entrypoint="$2"
  local tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN

  rsync -a --exclude node_modules --exclude dist "$ROOT/$dir/" "$tmp/app/"
  for leaked in "${PRUNE[@]}"; do
    if find "$tmp" -name "$leaked" -type d | grep -q .; then
      echo "    FAIL: $leaked leaked into the isolated copy" >&2
      return 1
    fi
  done

  local out
  out="$(printf '%s\n' "$INIT_REQ" | (cd "$tmp/app" && node "$entrypoint" 2>&1 | head -c 2000))" || true

  if grep -q '"protocolVersion"' <<<"$out" && grep -q '"serverInfo"' <<<"$out"; then
    echo "    ok: initialized standalone"
    return 0
  fi

  echo "    FAIL: bundle did not initialize without node_modules" >&2
  echo "$out" | head -20 >&2
  return 1
}

failed=0

for entry in "${MCPS[@]}"; do
  dir="${entry%%:*}"
  entrypoint="${entry##*:}"
  echo "==> $dir"

  if [[ -d "$ROOT/$dir/node_modules" ]]; then
    echo "    building bundle"
    (cd "$ROOT/$dir" && npm run bundle >/dev/null)
  else
    echo "    no node_modules; keeping existing bundle (run --dev to rebuild)"
  fi

  if [[ ! -s "$ROOT/$dir/$entrypoint" ]]; then
    echo "    FAIL: $entrypoint missing or empty" >&2
    failed=1
    continue
  fi

  if ! smoke_test "$dir" "$entrypoint"; then
    failed=1
    continue
  fi

  for prune in "${PRUNE[@]}"; do
    if [[ -d "$ROOT/$dir/$prune" ]]; then
      size="$(du -sh "$ROOT/$dir/$prune" | cut -f1)"
      rm -r "$ROOT/$dir/$prune"
      echo "    pruned $prune ($size)"
    fi
  done
done

if (( failed )); then
  echo
  echo "One or more MCPs failed the standalone check. node_modules was KEPT for those." >&2
  echo "Fix the bundle before syncing the marketplace." >&2
  exit 1
fi

if [[ "${SKIP_EVAL:-}" != 1 ]]; then
  echo
  ./scripts/eval.sh
fi

echo
echo "Shippable. Working tree is now $(du -sh "$ROOT" | cut -f1)."
