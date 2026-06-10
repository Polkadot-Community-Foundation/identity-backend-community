import { Either, HashSet, Option, Redacted, Schema } from 'effect'
import { PushNotificationValidationError, type TokenInvalidReason } from '../types.js'
import { PLATFORM_IOS, VOIP_TOPIC_SUFFIX } from './constants.js'
import type {
  APNEnvironment,
  APNSendTarget,
  APNTargetResult,
  APNTopic,
  PushError,
  PushResult,
  ValidDeviceToken,
} from './types.js'
import { APNTopic as APNTopicSchema, ValidDeviceToken as ValidDeviceTokenSchema } from './types.js'

export function routeToEnvironments(
  topic: APNTopic,
  defaultEnvironment: APNEnvironment,
  developmentSuffixes: HashSet.HashSet<string>,
): APNSendTarget[] {
  const lowerTopic = topic.toLowerCase()
  const isDev = Array.from(developmentSuffixes).some((suffix) => lowerTopic.endsWith(suffix.toLowerCase()))
  if (!isDev) return [{ topic, environment: defaultEnvironment }]
  return [
    { topic, environment: 'development' as const },
    { topic, environment: 'production' as const },
  ]
}

export function formatTopic(topic: APNTopic, isVoip: boolean): string {
  if (!isVoip) return topic
  if (topic.endsWith(VOIP_TOPIC_SUFFIX)) return topic
  return `${topic}${VOIP_TOPIC_SUFFIX}`
}

export function resolveTopics(
  requestTopics: readonly string[] | undefined,
  configTopics: readonly APNTopic[],
): Either.Either<readonly APNTopic[], PushNotificationValidationError> {
  if (requestTopics?.length) {
    const decoded: APNTopic[] = []
    const invalid: string[] = []
    for (const topic of requestTopics) {
      const result = Schema.decodeEither(APNTopicSchema)(topic)
      if (Either.isLeft(result)) invalid.push(topic)
      else decoded.push(result.right)
    }
    if (invalid.length > 0) {
      return Either.left(
        new PushNotificationValidationError({ message: `Invalid topics: ${invalid.join(', ')}` }),
      )
    }
    return Either.right(decoded)
  }
  if (configTopics.length === 0) {
    return Either.left(new PushNotificationValidationError({ message: 'No APN topics configured or provided' }))
  }
  return Either.right(configTopics)
}

export function validateToken(
  token: Redacted.Redacted<string>,
): Either.Either<ValidDeviceToken, PushNotificationValidationError> {
  const result = Schema.decodeEither(ValidDeviceTokenSchema)(Redacted.value(token))
  if (Either.isLeft(result)) {
    return Either.left(new PushNotificationValidationError({ message: 'Invalid device token' }))
  }
  return Either.right(result.right)
}

export function aggregateResults(results: readonly APNTargetResult[]): PushResult {
  const sent = results.reduce((sum, r) => sum + r.result.sent.length, 0)
  const failed = results.reduce((sum, r) => sum + r.result.failed.length, 0)
  const errors: PushError[] = []

  for (const r of results) {
    for (const f of r.result.failed) {
      errors.push({
        device: f.device,
        environment: r.environment,
        ...(f.status !== undefined && { status: f.status }),
        ...(f.response !== undefined && { response: f.response }),
      })
    }
  }

  return {
    success: sent >= 1,
    platform: PLATFORM_IOS,
    sent,
    failed,
    ...(errors.length > 0 && { errors }),
  }
}

/**
 * Determines logging level and content based on send results.
 * Returns diagnostic information for failed sends.
 */
export function decideLogging(failed: number, reasons: (string | undefined)[]): {
  level: 'warning' | 'debug'
  reasons?: string[]
} {
  if (failed > 0) {
    return {
      level: 'warning',
      reasons: reasons.filter((r): r is string => r != null),
    }
  }
  return {
    level: 'debug',
  }
}

const TERMINAL_APNS_REASONS: Readonly<Record<string, TokenInvalidReason>> = {
  Unregistered: 'token_unregistered',
  ExpiredToken: 'token_unregistered',
  BadDeviceToken: 'token_invalid',
  DeviceTokenNotForTopic: 'token_invalid',
}

export interface ApnsTerminalClassification {
  readonly reason: TokenInvalidReason
  readonly providerCode: string
}

/**
 * Classifies a specific device token's outcome across APNS per-target results.
 * Returns terminal-token-invalid only when the device never sent in any target
 * and EVERY recorded failure for it carries a terminal reason. Mixed/partial
 * outcomes return Option.none because the same token can naturally fail in one
 * environment and succeed in another (dev/prod fanout). Results for other
 * devices are ignored — classification is scoped per token.
 */
export function classifyApnsResult(
  device: string,
  results: readonly APNTargetResult[],
): Option.Option<ApnsTerminalClassification> {
  let classification: Option.Option<ApnsTerminalClassification> = Option.none()
  for (const r of results) {
    for (const s of r.result.sent) {
      if (s.device === device) return Option.none()
    }
    for (const f of r.result.failed) {
      if (f.device !== device) continue
      const code = f.response?.reason
      if (code === undefined) return Option.none()
      const mapped = TERMINAL_APNS_REASONS[code]
      if (mapped === undefined) return Option.none()
      if (Option.isNone(classification)) {
        classification = Option.some({ reason: mapped, providerCode: code })
      }
    }
  }
  return classification
}
