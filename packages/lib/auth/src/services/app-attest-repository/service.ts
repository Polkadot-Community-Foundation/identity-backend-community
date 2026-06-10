import { Context, type Effect } from 'effect'
import type { AppAttestationData, AppAttestationDatabaseError, AppAttestationNotFoundError, KeyId } from './types.js'

export namespace AppAttestRepository {
  export interface AppAttestRepository {
    findById: (keyId: KeyId) => Effect.Effect<
      AppAttestationData,
      AppAttestationNotFoundError | AppAttestationDatabaseError,
      never
    >
    update: (
      keyId: KeyId,
      updateFn: (current: AppAttestationData) => AppAttestationData,
    ) => Effect.Effect<
      AppAttestationData,
      AppAttestationNotFoundError | AppAttestationDatabaseError,
      never
    >
    create: (data: AppAttestationData) => Effect.Effect<
      void,
      AppAttestationDatabaseError,
      never
    >
  }
}

export class AppAttestRepository extends Context.Tag('AppAttestRepository')<
  AppAttestRepository,
  AppAttestRepository.AppAttestRepository
>() {}
