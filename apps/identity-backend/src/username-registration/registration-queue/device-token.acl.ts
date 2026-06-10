import { ParseResult, Schema as S } from 'effect'

import { AndroidDeviceIdentifiers } from '#root/username-registration/registration-queue/claim.schema.js'

const AndroidDeviceTokenForeign = S.Struct({
  androidId: S.String,
  widevineId: S.String,
}).pipe(S.annotations({ identifier: 'AndroidDeviceTokenForeign' }))

const AndroidDeviceTokenJson = S.compose(
  S.StringFromBase64Url,
  S.parseJson(AndroidDeviceTokenForeign),
).pipe(S.annotations({ identifier: 'AndroidDeviceTokenJson' }))

const decodeAndroidDeviceIdentifiers = ParseResult.decode(AndroidDeviceIdentifiers)

export const DecodeAndroidDeviceTokenACL = S.transformOrFail(
  AndroidDeviceTokenJson,
  AndroidDeviceIdentifiers,
  {
    strict: true,
    decode: (foreign) =>
      decodeAndroidDeviceIdentifiers({
        androidId: foreign.androidId,
        widevineId: foreign.widevineId,
      }),
    encode: (_toI, _options, ast, toA) =>
      ParseResult.fail(
        new ParseResult.Forbidden(ast, toA, 'DecodeAndroidDeviceTokenACL is decode-only'),
      ),
  },
).pipe(S.annotations({ identifier: 'DecodeAndroidDeviceTokenACL' }))
