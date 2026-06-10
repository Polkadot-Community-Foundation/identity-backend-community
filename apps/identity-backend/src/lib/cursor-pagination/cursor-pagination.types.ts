import { Schema as S } from 'effect'

export const CursorToken = S.StringFromBase64Url.pipe(S.nonEmptyString(), S.brand('CursorToken'))

export type CursorToken = S.Schema.Type<typeof CursorToken>
