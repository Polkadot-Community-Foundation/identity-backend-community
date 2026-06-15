import { appDeploymentEnvironment } from './secrets'

export interface ServiceInput {
  readonly cluster: sst.aws.Cluster
  readonly database: sst.aws.Postgres
  readonly profile: 'shared-nat' | 'global'
  readonly pods: number
  readonly deploymentConfig: Record<string, string>
  readonly otlpHttpEndpoint: $util.Input<string>
  readonly hostname: string | undefined
}

export function deployService(input: ServiceInput) {
  const database = input.database
  const databaseUrl =
    $interpolate`postgresql://${database.username}:${database.password}@${database.host}:${database.port}/${database.database}`

  const taskPolicy = new aws.iam.Policy('IdentityBackendTaskPolicy', {
    name: 'IdentityBackendTaskPolicy',
    policy: $util.jsonStringify({
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'SecretsManager',
          Effect: 'Allow',
          Action: [
            'secretsmanager:GetSecretValue',
            'secretsmanager:DescribeSecret',
          ],
          Resource: 'arn:aws:secretsmanager:*:*:secret:identity-backend-*',
        },
        {
          Sid: 'SSMParameters',
          Effect: 'Allow',
          Action: [
            'ssm:GetParameter',
            'ssm:GetParameters',
            'ssm:GetParametersByPath',
          ],
          Resource: 'arn:aws:ssm:*:*:parameter/identity-backend-*',
        },
        {
          Sid: 'CloudWatchLogs',
          Effect: 'Allow',
          Action: [
            'logs:CreateLogStream',
            'logs:PutLogEvents',
            'logs:DescribeLogStreams',
          ],
          Resource: '*',
        },
        {
          Sid: 'ECRPull',
          Effect: 'Allow',
          Action: [
            'ecr:GetAuthorizationToken',
            'ecr:BatchGetImage',
            'ecr:GetDownloadUrlForLayer',
          ],
          Resource: '*',
        },
      ],
    }),
  })

  // ALB access logs bucket — required for audit trail and debugging
  const albLogBucket = new aws.s3.Bucket('AlbAccessLogs', {
    serverSideEncryptionConfiguration: {
      rule: { applyServerSideEncryptionByDefault: { sseAlgorithm: 'AES256' } },
    },
    tags: { Name: 'identity-backend-alb-access-logs' },
  })

  // Grant ELB service principal write access to the bucket
  const albLogBucketPolicy = new aws.s3.BucketPolicy('AlbAccessLogsPolicy', {
    bucket: albLogBucket.bucket,
    policy: $util.jsonStringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { Service: 'logdelivery.elb.amazonaws.com' },
          Action: 's3:PutObject',
          Resource: $interpolate`${albLogBucket.arn}/*`,
        },
        {
          Effect: 'Allow',
          Principal: { Service: 'logdelivery.elb.amazonaws.com' },
          Action: 's3:GetBucketAcl',
          Resource: albLogBucket.arn,
        },
      ],
    }),
  })

  const svc = new sst.aws.Service('IdentityBackend', {
    cluster: input.cluster,
    link: [database],
    architecture: 'arm64',
    image: { context: '.', dockerfile: 'Dockerfile', target: 'app-identity' },
    dev: {
      command: 'pnpm dev',
      url: 'http://localhost:3000',
    },
    scaling: {
      min: 1,
      max: 10,
      cpuUtilization: 70,
      memoryUtilization: 80,
    },
    loadBalancer: {
      rules: [
        input.hostname !== undefined
          ? { listen: '443/https', forward: '8080/http', customDomain: input.hostname }
          : { listen: '80/http', forward: '8080/http' },
      ],
      health: {
        '8080/http': {
          path: '/readyz',
          interval: '30 seconds',
          timeout: '5 seconds',
          healthyThreshold: 3,
          unhealthyThreshold: 3,
          successCodes: '200',
        },
      },
    },
    health: {
      command: ['CMD-SHELL', 'curl -f http://localhost:8080/readyz || exit 1'],
      interval: '30 seconds',
      timeout: '5 seconds',
      retries: 3,
      startPeriod: '60 seconds',
    },
    environment: {
      ...appDeploymentEnvironment(),
      ...input.deploymentConfig,
      PORT: '8080',
      DATABASE_URL: databaseUrl,
      RATE_LIMIT_PROFILE: input.profile,
      RATE_LIMIT_POD_DIVISOR: String(input.pods),
      OTEL_EXPORTER_OTLP_ENDPOINT: input.otlpHttpEndpoint,
      OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf',
    },
    transform: {
      service: (args) => {
        args.tags = { ...args.tags, Name: 'identity-backend-service' }
      },
      loadBalancer: (args) => {
        args.tags = { ...args.tags, Name: 'identity-backend-alb' }
        args.accessLogs = {
          bucket: albLogBucket.bucket,
          prefix: 'alb-logs',
        }
      },
      target: (args) => {
        args.stickiness = { enabled: true, type: 'lb_cookie', cookieDuration: 3600 }
      },
      logGroup: (args) => {
        args.tags = { ...args.tags, Name: 'identity-backend-logs' }
      },
      taskRole: (args) => {
        args.tags = { ...args.tags, Name: 'identity-backend-task-role' }
        args.managedPolicyArns = $util.output(args.managedPolicyArns ?? []).apply(
          (arns) => [...(arns ?? []), taskPolicy.arn],
        )
      },
    },
  })

  return svc
}
