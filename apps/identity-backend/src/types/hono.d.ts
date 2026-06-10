import type { SpanContext } from '@opentelemetry/api'

declare module 'hono' {
  interface ContextVariableMap {
    spanContext: SpanContext
  }
}
