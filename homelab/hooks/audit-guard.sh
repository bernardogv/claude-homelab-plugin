#!/usr/bin/env bash
# PreToolUse guard for homelab-ssh ssh_exec.
# Reads the tool-call JSON on stdin, appends an audit line, and blocks a
# small deterministic denylist (exit 2 = block, stderr shown to the model).
set -euo pipefail

LOG="${HOME}/.claude/homelab-audit.log"
payload="$(cat)"

read -r NODE COMMAND <<EOF
$(printf '%s' "$payload" | python3 -c '
import json, sys
d = json.load(sys.stdin)
ti = d.get("tool_input", {})
node = str(ti.get("node", "")).replace("\n", " ")
cmd = str(ti.get("command", "")).replace("\n", " ")
print(node, cmd)
')
EOF

ts="$(date "+%Y-%m-%dT%H:%M:%S%z")"
printf '%s\t%s\t%s\n' "$ts" "$NODE" "$COMMAND" >> "$LOG"

# Denylist (approved scope): writes into /etc.
if printf '%s' "$COMMAND" | grep -qE '(>|>>|tee|cp|mv|install)[[:space:]]+[^|]*/etc/'; then
  echo "BLOCKED: refusing to write into /etc on $NODE. Use a config-as-code path under \$HOME." >&2
  exit 2
fi

exit 0
