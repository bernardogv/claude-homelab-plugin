---
name: operating-the-homelab
description: Use when operating, deploying to, diagnosing, SSHing into, or reasoning about the homelab — nodes spark/spark2/strix/pi/framework/mac-mini/nas, the Prometheus/Grafana monitoring stack, Spark GPU/OOM behavior, or job routing. ALSO use for any question about what to run on the DGX Sparks — choosing, comparing, benchmarking or sizing a local model, quantization, serving engines (llama.cpp/vLLM/SGLang/llama-swap), tok/s or context budgets — including research, planning and 'which is best' questions where nothing is being operated yet. Provides fleet facts, SSH access, hard-won safety rules, and the route to the Spark casebook.
---

# Operating the Homelab

Use the `homelab-ssh` MCP tools (`ssh_exec`, `node_status`, `node_processes`, `file_read/write/download`, `ssh_tail`, `list_nodes`) to operate the fleet. For autonomous multi-step jobs, dispatch the `homelab-operator` subagent.

## Hard rules (read before acting)
- **Never run memory-sizing GPU jobs on spark** (any tool that grabs all "free" GPU memory) — over-allocates GB10 unified memory and zombies the box. Run those on the Mac/mac-mini instead. See `references/spark.md`.
- **Spark swap stays OFF.** Converts "brick the box" into a clean OOM-kill. Before a big model load, check `MemAvailable` headroom (see `references/spark.md`).
- **cgroup/Docker `--memory` limits do not constrain GPU allocs on GB10 UMA.** Don't trust them.
- **`spark-mode switch <mode>` is the only way to change what a Spark serves** (`references/spark.md` → modes). Its HTTP probe is the truth; never start/stop serving units by hand, never switch a box with another session's job on it.
- **Never run a flux-class ComfyUI job beside a resident LLM on spark** — ComfyUI sizes to free memory and `--reserve-vram` does not cap it; earlyoom then kills ComfyUI. SDXL-class coexists.
- Job routing: LLM/agents → spark2 `coder`; generation → spark `gen`; Docker → framework/pi; macOS/orchestration → mac-mini; AMD/ROCm/gfx1151 → strix (provisional; llama-swap `:8089` for a third local model); x86 → framework; low-priority → pi; two-box cluster → model-class experiments only.

## Reference files (load as needed)
- `references/nodes.md` — node table, hardware, SSH aliases, env vars.
- `references/spark.md` — GB10 unified-memory & OOM hardening (the detailed playbook).
- **The spark casebook — the single source of truth for anything MEASURED on the Sparks.** Not a reference file in this plugin; a separate (private) repo of dated measurement entries. `grep -ri` it before proposing any Spark test, and write the dated entry after. `hardware.md` (roofline, UMA, telemetry, 200G link) · `models.md` (scoreboard) · `serving.md` · `quantization.md` · `artifacts.md` (where harnesses live) · `casebook/`. Claude memory holds pointers only and may be stale — the casebook wins.
- **The strix casebook** — same role and rules for strix (AMD gfx1151). A Spark-vs-strix comparison cites both casebooks.
- `references/monitoring.md` — config-as-code Prometheus/Grafana stack, URLs, tag-based discovery, canned PromQL queries (prefer querying Prometheus over ssh snapshots for anything about state over time), and **Home Assistant via its REST API** (there is no `hass-mcp` server — it was removed for costing 9,999 context tokens per session for ~5 calls in 6 weeks).
