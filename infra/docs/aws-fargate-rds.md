# AWS — Operator Reference

> Fargate, ALB, RDS Postgres 17 with RDS Proxy, Secrets Manager,
> CloudWatch Logs, S3 (ALB access logs + ECR), EFS (LGTM data),
> fck-nat + PrivateLink. Code in `infra/service.ts`,
> `infra/observability.ts`, `infra/vpc-endpoints.ts`. This document
> covers the operator-facing facts: what runs, what the live
> troubleshooting flow looks like, and the per-resource quotas.

## The deployed topology

```
        Internet
           │
           ▼
   ┌──────────────┐
   │  Cloudflare  │   zone: api.<your-domain>
   │  (proxied)   │   rate-limit + WAF + AOP mTLS
   └──────┬───────┘
          │ ALB-internal (only Cloudflare IPs allowed by AOP)
          ▼
   ┌──────────────┐
   │  ALB (HTTP)  │   /readyz health check, stickiness: lb_cookie 1h
   │  us-east-1   │   access logs → S3
   └──────┬───────┘
          │ VPC, private subnets (2 AZ non-prod, 3 AZ prod)
          ▼
   ┌──────────────┐
   │  Fargate     │   arm64, scaling 1–10, circuit breaker + rollback
   │  /api/v1/*   │   task role: 4-scope scoped policy
   │              │   task exec role: ECR + CloudWatch Logs
   └──────┬───────┘
          │ PostgreSQL protocol, via RDS Proxy
          ▼
   ┌──────────────┐
   │  RDS Proxy   │   IAM auth, secrets-backed
   └──────┬───────┘
          │
          ▼
   ┌──────────────┐
   │  RDS         │   Postgres 17
   │  Postgres    │   30-day backup (prod), 7-day (non-prod)
   │              │   deletionProtection=true (prod)
   └──────────────┘

   ┌──────────────┐
   │  LGTM        │   grafana/otel-lgtm:0.11.16
   │  (Fargate)   │   1 vCPU / 2 GB, scales 1–3
   │              │   EFS mount at /data
   │  internal LB │   3000 (Grafana UI), 4318 (OTLP HTTP)
   └──────────────┘

   EFS              /data  ←→  LGTM
   Secrets Manager  identity-backend/<stage>/*  ←→  task role
   CloudWatch Logs  /ecs/identity-backend-<stage>  ←→  Fargate
   S3               ALB access logs  ←→  ALB
```

## Region

`eu-central-1` (Frankfurt). Pinned in `sst.config.ts#app().providers`.
All AWS CLI commands below assume this region.

## Fargate troubleshooting — the canonical flow

```bash
STAGE=<stage>                                # dev, staging, prod

# 1. List services and their running task counts
aws ecs describe-services \
  --cluster identity-backend-$STAGE \
  --services identity-backend

# 2. List running tasks
aws ecs list-tasks --cluster identity-backend-$STAGE --desired-status RUNNING

# 3. Tail CloudWatch Logs
aws logs tail /ecs/identity-backend-$STAGE --follow --filter-pattern "ERROR"

# 4. ECS Exec into a task (interactive shell — requires session-manager-plugin)
aws ecs update-service --cluster identity-backend-$STAGE --service identity-backend --enable-execute-command
TASK=$(aws ecs list-tasks --cluster identity-backend-$STAGE --desired-status RUNNING --query 'taskArns[0]' --output text)
aws ecs execute-command \
  --cluster identity-backend-$STAGE \
  --task $TASK \
  --container app-identity \
  --interactive \
  --command "/bin/sh"

# 5. Force a new deployment (rolls all tasks to the latest task definition)
aws ecs update-service --cluster identity-backend-$STAGE --service identity-backend --force-new-deployment

# 6. Roll back to the previous task definition revision
PREV_REV=$(aws ecs list-task-definitions --family-prefix identity-backend --sort DESC --query 'taskDefinitionArns[1]' --output text | awk -F: '{print $NF}')
aws ecs update-service --cluster identity-backend-$STAGE --service identity-backend --task-definition $PREV_REV
```

The 12 task-stopped reason codes that matter:

| Reason                               | Meaning                                              |
| ------------------------------------ | ---------------------------------------------------- |
| `Essential container in task exited` | App crashed; check container exit code in logs       |
| `OutOfMemory`                        | Task hit memory limit; bump `memory` in `service.ts` |
| `CannotPullContainerError`           | ECR auth / network / image not found                 |
| `TaskFailedToStart`                  | AZ resource unavailable; retry or change AZ          |
| `Target.ContainerPort`               | Port conflict; another service bound the same port   |

Exit code `137` = SIGKILL (OOM or restart limit). Exit code `1` =
application error. Always tail logs first.

## ALB access logs

The ALB writes access logs to an S3 bucket named
`identity-backend-alb-access-logs-<account-id>-<region>`. Enable the
lifecycle policy to age logs out after the compliance window
(default 90 days to Glacier, 365 days expiry).

Sample CloudWatch Logs Insights query for 5xx:

```
fields @timestamp, client_ip, target_ip, elb_status_code, target_status_code, request
| filter elb_status_code >= 500
| sort request_time desc
| limit 100
```

## RDS Postgres 17 with RDS Proxy

The app connects to the **RDS Proxy endpoint**, never to the RDS
instance directly. The proxy endpoint is the value of `DATABASE_URL`
injected by SST (`infra/service.ts#deployService`). Per-pod connection
pools (`DB_POOL_MAX=25`) multiplied by N pods multiplexed by the proxy
keeps the actual RDS connection count bounded.

