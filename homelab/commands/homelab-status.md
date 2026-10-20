---
description: Fleet health check across all homelab nodes (uptime, load, memory, disk, Spark GPU).
---

Use the `mcp__plugin_homelab_homelab-ssh__node_status` tool with `node: "all"` to get health for every node. Summarize as a compact table: node, reachable?, load, mem used/total, disk used%, and for **both Sparks** the GPU utilization/temp, free memory headroom, and the `spark-mode` line (run `~/bin/spark-mode status` on `spark` and `spark2` via `ssh_exec`: mode, whether the probe is OK — that probe is the evidence a box is serving, not process state). Flag anything concerning (offline node, >85% mem/disk, GPU hot). Keep it to the table plus one line of takeaway.
