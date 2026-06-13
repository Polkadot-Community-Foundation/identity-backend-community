# Grafana dashboards & alerts

One dashboard. Seven panels. Three questions answered.

## What the business needs to know

This is a username-registration service. The dashboard and alerts answer only the
questions an on-call has to be able to answer in five seconds:

1. **Are people registering right now?** → top-row stat "Registrations completing now"
2. **Are people being hurt?** → p95 latency, 5xx error ratio, succeeded-vs-failed
3. **Is the chain keeping up?** → finalized block height, daemon heartbeat/leader

Everything else (per-stage latency, daemon tick failures, DIM pool, push delivery
breakdowns, etc.) is one Grafana drill-down away in the Explore view against the
underlying metric series. It is NOT on the landing page because operators do not
scroll.

## Source of truth

The metrics queried here are defined in the application code:

| File                                                                                           | Domain                     |
| ---------------------------------------------------------------------------------------------- | -------------------------- |
| `apps/identity-backend/src/metrics/http.ts`                                                    | HTTP RED                   |
| `apps/identity-backend/src/middleware/rate-limit.middleware.ts`                                | Rate limiting              |
| `apps/identity-backend/src/metrics/people.ts`                                                  | Username registration      |
| `apps/identity-backend/src/username-registration/registration-queue/metrics.ts`                | Registration queue         |
| `apps/identity-backend/src/supervision/individuality-indexer/individuality-indexer.metrics.ts` | Indexer                    |
| `apps/identity-backend/src/supervision/chain-metrics/workers/*`                                | Blockchain                 |
| `apps/identity-backend/src/features/dim/invitation-ticket.metrics.ts`                          | DIM invitation tickets     |
| `apps/identity-backend/src/features/dim/dim-ticket.metrics.ts`                                 | DIM ticket registration    |
| `apps/identity-backend/src/features/subscriptions/telemetry.ts`                                | Push notifications         |
| `apps/identity-backend/src/metrics/dotns-gateway.ts`                                           | dotNS gateway              |
| `apps/identity-backend/src/batch-backoff/batch-backoff.executor.ts`                            | Reactive batch sizing      |
| `packages/lib/effect-daemon-spec/src/daemon-metrics.ts`                                        | Daemon health & supervisor |

When you add a new metric to one of those files, decide:

- **Is it on the landing dashboard's critical path?** Update `dashboards/identity-backend.json`.
- **Is it a wake-someone-up signal?** Update `alerting/rules.yaml`.
- **Neither?** The Explore view against the metric name is enough. No JSON edit needed.

## Naming: Effect → Prometheus

Effect's `Metric.counter("app.x.y", ...)` becomes `app_x_y_total` in Prometheus.
Dots become underscores; counters get a `_total` suffix. Histograms emit
`<name>_bucket`, `<name>_sum`, `<name>_count`. Gauges keep the bare name. The
`time_unit="milliseconds"` label that Effect timer helpers add does NOT change the
metric name — only the value unit (which the panel's `fieldConfig.unit` honors).

This naming is the OTel SDK's, not ours. See
`node_modules/@opentelemetry/exporter-prometheus/build/src/PrometheusSerializer.js`
and `node_modules/@effect/opentelemetry/dist/cjs/internal/metrics.js` if you
need to verify the transform.

## Provisioning

The Dockerfile copies the dashboards and rules into the LGTM image's provisioning
directory. Grafana loads them on container start. To make a change land in the
running stack, rebuild and redeploy the LGTM service.

## Open items — wiring the alert webhook

The alert webhook URL is supplied by the SST secret `GrafanaWebhookUrl`
(declared in `infra/secrets.ts` next to the other deployment config). The
render flow:

1. `infra/observability/grafana/alerting/contact-points.template.yaml` — the
   git-committed source containing the literal `{{GRAFANA_WEBHOOK_URL}}` token.
2. `scripts/render-contact-points.ts` reads the secret (or
   `process.env.GRAFANA_WEBHOOK_URL` for local runs), substitutes the token, and
   writes `infra/observability/grafana/alerting/contact-points.yaml`. The
   script fails loud if the secret is unset or the token is still present after
   substitution.
3. The Dockerfile `COPY`s the rendered `contact-points.yaml` verbatim into the
   LGTM image. Grafana file-provisions it on container start.

Operator workflow (one-time per stage):

```sh
sst secret set GrafanaWebhookUrl https://hooks.your-internal-domain/alerts
pnpm observability:render-contact-points
pnpm sst deploy   # rebuilds the LGTM image with the resolved URL
```

If the rendered file is still missing the token at deploy time (e.g. someone
forgot to run the renderer), Grafana will log a provisioning error on container
start — the misconfiguration is loud, not silent.

The chosen follow-up should also remove the
`PROMETHEUS_DATASOURCE_UID` placeholder from `alerting/rules.yaml` — it has to
be set per-environment after first dashboard import.

## LGTM is the only observability stack

The LGTM container in `infra/observability.ts` is self-hosted and authoritative.
There is no Grafana Cloud fallback. The `OTEL_EXPORTER_OTLP_ENDPOINT` env var on
the app service points at this stack; the dashboard JSON, alert rules, and
contact points in this directory are the production observability surface.
