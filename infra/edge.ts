import { deriveDefaultLimits, sharedNatClause } from '@identity-backend/rate-limit-sizing'
import { Match, Option } from 'effect'

export interface EdgePolicyInput {
  readonly zoneId: $util.Input<string>
  readonly plan: 'free' | 'pro' | 'business'
  readonly profile: 'shared-nat' | 'global'
  readonly sharedNatCidrs: readonly string[]
  readonly population: number
  readonly pods: number
}

type Plan = EdgePolicyInput['plan']

// Per-plan rule quotas, sourced from Cloudflare WAF docs (zone-level rules per phase):
//   http_ratelimit:                free=1, pro=2, business=5
//   http_request_firewall_custom:  free=5, pro=20, business=100
// Bumping a rule count above the quota causes Cloudflare to silently disable the
// over-quota rules (and email the account owner), so `applyEdgePolicy` runs an
// `assertPlanQuotaFits` check at deploy time on every plan's ruleset.
const PLAN_LIMITS = {
  free: { firewall: 5, rateLimit: 1 },
  pro: { firewall: 20, rateLimit: 2 },
  business: { firewall: 100, rateLimit: 5 },
} as const satisfies Record<Plan, { readonly firewall: number; readonly rateLimit: number }>

// Runtime quota assertion. Throws at deploy time if any ruleset on the active
// plan exceeds the per-phase quota. This is the deploy-time safety net for
// Cloudflare's silent rule-disable behavior on quota overage.
const assertPlanQuotaFits = (plan: Plan, phase: 'firewall' | 'rateLimit', ruleCount: number): void => {
  const limit = PLAN_LIMITS[plan][phase]
  if (ruleCount > limit) {
    throw new Error(
      `Cloudflare plan '${plan}' allows ${limit} rules in the ${phase} phase, ` +
        `but ${ruleCount} rules were configured. Cloudflare silently disables over-quota ` +
        `rules — reduce the rule count or upgrade the plan.`,
    )
  }
}

const RATE_LIMIT_RESPONSE = JSON.stringify({
  type: 'https://problems-registry.smartbear.com/too-many-requests',
  title: 'Too Many Requests',
  detail: 'Rate limit exceeded.',
  status: 429,
})

const jsonResponse = {
  response: { statusCode: 429, contentType: 'application/json', content: RATE_LIMIT_RESPONSE },
}

const PERIOD = 60
const CF_VISITOR = ['cf.colo.id', 'cf.unique_visitor_id']
const IP_SRC = ['ip.src', 'cf.colo.id']
const FAILED_AUTH = 'http.response.code in {401 403}'

interface EndpointClass {
  readonly ref: string
  readonly description: string
  readonly paths: readonly string[]
  readonly requestsPerMinute: number
  readonly blockSeconds: number
  readonly countFailedAuthOnly: boolean
}

const ENDPOINT_CLASSES: readonly EndpointClass[] = [
  {
    ref: 'token_refresh',
    description: 'Token refresh',
    paths: ['/api/v1/token/refresh'],
    requestsPerMinute: 30,
    blockSeconds: 60,
    countFailedAuthOnly: false,
  },
  {
    ref: 'handshake',
    description: 'JWT-auth handshake (challenge, attestation, token)',
    paths: ['/api/v1/auth/'],
    requestsPerMinute: 10,
    blockSeconds: 120,
    countFailedAuthOnly: true,
  },
  {
    ref: 'registration',
    description: 'Registration',
    paths: ['/api/v1/registration'],
    requestsPerMinute: 10,
    blockSeconds: 60,
    countFailedAuthOnly: false,
  },
  {
    ref: 'public_reads',
    description:
      'Public reads and proof-of-compute issuance (search, availability, schemas, vapid, attester, poc/issue)',
    paths: [
      '/api/v1/usernames/search',
      '/api/v1/usernames/available',
      '/api/v1/schemas',
      '/api/v1/subscriptions/vapid-public-key',
      '/api/v1/attester',
      '/api/v1/poc/issue',
    ],
    requestsPerMinute: 60,
    blockSeconds: 60,
    countFailedAuthOnly: false,
  },
  {
    ref: 'authenticated_actions',
    description: 'Authenticated actions (subscriptions, notify, tickets, turn, usernames)',
    paths: [
      '/api/v1/subscriptions',
      '/api/v1/notify',
      '/api/v1/invitation-ticket',
      '/api/v1/dim-ticket',
      '/api/v1/turn',
      '/api/v1/usernames',
    ],
    requestsPerMinute: 30,
    blockSeconds: 60,
    countFailedAuthOnly: false,
  },
]

const byRef = (...refs: readonly string[]) =>
  ENDPOINT_CLASSES.filter((c) => refs.includes(c.ref)).flatMap((c) => c.paths)
