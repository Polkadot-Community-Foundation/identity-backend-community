import { Effect, Option, ParseResult, pipe, Schema as S } from 'effect'
import { AppLicensingVerdict, AppRecognitionVerdict, DeviceRecognitionVerdict, PlayIntegrityToken } from './types.js'

const VerdictField = <A extends string>(literal: S.Schema<A, A, never>) =>
  pipe(
    S.transform(
      S.NullishOr(S.String),
      S.NullOr(literal),
      {
        strict: false,
        decode: (s) =>
          s == null
            ? null
            : pipe(s, S.decodeUnknownOption(literal), Option.getOrNull),
        encode: (a) => a,
      },
    ),
    S.annotations({ identifier: 'VerdictField' }),
  )

const VerdictListField = <A extends string>(literal: S.Schema<A, A, never>) =>
  pipe(
    S.transform(
      S.NullishOr(S.Array(S.String)),
      S.NullOr(S.Array(literal)),
      {
        strict: false,
        decode: (values) =>
          values == null
            ? null
            : values.flatMap((v) => pipe(v, S.decodeUnknownOption(literal), Option.toArray)),
        encode: (a) => a,
      },
    ),
    S.annotations({ identifier: 'VerdictListField' }),
  )

const PlayIntegrityTokenForeign = S.Struct({
  appIntegrity: S.optional(S.Struct({
    appRecognitionVerdict: S.optional(VerdictField(AppRecognitionVerdict)),
  })),
  deviceIntegrity: S.optional(S.Struct({
    deviceRecognitionVerdict: S.optional(VerdictListField(DeviceRecognitionVerdict)),
  })),
  accountDetails: S.optional(S.Struct({
    appLicensingVerdict: S.optional(VerdictField(AppLicensingVerdict)),
  })),
})

export const PlayIntegrityTokenAcl = S.transformOrFail(
  PlayIntegrityTokenForeign,
  PlayIntegrityToken,
  {
    strict: false,
    decode: (fromA, _options, _ast, _fromI) =>
      Effect.succeed({
        appRecognitionVerdict: fromA.appIntegrity?.appRecognitionVerdict ?? null,
        deviceRecognitionVerdict: fromA.deviceIntegrity?.deviceRecognitionVerdict ?? null,
        appLicensingVerdict: fromA.accountDetails?.appLicensingVerdict ?? null,
      }),
    encode: (_toI, _options, ast, _toA) =>
      Effect.fail(new ParseResult.Forbidden(ast, null, 'PlayIntegrityTokenAcl is decode-only')),
  },
)
