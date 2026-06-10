import { OTEL_SERVICE_NAME, OTEL_SPAN_PROCESSOR, SENTRY_TRACE_SAMPLE_RATE } from '#root/config.js'
import { NodeSdk } from '@effect/opentelemetry'
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import {
  BatchSpanProcessor,
  ParentBasedSampler,
  SimpleSpanProcessor,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-node'
import { Effect, Layer, Match } from 'effect'

export const layerOTLPOnly = Layer.unwrapEffect(
  Effect.gen(function*() {
    const [serviceName, processorKind, sampleRate] = yield* Effect.all([
      OTEL_SERVICE_NAME,
      OTEL_SPAN_PROCESSOR,
      SENTRY_TRACE_SAMPLE_RATE,
    ])

    const spanProcessor = Match.value(processorKind).pipe(
      Match.when('simple', () => new SimpleSpanProcessor(new OTLPTraceExporter())),
      Match.when('batch', () => new BatchSpanProcessor(new OTLPTraceExporter())),
      Match.exhaustive,
    )

    return NodeSdk.layer(() => ({
      resource: { serviceName },
      metricReader: new PrometheusExporter(),
      spanProcessor,
      tracerConfig: {
        sampler: new ParentBasedSampler({
          root: new TraceIdRatioBasedSampler(sampleRate),
        }),
      },
    } satisfies NodeSdk.Configuration))
  }),
)