const NO_PRINCIPAL_PATHS = byRef('token_refresh', 'handshake', 'public_reads')
const AUTHENTICATED_PATHS = byRef('registration', 'authenticated_actions')
const ALL_RATE_LIMITED_PATHS = ENDPOINT_CLASSES.flatMap((c) => c.paths)
const OVERSIZED_BODY_CAP_PATHS = [...byRef('handshake'), '/api/v1/notify']

const pathPredicate = (path: string) => `http.request.uri.path starts_with "${path}"`
const anyPath = (paths: readonly string[]) => `(${paths.map(pathPredicate).join(' or ')})`

const exclusionClause = (earlierPaths: readonly string[]) =>
  Option.liftPredicate(earlierPaths, (paths) => paths.length > 0).pipe(
    Option.map((paths) => ` and not ${anyPath(paths)}`),
    Option.getOrElse(() => ''),
  )

const countingClause = (countFailedAuthOnly: boolean, expression: string) =>
  Match.value(countFailedAuthOnly).pipe(
    Match.when(true, () => ({ countingExpression: `${expression} and ${FAILED_AUTH}` })),
    Match.when(false, () => ({})),
    Match.exhaustive,
  )

const responseClause = (withResponse: boolean) =>
  Match.value(withResponse).pipe(
    Match.when(true, () => ({ actionParameters: jsonResponse })),
    Match.when(false, () => ({})),
    Match.exhaustive,
  )

interface Keying {
  readonly characteristics: readonly string[]
  readonly failedAuthCounting: boolean
}

const perClassRules = (keying: Keying): ReturnType<typeof perClassRule>[] => {
  return ENDPOINT_CLASSES.map((cls, index) => perClassRule(cls, index, keying))
}

const perClassRule = (cls: EndpointClass, index: number, keying: Keying) => {
  const earlierPaths = ENDPOINT_CLASSES.slice(0, index).flatMap((earlier) => earlier.paths)
  const expression = anyPath(cls.paths) + exclusionClause(earlierPaths)
  return {
    ref: cls.ref,
    description: cls.description,
    expression,
    action: 'block',
    ratelimit: {
      characteristics: [...keying.characteristics],
      period: PERIOD,
      requestsPerPeriod: cls.requestsPerMinute,
      mitigationTimeout: cls.blockSeconds,
      ...countingClause(cls.countFailedAuthOnly && keying.failedAuthCounting, expression),
    },
    ...responseClause(true),
  }
}

const ipRule = (cfg: {
  readonly ref: string
  readonly description: string
  readonly expression: string
  readonly requestsPerMinute: number
  readonly withResponse: boolean
}) => ({
  ref: cfg.ref,
  description: cfg.description,
  expression: cfg.expression,
  action: 'block',
  ratelimit: {
    characteristics: IP_SRC,
    period: PERIOD,
    requestsPerPeriod: cfg.requestsPerMinute,
    mitigationTimeout: 60,
  },
  ...responseClause(cfg.withResponse),
})

const COARSE =
  'Coarse ip.src bucket (plan allows few rate-limit rules). In a shared-NAT profile this cannot distinguish principals behind one IP; the origin per-JWT limiter is the per-principal control.'

const collapsedRules = (input: EdgePolicyInput, withResponse: boolean, twoRules: boolean) => {
  const derived = deriveDefaultLimits(input.population, input.pods)
  if (input.sharedNatCidrs.length > 0) {
    const offNat = ipRule({
      ref: 'off_shared_nat',
      description:
        `All rate-limited paths from IPs outside the configured shared-NAT egress — a tight per-IP bucket sized to one principal's peak in infra/rate-limit-sizing.ts. ${COARSE}`,
      expression: `${anyPath(ALL_RATE_LIMITED_PATHS)} and not ${sharedNatClause(input.sharedNatCidrs)}`,
      requestsPerMinute: derived.offNatPerIpRpm,
      withResponse,
    })
    if (!twoRules) {
      return [offNat]
    }
    const sharedNat = ipRule({
      ref: 'shared_nat',
      description:
        'Configured shared-NAT egress IP(s) where one public IP fronts many principals (CGNAT, conference / office WiFi). Ceiling derived in infra/rate-limit-sizing.ts as min(population peak demand, tightest class capacity); per-principal control is the per-JWT origin limiter, proof-of-compute on search, and platform attestation on the bootstrap. This ceiling only caps a catastrophic edge-bypass flood from the shared IP.',
      expression: `${anyPath(ALL_RATE_LIMITED_PATHS)} and ${sharedNatClause(input.sharedNatCidrs)}`,
      requestsPerMinute: derived.sharedNatCeilingRpm,
      withResponse,
    })
    return [sharedNat, offNat]
  }

  const first = ipRule({
    ref: 'no_principal',
    description:
      `No-principal and public paths. No shared-NAT egress configured, so this coarse bucket uses the shared-NAT ceiling from infra/rate-limit-sizing.ts — any IP may front a NAT, and false-loose (bounded by per-JWT, proof-of-compute, attestation) is safer than nuking an unconfigured NAT. ${COARSE}`,
    expression: anyPath(NO_PRINCIPAL_PATHS),
    requestsPerMinute: derived.sharedNatCeilingRpm,
    withResponse,
  })
  return Match.value(twoRules).pipe(
    // sst@4 / @pulumi/cloudflare 6.17.0: the Ruleset arg expects a mutable
    // `Input<Input<RulesetRule>[]>`. The `as const` tuple type from the v3
    // code was rejected. Spread to a fresh mutable array.
    Match.when(false, () => [first]),
    Match.when(true, () => [
      first,
      ipRule({
        ref: 'authenticated',
        description:
          `Authenticated paths flood guard, sized to the shared-NAT ceiling from infra/rate-limit-sizing.ts. ${COARSE}`,
        expression: anyPath(AUTHENTICATED_PATHS),
        requestsPerMinute: derived.sharedNatCeilingRpm,
        withResponse,
      }),
    ]),
    Match.exhaustive,
  )
}

