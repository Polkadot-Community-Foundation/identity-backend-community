import { getUnixTime } from 'date-fns/getUnixTime'
import { Schema as S } from 'effect'
import { encodeHex } from 'effect/Encoding'

export type IceServer = URL

export class TurnIssueRequest extends S.Class<TurnIssueRequest>('TurnIssueRequest')({
  regionHint: S.optionalWith(S.String, { nullable: true }),
}) {}

export class TurnIssueResponse extends S.Class<TurnIssueResponse>('TurnIssueResponse')({
  servers: S.Array(S.String),
  username: S.String,
  password: S.String,
  ttl: S.Number.pipe(S.int(), S.positive()),
}) {}

export const Realm = S.NonEmptyString.pipe(
  S.filter((s) => /^[a-zA-Z0-9_.-]+$/.test(s), {
    message: () => 'Realm must contain only alphanumeric characters, underscores, dots, and hyphens',
  }),
  S.brand('Realm'),
)

export type Realm = S.Schema.Type<typeof Realm>

export class TurnUsername extends S.TaggedClass<TurnUsername>('TurnUsername')('TurnUsername', {
  id: S.Uint8ArrayFromHex,
  expiry: S.ValidDateFromSelf,
}) {
  override toString = (): string => {
    return `${getUnixTime(this.expiry)}:${encodeHex(this.id)}`
  }
}

export class TurnCredentials extends S.TaggedClass<TurnCredentials>()('TurnCredentials', {
  username: TurnUsername,
  password: S.Redacted(S.Uint8ArrayFromBase64),
  realm: Realm,
  ttl: S.DurationFromSelf,
}) {}
