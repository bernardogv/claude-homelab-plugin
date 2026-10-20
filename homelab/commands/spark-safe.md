---
description: Preflight whether a Spark can safely take a large model load right now (UMA/OOM guard), on either box.
---

Check whether **spark** (spark1) or **spark2** — whichever the user names, both if unsure — has headroom for a
large model load. Use `mcp__plugin_homelab_homelab-ssh__ssh_exec` on the box to gather, in one call:
`~/bin/spark-mode status` (mode, unit states, MemAvailable, HTTP probe — this is the authoritative "what is
resident"), `free -b` (MemAvailable), `nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv`
(other GPU tenants, e.g. a hand-launched docker engine), `docker ps --format '{{.Names}}'`, and `swapon --show`
(must be empty). On spark1 also `~/bin/spark-gpu status` (ComfyUI queue, llama-swap resident model).

Answer plainly: **SAFE / NOT SAFE**, with the limiting number, using these rules from the casebook:
- The bench launchers refuse below **100 GiB MemAvailable** before a load; the house rule is **≥ 15 GiB
  MemAvailable after the load** (earlyoom SIGTERMs at 5 % ≈ 6 GiB and picks the biggest python — usually the
  LLM). Size = checkpoint bytes + engine overhead; `mem-fraction 0.50` on 121.7 GiB costs ~63 GiB whatever the
  model (nemotron `coder` measured: 114 → 51.5 GiB).
- **Never change what a Spark serves by hand** — `spark-mode switch <mode>` is the only path (it waits for the
  floor and verifies by probe). Cluster mode needs both boxes near-empty (worker ~111 GiB, head after `coder`
  stops) and takes `coder` down for its whole life.
- **ComfyUI is a memory-sizing tool for flux-class jobs**: it takes whatever is free (42–57 GiB measured) and
  `--reserve-vram` does not cap it. A resident LLM beside an active flux job is NOT SAFE regardless of the
  number you see now; SDXL-class jobs (~21 GiB during sampling) are fine.
- ollama is gone from spark1 (2026-09-06); ignore any `spark-gpu status` line about it.
If a model is already resident, say which and subtract it. Cite the spark casebook for any
number you quote; do not invent sizes.