```bash
# Confirm the app is hitting the proxy
aws rds describe-db-proxies --query 'DBProxies[?contains(DBProxyName,`identity-backend`)].Endpoint'

# See registered targets
aws rds describe-db-proxy-targets --db-proxy-name identity-backend-proxy-$STAGE

# On-demand snapshot
aws rds create-db-snapshot \
  --db-instance-identifier identity-backend-db-$STAGE \
  --db-snapshot-identifier manual-$(date +%Y%m%d-%H%M%S)

# Point-in-time restore (creates a new instance)
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier identity-backend-db-$STAGE \
  --target-db-instance-identifier identity-backend-db-restored \
  --restore-time "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

**Production hardening** (set by `sst.config.ts#run()`):

- `backupRetentionPeriod: 30` (vs 7 in non-prod)
- `deletionProtection: true` (only in prod)
- `performanceInsightsEnabled: true`
- `monitoringInterval: 60` (60-second enhanced monitoring)

## Secrets Manager

`infra/secrets.ts#APP_SECRET_NAMES` declares 11 secrets. The
operator sets them with `pnpm sst secret set <NAME> <value>
--stage <stage>`. The values are encrypted at rest with the
AWS-managed KMS key, and the task role is granted
`secretsmanager:GetSecretValue` + `DescribeSecret` scoped to
`arn:aws:secretsmanager:*:*:secret:identity-backend-*`.

Pricing: ~$0.40/secret/month + $0.05 per 10,000 API calls. The
container reads each secret once at task start — no hot-reload. To
pick up a new value, force a new deployment.

## VPC + PrivateLink

`infra/vpc-endpoints.ts` deploys three interface endpoints
(`secretsmanager`, `ssm`, `ssmmessages`) and one gateway endpoint
(`s3`). The interface endpoints cost ~$0.01/hr/AZ + $0.01/GB; the
S3 gateway endpoint is free.

fck-nat (`nat: 'ec2'`) replaces AWS managed NAT Gateways at
~$3-8/AZ/month (single fck-nat t4g.nano) vs ~$32/AZ/month for
managed NAT. The trade-off: fck-nat is a single EC2 instance per
AZ — if it dies, that AZ loses egress. The 2-AZ non-prod / 3-AZ
prod layout absorbs single-AZ fck-nat loss in the other AZs
until the instance is replaced.

## S3 ALB access logs bucket

`AlbAccessLogs` resource in `infra/service.ts`. Bucket policy:

- Allow `logdelivery.elb.amazonaws.com` `s3:PutObject` on
  `arn:aws:s3:::<bucket>/alb-logs/*`
- Allow `s3:GetBucketAcl` on the bucket itself
- SSE-S3 (AES256) at rest

The bucket is created on first deploy and never deleted on
subsequent deploys (Pulumi retains it).

## CloudWatch Logs

Log group `/ecs/identity-backend-<stage>`. Stream prefix `ecs`. The
container's `awslogs` driver writes structured JSON logs.

```bash
# Tail live
aws logs tail /ecs/identity-backend-$STAGE --follow

# Filter
aws logs tail /ecs/identity-backend-$STAGE --filter-pattern "ERROR"

# Insights query (recent 15m of HTTP 5xx)
aws logs start-query \
  --log-group-name /ecs/identity-backend-$STAGE \
  --start-time $(date -d '-15 minutes' +%s) \
  --end-time $(date +%s) \
  --query-string 'fields @timestamp, @message | filter @message like /http_response_status_code/ | filter @message like /5.. / | sort @timestamp desc | limit 50'
```

## IAM task role — the four-scope policy

`IdentityBackendTaskPolicy` (scoped via `managedPolicyArns` on
`transform.taskRole`):

| Sid              | Actions                                                                | Resource                                               |
| ---------------- | ---------------------------------------------------------------------- | ------------------------------------------------------ |
| `SecretsManager` | `secretsmanager:GetSecretValue`, `DescribeSecret`                      | `arn:aws:secretsmanager:*:*:secret:identity-backend-*` |
| `SSMParameters`  | `ssm:GetParameter`, `GetParameters`, `GetParametersByPath`             | `arn:aws:ssm:*:*:parameter/identity-backend-*`         |
| `CloudWatchLogs` | `logs:CreateLogStream`, `PutLogEvents`, `DescribeLogStreams`           | `*`                                                    |
| `ECRPull`        | `ecr:GetAuthorizationToken`, `BatchGetImage`, `GetDownloadUrlForLayer` | `*`                                                    |

The wildcard on CloudWatch Logs and ECR is necessary — those
services' ARNs are account/region scoped and wildcard is the
documented pattern.

## Cost notes (single deployment, eu-central-1)

| Resource                    | Approx cost / month           |
| --------------------------- | ----------------------------- |
| fck-nat (single t4g.nano)   | ~$3 / AZ                      |
| VPC endpoints (×3 × 2 AZ)   | ~$3.50 + data processing      |
| S3 gateway endpoint         | Free                          |
| Fargate arm64 service       | ~$30 (1 task) to ~$300 (10)   |
| ALB                         | ~$20 + LCU usage              |
| RDS Postgres (db.r6g.large) | ~$200                         |
| RDS Proxy                   | ~$15 per vCPU                 |
| LGTM (1 vCPU, 2 GB)         | ~$30                          |
| EFS                         | ~$0.30/GB-month               |
| ALB access logs S3          | Pennies; lifecycle to Glacier |

## Sources

- ECS Exec: <https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs-exec.html>
- ALB access logs: <https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-access-logs.html>
- RDS Proxy: <https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy.html>
- Secrets Manager: <https://docs.aws.amazon.com/secretsmanager/latest/userguide/intro.html>
- VPC endpoints pricing: <https://aws.amazon.com/privatelink/pricing/>
- fck-nat: <https://github.com/AndrewGuenther/fck-nat>
