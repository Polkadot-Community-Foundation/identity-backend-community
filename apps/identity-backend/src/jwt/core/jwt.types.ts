import { isBefore } from 'date-fns/isBefore'
import { FastCheck as fc, Match, Option, ParseResult, pipe, Schema as S } from 'effect'

export const RefreshTokenPlain = pipe(
  S.Uint8ArrayFromSelf,
  S.filter((bytes) => bytes.length === 32, {
    message: () => 'Expected 32 bytes',
  }),
  S.annotations({
    identifier: 'RefreshTokenPlain',
    arbitrary: () => (fc_: typeof fc) => fc_.uint8Array({ minLength: 32, maxLength: 32 }),
  }),
  S.brand('RefreshTokenPlain'),
)
export type RefreshTokenPlain = S.Schema.Type<typeof RefreshTokenPlain>

export const RefreshTokenHash = pipe(
  S.Uint8ArrayFromSelf,
  S.filter((bytes) => bytes.length === 32, {
    message: () => 'Expected 32 bytes',
  }),
  S.annotations({
    identifier: 'RefreshTokenHash',
    arbitrary: () => (fc_: typeof fc) => fc_.uint8Array({ minLength: 32, maxLength: 32 }),
  }),
  S.brand('RefreshTokenHash'),
)
export type RefreshTokenHash = S.Schema.Type<typeof RefreshTokenHash>

export const UserId = pipe(
  S.String,
  S.annotations({ identifier: 'UserId', arbitrary: () => (fc_: typeof fc) => fc_.uuid() }),
  S.brand('UserId'),
)
export type UserId = S.Schema.Type<typeof UserId>

export const TokenClassification = S.Literal('valid', 'expired', 'revoked')
export type TokenClassification = S.Schema.Type<typeof TokenClassification>

export const RefreshAction = S.Literal('rotate', 'reject', 'revoke-family')
export type RefreshAction = S.Schema.Type<typeof RefreshAction>

export const ClassificationToAction = S.transformOrFail(RefreshAction, TokenClassification, {
  strict: true,
  decode: (_actual, _override, ast) =>
    ParseResult.fail(new ParseResult.Forbidden(ast, _actual, 'ClassificationToAction is decode-only')),
  encode: (_1, _2, _3, classification) =>
    ParseResult.succeed(
      Match.value(classification).pipe(
        Match.when('valid', () => 'rotate' as const),
        Match.when('expired', () => 'reject' as const),
        Match.when('revoked', () => 'revoke-family' as const),
        Match.exhaustive,
      ),
    ),
})

export const IssueTokenCommand = S.Struct({
  clientId: S.Uint8ArrayFromSelf,
  clientProof: S.Uint8ArrayFromSelf,
  challenge: S.Uint8ArrayFromSelf,
  body: S.Uint8ArrayFromSelf,
  attestationResult: S.optional(
    S.Struct({ appFromOfficialStore: S.Boolean }),
  ),
  iosPackage: S.optional(S.String),
})
export type IssueTokenCommand = S.Schema.Type<typeof IssueTokenCommand>

export const ClassifyTokenInput = S.Struct({
  revokedAt: S.Option(S.ValidDateFromSelf),
  expiresAt: S.ValidDateFromSelf,
  now: S.ValidDateFromSelf,
}).pipe(
  S.brand('ClassifyTokenInput'),
)

export const ClassifyTokenCommand = S.transformOrFail(TokenClassification, ClassifyTokenInput, {
  strict: true,
  decode: (_actual, _override, ast) =>
    ParseResult.fail(new ParseResult.Forbidden(ast, _actual, 'ClassifyTokenCommand is encode-only')),
  encode: (_toI, _override, _ast, toA) =>
    ParseResult.succeed(
      Match.value(toA).pipe(
        Match.when(({ revokedAt }) => Option.isSome(revokedAt), () => 'revoked' as const),
        Match.when(({ expiresAt, now }) => isBefore(expiresAt, now), () => 'expired' as const),
        Match.orElse(() => 'valid' as const),
      ),
    ),
})

export class ClientProofVerificationFailedError extends S.TaggedError<ClientProofVerificationFailedError>()(
  'ClientProofVerificationFailedError',
  {},
) {
}

export class IntegrityFailedError extends S.TaggedError<IntegrityFailedError>()(
  'IntegrityFailedError',
  {
    cause: S.optionalWith(S.Unknown, { nullable: true }),
  },
) {
}

export const AccessToken = S.String.pipe(S.brand('AccessToken'))
export type AccessToken = S.Schema.Type<typeof AccessToken>

const RotatedTokenPairTypeId: unique symbol = Symbol.for('@identity-backend/jwt/RotatedTokenPair')
type RotatedTokenPairTypeId = typeof RotatedTokenPairTypeId

export class RotatedTokenPair extends S.TaggedClass<RotatedTokenPair>()('RotatedTokenPair', {
  accessToken: AccessToken,
  refreshToken: S.Redacted(RefreshTokenPlain),
}) {
  readonly [RotatedTokenPairTypeId] = RotatedTokenPairTypeId
}

/* Stryker disable all */
if (import.meta.vitest) {
  const { ruleOfSchemas } = await import('@identity-backend/testing/schema')
  ruleOfSchemas('RefreshTokenPlain', RefreshTokenPlain)
  ruleOfSchemas('RefreshTokenHash', RefreshTokenHash)
  ruleOfSchemas('UserId', UserId)
  ruleOfSchemas('AccessToken', AccessToken)
  ruleOfSchemas('TokenClassification', TokenClassification)
  ruleOfSchemas('RefreshAction', RefreshAction)
  ruleOfSchemas('IssueTokenCommand', IssueTokenCommand)
  ruleOfSchemas('ClassifyTokenInput', ClassifyTokenInput)
  ruleOfSchemas('RotatedTokenPair', RotatedTokenPair)
}
