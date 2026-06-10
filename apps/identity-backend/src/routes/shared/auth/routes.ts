import { createOpenAPIHono, ProblemDetailWithErrorsZod, problemResponse } from '#root/lib/problem-details.js'
import { withRouteTimeout } from '#root/lib/route-timeout.js'
import { bridgeSpanContext } from '#root/tracing/bridge-span-context.js'
import type { HttpBindings } from '@hono/node-server'
import { createRoute, z } from '@hono/zod-openapi'
import {
  AppAttestationData,
  type AppAttestService,
  type ChallengeService,
  KeyId,
} from '@identity-backend/auth/services'
import { decodeBase64, encodeBase64 } from '@std/encoding'
import { Cause, Context, Effect, Exit, Layer, Runtime, Schedule } from 'effect'

export class AuthRoutesConfig extends Context.Tag('@app/AuthRoutesConfig')<
  AuthRoutesConfig,
  {
    readonly verifyAttestation: AppAttestService['verifyAttestation']
    readonly makeChallenge: ChallengeService['Type']['makeChallenge']
    readonly persistChallenge: ChallengeService['Type']['persistChallenge']
    readonly persistAttestation: AppAttestService['persistAttestation']
  }
>() {}

export namespace AuthRoutes {
  export type Options = Readonly<{
    tags?: string[]
  }>
}

