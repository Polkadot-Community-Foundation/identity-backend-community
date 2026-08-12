import { RotateTokenUseCase } from '#root/jwt/shell/rotate-token.use-case.js'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { Hono } from 'hono'
import { makeRefreshRouteWithoutDependencies } from '../routes.js'

/**
 * Guards the refresh-route mount. The refresh route declares its own `/token/refresh` path, so it
 * must be mounted at `/` under `/auth` (see routes/v1/mod.ts) to resolve at
 * `/api/v1/auth/token/refresh`. If it is instead mounted at `/token/refresh`, the prefix doubles to
 * `/api/v1/auth/token/refresh/token/refresh` and the documented endpoint 404s — which is what
 * happened in production (every client refresh returned 404 and fell back to full re-attestation).
 * This also checks the refresh route is not shadowed by the sibling `/token` mount.
 */

// Never invoked: request-body validation fails first (empty body), so only routing is exercised.
const RotateTokenUseCaseMock = Layer.succeed(RotateTokenUseCase, {
  rotateToken: () => Effect.die('rotateToken must not be reached in a routing test'),
})

const post = (app: Hono, path: string) =>
  Effect.promise(async () =>
    app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  )

describe('refresh route mount', () => {
  it.effect("resolves at /auth/token/refresh, not the doubled path, and isn't shadowed by /token", () =>
    Effect.gen(function*() {
      const refresh = yield* makeRefreshRouteWithoutDependencies
      // Mirror routes/v1/mod.ts: refresh mounted at `/` (its internal path is `/token/refresh`),
      // with a sibling `/token` mount registered AFTER it.
      const app = new Hono().route(
        '/auth',
        new Hono()
          .route('/', refresh)
          .route('/token', new Hono().post('/', (c) => c.text('token-route', 200))),
      )

      const resolved = yield* post(app, '/auth/token/refresh')
      const doubled = yield* post(app, '/auth/token/refresh/token/refresh')
      const token = yield* post(app, '/auth/token')

      // Documented endpoint resolves to the refresh route: not 404 (exists), and not the sibling
      // /token route's 200 (the empty body fails validation → a 4xx from the refresh route).
      expect(resolved.status).not.toBe(404)
      expect(resolved.status).not.toBe(200)
      // The old double-prefixed path is gone.
      expect(doubled.status).toBe(404)
      // The sibling /token route still works and isn't shadowed.
      expect(token.status).toBe(200)
    }).pipe(Effect.provide(RotateTokenUseCaseMock)))
})
