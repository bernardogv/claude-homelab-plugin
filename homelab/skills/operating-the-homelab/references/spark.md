# Spark (GB10) — Unified Memory & OOM Hardening

> ## 🔴 The spark casebook is the single source of truth
>
> **Grep it before testing anything on a Spark**, and write the dated entry in the same session.
> It holds every model tried, every measured number, every quant verdict, every serving gotcha,
> and the negative results. Consolidated 2026-08-31 — `gb10-observability`'s docs and the Claude
> memory files are now pointers into it, deliberately, so nothing has two homes.
>
> | Question | File |
> |---|---|
> | How fast should this model be? | `hardware.md` — roofline: **expected tok/s ≈ 187 GB/s ÷ active-GB-per-token** |
> | What have we tried, and how did it score? | `models.md` |
> | What config actually works? | `serving.md` |
> | NVFP4 findings and retractions | `quantization.md` |
> | Where is the harness / raw log / chart? | `artifacts.md` |
> | Evidence for one specific result | `casebook/YYYY-MM-DD-*.md` |
>
> **This file keeps only the operational rules.** Never record a measured number here.

Spark is Grace-Blackwell with **128 GB unified memory** (CPU+GPU share one pool, no separate VRAM). This causes a documented failure mode: a CUDA app that sizes to "free GPU memory" over-allocates system RAM and the box goes **zombie (SSH hangs, hard reboot needed)** instead of throwing a clean CUDA OOM. Confirmed on [NVIDIA's DGX Spark forums](https://forums.developer.nvidia.com/c/dgx-user-forum/dgx-spark/), affects ComfyUI / PyTorch / NIM / ollama and any GPU tool that sizes to free memory alike.

## Key Facts (learned the hard way 2026-06-07)

- **cgroup / container memory limits DO NOT WORK** on GB10 UMA — GPU allocs bypass cgroup accounting. `systemd MemoryMax`, Docker `--memory`, all ineffective for GPU memory. Don't rely on them.
- **The real fix = no swap.** Swap was disabled (`swapoff -a` + `/swap.img` commented in `/etc/fstab`, backup `/etc/fstab.bak.preswapfix`). Converts "brick the box" → "greedy process gets OOM-killed, OS lives." **Keep swap off.**
- **Don't run memory-sizing GPU tools on spark** — anything that grabs all free GPU memory over-allocates UMA and gets killed (or zombies the box). Run those on the Mac/mac-mini (Metal/OpenCL) instead.
- **ollama hardening** (HISTORICAL — ollama was removed from spark1 on 2026-09-06; kept for the failure-mode lesson) (`/etc/systemd/system/ollama.service.d/override.conf`): `OLLAMA_MAX_LOADED_MODELS=1`, `OLLAMA_KEEP_ALIVE=5m`, `OLLAMA_CONTEXT_LENGTH=65536`, `OLLAMA_FLASH_ATTENTION=1`, `OLLAMA_KV_CACHE_TYPE=q8_0`, plus a (belt-and-suspenders) MemoryMax. Two 65 GB models (gpt-oss:120b, llama4) loading at once was the original crash cause — **both were deleted 2026-07-28** along with nemotron-3-super, freeing 266 GB. ollama listens on `0.0.0.0` — any tailnet/LAN client can trigger a model load. **This file has silently regressed before** (rewritten 2026-06-18, lost its tuning until 2026-07-28) — if models start ballooning, diff it first. 
- **Agents cannot write to `/etc` on any node** — the `audit-guard.sh` hook blocks it. Stage the file under `$HOME` on the node and hand the owner one `sudo cp && daemon-reload && restart` line.
- **`ollama list` SIZE ≠ reclaimable disk** (historical, see above). Manifests share blobs (two 51 GB entries can be the *same* 51 GB — deleting either frees 0). Before pruning, ref-count layer digests under `/usr/share/ollama/.ollama/models/manifests`. `ollama rm` needs the full registry prefix (`hf.co/…`).
- **Diagnose without touching spark:** Prometheus on pi has spark's `node_exporter` (`node_memory_MemAvailable_bytes{job="spark"}`) + `spark-gpu` DCGM. When tailscale drops but host lives, reach it via framework's LAN (`ssh framework "ssh 192.0.2.10 ..."`).

## Checking MemAvailable Before a Big Model Load

```bash
# Via pi Prometheus (preferred — doesn't touch spark)
curl -s 'http://100.64.0.13:9090/api/v1/query?query=node_memory_MemAvailable_bytes{job="spark"}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(int(d['data']['result'][0]['value'][1])//1024//1024//1024, 'GB free')"

# Direct SSH (only if spark is reachable)
ssh spark "free -h"
```

## Model serving topology — Phase 3 modes (2026-09-06)

Both boxes run **explicit, switchable modes** via `~/bin/spark-mode` (its own `spark-mode` repo,
per-box `~/.config/spark-mode/modes.conf`). A switch = stop the current mode's units → wait for the
`MemAvailable` floor → start the target units → **verify by HTTP probe, never by process state** → write
`~/.config/spark-mode/state`. Only the **default** mode's units are `enabled`; every other unit is
started only by the script, so a reboot always lands in the default mode (verified 2026-09-06, both
boxes, from default and from non-default modes — casebook `serving.md` → Phase 3).

| box | default | modes | stable endpoint |
|---|---|---|---|
| spark1 (`spark`, studio) | `gen` | `gen` = ComfyUI `:8188` · `research` = llama-swap `:8089` · `train` = nothing serves · `cluster` = TP=2 **worker** rank (no published port; ComfyUI stopped while up) | `http://100.64.0.11:8089/v1` (research: `qwen3.6-heretic`, `qwen3-coder-next-abl`, `qwen3.6-base-batch`) |
| spark2 (agent box) | `llm` | `llm` = `spark-llm.service` → SGLang `:8000`, served id **`coder`** (nemotron35-lightning) · `train` · `cluster` = TP=2 **head** rank, vLLM on `:8000`, served id **`cluster`** (MiniMax-M2.7-AWQ4; `coder` is down while it is up) | `http://100.64.0.12:8000/v1`, model `coder` — consumers never change when the resident model swaps |

```
spark-mode status            # mode, live unit states, MemAvailable, probe
spark-mode switch <mode>     # exit 0 ok · 1 probe failed · 3 floor not reached · 4 refused; cluster has its own 0–7 table (casebook serving.md)
spark-mode switch <mode> --dry-run
```

**Cluster mode (Phase 4, serves since 2026-09-07).** `ssh spark2 '~/bin/spark-mode switch cluster'` from the
head orchestrates both boxes (worker rank first, then the head; preflight refuses before touching anything;
a failed rank rolls both boxes back). Switch → promoted **~4.5–5 min**; `switch llm` on the head is the
orchestrated exit, **~8 min**, and returns spark1 to `gen` too. While it is up **`coder` is down** — every
consumer pinned to `coder` gets 404 — and spark1's ComfyUI is stopped. After a clean exit spark1's
`spark-cluster-worker.service` reads `failed` (cosmetic, known). Exit codes 0–7 report the head's
outcome only; table and the full contract in casebook `serving.md` → "Cluster mode (two boxes, TP=2)".
**What it is for:** model-class experiments only — the measured verdict is that two independent boxes
(DP=2) beat it 2.3× on aggregate throughput and the pair is *not* a better coding agent than the resident
`coder` (casebook `2026-09-07-phase4-{dp2-control-arm,m27-agent-matrix}.md`). Don't propose it for
throughput or coding.

**Fan-out capacity of `coder` (since 2026-09-07 12:22):** `spark-llm.service` runs `--max-running-requests 16`
— ~405 tok/s aggregate at 16 streams, TTFT 0.24 s (it was capped at 4 → ~205 and 15 s TTFT). A second
`coder` replica can be launched on spark1 in ~7 min (`spark:~/dp2-launch.sh`, checkpoint + SGLang image
kept there) — but only as a mode exclusive with ComfyUI, never beside `gen` (see Contention below).

Rules: never switch a box while another session's job is running on it (`nvidia-smi` / `~/bin/spark-gpu status`
first, and tell the other session). Cold starts to plan around: spark2 `coder` ≈ 7–7.5 min from
`switch llm` (411–442 s measured incl. boot); spark1 ComfyUI ≈ 20 s; llama-swap loads on first request
(heretic ≈ 30 s with a burst of 502s while settling, coder-next-abl ≈ 66 s). **Ollama is gone from spark1**
(service, binary and 226 GiB store removed 2026-09-06); `spark-gpu status` may still print an ollama line.
**llama-swap hot-reloads `config.yaml` and kills the resident model when it does.** Harness: `spark-task`
(dsh, gated delegation) and `spark-task-pi` (pi, interactive) both target `spark2/coder`; opencode was
removed. Details, numbers and the reasons: casebook `serving.md` (Phase 3 section) and the dated entries
`casebook/2026-09-06-phase3-*.md`, `…-harness-bakeoff.md`, `…-research-frontend-hermes.md`.

