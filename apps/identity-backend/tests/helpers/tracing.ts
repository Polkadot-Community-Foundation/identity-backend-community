import * as NodeSdk from '@effect/opentelemetry/NodeSdk'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'

const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318/v1/traces'

export const TestTracingLive = NodeSdk.layer(() => ({
  serviceName: 'identity-backend-test',
  spanProcessor: new SimpleSpanProcessor(
    new OTLPTraceExporter({ url: otlpEndpoint }),
  ),
}))
