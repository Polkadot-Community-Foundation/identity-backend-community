import {
  AppAttestationData,
  AppAttestationDatabaseError,
  AppAttestationNotFoundError,
  AppAttestRepository,
} from '@identity-backend/auth/services'
import { DB } from '@identity-backend/db'
import { eq } from 'drizzle-orm'
import { Effect, Either, Exit, Layer, Runtime, Schema as S } from 'effect'
import { encodeBase64 } from 'effect/Encoding'

export const AppAttestationRepositoryLive = Layer.effect(
  AppAttestRepository,
  Effect.gen(function*() {
    const schema = yield* Effect.promise(() => import('#root/db/schema.js'))
    const db = yield* DB

    const runtime = yield* Effect.runtime()

    const findById = (Effect.fn('app_attest_repository.findById')((keyId) =>
      Effect.gen(function*() {
        const attestation = yield* Effect.tryPromise({
          try: () =>
            db.query.appleAttestations.findFirst({
              where: { keyId: { eq: encodeBase64(keyId) } },
            }),
          catch: (err) => new AppAttestationDatabaseError({ cause: err }),
        })

        yield* Effect.annotateCurrentSpan({ 'app_attest.key_id': keyId, 'db.operation': 'findFirst' })

        if (!attestation) {
          return yield* AppAttestationNotFoundError.make({ keyId: encodeBase64(keyId) })
        }

        return yield* S.decode(AppAttestationData)({
          _tag: 'AppAttestationData',
          keyId: attestation.keyId,
          publicKey: attestation.publicKey,
          receipt: attestation.receipt,
          signCount: attestation.signCount,
        }).pipe(
          Effect.orDie,
        )
      })
    )) satisfies AppAttestRepository['Type']['findById']

    const update = (Effect.fn('app_attest_repository.update')((keyId, updateFn) =>
      Effect.async<
        AppAttestationData,
        AppAttestationDatabaseError | AppAttestationNotFoundError
      >((resume) => {
        void db.transaction(async (tx) => {
          try {
            const result = await Effect.gen(function*() {
              const current = yield* Effect.tryPromise({
                try: async () =>
                  tx.query.appleAttestations.findFirst({
                    where: { keyId: { eq: encodeBase64(keyId) } },
                  }),
                catch: (cause) => AppAttestationDatabaseError.make({ cause }),
              })

              if (!current) {
                return yield* AppAttestationNotFoundError.make({ keyId: encodeBase64(keyId) })
              }

              const currentData = yield* S.decode(AppAttestationData)({
                _tag: 'AppAttestationData',
                keyId: current.keyId,
                publicKey: current.publicKey,
                receipt: current.receipt,
                signCount: current.signCount,
              }).pipe(
                Effect.orDie,
              )

              const updatedData = updateFn(currentData)

              const updated = yield* Effect.tryPromise({
                try: async () =>
                  tx
                    .update(schema.appleAttestations)
                    .set({
                      publicKey: encodeBase64(updatedData.publicKey),
                      receipt: encodeBase64(updatedData.receipt),
                      signCount: updatedData.signCount,
                    })
                    .where(eq(schema.appleAttestations.keyId, encodeBase64(keyId)))
                    .returning(),
                catch: (cause) => AppAttestationDatabaseError.make({ cause }),
              })

              const updatedRecord = updated[0]!

              yield* Effect.annotateCurrentSpan({ 'app_attest.key_id': keyId, 'db.operation': 'transaction' })

              return yield* S.decode(AppAttestationData)({
                _tag: 'AppAttestationData',
                keyId: updatedRecord.keyId,
                publicKey: updatedRecord.publicKey,
                receipt: updatedRecord.receipt,
                signCount: updatedRecord.signCount,
              }).pipe(
                Effect.orDie,
              )
            }).pipe(
              Effect.either,
              Effect.exit,
              Runtime.runPromise(runtime),
            )

            if (Exit.isFailure(result)) {
              throw result.cause
            }

            const either = result.value

            if (Either.isLeft(either)) {
              resume(Effect.fail(either.left))
              throw either.left
            }

            resume(Effect.succeed(either.right))
          } catch (err) {
            resume(Effect.fail(AppAttestationDatabaseError.make({ cause: err })))
          }
        })
      })
    )) satisfies AppAttestRepository['Type']['update']

    const create = (Effect.fn('app_attest_repository.create')((data) =>
      Effect.gen(function*() {
        const [attestation] = yield* Effect.tryPromise({
          try: () =>
            db
              .insert(schema.appleAttestations)
              .values({
                keyId: encodeBase64(data.keyId),
                publicKey: encodeBase64(data.publicKey),
                receipt: encodeBase64(data.receipt),
                signCount: data.signCount ?? 0,
              })
              .returning(),
          catch: (err) => new AppAttestationDatabaseError({ cause: err }),
        })

        yield* Effect.annotateCurrentSpan({ 'app_attest.key_id': data.keyId, 'db.operation': 'insert' })

        if (!attestation) {
          return yield* Effect.fail(
            new AppAttestationDatabaseError({
              cause: new Error('Create operation returned no result'),
            }),
          )
        }

        return yield* S.decode(AppAttestationData)({
          _tag: 'AppAttestationData',
          keyId: attestation.keyId,
          publicKey: attestation.publicKey,
          receipt: attestation.receipt,
          signCount: attestation.signCount,
        }).pipe(
          Effect.orDie,
        )
      })
    )) satisfies AppAttestRepository['Type']['create']

    return {
      findById,
      update,
      create,
    } satisfies AppAttestRepository.AppAttestRepository
  }),
)