- **ComfyUI:** URL http://100.64.0.11:8188 · models `~/projects/comfyui/ComfyUI/models/checkpoints/` · workflows `~/projects/comfyui/ComfyUI/user/default/workflows/` · `comfyui.service` is the `gen` unit — prefer `spark-mode switch gen` over starting it by hand.
- **llama-swap config:** `~/projects/llama-swap/config.yaml` (3-id Phase 3 roster; pre-Phase-3 backup at `~/modes/cleanup/llama-swap-config.pre-phase3.yaml.bak`), `-watch-config` hot-reload. Model list is `/v1/models`; unload is `POST /api/models/unload` (**`/unload` and `/api/models` both 404**).

## Contention: the two GPU tenants (ENFORCED, don't hand-manage it)

ComfyUI and the LLM side both draw on the same 121 GB. llama.cpp logs `fitting params to device memory` at spawn — it sizes to whatever is **free at that instant** — so a resident model silently shrinks the other side. This is now automatic in both directions; **policy is the IDLE side yields, a RUNNING job is never interrupted.**

- LLM load → frees an *idle* ComfyUI, leaves a *busy* one alone: `~/bin/llm-spawn` (all llama-swap `cmd` entries route through it). Check: `~/bin/llm-spawn.test.sh`.
- ComfyUI job → frees the LLM: `comfyui-mcp`'s `freeLlmSide()` in `queuePrompt()` + `run_comfyscript`.
- **Not covered: the ComfyUI web UI** (posts `/prompt` directly, bypasses the MCP).
- **ComfyUI's dynamic-VRAM loader sizes to FREE memory, and `--reserve-vram` does not cap it** (measured 2026-09-07): a flux-class job beside a resident LLM replica took 42 GiB with 51 free and 57 GiB with 67 free, dove the box to 6 GiB at ~2.4 GiB/s, and earlyoom killed *both* ComfyUI processes (the LLM survived). So an LLM on spark1 is a **mode** exclusive with ComfyUI, never a tenant beside `gen`; only SDXL-class jobs coexist. Evidence: casebook `casebook/2026-09-07-phase4-dp2-control-arm.md` §4/§7.

**Manual override / inspection — `ssh spark spark-gpu <verb>`:**

```bash
spark-gpu status   # what is actually resident right now (LLM, ComfyUI queue, ollama)
spark-gpu gen      # free the LLM side   — before a big ComfyUI job
spark-gpu llm      # free ComfyUI models — before loading a big model
spark-gpu free     # free both
spark-gpu check    # assert all four control endpoints answer (run after any upgrade)
```

The yield is cooperative: llama-swap reloads on the next request. For a long job that must not be disturbed, stop the other unit outright (`systemctl --user stop llama-swap` / `comfyui`).

## KV-cache tuning: measured, mostly not worth it (2026-07-28)

Counter-intuitive, so don't re-derive it: on the 35B MoE, `-ctk/-ctv q8_0` saved **147 MB** and `-np 1` saved **130 MB** — noise, because this build runs `kv_unified = true` (slots share one cache) and the arch's attention is cheap. **4× the context cost ~1.2 GB.** So don't add KV-quant flags to llama-server here; buy context instead.

The opposite holds for ollama's standard-attention models: gemma4:26b at ollama 0.22's auto-picked 262144 ctx was **25 GB**, at 65536 it is **20 GB**. That is why `OLLAMA_CONTEXT_LENGTH=65536` is set.
