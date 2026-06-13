# Cloudflare Edge — Operator Reference

> The CDN sits in front of the Fargate service. The DNS record is
> `proxied: true`, WAF and rate-limit rules live here (not on the
> origin's ALB), and Authenticated Origin Pulls is the mTLS safety net
> that locks the origin to Cloudflare-sourced traffic. Code in
> `infra/edge.ts`; dashboard navigation is below for 3 AM incidents.

## What `proxied: true` means

Cloudflare terminates the TLS handshake, runs the rulesets, and
forwards to the origin over the Cloudflare backbone. The origin never
sees the client's raw IP — it sees a Cloudflare edge IP and a
`CF-Connecting-IP` header. The HTTP request path is:

```
client ──TLS──▶ Cloudflare edge
                │
                ├─ Ruleset phase http_request_firewall_managed
                │     (Cloudflare Managed Ruleset + Cloudflare Specials)
                ├─ Ruleset phase http_request_firewall_custom
                │     (block /admin, /debug, /healthcheck, /livez,
                │      /readyz, /metrics + UA firewall)
                ├─ Ruleset phase http_ratelimit
                │     (per-endpoint class, plan-aware)
                │
                └─▶ origin (ALB) ──▶ Fargate ──▶ RDS / LGTM
```

## Per-plan rate-limit rule quotas

The repo enforces these at deploy time via `assertPlanQuotaFits`. A
quota overage causes Cloudflare to **silently disable** the overage
rules and email the account owner — the deploy-time check is the
safety net.

| Phase                           | Free | Pro | Business | Enterprise |
| ------------------------------- | ---- | --- | -------- | ---------- |
| `http_ratelimit`                | 1    | 2   | 5        | 5+         |
| `http_request_firewall_custom`  | 5    | 20  | 100      | 100+       |
| `http_request_firewall_managed` | 5    | 20  | 100      | 100+       |

Source: <https://developers.cloudflare.com/waf/rate-limiting-rules/>
and <https://developers.cloudflare.com/waf/custom-rules/>.

## Plan-aware rule shape

`infra/edge.ts#rulesFor` emits one of three rule sets:

- **`business` plan** — one rule per `ENDPOINT_CLASS` (5 classes:
  `token_refresh`, `handshake`, `registration`, `public_reads`,
  `authenticated_actions`). Each rule keys on
  `['cf.colo.id', 'cf.unique_visitor_id']` (the Business-only
  `cf.unique_visitor_id` characteristic, paired with
  `countingExpression` to count only `401`/`403` responses for the
  handshake class). **5 rules emitted, hits the plan quota exactly.**
- **`pro` plan** — collapses to 2 coarse `ip.src`-keyed rules (no-
  principal paths + authenticated paths). **2 rules emitted.**
- **`free` plan** — single coarse rule. **1 rule emitted.**

The Business plan is the default production profile. Free/Pro are for
dev/staging where the per-class granularity is unnecessary.

## Rule fields and value sets

```ts
ratelimit: {
  characteristics: ['ip.src', 'cf.colo.id'],   // the keying tuple
  period: 60,                                  // 10|60|120|300|600|3600
  requestsPerPeriod: 30,                       // positive integer
  mitigationTimeout: 60,                       // 0|10|60|120|300|600|3600|86400
  // OPTIONAL: countingExpression: '<expr> and http.response.code in {401 403}'
}
```

A rule using `cf.unique_visitor_id` requires the Business plan and
returns a Cloudflare API error on lower plans.

## Custom firewall rules

Three rules in `http_request_firewall_custom`, action `block`:

1. **`block_internal_only_paths`** — exact-match on
   `/healthcheck`, `/livez`, `/readyz`, `/metrics`, `/admin`, `/admin/`,
   `/debug/heapdump`, `/debug/memory`, `/debug/query`.
2. **`block_internal_only_prefixes`** — prefix-match on `/admin/`,
   `/debug/` (belt-and-suspenders for future route additions).
3. **`block_scripted_user_agents`** — UA contains one of `curl`,
   `python-requests`, `Go-http-client`, `Wget`, `okhttp`, `Scrapy`,
   `libwww-perl`.

These rules do not affect the ALB's VPC-internal health checks
(those bypass Cloudflare and hit the targets directly).

## Managed WAF

Two `execute` rules in `http_request_firewall_managed`:

- **Cloudflare Managed Ruleset** (`4814384a9e5d4991b9815dcfc25d2f1f`)
  — the OWASP / SQLi / Known Bad Inputs set. `sensitivity_level: 'medium'`
  with `cerberus_ai.ruleset_scanner_detection.enabled: false` (the
  scanner-detection rules cause false positives on legitimate mobile
  clients; disabling them is the documented override).
- **Cloudflare Specials** (`fb27a10a6b3d4eb1acae8c2a092d2a1f`) — 0-day
  and anomaly mitigations rolled out by Cloudflare.

Both run at `action: 'execute'`, `enabled: true`, `version: 'latest'`.

## Authenticated Origin Pulls (mTLS)

`infra/edge.ts` calls:

```ts
new cloudflare.AuthenticatedOriginPulls('OriginPulls', {
  zoneId: input.zoneId,
  configs: [{ enabled: true }],
})
```

This makes Cloudflare present a client cert to the origin at the TLS
handshake. The origin's ALB is configured (via `sst.aws.Service` →
`loadBalancer`) to require a valid Cloudflare-issued cert. **Any
traffic that does not come from Cloudflare is rejected at the TLS
layer** — port scans, direct IP hits, and accidental DNS-unproxy are
all blocked before they reach Hono.

## Dashboard navigation (for the 3 AM incident)

| Task                                | Path                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------ |
| View current rulesets               | Account home → select zone → **Security** → **WAF** → **Custom Rules** / **Managed Rules** |
| View live block events (per-rule)   | **Security** → **Events** → filter by rule name                                            |
| Inspect rate-limit hit counts       | **Security** → **Analytics** → **Activity log** or **Security** → **Overview**             |
| Toggle Authenticated Origin Pulls   | **SSL/TLS** → **Edge Certificates** → **Authenticated Origin Pulls** → zone toggle         |
| Edit DNS record (re-proxied toggle) | **DNS** → **Records** → click the record → orange-cloud toggle                             |
| Inspect a specific 4xx/5xx response | **Security** → **Events** → filter `http.response.code = 403` or `= 429`                   |

## Rule-order precedence

Within a single ruleset phase, rules execute **in the order returned
by the API**, which is the declaration order. The first matching rule
wins; later rules see requests that the earlier rules passed. In
practice this matters when you combine block + skip rules.

## Testing a rule (log-only)

Change the action from `'block'` to `'log'` (or add an explicit
`enabled: false` to the rule). The dashboard's **Events** page will
show matching traffic without it being blocked. Always log-test a new
rule for 24 hours before flipping it to `block` in production.

## Source

- Cloudflare WAF root: <https://developers.cloudflare.com/waf/>
- Rate-limit rules: <https://developers.cloudflare.com/waf/rate-limiting-rules/>
- Custom rules: <https://developers.cloudflare.com/waf/custom-rules/>
- Managed rules: <https://developers.cloudflare.com/waf/managed-rules/>
- Authenticated Origin Pulls: <https://developers.cloudflare.com/fundamentals/origin-pull-auth/>
