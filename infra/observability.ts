export interface ObservabilityInput {
  readonly vpc: sst.aws.Vpc
  readonly cluster: sst.aws.Cluster
}

export interface ObservabilityOutput {
  readonly grafanaUrl: $util.Output<string>
  readonly otlpHttpEndpoint: $util.Output<string>
}

export function deployObservability(input: ObservabilityInput): ObservabilityOutput {
  const data = new sst.aws.Efs('ObservabilityData', {
    vpc: input.vpc,
    transform: {
      fileSystem: (args) => {
        args.tags = { ...args.tags, Name: 'identity-backend-observability-efs' }
      },
    },
  })

  const lgtm = new sst.aws.Service('Lgtm', {
    cluster: input.cluster,
    image: { context: 'infra/observability' },
    cpu: '1 vCPU',
    memory: '2 GB',
    architecture: 'arm64',
    scaling: {
      min: 1,
      max: 3,
      cpuUtilization: 80,
    },
    volumes: [
      { efs: data, path: '/data' },
    ],
    loadBalancer: {
      public: false,
      health: {
        '3000/http': {
          path: '/api/health',
          interval: '30 seconds',
          timeout: '5 seconds',
          healthyThreshold: 2,
          unhealthyThreshold: 3,
          successCodes: '200',
        },
      },
      rules: [
        { listen: '3000/http' },
        { listen: '4318/http' },
      ],
    },
    health: {
      command: ['CMD-SHELL', 'curl -fsS http://localhost:3000/api/health || exit 1'],
      interval: '30 seconds',
      timeout: '5 seconds',
      retries: 3,
      startPeriod: '60 seconds',
    },
    transform: {
      service: (args) => {
        args.tags = { ...args.tags, Name: 'identity-backend-lgtm' }
      },
      logGroup: (args) => {
        args.tags = { ...args.tags, Name: 'identity-backend-lgtm-logs' }
      },
    },
  })

  return {
    grafanaUrl: $interpolate`http://${lgtm.service}:3000`,
    otlpHttpEndpoint: $interpolate`http://${lgtm.service}:4318`,
  }
}
