#!/usr/bin/env bun
/**
 * Render `infra/observability/grafana/alerting/contact-points.yaml` from
 * `contact-points.template.yaml`, substituting the alert webhook URL read
 * from the SST secret `GrafanaWebhookUrl` (or `process.env.GRAFANA_WEBHOOK_URL`
 * for local runs / CI dry-runs).
 *
 * Run from the repo root:
 *   pnpm observability:render-contact-points
 * or directly:
 *   bun scripts/render-contact-points.ts
 *
 * Why this is a separate script (not baked into the SST service or Dockerfile):
 *   - `sst.aws.Service.image` does not accept Docker build args, so the URL
 *     cannot be templated at synth time without a refactor.
 *   - Grafana's file provisioner does not expand env vars in contact-point
 *     `settings.url`, so the URL has to be in the file.
 *   - The cleanest fix is a pre-build render: read the secret, write the
 *     resolved file, let the Dockerfile COPY it verbatim. CI/operators run
 *     the script; the rendered output is committable but ignored in practice.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const TEMPLATE_PATH = 'infra/observability/grafana/alerting/contact-points.template.yaml'
const OUTPUT_PATH = 'infra/observability/grafana/alerting/contact-points.yaml'
const TOKEN = '__GRAFANA_WEBHOOK_URL__'

const args = new Map<string, string>()
for (let i = 2; i < process.argv.length; i += 2) {
  const k = process.argv[i]
  const v = process.argv[i + 1]
  if (k === undefined || v === undefined) continue
  if (k.startsWith('--')) args.set(k.slice(2), v)
}

const webhookUrl = args.get('url') ?? process.env.GRAFANA_WEBHOOK_URL ?? ''
if (webhookUrl.length === 0 || webhookUrl.includes(TOKEN)) {
  console.error('render-contact-points: GRAFANA_WEBHOOK_URL is unset or still contains the template token.')
  console.error('Set the SST secret (`sst secret set GrafanaWebhookUrl https://...`) and re-run,')
  console.error('or pass --url https://hooks.example/webhook for a one-off render.')
  process.exit(1)
}

const repoRoot = resolve(dirname(import.meta.dir))
const templatePath = join(repoRoot, TEMPLATE_PATH)
const outputPath = join(repoRoot, OUTPUT_PATH)

const template = readFileSync(templatePath, 'utf8')
if (!template.includes(TOKEN)) {
  console.error(`render-contact-points: template at ${templatePath} does not contain the expected token ${TOKEN}.`)
  process.exit(1)
}

const rendered = template.replaceAll(TOKEN, webhookUrl)
mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, rendered, 'utf8')

console.log(`render-contact-points: wrote ${outputPath} (webhook host: ${new URL(webhookUrl).host})`)
