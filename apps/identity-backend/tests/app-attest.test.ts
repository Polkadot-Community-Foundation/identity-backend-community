import { DB, DBTest } from '#root/db/drizzle.js'
import * as schema from '#root/db/schema.js'
import { AppAttestationRepositoryLive } from '#root/infrastructure/adapters/repositories/app-attest.repository.js'
import { ChallengeServiceLive } from '#root/infrastructure/adapters/repositories/challenge.repository.js'
import { AndroidAttestationCrlService } from '#root/infrastructure/android-attestation-crl.service.js'
import { layerAuthRoutes } from '#root/routes/shared/auth/layer.js'
import { makeAuthRoutes } from '#root/routes/shared/auth/routes.js'
import { it } from '@effect/vitest'
import { OpenAPIHono, z } from '@hono/zod-openapi'
import { zValidator } from '@hono/zod-validator'
import { AppAttestService, AppAttestServiceConfig, AuthService } from '@identity-backend/auth/services'
import {
  AppAttestEnvironment,
  layerAppAttestMiddleware,
  makeAppAttestMiddleware,
} from '@identity-backend/hono-auth/app-attest'
import { decodeBase64 } from '@std/encoding'
import { eq } from 'drizzle-orm'
import { Effect, Layer, pipe, TestClock } from 'effect'
import { testClient } from 'hono/testing'
import { describe } from 'vitest'

