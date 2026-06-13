/// <reference path="./.sst/platform/config.d.ts" />

const isProd = process.env.SST_STAGE === 'production'

const PLANS = { free: 'free', pro: 'pro', business: 'business' } as const
const PROFILES = { 'shared-nat': 'shared-nat', global: 'global' } as const

const plan = PLANS[(process.env.CLOUDFLARE_PLAN ?? '') as keyof typeof PLANS] ?? 'pro'
const profile = PROFILES[(process.env.RATE_LIMIT_PROFILE ?? '') as keyof typeof PROFILES] ?? 'shared-nat'

const PEOPLE_NETWORK_FALLBACK = 'westend2' as const

// Placeholders for the SST deployment-config keys the app's `Config` reads.
// The values match the shape each `Config` decoder expects (so the app
// boots on a fresh clone with no .env values), but they are obviously
// not real — gitleaks-clean, on-chain no-ops, and feature-flag gated in
// the app so a placeholder never matches a real attestation.
const CONFIG_PLACEHOLDERS: Record<string, string> = {
  ATTESTER_PUBLIC_KEY: '0x0000000000000000000000000000000000000000000000000000000000000000',
  ANDROID_PACKAGE_NAMES: JSON.stringify(['dev-placeholder-android-package']),
  ANDROID_SIGNING_DIGEST_PLAYSTORE: '0'.repeat(64),
  ANDROID_SIGNING_DIGEST_WEBSITE: '0'.repeat(64),
  APPLE_TEAM_ID: 'dev-placeholder-apple-team-id',
  DEVICE_CHECK_KEY_ID: 'dev-placeholder-devicecheck-key-id',
  APN_KEY_ID: 'dev-placeholder-apn-key-id',
}

const PUBLIC_WSS_ENDPOINTS = {
  paseo: { people: 'wss://people-paseo.dotters.network', assetHub: 'wss://asset-hub-paseo.dotters.network' },
  westend2: { people: 'wss://people-westend-rpc.polkadot.io', assetHub: 'wss://asset-hub-westend-rpc.polkadot.io' },
  polkadot: { people: 'wss://people-rpc.polkadot.io', assetHub: 'wss://asset-hub-rpc.polkadot.io' },
} as const

const DEPLOYMENT_CONFIG = [
  'PEOPLE_NETWORK',
  'PEOPLE_RPC_ENDPOINTS',
  'ATTESTER_PUBLIC_KEY',
  'ANDROID_PACKAGE_NAMES',
  'ANDROID_SIGNING_DIGEST_PLAYSTORE',
  'ANDROID_SIGNING_DIGEST_WEBSITE',
  'APPLE_TEAM_ID',
  'DEVICE_CHECK_KEY_ID',
  'APN_KEY_ID',
  'APN_TEAM_ID',
  'TURN_REALM',
  'WEB_PUSH_VAPID_SUBJECT',
] as const

type DeploymentConfigKey = (typeof DEPLOYMENT_CONFIG)[number]

function requireEnv(key: DeploymentConfigKey): string {
  const value = process.env[key]
  if (value === undefined || value === '') {
    throw new Error(
      `Missing required deployment config: ${key}\n` +
        `Set it in .env at the repo root or export it before running \`sst deploy\`.\n` +
        `Example: ${key}=<value> pnpm sst deploy --stage ${process.env.SST_STAGE ?? '<stage>'}`,
    )
  }
  return value
}

function envOr(key: DeploymentConfigKey, fallback: string): string {
  const value = process.env[key]
  return value !== undefined && value !== '' ? value : fallback
}

function envOrDerived(
  key: DeploymentConfigKey,
  derive: (peopleNetwork: 'paseo' | 'westend2' | 'polkadot') => string,
): string {
  const value = process.env[key]
  if (value !== undefined && value !== '') return value
  const network = (process.env.PEOPLE_NETWORK ?? PEOPLE_NETWORK_FALLBACK) as 'paseo' | 'westend2' | 'polkadot'
  return derive(network)
}

