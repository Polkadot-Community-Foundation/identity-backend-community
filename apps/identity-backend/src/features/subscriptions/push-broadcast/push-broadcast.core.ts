import { Blake2256 } from '@polkadot-api/substrate-bindings'
import { HashSet } from 'effect'
import { toHex } from 'polkadot-api/utils'
import { calculateRateLimitOutput, computeNewRateState, ZERO_STATE } from '../pipeline/rate-limit.js'

export interface CanonicalizedBroadcast {
  readonly signer: string
  readonly topics: readonly string[]
  readonly content: { readonly title: string; readonly body: string; readonly deeplink?: string }
}

export interface MatchEntry {
  readonly subscriptionId: string
  readonly ruleId: string
  readonly clientId: string
  readonly notificationType: string
  readonly topic: string
  readonly channel: string
}

export interface DeliveryCandidate {
  readonly subscriptionId: string
  readonly ruleId: string
  readonly clientId: string
  readonly topic: string
  readonly channel: string
  readonly notificationType: string
}

export interface RateUpdateEntry {
  readonly clientId: string
  readonly windowStart: Date
  readonly notificationCount: number
}

export interface DeliveryPlanResult {
  readonly deliveries: readonly DeliveryCandidate[]
  readonly skipped: readonly { subscriptionId: string; reason: string }[]
  readonly rateUpdates: readonly RateUpdateEntry[]
}

export const canonicalizeBroadcast = (
  input: {
    signer: string
    topics: readonly string[]
    content: { readonly title: string; readonly body: string; readonly deeplink?: string }
  },
): CanonicalizedBroadcast => ({
  signer: input.signer.toLowerCase(),
  topics: [...input.topics].map((t) => t.toLowerCase()).sort(),
  content: input.content.deeplink === undefined
    ? { title: input.content.title, body: input.content.body }
    : { title: input.content.title, body: input.content.body, deeplink: input.content.deeplink },
})

export const hashBroadcastPayload = (payload: CanonicalizedBroadcast): string => {
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  return toHex(Blake2256(bytes))
}

export const computeDeliveryPlan = (
  params: {
    readonly matches: readonly MatchEntry[]
    readonly existingClaims: HashSet.HashSet<string>
    readonly rateLimitMap: ReadonlyMap<string, { readonly windowStart: Date; readonly notificationCount: number }>
    readonly rateLimitConfig: {
      readonly windowSizeMs: number
      readonly maxPerWindow: number
      readonly cooldownMs: number
    }
    readonly now: Date
  },
): DeliveryPlanResult => {
  const deliveries: DeliveryCandidate[] = []
  const skipped: { subscriptionId: string; reason: string }[] = []

  for (const match of params.matches) {
    if (HashSet.has(params.existingClaims, match.subscriptionId)) {
      skipped.push({ subscriptionId: match.subscriptionId, reason: 'duplicate' })
      continue
    }

    const clientState = params.rateLimitMap.get(match.clientId) ?? ZERO_STATE
    if (calculateRateLimitOutput(clientState, params.now, params.rateLimitConfig) === 'blocked') {
      skipped.push({ subscriptionId: match.subscriptionId, reason: 'rate_limited' })
      continue
    }

    deliveries.push({
      subscriptionId: match.subscriptionId,
      ruleId: match.ruleId,
      topic: match.topic,
      clientId: match.clientId,
      channel: match.channel,
      notificationType: match.notificationType,
    })
  }

  const deliveredClientIds = [...new Set(deliveries.map((d) => d.clientId))]
  const rateUpdates = deliveredClientIds.map((clientId) => {
    const currentState = params.rateLimitMap.get(clientId) ?? ZERO_STATE
    const newState = computeNewRateState(currentState, params.now, {
      windowSizeMs: params.rateLimitConfig.windowSizeMs,
    })
    return { clientId, windowStart: newState.windowStart, notificationCount: newState.notificationCount }
  })

  return { deliveries, skipped, rateUpdates }
}
