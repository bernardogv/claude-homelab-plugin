# claude-homelab-plugin

A Claude Code plugin for operating a GPU homelab: two NVIDIA DGX Sparks, an AMD Strix Halo box, a Raspberry Pi monitoring stack, a NAS and a MAAS bare-metal lab. It is the plugin I run every day, published with my fleet's details replaced by example values.

The point is not the SSH access. It is letting an agent operate real machines **without trusting it blindly**: every layer below either refuses something or proves something.

## What's inside

| Piece | Where | What it does |
|---|---|---|
| MCP server | `homelab/mcp/homelab-ssh/` | 8 tools (`ssh_exec`, `node_status`, `node_processes`, `file_read`, `file_write`, `file_download`, `ssh_tail`, `list_nodes`). Writes are path-allowlisted, traversal and shell metacharacters are rejected, downloads can't smuggle curl flags. Unit-tested. |
| Skill | `homelab/skills/operating-the-homelab/` | Fleet facts, job routing and the hard rules, loaded on demand. `references/spark.md` is the GB10 unified-memory/OOM playbook. |
| Subagent | `homelab/agents/homelab-operator.md` | Runs multi-step fleet jobs on a cheaper model with only the homelab tools, and reports back a summary instead of a transcript. |
| Commands | `homelab/commands/` | `/homelab-status` (fleet health table) and `/spark-safe` (SAFE / NOT SAFE preflight before a big model load). |
| Hook | `homelab/hooks/audit-guard.sh` | `PreToolUse` on `ssh_exec`: appends every command to an audit log and blocks a deterministic denylist (writes into `/etc`; agents stage files under `$HOME` and hand the human one `sudo cp` line). |
| Evals | `homelab/evals/` | `claude plugin eval` cases with an agent-mocked MCP server, so runs never touch real machines. Each case runs with and without the plugin; the difference is the point. |
| Ship gate | `scripts/ship.sh`, `scripts/eval.sh` | Rebuilds the MCP bundle, proves it answers an MCP `initialize` with no `node_modules` reachable, prunes build output, then fails the release if any eval case scores below 1.0. |

## Why the rules look the way they do

The DGX Spark's GB10 shares one 128 GB pool between CPU and GPU. A tool that sizes itself to "free GPU memory" over-allocates system RAM, and the box goes zombie instead of throwing a clean CUDA OOM. Docker and cgroup memory limits don't constrain those allocations. So the plugin encodes the fix in several places at once: the skill states it, the subagent repeats it, `/spark-safe` checks headroom against a measured floor before a load, and an eval case fails if Claude runs a memory-sizing job on a Spark even when asked casually.

## Install

```text
/plugin marketplace add bernardogv/claude-homelab-plugin
/plugin install homelab@claude-homelab
```

Then adapt it to your machines:

1. `homelab/mcp/homelab-ssh/config/nodes.json`: your nodes, SSH aliases and hardware. The SSH aliases must exist in your `~/.ssh/config` with key-based auth.
2. `homelab/mcp/homelab-ssh/src/guardrails.ts`: `WRITE_ALLOWED_PREFIXES` (defaults to `/home/bernardogv/` and `/tmp/`). Then `npm ci && npm test && npm run bundle` in that directory.
3. `homelab/skills/operating-the-homelab/`: rewrite the fleet facts and routing for your hardware. Keep the hard rules that apply to you.

## Development

```bash
./scripts/ship.sh --dev   # install deps
cd homelab/mcp/homelab-ssh && npm test
./scripts/ship.sh         # bundle, standalone smoke test, prune, eval gate
./scripts/eval.sh         # eval gate alone
```

Plugin-bundled MCP tools are namespaced `mcp__plugin_<plugin>_<server>__<tool>`. Bare names in hook matchers or subagent `tools:` lists fail silently, which is why the hook matcher is `mcp__(plugin_homelab_)?homelab-ssh__ssh_exec`.

## License

MIT
