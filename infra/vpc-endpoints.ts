/**
 * VPC Interface Endpoints (AWS PrivateLink) for intra-AWS service traffic.
 *
 * Without these, Fargate containers reach Secrets Manager and SSM via the NAT
 * Gateway ($0.045/GB).  With PrivateLink interface endpoints the traffic stays
 * inside the VPC ($0.01/hour per endpoint AZ + $0.01/GB) — roughly 80 % cheaper
 * for bursty secret reads and eliminates NAT as a single point of failure for
 * control-plane access.
 *
 * Interface endpoints for Secrets Manager and SSM (which don't support gateway
 * endpoints), plus a free S3 gateway endpoint that eliminates NAT charges for
 * ECR image pulls and any direct S3 access.
 */

export interface VpcEndpointsInput {
  readonly vpc: sst.aws.Vpc
}

export function deployVpcEndpoints(input: VpcEndpointsInput) {
  // Secrets Manager — used by sst.Secret linkage, ECS secret injection, and any
  // direct GetSecretValue calls the app makes at startup.
  new aws.ec2.VpcEndpoint('SecretsManagerEndpoint', {
    vpcId: input.vpc.id,
    serviceName: 'com.amazonaws.eu-central-1.secretsmanager',
    vpcEndpointType: 'Interface',
    privateDnsEnabled: true,
    subnetIds: input.vpc.privateSubnets,
    securityGroupIds: input.vpc.securityGroups,
    tags: { Name: 'identity-backend-vpce-secretsmanager' },
  })

  // SSM Parameter Store — used by ECS for env-var resolution and by any
  // GetParameter / GetParameters calls the app makes.
  new aws.ec2.VpcEndpoint('SsmParameterStoreEndpoint', {
    vpcId: input.vpc.id,
    serviceName: 'com.amazonaws.eu-central-1.ssm',
    vpcEndpointType: 'Interface',
    privateDnsEnabled: true,
    subnetIds: input.vpc.privateSubnets,
    securityGroupIds: input.vpc.securityGroups,
    tags: { Name: 'identity-backend-vpce-ssm' },
  })

  // SSM Messages — required alongside the SSM endpoint for Session Manager
  // connectivity (not used today but pre-created so it's ready if needed).
  new aws.ec2.VpcEndpoint('SsmMessagesEndpoint', {
    vpcId: input.vpc.id,
    serviceName: 'com.amazonaws.eu-central-1.ssmmessages',
    vpcEndpointType: 'Interface',
    privateDnsEnabled: true,
    subnetIds: input.vpc.privateSubnets,
    securityGroupIds: input.vpc.securityGroups,
    tags: { Name: 'identity-backend-vpce-ssmmessages' },
  })

  // S3 Gateway endpoint — free, no per-hour or per-GB charge. Routes S3 traffic
  // through the VPC instead of the NAT Gateway, saving $0.045/GB on ECR image
  // pulls and any S3 access. Uses routeTableIds (not subnetIds) because Gateway
  // endpoints modify the route table, not the ENI.
  new aws.ec2.VpcEndpoint('S3GatewayEndpoint', {
    vpcId: input.vpc.id,
    serviceName: 'com.amazonaws.eu-central-1.s3',
    routeTableIds: aws.ec2.getRouteTablesOutput({ vpcId: input.vpc.id }).ids,
    tags: { Name: 'identity-backend-vpce-s3' },
  })
}
