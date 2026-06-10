import { DefectReporter } from '#root/infrastructure/observability/context.js'
import { HttpClient, HttpClientRequest, HttpClientResponse } from '@effect/platform'
import {
  type CrlEntry,
  CrlResponseFromJson,
  FetchCrlError,
  normalizeCrlEntries,
  ParseCrlError,
} from '@identity-backend/android-attest'
import { Context, type Duration, Effect, Exit, Layer, Option, Ref } from 'effect'

export class AndroidAttestationCrlServiceConfig extends Context.Tag(
  '@app/AndroidAttestationCrlServiceConfig',
)<
  AndroidAttestationCrlServiceConfig,
  {
    readonly crlUrl: string
    readonly cacheTtl: Duration.Duration
  }
>() {}

export namespace AndroidAttestationCrlService {
  export interface Definition {
    readonly getEntries: Effect.Effect<
      Readonly<Record<string, CrlEntry>>,
      FetchCrlError | ParseCrlError
    >
  }
}

export class AndroidAttestationCrlService extends Context.Tag(
  '@app/AndroidAttestationCrlService',
)<AndroidAttestationCrlService, AndroidAttestationCrlService.Definition>() {}

export const AndroidAttestationCrlServiceLive = Layer.effect(
  AndroidAttestationCrlService,
  Effect.gen(function*() {
    const { crlUrl, cacheTtl } = yield* AndroidAttestationCrlServiceConfig
    const reporter = yield* DefectReporter
    const httpClient = (yield* HttpClient.HttpClient).pipe(
      HttpClient.filterStatusOk,
      HttpClient.retryTransient({ times: 3 }),
    )

    const fetchEntries = Effect.gen(function*() {
      const response = yield* httpClient.execute(HttpClientRequest.get(crlUrl)).pipe(
        Effect.timeout('10 seconds'),
        Effect.mapError((cause) => new FetchCrlError({ cause })),
      )

      const parsed = yield* HttpClientResponse.schemaBodyJson(CrlResponseFromJson)(response).pipe(
        Effect.mapError((cause) => new ParseCrlError({ cause })),
      )

      return normalizeCrlEntries(parsed.entries)
    }).pipe(
      Effect.tapErrorCause((cause) => reporter.captureException(cause)),
    ) satisfies AndroidAttestationCrlService['Type']['getEntries']

    const lastGood = yield* Ref.make<Option.Option<Readonly<Record<string, CrlEntry>>>>(
      Option.none(),
    )
    const cached = yield* Effect.cachedWithTTL(fetchEntries, cacheTtl)

    const getEntries = Effect.gen(function*() {
      const exit = yield* cached.pipe(Effect.exit)
      if (Exit.isSuccess(exit)) {
        yield* Ref.set(lastGood, Option.some(exit.value))
        return exit.value
      }
      const stale = yield* Ref.get(lastGood)
      if (Option.isSome(stale)) return stale.value
      return yield* exit
    }).pipe(
      Effect.withSpan('android_attestation_crl.get_entries'),
    ) satisfies AndroidAttestationCrlService['Type']['getEntries']

    return AndroidAttestationCrlService.of({ getEntries })
  }),
)
