# Observability — Operator Reference

> LGTM is the only observability stack. Code in
> `infra/observability.ts` (service) and
> `infra/observability/grafana/` (provisioned dashboards, alert
> rules, contact points). The Grafana image pre-provisions four
> datasources — Prometheus, Tempo, Loki, Pyroscope — and the
> `dashboards/` + `alerting/` files are file-provisioned on
> container start.

## What ships in the LGTM container

`infra/observability/Dockerfile`:

```Dockerfile
FROM grafana/otel-lgtm:0.11.16
COPY --link grafana/dashboards.yaml        /otel-lgtm/grafana/conf/provisioning/dashboards/
COPY --link grafana/dashboards/*.json      /otel-lgtm/grafana/conf/provisioning/dashboards/identity-backend/
COPY --link grafana/alerting/rules.yaml    /otel-lgtm/grafana/conf/provisioning/alerting/
COPY --link grafana/alerting/contact-points.yaml /otel-lgtm/grafana/conf/provisioning/alerting/
```

The base image pre-provisions four datasources (literal UIDs):

| Datasource | UID          | Use                       |
| ---------- | ------------ | ------------------------- |
| Prometheus | `prometheus` | RED metrics + app metrics |
| Tempo      | `tempo`      | Distributed traces        |
| Loki       | `loki`       | Container logs (JSON)     |
| Pyroscope  | `pyroscope`  | Continuous profiling      |

`__expr__` is Grafana's expression engine (also a literal UID).
Use these UIDs verbatim in `rules.yaml` and dashboard JSON — never
parameterize.

## One dashboard, seven panels

`dashboards/identity-backend.json` answers the three questions an
on-call has in five seconds:

1. **Are people registering right now?** → top-row stat "Registrations completing now"
2. **Are people being hurt?** → p95 latency, 5xx ratio, succeeded-vs-failed
3. **Is the chain keeping up?** → finalized block height, daemon heartbeat/leader

Per-stage latency, daemon tick failures, DIM pool, push delivery
breakdowns, etc. live in Grafana Explore (drilldown from the metric
name). They are NOT on the landing page because operators do not
scroll.

## OTel → Prometheus metric rename

The OTel SDK's Prometheus exporter applies three rules:

1. **Dot → underscore** in metric and label keys
   (`http.server.request.duration` → `http_server_request_duration`).
2. Counters get a `_total` suffix. If the Effect name already ends
   in `.total` (which sanitizes to `_total`), OTel does NOT add
   another — `app.queue.cycle.total` stays `app_queue_cycle_total`.
3. Histograms emit `<name>_bucket`, `<name>_sum`, `<name>_count`.
   The unit (`s`, `ms`, `1`) goes in a `# UNIT` comment, NOT the
   name. `http.server.request.duration` (seconds) becomes
   `http_server_request_duration_bucket` — no `_seconds` suffix.

The dashboard is the canonical reference for the per-metric rename
table; verify there if a panel goes red and you suspect a metric
name.

## Alert rules

`alerting/rules.yaml` ships 9 rules. Severity is `critical` for
business-down signals and `warning` for capacity signals.

| UID                                   | Severity | Fires when                                        |
| ------------------------------------- | -------- | ------------------------------------------------- |
| `registration_p95_sla_breach`         | critical | p95 e2e registration > 90s for 10m                |
| `registrations_fully_stopped`         | critical | No `item_completed` registrations for 5m          |
| `registration_failure_storm`          | critical | > 1 registration failure/sec for 10m              |
| `http_5xx_ratio_high`                 | critical | 5xx ratio > 5% for 5m                             |
| `registration_queue_saturated`        | warning  | Queue depth > 100 for 10m                         |
| `registration_daemon_heartbeat_lost`  | critical | Daemon heartbeat < 1 for 2m                       |
| `chain_stalled`                       | critical | `blockchain_finalized_block` not advancing for 3m |
| `rate_limit_429_surge`                | warning  | > 5 req/s blocked at origin for 10m               |
| `dim_invitation_ticket_pool_depleted` | critical | DIM invitation pool < 5 for 10m                   |

## Contact points (one-time per stage)

The webhook URL lives in the SST secret `GrafanaWebhookUrl`
(declared in `infra/secrets.ts`). The file provisioner does NOT
expand env vars in `settings.url`, so the URL is baked into
`contact-points.yaml` at build time by the renderer.

**One-time per stage:**

```bash
# 1. Set the secret
pnpm sst secret set GrafanaWebhookUrl "https://hooks.slack.com/services/XXX/YYY/ZZZ" --stage <stage>

# 2. Render contact-points.yaml from the template
pnpm observability:render-contact-points

# 3. Deploy
pnpm sst deploy --stage <stage>
```

The renderer (`scripts/render-contact-points.ts`) fails loud if
the secret is unset or the `__GRAFANA_WEBHOOK_URL__` template token
survives substitution. See `infra/observability/grafana/README.md`
for the full flow.

## LGTM ports

- **3000** — Grafana UI (internal ALB only; never exposed to the
  public internet)
- **4318** — OTLP HTTP (the app sends here)
- **4317** — OTLP gRPC (not exposed; add an NLB if you need it)

## LGTM is the only observability stack

There is no Grafana Cloud fallback, no Datadog, no New Relic.
`OTEL_EXPORTER_OTLP_ENDPOINT` on every service points at the LGTM
container. Re-pointing it to a different backend is a config change
in `infra/service.ts` — not a new vendor integration.

## Production-observability upgrade path

The `grafana/otel-lgtm` image is a single container, not HA, no
object storage backend. For a real production observability stack,
point `OTEL_EXPORTER_OTLP_ENDPOINT` at a distributed Grafana Cloud
or self-hosted Loki/Tempo/Mimir on S3. **The app code does not
change** — only the OTLP destination.

## Sources

- grafana/otel-lgtm: <https://github.com/grafana/docker-otel-lgtm>
- Grafana file provisioning: <https://grafana.com/docs/grafana/latest/administration/provisioning/>
- OTel → Prometheus rename: see the OTel SDK source under
  `node_modules/@opentelemetry/exporter-prometheus/build/src/`