const keyingFor = (input: EdgePolicyInput): Keying =>
  Match.value(input).pipe(
    Match.when(
      { profile: 'shared-nat', plan: 'business' },
      () => ({ characteristics: CF_VISITOR, failedAuthCounting: true }),
    ),
    Match.orElse(() => ({ characteristics: IP_SRC, failedAuthCounting: false })),
  )

const rulesFor = (input: EdgePolicyInput) => {
  // Each plan emits a different number of rate-limit rules (1/2/5) sized exactly
  // to that plan's Cloudflare quota. `assertPlanQuotaFits` verifies the count
  // at deploy time; a misconfigured addition over the quota throws before SST
  // talks to Cloudflare's API (where it would silently disable the overage).
  const rules = Match.value(input.plan).pipe(
    Match.when('business', () => perClassRules(keyingFor(input))),
    Match.when('pro', () => collapsedRules(input, true, true)),
    Match.when('free', () => collapsedRules(input, false, false)),
    Match.exhaustive,
  )
  assertPlanQuotaFits(input.plan, 'rateLimit', rules.length)
  return rules
}

const BLOCKED_USER_AGENTS = ['curl', 'python-requests', 'Go-http-client', 'Wget', 'okhttp', 'Scrapy', 'libwww-perl']

// Path families that MUST NEVER be reachable from the public internet.
//   - Health-check / observability: ALB / container probes hit these inside the VPC,
//     not through the edge, so blocking at the edge does not affect health checks.
//   - Admin: gated at the origin by basic-auth, but a leaked or guessed credential
//     is still a public-internet attack surface (e.g. /admin/nuke wipes the database).
//     Defense in depth: block at the edge AND at the origin.
//   - Debug: feature-flagged off in production (returns 404 at the origin) but the
//     heapdump / memory / query routes expose in-memory secrets and proxy DB reads.
//     Treat them as always-on attack surface at the edge.
const INTERNAL_ONLY_PATHS = [
  '/healthcheck',
  '/livez',
  '/readyz',
  '/metrics',
  // Admin tree — root + every sub-path. /admin itself is the basic-auth gate
  // and is mounted as `app.route('/admin', adminRoute)` in apps/identity-backend/src/app.ts.
  '/admin',
  '/admin/',
  // Debug tree — three independent mounts, each with its own feature flag.
  '/debug/heapdump',
  '/debug/memory',
  '/debug/query',
]

// Prefix-based block: any sub-path under a sensitive tree is also blocked,
// even if the exact path is not enumerated above (future additions, URL-encoded
// variants, trailing-slash tricks, or paths the origin mounts later). This is
// the fail-closed second gate — if the exact-match rule ever misses, the prefix
// rule still blocks.
const INTERNAL_ONLY_PATH_PREFIXES = [
  '/admin/',
  '/debug/',
]

