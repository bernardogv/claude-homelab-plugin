# Monitoring Stack (Pi)

Config-as-code Prometheus/Grafana stack on pi (Docker Compose project `monitoring`).

## Service URLs

| Service | URL |
|---------|-----|
| Prometheus | http://100.64.0.13:9090 |
| Alertmanager | http://100.64.0.13:9093 |
| Grafana | http://100.64.0.13:3000 |

## Stack Composition

- **Prometheus** — metrics collection
- **Alertmanager → Discord** via a small `alert-forwarder` container
- **Grafana** — datasource + dashboards provisioned as code
- **blackbox-exporter** — ping/HTTP probes
- **node-exporter**, **cAdvisor** — host and container metrics
- **DCGM exporter** — GPU metrics on the Sparks
- **snmp-exporter** — the core switch (not on Tailscale, so a static `snmp-switch` job)
- **`tailscale-sd` sidecar** — FastAPI service; queries the Tailscale API via a read-only OAuth client (`devices:read`) and serves `http_sd` targets to Prometheus. The devices API has no `online` field, so the sidecar filters by tag only.

## Dynamic Tag-Based Discovery

**To monitor a new device: tag it in the Tailscale admin console. No config edits.**

| Tag | Exporter | Port |
|-----|----------|------|
| `tag:monitored` | node-exporter | :9100 |
| `tag:monitored` + `tag:gpu` | DCGM exporter | :9400 |
| `tag:monitored` + `tag:docker` | cAdvisor | :9103 |

Instance labels come from each device's OS hostname, not its name in the Tailscale console — renaming a device in the console does not fix a wrong label; `hostnamectl set-hostname` on the box does.

## Secrets

Secrets live only in the stack's gitignored `.env` on pi (Tailscale OAuth client, Discord webhook, Grafana admin password, SNMP community). Never committed.

## Querying Prometheus (answer with trends, not ssh snapshots)

Prometheus is reachable over the tailnet — no ssh needed. Prefer a PromQL query over
`ssh_exec` + `free`/`top` whenever the question is about state over time
("is spark's memory trending up", "how hot did the GPU get today").

```bash
# instant query
curl -s 'http://100.64.0.13:9090/api/v1/query' --data-urlencode 'query=<PROMQL>'
# range query (e.g. last 6h at 5m steps)
curl -s 'http://100.64.0.13:9090/api/v1/query_range' \
  --data-urlencode 'query=<PROMQL>' \
  --data-urlencode "start=$(date -v-6H +%s)" --data-urlencode "end=$(date +%s)" \
  --data-urlencode 'step=300'
```

Canned queries for the usual questions:

| Question | PromQL |
|----------|--------|
| What's up/down right now | `up` |
| Memory headroom per node | `node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes` |
| CPU busy % per node | `100 - avg by(instance)(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100` |
| Disk free % per mount | `node_filesystem_avail_bytes{fstype!~"tmpfs|overlay"} / node_filesystem_size_bytes` |
| Spark GPU util / temp | `DCGM_FI_DEV_GPU_UTIL` / `DCGM_FI_DEV_GPU_TEMP` |
| Container memory | `container_memory_working_set_bytes{name!=""}` |
| Service probes | `probe_success` |
| Switch temps / fan | `mtxrGaugeValue{job="snmp-switch"}` (by `mtxrGaugeName`) |
| Switch per-port traffic | `rate(ifHCInOctets{job="snmp-switch"}[5m])*8` (by `ifName`) |

If a node is missing from results entirely, its exporter or tag is broken — check `up` and the
tailscale-sd targets before trusting a "no data" answer.

## Troubleshooting Alerts

1. Alertmanager: http://100.64.0.13:9093
2. Forwarder logs: `ssh pi "docker logs alert-forwarder"`
3. Grafana: http://100.64.0.13:3000
