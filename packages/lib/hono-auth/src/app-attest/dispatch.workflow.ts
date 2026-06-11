import { Either, Match, ParseResult, Schema as S } from 'effect'

const AppAttestDispatchTypeId: unique symbol = Symbol.for(
  '@identity-backend/hono-auth/AppAttestDispatch',
)
type AppAttestDispatchTypeId = typeof AppAttestDispatchTypeId

export class AppAttestDispatchCommand extends S.TaggedClass<AppAttestDispatchCommand>()(
  'AppAttestDispatchCommand',
  {
    iosPackage: S.UndefinedOr(S.String),
    payload: S.UndefinedOr(S.String),
    keyId: S.UndefinedOr(S.String),
    challenge: S.UndefinedOr(S.String),
    clientId: S.UndefinedOr(S.String),
  },
) {}

export class Skip extends S.TaggedClass<Skip>()('Skip', {}) {
  readonly [AppAttestDispatchTypeId] = AppAttestDispatchTypeId
}

export class Verify extends S.TaggedClass<Verify>()('Verify', {}) {
  readonly [AppAttestDispatchTypeId] = AppAttestDispatchTypeId
}

export const AppAttestDispatchDecision = S.Union(Skip, Verify)
export type AppAttestDispatchDecision = S.Schema.Type<typeof AppAttestDispatchDecision>

export class IncompleteAssertionError extends S.TaggedError<IncompleteAssertionError>()(
  'IncompleteAssertion',
  {
    missing: S.Array(S.String),
  },
) {}

export const AppAttestDispatchError = S.Union(IncompleteAssertionError)
export type AppAttestDispatchError = S.Schema.Type<typeof AppAttestDispatchError>

const RequiredAssertion = S.Struct({
  payload: S.String,
  keyId: S.String,
  challenge: S.String,
  clientId: S.String,
})

const missingAssertionFields = (error: ParseResult.ParseError): ReadonlyArray<string> =>
  ParseResult.ArrayFormatter.formatErrorSync(error).map((issue) => String(issue.path[0]))

export const decideAppAttestDispatch = (
  command: AppAttestDispatchCommand,
): Either.Either<AppAttestDispatchDecision, AppAttestDispatchError> =>
  Match.value(command).pipe(
    Match.when({ iosPackage: Match.defined }, (iosCommand) =>
      S.decodeUnknownEither(RequiredAssertion)(iosCommand, { errors: 'all' }).pipe(
        Either.mapBoth({
          onLeft: (error) =>
            new IncompleteAssertionError({ missing: missingAssertionFields(error) }),
          onRight: () => new Verify(),
        }),
      )),
    Match.orElse(() =>
      Either.right(new Skip())
    ),
  )