export function appDeploymentConfig(): Record<string, string> {
  const peopleNetwork = process.env.PEOPLE_NETWORK ?? PEOPLE_NETWORK_FALLBACK
  return {
    PEOPLE_NETWORK: peopleNetwork,
    PEOPLE_RPC_ENDPOINTS: envOrDerived(
      'PEOPLE_RPC_ENDPOINTS',
      (n) => PUBLIC_WSS_ENDPOINTS[n].people,
    ),
    ASSET_HUB_RPC_ENDPOINTS: envOrDerived(
      'ASSET_HUB_RPC_ENDPOINTS',
      (n) => PUBLIC_WSS_ENDPOINTS[n].assetHub,
    ),
    ATTESTER_PUBLIC_KEY: envOr('ATTESTER_PUBLIC_KEY', CONFIG_PLACEHOLDERS.ATTESTER_PUBLIC_KEY),
    ANDROID_PACKAGE_NAMES: envOr('ANDROID_PACKAGE_NAMES', CONFIG_PLACEHOLDERS.ANDROID_PACKAGE_NAMES),
    ANDROID_SIGNING_DIGEST_PLAYSTORE: envOr(
      'ANDROID_SIGNING_DIGEST_PLAYSTORE',
      CONFIG_PLACEHOLDERS.ANDROID_SIGNING_DIGEST_PLAYSTORE,
    ),
    ANDROID_SIGNING_DIGEST_WEBSITE: envOr(
      'ANDROID_SIGNING_DIGEST_WEBSITE',
      CONFIG_PLACEHOLDERS.ANDROID_SIGNING_DIGEST_WEBSITE,
    ),
    APPLE_TEAM_ID: envOr('APPLE_TEAM_ID', CONFIG_PLACEHOLDERS.APPLE_TEAM_ID),
    DEVICE_CHECK_KEY_ID: envOr('DEVICE_CHECK_KEY_ID', CONFIG_PLACEHOLDERS.DEVICE_CHECK_KEY_ID),
    APN_KEY_ID: envOr('APN_KEY_ID', CONFIG_PLACEHOLDERS.APN_KEY_ID),
    APN_TEAM_ID: envOr('APN_TEAM_ID', process.env.APPLE_TEAM_ID ?? ''),
    TURN_REALM: envOrDerived('TURN_REALM', () => {
      return process.env.API_HOSTNAME
        ? `turn.${process.env.API_HOSTNAME.split('.').slice(-2).join('.')}`
        : 'turn.localhost'
    }),
    WEB_PUSH_VAPID_SUBJECT: envOr('WEB_PUSH_VAPID_SUBJECT', 'mailto:ops@localhost'),
  }
}

export default $config({
  app(input) {
    const stage = input.stage
    return {
      name: 'identity-backend',
      removal: stage === 'production' ? 'retain' : 'remove',
      protect: stage === 'production',
      home: 'aws',
      providers: {
        aws: {
          version: '7.32.0',
          region: 'eu-central-1',
          defaultTags: {
            tags: {
              Project: 'identity-backend',
              Stage: stage,
              ManagedBy: 'sst',
            },
          },
        },
        cloudflare: '6.17.0',
      },
    }
  },
  async run() {
    const { deployObservability } = await import('./infra/observability')
    const { deployService } = await import('./infra/service')
    const { deployVpcEndpoints } = await import('./infra/vpc-endpoints')
    const { applyEdgePolicy } = await import('./infra/edge')

    const apiHostname = process.env.API_HOSTNAME
    const zoneId = process.env.CLOUDFLARE_ZONE_ID

    if (apiHostname !== undefined && zoneId === undefined) {
      throw new Error(
        'CLOUDFLARE_ZONE_ID is required when API_HOSTNAME is set. ' +
          'Both are public identifiers; add them to .env or export them before running `sst deploy`.',
      )
    }

    const vpc = new sst.aws.Vpc('Vpc', {
      az: isProd ? 3 : 2,
      nat: 'ec2',
      transform: {
        vpc: (args) => {
          args.tags = { ...args.tags, Name: 'identity-backend-vpc' }
        },
      },
    })

    deployVpcEndpoints({ vpc })

    const cluster = new sst.aws.Cluster('Cluster', {
      vpc,
      transform: {
        cluster: (args) => {
          args.tags = { ...args.tags, Name: 'identity-backend-cluster' }
        },
      },
    })

    const rdsMonitoringRole = new aws.iam.Role('DatabaseMonitoringRole', {
      assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
        Service: 'monitoring.rds.amazonaws.com',
      }),
      managedPolicyArns: [
        'arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole',
      ],
      tags: {
        Project: 'identity-backend',
        Stage: $app.stage,
        ManagedBy: 'sst',
      },
    })

    const database = new sst.aws.Postgres('Database', {
      vpc,
      proxy: true,
      transform: {
        instance: (args) => {
          args.backupRetentionPeriod = isProd ? 30 : 7
          args.deletionProtection = isProd
          args.performanceInsightsEnabled = true
          args.monitoringInterval = 60
          args.monitoringRoleArn = rdsMonitoringRole.arn
          args.dependsOn = [...(args.dependsOn ?? []), rdsMonitoringRole]
          args.tags = { ...args.tags, Name: 'identity-backend-database' }
        },
        parameterGroup: (args) => {
          args.description = 'identity-backend-custom-pg-params'
        },
      },
    })

    const observability = deployObservability({ vpc, cluster })
    const service = deployService({
      cluster,
      database,
      profile,
      deploymentConfig: appDeploymentConfig(),
      otlpHttpEndpoint: observability.otlpHttpEndpoint,
      hostname: apiHostname,
    })

    if (apiHostname !== undefined && zoneId !== undefined) {
      new cloudflare.DnsRecord('ApiDns', {
        zoneId,
        name: apiHostname,
        type: 'CNAME',
        content: service.url.apply((url) => new URL(url).hostname),
        proxied: true,
        ttl: 1,
      })

      applyEdgePolicy({ zoneId, plan, profile })
    }

    return {
      api: apiHostname ? `https://${apiHostname}` : service.url,
      grafana: observability.grafanaUrl,
    }
  },
})
