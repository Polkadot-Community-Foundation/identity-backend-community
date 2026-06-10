import { createOpenAPIHono } from '#root/lib/problem-details.js'
import { AuthPlugin, optionalJwt, verifyJwt } from '#root/middleware/mod.js'
import { Config, Context, Effect, Layer, Redacted } from 'effect'
import type { Hono } from 'hono'
import type { BlankEnv, BlankSchema, Env, Schema } from 'hono/types'
import { makeAuthRoutes } from '../shared/auth/routes.js'
import { makeAttesterRoute } from './attester.routes.js'
import { makeDIMTicketRoute } from './dim-ticket.routes.js'
import { makeInvitationTicketRoute } from './invitation-ticket.routes.js'
import { makeNotifyRoute } from './notify/routes.js'
import { makeRegistrationQueueRoute } from './registration-queue.routes.js'
import { makeSchemaRoute } from './schemas/routes.js'
import { makeSubscriptionPublicRoutes, makeSubscriptionRoutes } from './subscriptions/routes.js'
import { makeTokenRoute } from './token/routes.js'
import { makeRefreshRoute } from './token/routes.js'
import { makeTurnIssueRoute } from './turn/issue.route.js'
import { makeUsernamesRoute } from './username/mod.js'

export class V1RoutesConfig extends Context.Tag('V1RoutesConfig')<
  V1RoutesConfig,
  {
    jwtSecret: Redacted.Redacted<string>
    jwtAuthEnforced: boolean
    enabled: true
  } | {
    enabled: false
  }
>() {}

export const makeRoutesWithOutDependencies = <
  E extends Env = BlankEnv,
  S extends Schema = BlankSchema,
>(app: Hono<E, S, '/'>) =>
  Effect.gen(function*() {
    const makeV1Routes = (jwtSecret: Redacted.Redacted<string>, jwtAuthEnforced: boolean) =>
      Effect.gen(function*() {
        const authPlugin = yield* AuthPlugin

        const authRoutes = yield* makeAuthRoutes({ tags: ['v1'] })

        const { WEB_PUSH_ENABLED } = yield* Effect.promise(() => import('#root/config.js'))
        const webPushEnabled = yield* WEB_PUSH_ENABLED

        const jwtMiddleware = jwtAuthEnforced ? verifyJwt : optionalJwt

        const publicSubRoutes = webPushEnabled
          ? yield* makeSubscriptionPublicRoutes()
          : createOpenAPIHono() as Effect.Effect.Success<ReturnType<typeof makeSubscriptionPublicRoutes>>

        const subscriptionRouter = createOpenAPIHono()
          .route('/', publicSubRoutes)
          .use(verifyJwt(Redacted.value(jwtSecret)))
          .route('/', yield* makeSubscriptionRoutes())

        const registrationRouter = createOpenAPIHono()
          .use(verifyJwt(Redacted.value(jwtSecret)))
          .route('/', yield* makeRegistrationQueueRoute)

        return app.route(
          'api/v1',
          createOpenAPIHono()
            .use('/dim-ticket/*', jwtMiddleware(Redacted.value(jwtSecret)))
            .use('/invitation-ticket/*', jwtMiddleware(Redacted.value(jwtSecret)))
            .use('/notify/*', jwtMiddleware(Redacted.value(jwtSecret)))
            .use('/turn/*', jwtMiddleware(Redacted.value(jwtSecret)))
            .route(
              '/usernames',
              yield* makeUsernamesRoute(jwtMiddleware(Redacted.value(jwtSecret))),
            )
            .route('/dim-ticket', yield* makeDIMTicketRoute())
            .route('/invitation-ticket', yield* makeInvitationTicketRoute())
            .route('/registration', registrationRouter)
            .route(
              '/auth',
              createOpenAPIHono()
                .route('/token/refresh', yield* makeRefreshRoute())
                .route('/', authRoutes)
                .use(authPlugin)
                .route('/token', yield* makeTokenRoute()),
            )
            .route('/attester', yield* makeAttesterRoute())
            .route('/turn', yield* makeTurnIssueRoute)
            .route('/schemas', yield* makeSchemaRoute())
            .route('/notify', yield* makeNotifyRoute())
            .route('/subscriptions', subscriptionRouter),
        )
      })

    const config = yield* V1RoutesConfig

    if (config.enabled === false) {
      return createOpenAPIHono() as Effect.Effect.Success<ReturnType<typeof makeV1Routes>>
    }

    return yield* makeV1Routes(config.jwtSecret, config.jwtAuthEnforced)
  })

export const makeRoutes = <
  E extends Env = BlankEnv,
  S extends Schema = BlankSchema,
>(app: Hono<E, S, '/'>) =>
  makeRoutesWithOutDependencies(app).pipe(
    Effect.provide(
      Layer.effect(
        V1RoutesConfig,
        Effect.gen(function*() {
          const { JWT_AUTH_SECRET, JWT_AUTH_ENFORCED } = yield* Effect.promise(() => import('#root/config.js'))

          const { jwtSecret, jwtAuthEnforced } = yield* Config.all({
            jwtSecret: JWT_AUTH_SECRET,
            jwtAuthEnforced: JWT_AUTH_ENFORCED,
          })

          return {
            enabled: true,
            jwtSecret,
            jwtAuthEnforced,
          } satisfies V1RoutesConfig['Type']
        }),
      ),
    ),
  )

export type App = Effect.Effect.Success<ReturnType<typeof makeRoutes>>