describe('App Attest', () => {
  const textDecoder = new TextDecoder()
  const APP_ID = 'QXCVVJ6654.io.novasama.polkadotapp.develop'

  const layerSeedDb = Layer.effectDiscard(
    Effect.gen(function*() {
      const db = yield* DB

      yield* Effect.tryPromise(() =>
        db.insert(schema.challenges)
          .values({
            id: 'G7Ek5x3wuGYE4v4Wi/Ev/w==',
          })
      )

      yield* Effect.tryPromise(() =>
        db.insert(schema.challenges)
          .values({
            id: 'vmdqc8V3rgc68LJgzXsuEA==',
          })
      )

      return db
    }),
  )

  const TestLayers = Layer.provideMerge(
    Layer.mergeAll(
      layerSeedDb,
      ChallengeServiceLive,
      AppAttestationRepositoryLive,
    ),
    Layer.mergeAll(
      AuthService.Default,
      DBTest,
    ),
  )

  const layerAndroidAttestationCrlStub = Layer.succeed(
    AndroidAttestationCrlService,
    AndroidAttestationCrlService.of({ getEntries: Effect.succeed({}) }),
  )

  const setupApp = (appIds: ReadonlyArray<string> = [APP_ID]) =>
    Effect.gen(function*() {
      const authRoutes = yield* makeAuthRoutes()
      const middleware = yield* makeAppAttestMiddleware

      const app = new OpenAPIHono()
        .route('/auth', authRoutes)
        .use(middleware)
        .post(
          '/',
          zValidator(
            'json',
            z.object({
              signature: z.string(),
              username: z.string(),
              who: z.string(),
            }),
          ),
          async (c) => {
            return c.json({ result: 'OK' }, 200)
          },
        )

      return app
    }).pipe(
      Effect.provide(
        pipe(
          layerAuthRoutes,
          Layer.provideMerge(
            Layer.provide(
              AppAttestService.Default,
              Layer.succeed(AppAttestServiceConfig, { appIds }),
            ),
          ),
          Layer.provideMerge(layerAndroidAttestationCrlStub),
          Layer.provideMerge(
            Layer.provide(
              layerAppAttestMiddleware,
              Layer.succeed(
                AppAttestEnvironment,
                {
                  iosPackageNames: new Set(['io.novasama.polkadotapp.develop']),
                  appIds: new Set(appIds),
                },
              ),
            ),
          ),
        ),
      ),
    )

  it.layer(TestLayers)((it) => {
    it.scoped('Should_Work_When_ValidCredentials', (c) =>
      Effect.gen(function*() {
        yield* TestClock.setTime(new Date(2024, 10, 29).getTime())

        const db = yield* DB
        const app = yield* setupApp()
        const client = testClient(app)

        {
          const res = yield* Effect.promise(() =>
            client.auth['app-attest'].attestations.$post({
              json: {
                'keyId': '1tzE5bZjCbVgEKh+aafT0DHghSloN7dWqVlIR28Csjk=',
                'attestation': 'o2NmbXRvYXBwbGUtYXBwYXR0ZXN0Z2F0dFN0bXSiY3g1Y4JZAzkwggM1MIICu6ADAgECAgYBktMuFgUw' +
                  'CgYIKoZIzj0EAwIwTzEjMCEGA1UEAwwaQXBwbGUgQXBwIEF0dGVzdGF0aW9uIENBIDExEzARBgNVBAoM' +
                  'CkFwcGxlIEluYy4xEzARBgNVBAgMCkNhbGlmb3JuaWEwHhcNMjQxMDI3MTI1MTA1WhcNMjUwNTAxMDIx' +
                  'MzA1WjCBkTFJMEcGA1UEAwxAZDZkY2M0ZTViNjYzMDliNTYwMTBhODdlNjlhN2QzZDAzMWUwODUyOTY4' +
                  'MzdiNzU2YTk1OTQ4NDc2ZjAyYjIzOTEaMBgGA1UECwwRQUFBIENlcnRpZmljYXRpb24xEzARBgNVBAoM' +
                  'CkFwcGxlIEluYy4xEzARBgNVBAgMCkNhbGlmb3JuaWEwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAATT' +
                  'G7HMsCO1lpEU5iedf5tS9EkbKPXRGg2yOOOtPhI5tm5VSA1QrnH3FhSvCQUoXd/1WzfYTqC5f7Zxyl3j' +
                  'tlvGo4IBPjCCATowDAYDVR0TAQH/BAIwADAOBgNVHQ8BAf8EBAMCBPAwgYsGCSqGSIb3Y2QIBQR+MHyk' +
                  'AwIBCr+JMAMCAQG/iTEDAgEAv4kyAwIBAb+JMwMCAQG/iTQsBCpRWENWVko2NjU0LmlvLm5vdmFzYW1h' +
                  'LnBvbGthZG90YXBwLmRldmVsb3ClBgQEc2tzIL+JNgMCAQW/iTcDAgEAv4k5AwIBAL+JOgMCAQC/iTsD' +
                  'AgEAMFcGCSqGSIb3Y2QIBwRKMEi/ingIBAYxNy42LjG/iFAHAgUA/////r+KewcEBTIxRzkzv4p9CAQG' +
                  'MTcuNi4xv4p+AwIBAL+LDA8EDTIxLjcuOTMuMC4wLDAwMwYJKoZIhvdjZAgCBCYwJKEiBCC5QyhmS8xk' +
                  'wCG+MF5RdNOz/wkxJgKVTTJm/VGSDKrzAjAKBggqhkjOPQQDAgNoADBlAjEAx3x+lMDJoIEuGLCmOdZX' +
                  'S/p6xzAa7BHkdQhgnp5eP5KStwu5xuBb6RINxvcpYpbeAjAaEgL7AdMkP+o5zFFh7rqAXCEhRh4V/QDU' +
                  'OKX03u5TOt13bfSlRKaOd1TbpuZ/GFxZAkcwggJDMIIByKADAgECAhAJusXhvEAa2dRTlbw4GghUMAoG' +
                  'CCqGSM49BAMDMFIxJjAkBgNVBAMMHUFwcGxlIEFwcCBBdHRlc3RhdGlvbiBSb290IENBMRMwEQYDVQQK' +
                  'DApBcHBsZSBJbmMuMRMwEQYDVQQIDApDYWxpZm9ybmlhMB4XDTIwMDMxODE4Mzk1NVoXDTMwMDMxMzAw' +
                  'MDAwMFowTzEjMCEGA1UEAwwaQXBwbGUgQXBwIEF0dGVzdGF0aW9uIENBIDExEzARBgNVBAoMCkFwcGxl' +
                  'IEluYy4xEzARBgNVBAgMCkNhbGlmb3JuaWEwdjAQBgcqhkjOPQIBBgUrgQQAIgNiAASuWzegd015sjWP' +
                  'QOfR8iYm8cJf7xeALeqzgmpZh0/40q0VJXiaomYEGRJItjy5ZwaemNNjvV43D7+gjjKegHOphed0bqNZ' +
                  'ovZvKdsyr0VeIRZY1WevniZ+smFNwhpmzpmjZjBkMBIGA1UdEwEB/wQIMAYBAf8CAQAwHwYDVR0jBBgw' +
                  'FoAUrJEQUzO9vmhB/6cMqeX66uXliqEwHQYDVR0OBBYEFD7jXRwEGanJtDH4hHTW4eFXcuObMA4GA1Ud' +
                  'DwEB/wQEAwIBBjAKBggqhkjOPQQDAwNpADBmAjEAu76IjXONBQLPvP1mbQlXUDW81ocsP4QwSSYp7dH5' +
                  'FOh5mRya6LWu+NOoVDP3tg0GAjEAqzjt0MyB7QCkUsO6RPmTY2VT/swpfy60359evlpKyraZXEuCDfkE' +
                  'OG94B7tYlDm3Z3JlY2VpcHRZDrYwgAYJKoZIhvcNAQcCoIAwgAIBATEPMA0GCWCGSAFlAwQCAQUAMIAG' +
                  'CSqGSIb3DQEHAaCAJIAEggPoMYIEbzAyAgECAgEBBCpRWENWVko2NjU0LmlvLm5vdmFzYW1hLnBvbGth' +
                  'ZG90YXBwLmRldmVsb3AwggNDAgEDAgEBBIIDOTCCAzUwggK7oAMCAQICBgGS0y4WBTAKBggqhkjOPQQD' +
                  'AjBPMSMwIQYDVQQDDBpBcHBsZSBBcHAgQXR0ZXN0YXRpb24gQ0EgMTETMBEGA1UECgwKQXBwbGUgSW5j' +
                  'LjETMBEGA1UECAwKQ2FsaWZvcm5pYTAeFw0yNDEwMjcxMjUxMDVaFw0yNTA1MDEwMjEzMDVaMIGRMUkw' +
                  'RwYDVQQDDEBkNmRjYzRlNWI2NjMwOWI1NjAxMGE4N2U2OWE3ZDNkMDMxZTA4NTI5NjgzN2I3NTZhOTU5' +
                  'NDg0NzZmMDJiMjM5MRowGAYDVQQLDBFBQUEgQ2VydGlmaWNhdGlvbjETMBEGA1UECgwKQXBwbGUgSW5j' +
                  'LjETMBEGA1UECAwKQ2FsaWZvcm5pYTBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABNMbscywI7WWkRTm' +
                  'J51/m1L0SRso9dEaDbI4460+Ejm2blVIDVCucfcWFK8JBShd3/VbN9hOoLl/tnHKXeO2W8ajggE+MIIB' +
                  'OjAMBgNVHRMBAf8EAjAAMA4GA1UdDwEB/wQEAwIE8DCBiwYJKoZIhvdjZAgFBH4wfKQDAgEKv4kwAwIB' +
                  'Ab+JMQMCAQC/iTIDAgEBv4kzAwIBAb+JNCwEKlFYQ1ZWSjY2NTQuaW8ubm92YXNhbWEucG9sa2Fkb3Rh' +
                  'cHAuZGV2ZWxvcKUGBARza3Mgv4k2AwIBBb+JNwMCAQC/iTkDAgEAv4k6AwIBAL+JOwMCAQAwVwYJKoZI' +
                  'hvdjZAgHBEowSL+KeAgEBjE3LjYuMb+IUAcCBQD////+v4p7BwQFMjFHOTO/in0IBAYxNy42LjG/in4D' +
                  'AgEAv4sMDwQNMjEuNy45My4wLjAsMDAzBgkqhkiG92NkCAIEJjAkoSIEILlDKGZLzGTAIb4wXlF007P/' +
                  'CTEmApVNMmb9UZIMqvMCMAoGCCqGSM49BAMCA2gAMGUCMQDHfH6UwMmggS4YsKY51ldL+nrHMBrsEeR1' +
                  'CGCenl4/kpK3C7nG4FvpEg3G9ylilt4CMBoSAvsB0yQ/6jnMUWHuuoBcISFGHhX9ANQ4pfTe7lM63Xdt' +
                  '9KVEpo53VNum5n8YXDAoAgEEAgEBBCDw3rq/7PIuegrO2tZaV1tR7zTfx9xsU1Sb2hYmOQJ67DBgAgEF' +
                  'AgEBBFhaSEY1d3RIRTRlcVZ0UUc3cC9wSk9zZTVmTXROdVBkenk4a1RQeFpXaktCc0REK3p5UFBXTASB' +
                  'i0hXOCt6R01HYkNxOVp0THc3ekF0VWFFSDF3OWJ0aWRXZz09MA4CAQYCAQEEBkFUVEVTVDASAgEHAgEB' +
                  'BApwcm9kdWN0aW9uMCACAQwCAQEEGDIwMjQtMTAtMjhUMTI6NTE6MDUuODczWjAgAgEVAgEBBBgyMDI1' +
                  'LTAxLTI2VDEyOjUxOjA1Ljg3M1oAAAAAAACggDCCA64wggNUoAMCAQICEH4CEmDYznercqWd8Ggnvv0w' +
                  'CgYIKoZIzj0EAwIwfDEwMC4GA1UEAwwnQXBwbGUgQXBwbGljYXRpb24gSW50ZWdyYXRpb24gQ0EgNSAt' +
                  'IEcxMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9uIEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUg' +
                  'SW5jLjELMAkGA1UEBhMCVVMwHhcNMjQwMjI3MTgzOTUyWhcNMjUwMzI4MTgzOTUxWjBaMTYwNAYDVQQD' +
                  'DC1BcHBsaWNhdGlvbiBBdHRlc3RhdGlvbiBGcmF1ZCBSZWNlaXB0IFNpZ25pbmcxEzARBgNVBAoMCkFw' +
                  'cGxlIEluYy4xCzAJBgNVBAYTAlVTMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEVDe4gsZPxRPpelHn' +
                  'EnRV4UsakAuZi9fUFodpPwvYk8qLNeo9WCPJanWt/Ey3f5LMKZmQk9nG3C0YAMkDIPR7RKOCAdgwggHU' +
                  'MAwGA1UdEwEB/wQCMAAwHwYDVR0jBBgwFoAU2Rf+S2eQOEuS9NvO1VeAFAuPPckwQwYIKwYBBQUHAQEE' +
                  'NzA1MDMGCCsGAQUFBzABhidodHRwOi8vb2NzcC5hcHBsZS5jb20vb2NzcDAzLWFhaWNhNWcxMDEwggEc' +
                  'BgNVHSAEggETMIIBDzCCAQsGCSqGSIb3Y2QFATCB/TCBwwYIKwYBBQUHAgIwgbYMgbNSZWxpYW5jZSBv' +
                  'biB0aGlzIGNlcnRpZmljYXRlIGJ5IGFueSBwYXJ0eSBhc3N1bWVzIGFjY2VwdGFuY2Ugb2YgdGhlIHRo' +
                  'ZW4gYXBwbGljYWJsZSBzdGFuZGFyZCB0ZXJtcyBhbmQgY29uZGl0aW9ucyBvZiB1c2UsIGNlcnRpZmlj' +
                  'YXRlIHBvbGljeSBhbmQgY2VydGlmaWNhdGlvbiBwcmFjdGljZSBzdGF0ZW1lbnRzLjA1BggrBgEFBQcC' +
                  'ARYpaHR0cDovL3d3dy5hcHBsZS5jb20vY2VydGlmaWNhdGVhdXRob3JpdHkwHQYDVR0OBBYEFCvPSR77' +
                  'zxt5DvCvAikTtQEW4Xk0MA4GA1UdDwEB/wQEAwIHgDAPBgkqhkiG92NkDA8EAgUAMAoGCCqGSM49BAMC' +
                  'A0gAMEUCIQCHqAkrdF+YQMU6lCFBGl2LqgmA1IaS1dbSmZnQeMfKtQIgP2VTjBMsz4gwNLBHdeiXU8/P' +
                  '0/dEg1W6l1ZcfYoGgRwwggL5MIICf6ADAgECAhBW+4PUK/+NwzeZI7Varm69MAoGCCqGSM49BAMDMGcx' +
                  'GzAZBgNVBAMMEkFwcGxlIFJvb3QgQ0EgLSBHMzEmMCQGA1UECwwdQXBwbGUgQ2VydGlmaWNhdGlvbiBB' +
                  'dXRob3JpdHkxEzARBgNVBAoMCkFwcGxlIEluYy4xCzAJBgNVBAYTAlVTMB4XDTE5MDMyMjE3NTMzM1oX' +
                  'DTM0MDMyMjAwMDAwMFowfDEwMC4GA1UEAwwnQXBwbGUgQXBwbGljYXRpb24gSW50ZWdyYXRpb24gQ0Eg' +
                  'NSAtIEcxMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9uIEF1dGhvcml0eTETMBEGA1UECgwKQXBw' +
                  'bGUgSW5jLjELMAkGA1UEBhMCVVMwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAASSzmO9fYaxqygKOxzh' +
                  'r/sElICRrPYx36bLKDVvREvhIeVX3RKNjbqCfJW+Sfq+M8quzQQZ8S9DJfr0vrPLg366o4H3MIH0MA8G' +
                  'A1UdEwEB/wQFMAMBAf8wHwYDVR0jBBgwFoAUu7DeoVgziJqkipnevr3rr9rLJKswRgYIKwYBBQUHAQEE' +
                  'OjA4MDYGCCsGAQUFBzABhipodHRwOi8vb2NzcC5hcHBsZS5jb20vb2NzcDAzLWFwcGxlcm9vdGNhZzMw' +
                  'NwYDVR0fBDAwLjAsoCqgKIYmaHR0cDovL2NybC5hcHBsZS5jb20vYXBwbGVyb290Y2FnMy5jcmwwHQYD' +
                  'VR0OBBYEFNkX/ktnkDhLkvTbztVXgBQLjz3JMA4GA1UdDwEB/wQEAwIBBjAQBgoqhkiG92NkBgIDBAIF' +
                  'ADAKBggqhkjOPQQDAwNoADBlAjEAjW+mn6Hg5OxbTnOKkn89eFOYj/TaH1gew3VK/jioTCqDGhqqDaZk' +
                  'beG5k+jRVUztAjBnOyy04eg3B3fL1ex2qBo6VTs/NWrIxeaSsOFhvoBJaeRfK6ls4RECqsxh2Ti3c0ow' +
                  'ggJDMIIByaADAgECAggtxfyI0sVLlTAKBggqhkjOPQQDAzBnMRswGQYDVQQDDBJBcHBsZSBSb290IENB' +
                  'IC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9yaXR5MRMwEQYDVQQKDApBcHBs' +
                  'ZSBJbmMuMQswCQYDVQQGEwJVUzAeFw0xNDA0MzAxODE5MDZaFw0zOTA0MzAxODE5MDZaMGcxGzAZBgNV' +
                  'BAMMEkFwcGxlIFJvb3QgQ0EgLSBHMzEmMCQGA1UECwwdQXBwbGUgQ2VydGlmaWNhdGlvbiBBdXRob3Jp' +
                  'dHkxEzARBgNVBAoMCkFwcGxlIEluYy4xCzAJBgNVBAYTAlVTMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAE' +
                  'mOkvPUBypO2TInKBExzdEJXxxaNOcdwUFtkO5aYFKndke19OONO7HES1f/UftjJiXcnphFtPME8RWgD9' +
                  'WFgMpfUPLE0HRxN12peXl28xXO0rnXsgO9i5VNlemaQ6UQoxo0IwQDAdBgNVHQ4EFgQUu7DeoVgziJqk' +
                  'ipnevr3rr9rLJKswDwYDVR0TAQH/BAUwAwEB/zAOBgNVHQ8BAf8EBAMCAQYwCgYIKoZIzj0EAwMDaAAw' +
                  'ZQIxAIPpwcQWXhpdNBjZ7e/0bA4ARku437JGEcUP/eZ6jKGma87CA9Sc9ZPGdLhq36ojFQIwbWaKEMrU' +
                  'DdRPzY1DPrSKY6UzbuNt2he3ZB/IUyb5iGJ0OQsXW8tRqAzoGAPnorIoAAAxgf0wgfoCAQEwgZAwfDEw' +
                  'MC4GA1UEAwwnQXBwbGUgQXBwbGljYXRpb24gSW50ZWdyYXRpb24gQ0EgNSAtIEcxMSYwJAYDVQQLDB1B' +
                  'cHBsZSBDZXJ0aWZpY2F0aW9uIEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMC' +
                  'VVMCEH4CEmDYznercqWd8Ggnvv0wDQYJYIZIAWUDBAIBBQAwCgYIKoZIzj0EAwIERzBFAiAxM/Bhf3ig' +
                  '6ogdaYtAddFlGj0Dc8wch9lFcs/11LsoZAIhAO6oEES3itvQCgciOswfnUwghIIRE/9iIRf6dGh/5jgA' +
                  'AAAAAAAAaGF1dGhEYXRhWKRT5FndWFgYeZgFl5ZCezIhu93iMF5q7mMMs7mrkr8hCEAAAAAAYXBwYXR0' +
                  'ZXN0AAAAAAAAAAAg1tzE5bZjCbVgEKh+aafT0DHghSloN7dWqVlIR28CsjmlAQIDJiABIVgg0xuxzLAj' +
                  'tZaRFOYnnX+bUvRJGyj10RoNsjjjrT4SObYiWCBuVUgNUK5x9xYUrwkFKF3f9Vs32E6guX+2ccpd47Zb' +
                  'xg==',
                'challenge': 'G7Ek5x3wuGYE4v4Wi/Ev/w==',
              },
            })
          )
          const resBody = yield* Effect.promise(() => res.json())
          c.expect(resBody).toEqual({})
          c.expect(res.status).toEqual(202)
        }

        {
          const res = yield* Effect.promise(() =>
            client.index.$post(
              {
                json: JSON.parse(textDecoder.decode(decodeBase64(
                  'eyJzaWduYXR1cmUiOiIweDllNjBlYTJhMTBhODIwOWJiZTMyNDU4NWM1YTIxMzkyZmY5YmNkZWRiMTUy' +
                    'ZjdjZjNmNTg1M2M1MDA1MWQ2MzYwNTk3NWU0YjM3YWQzNzEzZTMzNTEwMTcwZTgwM2NiMGE3NDVhZTZk' +
                    'YTJlNjQwZjg4YjhlYTMwZWRmYmU1OThkIiwidXNlcm5hbWUiOiJhdGVzdC5kb3QiLCJ3aG8iOiI1R1RQ' +
                    'VWg1TVU1c2hoY2lmNXZwRDZScUZwdVBYb0ZrU0ZSZ0hzRDU2Q2loUjVMSkwifQ==',
                ))),
              },
              {
                headers: {
                  'Auth-iOS-KeyId': '1tzE5bZjCbVgEKh+aafT0DHghSloN7dWqVlIR28Csjk=',
                  'Auth-iOS-Package': 'io.novasama.polkadotapp.develop',
                  'Auth-Challenge': 'vmdqc8V3rgc68LJgzXsuEA==',
                  'Auth-Payload': 'omlzaWduYXR1cmVYSDBGAiEA9Sbp7fVVBCtLyQ29jtmPWIiQssB1mL8gxQ7aN8TDT4gCIQDgtXFdNiMY' +
                    'pfc0jP+uQ/X1lYtR1o60M5JvrYe1f44m2XFhdXRoZW50aWNhdG9yRGF0YVglU+RZ3VhYGHmYBZeWQnsy' +
                    'Ibvd4jBeau5jDLO5q5K/IQhAAAAAAg==',
                },
              },
            )
          )
          const resBody = yield* Effect.promise(() => res.json())
          c.expect(resBody).toEqual({ result: 'OK' })
          c.expect(res.status).toEqual(200)
        }

        {
          const challenges = yield* Effect.tryPromise(() => db.select().from(schema.challenges))
          c.expect(challenges).toHaveLength(0)

          const attestation = yield* Effect.tryPromise(() =>
            db.select()
              .from(schema.appleAttestations)
              .where(eq(schema.appleAttestations.keyId, '1tzE5bZjCbVgEKh+aafT0DHghSloN7dWqVlIR28Csjk='))
              .limit(1)
          )

          c.expect(attestation[0]?.signCount).toEqual(2)
        }
      }))

    it.scoped('Should_Fail_When_NoAppIdsMatch', (c) =>
      Effect.gen(function*() {
        yield* TestClock.setTime(new Date(2024, 10, 29).getTime())

        const app = yield* setupApp([])
        const client = testClient(app)

        const res = yield* Effect.promise(() =>
          client.auth['app-attest'].attestations.$post({
            json: {
              'keyId': '1tzE5bZjCbVgEKh+aafT0DHghSloN7dWqVlIR28Csjk=',
              'attestation': 'o2NmbXRvYXBwbGUtYXBwYXR0ZXN0Z2F0dFN0bXSiY3g1Y4JZAzkwggM1MIICu6ADAgECAgYBktMuFgUw' +
                'CgYIKoZIzj0EAwIwTzEjMCEGA1UEAwwaQXBwbGUgQXBwIEF0dGVzdGF0aW9uIENBIDExEzARBgNVBAoM' +
                'CkFwcGxlIEluYy4xEzARBgNVBAgMCkNhbGlmb3JuaWEwHhcNMjQxMDI3MTI1MTA1WhcNMjUwNTAxMDIx' +
                'MzA1WjCBkTFJMEcGA1UEAwxAZDZkY2M0ZTViNjYzMDliNTYwMTBhODdlNjlhN2QzZDAzMWUwODUyOTY4' +
                'MzdiNzU2YTk1OTQ4NDc2ZjAyYjIzOTEaMBgGA1UECwwRQUFBIENlcnRpZmljYXRpb24xEzARBgNVBAoM' +
                'CkFwcGxlIEluYy4xEzARBgNVBAgMCkNhbGlmb3JuaWEwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAATT' +
                'G7HMsCO1lpEU5iedf5tS9EkbKPXRGg2yOOOtPhI5tm5VSA1QrnH3FhSvCQUoXd/1WzfYTqC5f7Zxyl3j' +
                'tlvGo4IBPjCCATowDAYDVR0TAQH/BAIwADAOBgNVHQ8BAf8EBAMCBPAwgYsGCSqGSIb3Y2QIBQR+MHyk' +
                'AwIBCr+JMAMCAQG/iTEDAgEAv4kyAwIBAb+JMwMCAQG/iTQsBCpRWENWVko2NjU0LmlvLm5vdmFzYW1h' +
                'LnBvbGthZG90YXBwLmRldmVsb3ClBgQEc2tzIL+JNgMCAQW/iTcDAgEAv4k5AwIBAL+JOgMCAQC/iTsD' +
                'AgEAMFcGCSqGSIb3Y2QIBwRKMEi/ingIBAYxNy42LjG/iFAHAgUA/////r+KewcEBTIxRzkzv4p9CAQG' +
                'MTcuNi4xv4p+AwIBAL+LDA8EDTIxLjcuOTMuMC4wLDAwMwYJKoZIhvdjZAgCBCYwJKEiBCC5QyhmS8xk' +
                'wCG+MF5RdNOz/wkxJgKVTTJm/VGSDKrzAjAKBggqhkjOPQQDAgNoADBlAjEAx3x+lMDJoIEuGLCmOdZX' +
                'S/p6xzAa7BHkdQhgnp5eP5KStwu5xuBb6RINxvcpYpbeAjAaEgL7AdMkP+o5zFFh7rqAXCEhRh4V/QDU' +
                'OKX03u5TOt13bfSlRKaOd1TbpuZ/GFxZAkcwggJDMIIByKADAgECAhAJusXhvEAa2dRTlbw4GghUMAoG' +
                'CCqGSM49BAMDMFIxJjAkBgNVBAMMHUFwcGxlIEFwcCBBdHRlc3RhdGlvbiBSb290IENBMRMwEQYDVQQK' +
                'DApBcHBsZSBJbmMuMRMwEQYDVQQIDApDYWxpZm9ybmlhMB4XDTIwMDMxODE4Mzk1NVoXDTMwMDMxMzAw' +
                'MDAwMFowTzEjMCEGA1UEAwwaQXBwbGUgQXBwIEF0dGVzdGF0aW9uIENBIDExEzARBgNVBAoMCkFwcGxl' +
                'IEluYy4xEzARBgNVBAgMCkNhbGlmb3JuaWEwdjAQBgcqhkjOPQIBBgUrgQQAIgNiAASuWzegd015sjWP' +
                'QOfR8iYm8cJf7xeALeqzgmpZh0/40q0VJXiaomYEGRJItjy5ZwaemNNjvV43D7+gjjKegHOphed0bqNZ' +
                'ovZvKdsyr0VeIRZY1WevniZ+smFNwhpmzpmjZjBkMBIGA1UdEwEB/wQIMAYBAf8CAQAwHwYDVR0jBBgw' +
                'FoAUrJEQUzO9vmhB/6cMqeX66uXliqEwHQYDVR0OBBYEFD7jXRwEGanJtDH4hHTW4eFXcuObMA4GA1Ud' +
                'DwEB/wQEAwIBBjAKBggqhkjOPQQDAwNpADBmAjEAu76IjXONBQLPvP1mbQlXUDW81ocsP4QwSSYp7dH5' +
                'FOh5mRya6LWu+NOoVDP3tg0GAjEAqzjt0MyB7QCkUsO6RPmTY2VT/swpfy60359evlpKyraZXEuCDfkE' +
                'OG94B7tYlDm3Z3JlY2VpcHRZDrYwgAYJKoZIhvcNAQcCoIAwgAIBATEPMA0GCWCGSAFlAwQCAQUAMIAG' +
                'CSqGSIb3DQEHAaCAJIAEggPoMYIEbzAyAgECAgEBBCpRWENWVko2NjU0LmlvLm5vdmFzYW1hLnBvbGth' +
                'ZG90YXBwLmRldmVsb3AwggNDAgEDAgEBBIIDOTCCAzUwggK7oAMCAQICBgGS0y4WBTAKBggqhkjOPQQD' +
                'AjBPMSMwIQYDVQQDDBpBcHBsZSBBcHAgQXR0ZXN0YXRpb24gQ0EgMTETMBEGA1UECgwKQXBwbGUgSW5j' +
                'LjETMBEGA1UECAwKQ2FsaWZvcm5pYTAeFw0yNDEwMjcxMjUxMDVaFw0yNTA1MDEwMjEzMDVaMIGRMUkw' +
                'RwYDVQQDDEBkNmRjYzRlNWI2NjMwOWI1NjAxMGE4N2U2OWE3ZDNkMDMxZTA4NTI5NjgzN2I3NTZhOTU5' +
                'NDg0NzZmMDJiMjM5MRowGAYDVQQLDBFBQUEgQ2VydGlmaWNhdGlvbjETMBEGA1UECgwKQXBwbGUgSW5j' +
                'LjETMBEGA1UECAwKQ2FsaWZvcm5pYTBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABNMbscywI7WWkRTm' +
                'J51/m1L0SRso9dEaDbI4460+Ejm2blVIDVCucfcWFK8JBShd3/VbN9hOoLl/tnHKXeO2W8ajggE+MIIB' +
                'OjAMBgNVHRMBAf8EAjAAMA4GA1UdDwEB/wQEAwIE8DCBiwYJKoZIhvdjZAgFBH4wfKQDAgEKv4kwAwIB' +
                'Ab+JMQMCAQC/iTIDAgEBv4kzAwIBAb+JNCwEKlFYQ1ZWSjY2NTQuaW8ubm92YXNhbWEucG9sa2Fkb3Rh' +
                'cHAuZGV2ZWxvcKUGBARza3Mgv4k2AwIBBb+JNwMCAQC/iTkDAgEAv4k6AwIBAL+JOwMCAQAwVwYJKoZI' +
                'hvdjZAgHBEowSL+KeAgEBjE3LjYuMb+IUAcCBQD////+v4p7BwQFMjFHOTO/in0IBAYxNy42LjG/in4D' +
                'AgEAv4sMDwQNMjEuNy45My4wLjAsMDAzBgkqhkiG92NkCAIEJjAkoSIEILlDKGZLzGTAIb4wXlF007P/' +
                'CTEmApVNMmb9UZIMqvMCMAoGCCqGSM49BAMCA2gAMGUCMQDHfH6UwMmggS4YsKY51ldL+nrHMBrsEeR1' +
                'CGCenl4/kpK3C7nG4FvpEg3G9ylilt4CMBoSAvsB0yQ/6jnMUWHuuoBcISFGHhX9ANQ4pfTe7lM63Xdt' +
                '9KVEpo53VNum5n8YXDAoAgEEAgEBBCDw3rq/7PIuegrO2tZaV1tR7zTfx9xsU1Sb2hYmOQJ67DBgAgEF' +
                'AgEBBFhaSEY1d3RIRTRlcVZ0UUc3cC9wSk9zZTVmTXROdVBkenk4a1RQeFpXaktCc0REK3p5UFBXTASB' +
                'i0hXOCt6R01HYkNxOVp0THc3ekF0VWFFSDF3OWJ0aWRXZz09MA4CAQYCAQEEBkFUVEVTVDASAgEHAgEB' +
                'BApwcm9kdWN0aW9uMCACAQwCAQEEGDIwMjQtMTAtMjhUMTI6NTE6MDUuODczWjAgAgEVAgEBBBgyMDI1' +
                'LTAxLTI2VDEyOjUxOjA1Ljg3M1oAAAAAAACggDCCA64wggNUoAMCAQICEH4CEmDYznercqWd8Ggnvv0w' +
                'CgYIKoZIzj0EAwIwfDEwMC4GA1UEAwwnQXBwbGUgQXBwbGljYXRpb24gSW50ZWdyYXRpb24gQ0EgNSAt' +
                'IEcxMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9uIEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUg' +
                'SW5jLjELMAkGA1UEBhMCVVMwHhcNMjQwMjI3MTgzOTUyWhcNMjUwMzI4MTgzOTUxWjBaMTYwNAYDVQQD' +
                'DC1BcHBsaWNhdGlvbiBBdHRlc3RhdGlvbiBGcmF1ZCBSZWNlaXB0IFNpZ25pbmcxEzARBgNVBAoMCkFw' +
                'cGxlIEluYy4xCzAJBgNVBAYTAlVTMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEVDe4gsZPxRPpelHn' +
                'EnRV4UsakAuZi9fUFodpPwvYk8qLNeo9WCPJanWt/Ey3f5LMKZmQk9nG3C0YAMkDIPR7RKOCAdgwggHU' +
                'MAwGA1UdEwEB/wQCMAAwHwYDVR0jBBgwFoAU2Rf+S2eQOEuS9NvO1VeAFAuPPckwQwYIKwYBBQUHAQEE' +
                'NzA1MDMGCCsGAQUFBzABhidodHRwOi8vb2NzcC5hcHBsZS5jb20vb2NzcDAzLWFhaWNhNWcxMDEwggEc' +
                'BgNVHSAEggETMIIBDzCCAQsGCSqGSIb3Y2QFATCB/TCBwwYIKwYBBQUHAgIwgbYMgbNSZWxpYW5jZSBv' +
                'biB0aGlzIGNlcnRpZmljYXRlIGJ5IGFueSBwYXJ0eSBhc3N1bWVzIGFjY2VwdGFuY2Ugb2YgdGhlIHRo' +
                'ZW4gYXBwbGljYWJsZSBzdGFuZGFyZCB0ZXJtcyBhbmQgY29uZGl0aW9ucyBvZiB1c2UsIGNlcnRpZmlj' +
                'YXRlIHBvbGljeSBhbmQgY2VydGlmaWNhdGlvbiBwcmFjdGljZSBzdGF0ZW1lbnRzLjA1BggrBgEFBQcC' +
                'ARYpaHR0cDovL3d3dy5hcHBsZS5jb20vY2VydGlmaWNhdGVhdXRob3JpdHkwHQYDVR0OBBYEFCvPSR77' +
                'zxt5DvCvAikTtQEW4Xk0MA4GA1UdDwEB/wQEAwIHgDAPBgkqhkiG92NkDA8EAgUAMAoGCCqGSM49BAMC' +
                'A0gAMEUCIQCHqAkrdF+YQMU6lCFBGl2LqgmA1IaS1dbSmZnQeMfKtQIgP2VTjBMsz4gwNLBHdeiXU8/P' +
                '0/dEg1W6l1ZcfYoGgRwwggL5MIICf6ADAgECAhBW+4PUK/+NwzeZI7Varm69MAoGCCqGSM49BAMDMGcx' +
                'GzAZBgNVBAMMEkFwcGxlIFJvb3QgQ0EgLSBHMzEmMCQGA1UECwwdQXBwbGUgQ2VydGlmaWNhdGlvbiBB' +
                'dXRob3JpdHkxEzARBgNVBAoMCkFwcGxlIEluYy4xCzAJBgNVBAYTAlVTMB4XDTE5MDMyMjE3NTMzM1oX' +
                'DTM0MDMyMjAwMDAwMFowfDEwMC4GA1UEAwwnQXBwbGUgQXBwbGljYXRpb24gSW50ZWdyYXRpb24gQ0Eg' +
                'NSAtIEcxMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9uIEF1dGhvcml0eTETMBEGA1UECgwKQXBw' +
                'bGUgSW5jLjELMAkGA1UEBhMCVVMwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAASSzmO9fYaxqygKOxzh' +
                'r/sElICRrPYx36bLKDVvREvhIeVX3RKNjbqCfJW+Sfq+M8quzQQZ8S9DJfr0vrPLg366o4H3MIH0MA8G' +
                'A1UdEwEB/wQFMAMBAf8wHwYDVR0jBBgwFoAUu7DeoVgziJqkipnevr3rr9rLJKswRgYIKwYBBQUHAQEE' +
                'OjA4MDYGCCsGAQUFBzABhipodHRwOi8vb2NzcC5hcHBsZS5jb20vb2NzcDAzLWFwcGxlcm9vdGNhZzMw' +
                'NwYDVR0fBDAwLjAsoCqgKIYmaHR0cDovL2NybC5hcHBsZS5jb20vYXBwbGVyb290Y2FnMy5jcmwwHQYD' +
                'VR0OBBYEFNkX/ktnkDhLkvTbztVXgBQLjz3JMA4GA1UdDwEB/wQEAwIBBjAQBgoqhkiG92NkBgIDBAIF' +
                'ADAKBggqhkjOPQQDAwNoADBlAjEAjW+mn6Hg5OxbTnOKkn89eFOYj/TaH1gew3VK/jioTCqDGhqqDaZk' +
                'beG5k+jRVUztAjBnOyy04eg3B3fL1ex2qBo6VTs/NWrIxeaSsOFhvoBJaeRfK6ls4RECqsxh2Ti3c0ow' +
                'ggJDMIIByaADAgECAggtxfyI0sVLlTAKBggqhkjOPQQDAzBnMRswGQYDVQQDDBJBcHBsZSBSb290IENB' +
                'IC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9yaXR5MRMwEQYDVQQKDApBcHBs' +
                'ZSBJbmMuMQswCQYDVQQGEwJVUzAeFw0xNDA0MzAxODE5MDZaFw0zOTA0MzAxODE5MDZaMGcxGzAZBgNV' +
                'BAMMEkFwcGxlIFJvb3QgQ0EgLSBHMzEmMCQGA1UECwwdQXBwbGUgQ2VydGlmaWNhdGlvbiBBdXRob3Jp' +
                'dHkxEzARBgNVBAoMCkFwcGxlIEluYy4xCzAJBgNVBAYTAlVTMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAE' +
                'mOkvPUBypO2TInKBExzdEJXxxaNOcdwUFtkO5aYFKndke19OONO7HES1f/UftjJiXcnphFtPME8RWgD9' +
                'WFgMpfUPLE0HRxN12peXl28xXO0rnXsgO9i5VNlemaQ6UQoxo0IwQDAdBgNVHQ4EFgQUu7DeoVgziJqk' +
                'ipnevr3rr9rLJKswDwYDVR0TAQH/BAUwAwEB/zAOBgNVHQ8BAf8EBAMCAQYwCgYIKoZIzj0EAwMDaAAw' +
                'ZQIxAIPpwcQWXhpdNBjZ7e/0bA4ARku437JGEcUP/eZ6jKGma87CA9Sc9ZPGdLhq36ojFQIwbWaKEMrU' +
                'DdRPzY1DPrSKY6UzbuNt2he3ZB/IUyb5iGJ0OQsXW8tRqAzoGAPnorIoAAAxgf0wgfoCAQEwgZAwfDEw' +
                'MC4GA1UEAwwnQXBwbGUgQXBwbGljYXRpb24gSW50ZWdyYXRpb24gQ0EgNSAtIEcxMSYwJAYDVQQLDB1B' +
                'cHBsZSBDZXJ0aWZpY2F0aW9uIEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMC' +
                'VVMCEH4CEmDYznercqWd8Ggnvv0wDQYJYIZIAWUDBAIBBQAwCgYIKoZIzj0EAwIERzBFAiAxM/Bhf3ig' +
                '6ogdaYtAddFlGj0Dc8wch9lFcs/11LsoZAIhAO6oEES3itvQCgciOswfnUwghIIRE/9iIRf6dGh/5jgA' +
                'AAAAAAAAaGF1dGhEYXRhWKRT5FndWFgYeZgFl5ZCezIhu93iMF5q7mMMs7mrkr8hCEAAAAAAYXBwYXR0' +
                'ZXN0AAAAAAAAAAAg1tzE5bZjCbVgEKh+aafT0DHghSloN7dWqVlIR28CsjmlAQIDJiABIVgg0xuxzLAj' +
                'tZaRFOYnnX+bUvRJGyj10RoNsjjjrT4SObYiWCBuVUgNUK5x9xYUrwkFKF3f9Vs32E6guX+2ccpd47Zb' +
                'xg==',
              'challenge': 'G7Ek5x3wuGYE4v4Wi/Ev/w==',
            },
          })
        )

        const resBody = yield* Effect.promise(() => res.json())
        c.expect(resBody).toEqual(c.expect.objectContaining({
          _tag: 'VERIFY_ATTESTATION_FAILED',
        }))
        c.expect(res.status).toEqual(401)
      }))
  })
})
