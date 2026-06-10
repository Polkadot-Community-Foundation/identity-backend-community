import * as NodeSdk from '@effect/opentelemetry/NodeSdk'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'

export const OtelLayer = NodeSdk.layer(() => ({
  resource: { serviceName: 'identity-backend-test' },
  spanProcessor: new SimpleSpanProcessor(new OTLPTraceExporter()),
} satisfies NodeSdk.Configuration))

export default OtelLayer