export const makeAuthRoutesWithoutDependencies = (options: AuthRoutes.Options = {}) =>
  Effect.gen(function*() {
    const runtime = yield* Effect.runtime()
    const {
      makeChallenge,
      verifyAttestation,
      persistChallenge,
      persistAttestation,
    } = yield* AuthRoutesConfig

    return createOpenAPIHono<{
      Bindings: HttpBindings
    }>()
      .openapi(
        createRoute({
          ...(options.tags ? { tags: options.tags } : {}),
          summary: 'Create Auth Challenge',
          description: 'Challenge to be used in a Play Integrity or Apple Attest flow',
          method: 'post',
          path: '/challenges',
          request: {},
          responses: {
            201: {
              content: {
                'application/json': {
                  schema: z.object({
                    challenge: z.string().openapi({
                      description: 'A base64 string representing the challenge',
                      examples: ['ZYoUU5pCBzwic6jAOSe+wQ=='],
                    }),
                  }),
                },
              },
              description: 'Created',
            },
            400: { ...problemResponse(ProblemDetailWithErrorsZod), description: 'Bad Request' },
            429: {
              content: {
                'text/plain': {
                  schema: z.unknown(),
                },
              },
              description: 'Rate Limit Exceeded',
            },
            500: {
              content: {
                'application/json': {
                  schema: z.object({
                    error: z.string(),
                  }),
                },
              },
              description: 'Internal Server Error',
            },
          },
        }),
        async (c) => {
          const handler = Effect.gen(function*() {
            const challenge = yield* makeChallenge()

            yield* persistChallenge(challenge)

            return encodeBase64(challenge)
          }).pipe(
            Effect.retry(Schedule.intersect(
              Schedule.exponential('50 millis', 2),
              Schedule.recurs(2),
            )),
            Effect.withSpan('v1.auth_challenge'),
          )

          const result = await bridgeSpanContext(handler, c).pipe(
            Effect.map((value) => c.json({ challenge: value }, 201)),
            withRouteTimeout,
            Effect.exit,
            Runtime.runPromise(runtime),
          )

          if (Exit.isFailure(result)) {
            throw Cause.squash(result.cause)
          }

          return result.value
        },
      ).openapi(
        createRoute({
          ...(options.tags ? { tags: options.tags } : {}),
          summary: 'Verify Apple Attestation',
          description: 'Verifies the Apple attestation provided by the client and returns the challenge if successful.',
          method: 'post',
          path: '/app-attest/attestations',
          request: {
            body: {
              required: true,
              content: {
                'application/json': {
                  schema: z.object({
                    keyId: z.base64()
                      .transform(decodeBase64)
                      .openapi({
                        description: 'The base64-encoded key identifier for the attestation.',
                        examples: ['s/134MbeEEZDZKCvOTf+jZgNhpoDwdXZ8cKfTym8FUg='],
                      }),
                    challenge: z.base64()
                      .transform(decodeBase64)
                      .openapi({
                        description: 'The base64-encoded challenge used in the attestation process.',
                        examples: ['NmY0NmFhZWItMzk4OS00NWRiLThjMjQtNmNjODhhNzZlNzg5'],
                      }),
                    attestation: z.base64()
                      .transform(decodeBase64)
                      .openapi({
                        description: 'The base64-encoded attestation statement from Apple.',
                        examples: [
                          'o2NmbXRvYXBwbGUtYXBwYXR0ZXN0Z2F0dFN0bXSiY3g1Y4JZAzgwggM0MIICuqADAgECAgYBjXXNniswCgYIKoZIzj0EAwIwTzEj' +
                          'MCEGA1UEAwwaQXBwbGUgQXBwIEF0dGVzdGF0aW9uIENBIDExEzARBgNVBAoMCkFwcGxlIEluYy4xEzARBgNVBAgMCkNhbGlmb3Ju' +
                          'aWEwHhcNMjQwMjAzMjAyNzA2WhcNMjUwMTA4MDYyMTA2WjCBkTFJMEcGA1UEAwxAYjNmZDc3ZTBjNmRlMTA0NjQzNjRhMGFmMzkz' +
                          'N2ZlOGQ5ODBkODY5YTAzYzFkNWQ5ZjFjMjlmNGYyOWJjMTU0ODEaMBgGA1UECwwRQUFBIENlcnRpZmljYXRpb24xEzARBgNVBAoM' +
                          'CkFwcGxlIEluYy4xEzARBgNVBAgMCkNhbGlmb3JuaWEwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAATUbRMd9sTNTCHp+VvhPrOI' +
                          'SWBBq6xvez0e2WTNoFHd1iPc7BA0QRR6BudOs2wJsXdtLx8XG7CmOF1/RxA5tK/vo4IBPTCCATkwDAYDVR0TAQH/BAIwADAOBgNV' +
                          'HQ8BAf8EBAMCBPAwgYoGCSqGSIb3Y2QIBQR9MHukAwIBCr+JMAMCAQG/iTEDAgEAv4kyAwIBAb+JMwMCAQG/iTQrBClWOEg2TFE5' +
                          'NDQ4LmlvLnVlYmVsYWNrZXIuQXBwQXR0ZXN0RXhhbXBsZaUGBARza3Mgv4k2AwIBBb+JNwMCAQC/iTkDAgEAv4k6AwIBAL+JOwMC' +
                          'AQAwVwYJKoZIhvdjZAgHBEowSL+KeAgEBjE3LjIuMb+IUAcCBQD/////v4p7BwQFMjFDNja/in0IBAYxNy4yLjG/in4DAgEAv4sM' +
                          'DwQNMjEuMy42Ni4wLjAsMDAzBgkqhkiG92NkCAIEJjAkoSIEIM5NSa3vXruGr5szchuQ4E6N36Nm/mZlkJflZq9Sdm4ZMAoGCCqG' +
                          'SM49BAMCA2gAMGUCMHlYC0KJPqTmF+QSnMlf3MH2XPSrSRnjyNI5yaSGNqeIkHlLJJQj3IUnMKA8JsCXsAIxAIo0HeGatVEyQhqr' +
                          'S9Ug9/3HbMXTGXqxRcdnT3XrA/atw4UYzwsK/vEEbRItNrbsKFkCRzCCAkMwggHIoAMCAQICEAm6xeG8QBrZ1FOVvDgaCFQwCgYI' +
                          'KoZIzj0EAwMwUjEmMCQGA1UEAwwdQXBwbGUgQXBwIEF0dGVzdGF0aW9uIFJvb3QgQ0ExEzARBgNVBAoMCkFwcGxlIEluYy4xEzAR' +
                          'BgNVBAgMCkNhbGlmb3JuaWEwHhcNMjAwMzE4MTgzOTU1WhcNMzAwMzEzMDAwMDAwWjBPMSMwIQYDVQQDDBpBcHBsZSBBcHAgQXR0' +
                          'ZXN0YXRpb24gQ0EgMTETMBEGA1UECgwKQXBwbGUgSW5jLjETMBEGA1UECAwKQ2FsaWZvcm5pYTB2MBAGByqGSM49AgEGBSuBBAAi' +
                          'A2IABK5bN6B3TXmyNY9A59HyJibxwl/vF4At6rOCalmHT/jSrRUleJqiZgQZEki2PLlnBp6Y02O9XjcPv6COMp6Ac6mF53Ruo1mi' +
                          '9m8p2zKvRV4hFljVZ6+eJn6yYU3CGmbOmaNmMGQwEgYDVR0TAQH/BAgwBgEB/wIBADAfBgNVHSMEGDAWgBSskRBTM72+aEH/pwyp' +
                          '5frq5eWKoTAdBgNVHQ4EFgQUPuNdHAQZqcm0MfiEdNbh4Vdy45swDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2kAMGYCMQC7' +
                          'voiNc40FAs+8/WZtCVdQNbzWhyw/hDBJJint0fkU6HmZHJrota7406hUM/e2DQYCMQCrOO3QzIHtAKRSw7pE+ZNjZVP+zCl/LrTf' +
                          'n16+WkrKtplcS4IN+QQ4b3gHu1iUObdncmVjZWlwdFkOrzCABgkqhkiG9w0BBwKggDCAAgEBMQ8wDQYJYIZIAWUDBAIBBQAwgAYJ' +
                          'KoZIhvcNAQcBoIAkgASCA+gxggRqMDECAQICAQEEKVY4SDZMUTk0NDguaW8udWViZWxhY2tlci5BcHBBdHRlc3RFeGFtcGxlMIID' +
                          'QgIBAwIBAQSCAzgwggM0MIICuqADAgECAgYBjXXNniswCgYIKoZIzj0EAwIwTzEjMCEGA1UEAwwaQXBwbGUgQXBwIEF0dGVzdGF0' +
                          'aW9uIENBIDExEzARBgNVBAoMCkFwcGxlIEluYy4xEzARBgNVBAgMCkNhbGlmb3JuaWEwHhcNMjQwMjAzMjAyNzA2WhcNMjUwMTA4' +
                          'MDYyMTA2WjCBkTFJMEcGA1UEAwxAYjNmZDc3ZTBjNmRlMTA0NjQzNjRhMGFmMzkzN2ZlOGQ5ODBkODY5YTAzYzFkNWQ5ZjFjMjlm' +
                          'NGYyOWJjMTU0ODEaMBgGA1UECwwRQUFBIENlcnRpZmljYXRpb24xEzARBgNVBAoMCkFwcGxlIEluYy4xEzARBgNVBAgMCkNhbGlm' +
                          'b3JuaWEwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAATUbRMd9sTNTCHp+VvhPrOISWBBq6xvez0e2WTNoFHd1iPc7BA0QRR6BudO' +
                          's2wJsXdtLx8XG7CmOF1/RxA5tK/vo4IBPTCCATkwDAYDVR0TAQH/BAIwADAOBgNVHQ8BAf8EBAMCBPAwgYoGCSqGSIb3Y2QIBQR9' +
                          'MHukAwIBCr+JMAMCAQG/iTEDAgEAv4kyAwIBAb+JMwMCAQG/iTQrBClWOEg2TFE5NDQ4LmlvLnVlYmVsYWNrZXIuQXBwQXR0ZXN0' +
                          'RXhhbXBsZaUGBARza3Mgv4k2AwIBBb+JNwMCAQC/iTkDAgEAv4k6AwIBAL+JOwMCAQAwVwYJKoZIhvdjZAgHBEowSL+KeAgEBjE3' +
                          'LjIuMb+IUAcCBQD/////v4p7BwQFMjFDNja/in0IBAYxNy4yLjG/in4DAgEAv4sMDwQNMjEuMy42Ni4wLjAsMDAzBgkqhkiG92Nk' +
                          'CAIEJjAkoSIEIM5NSa3vXruGr5szchuQ4E6N36Nm/mZlkJflZq9Sdm4ZMAoGCCqGSM49BAMCA2gAMGUCMHlYC0KJPqTmF+QSnMlf' +
                          '3MH2XPSrSRnjyNI5yaSGNqeIkHlLJJQj3IUnMKA8JsCXsAIxAIo0HeGatVEyQhqrS9Ug9/3HbMXTGXqxRcdnT3XrA/atw4UYzwsK' +
                          '/vEEbRItNrbsKDAoAgEEAgEBBCCU3wfNkLCWvlrQ0iwz2h6NdnA1ymMXJeLGeG8gFJmUITBgAgEFAgEBBFgxZmt5Q2hVMUIwNWkw' +
                          'NW5Rem85MlErajZWbDR6U3duNytVb0h6bVd0ckJuN1lyaDBNNTFveFF3BIGGbXpJV2tTUFhqK1RJOC9jNFRHOHdCTmhkV1ZJZ0Vs' +
                          'UT09MA4CAQYCAQEEBkFUVEVTVDAPAgEHAgEBBAdzYW5kYm94MCACAQwCAQEEGDIwMjQtMDItMDRUMjA6Mjc6MDYuMTkzWjAgAgEV' +
                          'AgEBBBgyMDI0LTA1LTA0VDIwOjI3OjA2LjE5M1oAAAAAAACggDCCA60wggNUoAMCAQICEH3NmVEtjH3NFgveDjiBekIwCgYIKoZI' +
                          'zj0EAwIwfDEwMC4GA1UEAwwnQXBwbGUgQXBwbGljYXRpb24gSW50ZWdyYXRpb24gQ0EgNSAtIEcxMSYwJAYDVQQLDB1BcHBsZSBD' +
                          'ZXJ0aWZpY2F0aW9uIEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcNMjMwMzA4MTUyOTE3WhcN' +
                          'MjQwNDA2MTUyOTE2WjBaMTYwNAYDVQQDDC1BcHBsaWNhdGlvbiBBdHRlc3RhdGlvbiBGcmF1ZCBSZWNlaXB0IFNpZ25pbmcxEzAR' +
                          'BgNVBAoMCkFwcGxlIEluYy4xCzAJBgNVBAYTAlVTMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE2pgoZ+9d0imsG72+nHEJ7T/X' +
                          'S6UZeRiwRGwaMi/mVldJ7Pmxu9UEcwJs5pTYHdPICN2Cfh6zy/vx/Sop4n8Q/aOCAdgwggHUMAwGA1UdEwEB/wQCMAAwHwYDVR0j' +
                          'BBgwFoAU2Rf+S2eQOEuS9NvO1VeAFAuPPckwQwYIKwYBBQUHAQEENzA1MDMGCCsGAQUFBzABhidodHRwOi8vb2NzcC5hcHBsZS5j' +
                          'b20vb2NzcDAzLWFhaWNhNWcxMDEwggEcBgNVHSAEggETMIIBDzCCAQsGCSqGSIb3Y2QFATCB/TCBwwYIKwYBBQUHAgIwgbYMgbNS' +
                          'ZWxpYW5jZSBvbiB0aGlzIGNlcnRpZmljYXRlIGJ5IGFueSBwYXJ0eSBhc3N1bWVzIGFjY2VwdGFuY2Ugb2YgdGhlIHRoZW4gYXBw' +
                          'bGljYWJsZSBzdGFuZGFyZCB0ZXJtcyBhbmQgY29uZGl0aW9ucyBvZiB1c2UsIGNlcnRpZmljYXRlIHBvbGljeSBhbmQgY2VydGlm' +
                          'aWNhdGlvbiBwcmFjdGljZSBzdGF0ZW1lbnRzLjA1BggrBgEFBQcCARYpaHR0cDovL3d3dy5hcHBsZS5jb20vY2VydGlmaWNhdGVh' +
                          'dXRob3JpdHkwHQYDVR0OBBYEFEzxp58QYYoaOWTMbebbOwdil3a9MA4GA1UdDwEB/wQEAwIHgDAPBgkqhkiG92NkDA8EAgUAMAoG' +
                          'CCqGSM49BAMCA0cAMEQCIHrbZOJ1nE8FFv8sSdvzkCwvESymd45Qggp0g5ysO5vsAiBFNcdgKjJATfkqgWf8l7Zy4AmZ1CmKlucF' +
                          'y+0JcBdQjTCCAvkwggJ/oAMCAQICEFb7g9Qr/43DN5kjtVqubr0wCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwSQXBwbGUgUm9vdCBD' +
                          'QSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9uIEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UE' +
                          'BhMCVVMwHhcNMTkwMzIyMTc1MzMzWhcNMzQwMzIyMDAwMDAwWjB8MTAwLgYDVQQDDCdBcHBsZSBBcHBsaWNhdGlvbiBJbnRlZ3Jh' +
                          'dGlvbiBDQSA1IC0gRzExJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9yaXR5MRMwEQYDVQQKDApBcHBsZSBJbmMu' +
                          'MQswCQYDVQQGEwJVUzBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABJLOY719hrGrKAo7HOGv+wSUgJGs9jHfpssoNW9ES+Eh5Vfd' +
                          'Eo2NuoJ8lb5J+r4zyq7NBBnxL0Ml+vS+s8uDfrqjgfcwgfQwDwYDVR0TAQH/BAUwAwEB/zAfBgNVHSMEGDAWgBS7sN6hWDOImqSK' +
                          'md6+veuv2sskqzBGBggrBgEFBQcBAQQ6MDgwNgYIKwYBBQUHMAGGKmh0dHA6Ly9vY3NwLmFwcGxlLmNvbS9vY3NwMDMtYXBwbGVy' +
                          'b290Y2FnMzA3BgNVHR8EMDAuMCygKqAohiZodHRwOi8vY3JsLmFwcGxlLmNvbS9hcHBsZXJvb3RjYWczLmNybDAdBgNVHQ4EFgQU' +
                          '2Rf+S2eQOEuS9NvO1VeAFAuPPckwDgYDVR0PAQH/BAQDAgEGMBAGCiqGSIb3Y2QGAgMEAgUAMAoGCCqGSM49BAMDA2gAMGUCMQCN' +
                          'b6afoeDk7FtOc4qSfz14U5iP9NofWB7DdUr+OKhMKoMaGqoNpmRt4bmT6NFVTO0CMGc7LLTh6DcHd8vV7HaoGjpVOz81asjF5pKw' +
                          '4WG+gElp5F8rqWzhEQKqzGHZOLdzSjCCAkMwggHJoAMCAQICCC3F/IjSxUuVMAoGCCqGSM49BAMDMGcxGzAZBgNVBAMMEkFwcGxl' +
                          'IFJvb3QgQ0EgLSBHMzEmMCQGA1UECwwdQXBwbGUgQ2VydGlmaWNhdGlvbiBBdXRob3JpdHkxEzARBgNVBAoMCkFwcGxlIEluYy4x' +
                          'CzAJBgNVBAYTAlVTMB4XDTE0MDQzMDE4MTkwNloXDTM5MDQzMDE4MTkwNlowZzEbMBkGA1UEAwwSQXBwbGUgUm9vdCBDQSAtIEcz' +
                          'MSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9uIEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMw' +
                          'djAQBgcqhkjOPQIBBgUrgQQAIgNiAASY6S89QHKk7ZMicoETHN0QlfHFo05x3BQW2Q7lpgUqd2R7X04407scRLV/9R+2MmJdyemE' +
                          'W08wTxFaAP1YWAyl9Q8sTQdHE3Xal5eXbzFc7SudeyA72LlU2V6ZpDpRCjGjQjBAMB0GA1UdDgQWBBS7sN6hWDOImqSKmd6+veuv' +
                          '2sskqzAPBgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIBBjAKBggqhkjOPQQDAwNoADBlAjEAg+nBxBZeGl00GNnt7/RsDgBG' +
                          'S7jfskYRxQ/95nqMoaZrzsID1Jz1k8Z0uGrfqiMVAjBtZooQytQN1E/NjUM+tIpjpTNu423aF7dkH8hTJvmIYnQ5Cxdby1GoDOgY' +
                          'A+eisigAADGB/DCB+QIBATCBkDB8MTAwLgYDVQQDDCdBcHBsZSBBcHBsaWNhdGlvbiBJbnRlZ3JhdGlvbiBDQSA1IC0gRzExJjAk' +
                          'BgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9yaXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUwIQfc2Z' +
                          'US2Mfc0WC94OOIF6QjANBglghkgBZQMEAgEFADAKBggqhkjOPQQDAgRGMEQCICDRBwL6EXnsaAyzRlUAprVpCVEQPbmEqS5SnOH0' +
                          'MKUpAiBpPwpQmtHCjZDbJ+wHnQ9KNWimtKsiJgn+un48tVlFSgAAAAAAAGhhdXRoRGF0YVikyj3cO094ro3BWWx1ax19Jg0jKzZr' +
                          'OT8xG6xW0D0QOqxAAAAAAGFwcGF0dGVzdGRldmVsb3AAILP9d+DG3hBGQ2Sgrzk3/o2YDYaaA8HV2fHCn08pvBVIpQECAyYgASFY' +
                          'INRtEx32xM1MIen5W+E+s4hJYEGrrG97PR7ZZM2gUd3WIlggI9zsEDRBFHoG506zbAmxd20vHxcbsKY4XX9HEDm0r+8=',
                        ],
                      }),
                  }),
                },
              },
            },
          },
          responses: {
            202: {
              content: {
                'application/json': {
                  schema: z.object({}),
                },
              },
              description: 'Accepted',
            },
            400: { ...problemResponse(ProblemDetailWithErrorsZod), description: 'Bad Request' },
            401: {
              content: {
                'application/json': {
                  schema: z.object({
                    _tag: z.union([
                      z.literal('VERIFY_ATTESTATION_FAILED'),
                      z.literal('CHALLENGE_NOT_FOUND'),
                    ]),
                    error: z.string(),
                  }),
                },
              },
              description: 'Unauthorized',
            },
            429: {
              content: {
                'text/plain': {
                  schema: z.unknown(),
                },
              },
              description: 'Rate Limit Exceeded',
            },
            500: {
              content: {
                'application/json': {
                  schema: z.object({
                    error: z.string(),
                  }),
                },
              },
              description: 'Internal Server Error',
            },
          },
        }),
        async (c) => {
          const body = c.req.valid('json')

          const handler = Effect.gen(function*() {
            const verifyResult = yield* verifyAttestation(body)

            const attestation = AppAttestationData.make({
              keyId: KeyId.make(body.keyId),
              publicKey: verifyResult.publicKey,
              receipt: verifyResult.receipt,
            })

            yield* persistAttestation(
              {
                attestation,
                challenge: body.challenge,
              },
            )
          }).pipe(
            Effect.withSpan('v1.auth_attestation'),
          )

          const result = await bridgeSpanContext(handler, c).pipe(
            Effect.map((_value) => c.json({}, 202)),
            Effect.catchTag(
              'AppAttestError',
              (err) =>
                Effect.succeed(c.json(
                  {
                    _tag: 'VERIFY_ATTESTATION_FAILED',
                    error: err.message,
                  } as const,
                  401,
                )),
            ),
            Effect.catchTag(
              'ChallengeNotFoundError',
              (_err) =>
                Effect.succeed(c.json(
                  {
                    _tag: 'CHALLENGE_NOT_FOUND',
                    error: `Challenge Not Found`,
                  } as const,
                  401,
                )),
            ),
            withRouteTimeout,
            Effect.exit,
            Runtime.runPromise(runtime),
          )

          if (Exit.isFailure(result)) {
            throw Cause.squash(result.cause)
          }

          return result.value
        },
      )
  })

export const makeAuthRoutes = (options: AuthRoutes.Options = {}) =>
  makeAuthRoutesWithoutDependencies(options).pipe(
    Effect.provide(Layer.unwrapEffect(Effect.gen(function*() {
      const { layerAuthRoutes } = yield* Effect.promise(() => import('./layer.js'))

      return layerAuthRoutes
    }))),
  )