export function applyEdgePolicy(input: EdgePolicyInput) {
  new cloudflare.Ruleset('RateLimit', {
    zoneId: input.zoneId,
    name: 'identity-backend-rate-limit',
    kind: 'zone',
    phase: 'http_ratelimit',
    rules: rulesFor(input),
  })
  // Custom firewall rules. Today we ship 4 rules (path block, prefix block,
  // UA block, oversized-tight-cap-body block); the count is verified at deploy
  // time against the active plan's `http_request_firewall_custom` quota via
  // `assertPlanQuotaFits`.
  const customFirewallRules = [
    {
      ref: 'block_internal_only_paths',
      description:
        'Operational, admin, and debug endpoints (liveness, readiness, metrics, /admin, /debug/*) must not be reachable from the public internet. The ALB health check hits /healthcheck, /livez, /readyz, /metrics inside the VPC, not through the edge, so blocking them here does not affect health checks. Admin routes are basic-auth gated at the origin; debug routes are feature-flagged off in production. This edge block is the fail-closed first gate — a leaked credential or a misconfigured feature flag must never reach the origin.',
      expression: `(http.request.uri.path in {${INTERNAL_ONLY_PATHS.map((p) => `"${p}"`).join(' ')}})`,
      action: 'block',
    },
    {
      ref: 'block_internal_only_prefixes',
      description:
        'Belt-and-suspenders prefix block for the /admin and /debug path families. Catches any sub-path not enumerated in block_internal_only_paths (future route additions, URL-encoded variants, trailing-slash tricks, paths the origin mounts later). Independent of the exact-match rule above — if that one ever misses, this still blocks. The official app never calls /admin/* or /debug/* over the public internet; only operator machines inside the VPC (via direct ALB access) and the explicit debug-username flow are expected.',
      expression: INTERNAL_ONLY_PATH_PREFIXES.map((p) => `(http.request.uri.path starts_with "${p}")`).join(' or '),
      action: 'block',
    },
    {
      ref: 'block_scripted_user_agents',
      description: 'Block scripted clients the official app never sends. IP-independent; contains works on all plans.',
      expression: BLOCKED_USER_AGENTS.map((ua) => `(http.user_agent contains "${ua}")`).join(' or '),
      action: 'block',
    },
    {
      ref: 'block_oversized_tight_cap_bodies',
      description: 'Block oversized bodies on the tight-cap route families before they reach the origin. ' +
        'These are the handshake paths (/api/v1/auth/*) and the push notify paths (/api/v1/notify/*) — the ' +
        'two families the per-route Hono body-size gate caps at MAX_BODY_BYTES_HANDSHAKE (default 16 KB). This ' +
        'edge rule catches bodies over 64 KB on those paths at the CDN, saving origin bandwidth and memory; the ' +
        'origin gate still enforces the tighter 16 KB cap on anything under 64 KB.',
      expression: `(http.request.body.size gt 65536) and ${anyPath(OVERSIZED_BODY_CAP_PATHS)}`,
      action: 'block',
    },
  ]

  assertPlanQuotaFits(input.plan, 'firewall', customFirewallRules.length)

  new cloudflare.Ruleset('CustomFirewall', {
    zoneId: input.zoneId,
    name: 'identity-backend-custom-firewall',
    kind: 'zone',
    phase: 'http_request_firewall_custom',
    rules: customFirewallRules,
  })

  // Managed WAF — Cloudflare's OWASP ModSecurity Core Rule Set and friends.
  // Replaces any origin-cloud managed rule groups: the only path to the origin
  // is through this proxy, so managed protection belongs at the edge in IaC,
  // not duplicated in the origin's load-balancer WAF. The
  // `http_request_firewall_managed` phase has its own (higher) per-plan quota;
  // we assert against the `http_request_firewall_custom` limit as a safety
  // margin so a future addition here cannot silently break free either.
  const managedWafRules = [
    {
      ref: 'owasp_crs',
      description: 'Cloudflare Managed Ruleset — OWASP ModSecurity Core Rule Set',
      expression: 'true',
      action: 'execute',
      actionParameters: {
        id: '4814384a9e5d4991b9815dcfc25d2f1f',
        version: 'latest',
        overrides: {
          sensitivityLevel: 'medium',
          rules: [
            {
              id: 'ruleset_cerberus_ai.ruleset_scanner_detection',
              enabled: false,
            },
          ],
        },
      },
      enabled: true,
    },
    {
      ref: 'cloudflare_specials',
      description: 'Cloudflare Specials — anomaly / 0-day mitigations',
      expression: 'true',
      action: 'execute',
      actionParameters: {
        id: 'fb27a10a6b3d4eb1acae8c2a092d2a1f',
        version: 'latest',
      },
      enabled: true,
    },
  ]

  assertPlanQuotaFits(input.plan, 'firewall', managedWafRules.length)

  new cloudflare.Ruleset('ManagedWaf', {
    zoneId: input.zoneId,
    name: 'identity-backend-managed-waf',
    kind: 'zone',
    phase: 'http_request_firewall_managed',
    rules: managedWafRules,
  })

  new cloudflare.AuthenticatedOriginPulls('OriginPulls', {
    zoneId: input.zoneId,
    configs: [{ enabled: true }],
  })
}
