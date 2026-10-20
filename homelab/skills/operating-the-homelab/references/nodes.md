# Node Reference

> Example fleet. IPs are placeholders in the Tailscale CGNAT range; edit
> `mcp/homelab-ssh/config/nodes.json` and this file to describe your own nodes.

## Node Quick Reference

| Node | Tailscale IP | Role | Best For |
|------|-------------|------|----------|
| spark | 100.64.0.11 | GPU/ML | Studio box: default mode `gen` (ComfyUI), `research` (llama-swap research models), training; cluster-mode worker rank |
| spark2 | 100.64.0.12 | GPU/ML | Agent box: default mode `llm` — resident `coder` (SGLang :8000, 16 concurrent) for every harness/consumer; cluster-mode head (TP=2 with spark) |
| strix | 100.64.0.17 | GPU/ML (AMD) | Framework **Desktop** (not the `framework` laptop): gfx1151 ROCm/HIP/Vulkan target, x86 + big-memory jobs. llama-swap `:8089`, one local model at a time |
| pi | 100.64.0.13 | Monitoring | Prometheus/Grafana/Alertmanager, cron, lightweight Docker |
| framework | 100.64.0.14 | Docker | x86 Docker; MAAS region+rack for the bare-metal lab |
| mac-mini | 100.64.0.15 | macOS | GitHub Actions runner, Claude Code orchestration |
| nas | 100.64.0.16 | NAS/Storage | File storage, backups, Docker apps |

## Job Routing

LLM/agent work → spark2 `coder` (stable id, `http://100.64.0.12:8000/v1`); image/video generation → spark `gen`; research models → spark `research`; a model that cannot fit one box → cluster mode (both Sparks, orchestrated from spark2, `coder` down while up — model-class experiments only); AMD GPU / ROCm / gfx1151 → strix; Docker → framework/pi; macOS/orchestration → mac-mini; storage/backups → nas; low priority → pi.

What is resident on a Spark is decided by `~/bin/spark-mode`, never by hand. The GB10 UMA/OOM rules in `references/spark.md` apply verbatim to both Sparks. Swap stays off on both.

## Node Hardware

| Node | Cores | RAM | Arch | Special |
|------|-------|-----|------|---------|
| spark | 20 | 121GB | ARM64 | NVIDIA GB10 (DGX Spark), DGX OS / Ubuntu 24.04 |
| spark2 | 20 | 121GB | ARM64 | NVIDIA GB10 (DGX Spark), 3.7TB NVMe |
| strix | 16 | 122GB | x86_64 | Ryzen AI Max+ 395, Radeon 8060S gfx1151, 128GB unified (VRAM 512MiB, GTT 120GiB) |
| pi | 4 | 8GB | ARM | Raspberry Pi 5 |
| framework | 16 | 30GB | x86_64 | Framework laptop |
| mac-mini | 10 | 16GB | ARM64 | Apple M4 |
| nas | 5 | 8GB | x86_64 | UGREEN DXP4800 Plus, UGOS Pro, 2.5G + 10G NIC |

## Network

MikroTik CRS310-8G+2S+ core switch (8× 2.5G + 2× 10G SFP+), flat L2 plus a VLAN dedicated to MAAS provisioning. The Sparks reach the switch over 10G SFP+ and link to each other directly with a 200G QSFP56 DAC, so the switch only carries management traffic for them. The switch is not on Tailscale; Prometheus scrapes it over SNMP (`snmp-switch` job).

## SSH Access

All nodes use Tailscale IPs and key-based auth via `~/.ssh/config` aliases (no passwords):

```bash
ssh spark       # DGX Spark #1
ssh spark2      # DGX Spark #2 — use the config alias; bare MagicDNS lacks User/IdentityFile
ssh strix       # Framework Desktop (AMD)
ssh pi          # monitoring
ssh framework   # Docker + MAAS
ssh mac-mini    # macOS runner
```

Secrets are never stored in this plugin: tokens live in environment variables on the machines that use them.
