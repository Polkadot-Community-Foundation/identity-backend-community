import { hc } from 'hono/client'
import type { App } from 'identity-backend-container/v1'
import { availableParallelism } from 'node:os'
import type { StartedDockerComposeEnvironment } from 'testcontainers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createLitePersonSigner, formatParams, generateMnemonic, randomUsername } from '../helpers.ts'
import { setupTestEnvironment, teardownTestEnvironment } from '../setup.ts'

/** ln(Γ(z)) via Lanczos approximation (g=7); reflection formula for z < 0.5. */
function lnGamma(z: number): number {
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z)
  }

  z -= 1
  const c = [
    0.99999999999980993,
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7,
  ]

  let x = c[0]!
  for (let i = 1; i < 9; i++) {
    x += c[i]! / (z + i)
  }
  const t = z + 7.5
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x)
}

/** Upper-tail p-value Q(df/2, χ²/2) via Lentz's modified continued fraction for regularized incomplete gamma. */
function chiSquaredPValue(chi2: number, df: number): number {
  const a = df / 2
  const x = chi2 / 2
  const FPMIN = 1e-30

  let b = x + 1 - a
  let c = 1 / FPMIN
  let d = 1 / b
  let h = d

  for (let i = 1; i <= 200; i++) {
    const an = -i * (i - a)
    b += 2
    d = an * d + b
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = b + an / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    const delta = d * c
    h *= delta
    if (Math.abs(delta - 1) < 1e-12) break
  }

  return Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h
}

const SAMPLE_SIZE = 10_000
const NUM_CATEGORIES = 99
const SIGNIFICANCE_LEVEL = 0.001
const DEGREES_OF_FREEDOM = NUM_CATEGORIES - 1
const CRITICAL_CHI_SQ_ALPHA_001_DF_98 = 148.0
const CONCURRENCY = availableParallelism() * 25
const MAX_FAILURE_RATE = 0.05
const MAX_5XX_RETRIES = 2
const RETRY_BASE_DELAY_MS = 500
const VERIFIER_ADDRESS = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

;(['pop-testnet'] as const).map((chain) => {
  describe.concurrent(`E2E: Digit Distribution Chi-Squared Test on ${chain}`, () => {
    let environment: StartedDockerComposeEnvironment
    let app: ReturnType<typeof hc<App>>

    beforeAll(async () => {
      ;({ environment, app } = await setupTestEnvironment<App>({
        peopleNetwork: chain,
        DB_POOL_MAX: String(availableParallelism() * 12),
      }))
    })

    afterAll(async () => {
      await teardownTestEnvironment(environment)
    })

    it('Should_AssignUniformlyDistributedDigits_When_RegisteringManyUsernames', async ({ annotate }) => {
      void annotate(
        `cores=${availableParallelism()} concurrency=${CONCURRENCY} n=${SAMPLE_SIZE} α=${SIGNIFICANCE_LEVEL}`,
      )

      const counts = new Int32Array(NUM_CATEGORIES)
      const failureSamples: Array<{ index: number; status?: number; error?: string }> = []
      let failures = 0
      let cursor = 0
      let cryptoSumMs = 0
      let httpSumMs = 0

      const signer = createLitePersonSigner(generateMnemonic(), VERIFIER_ADDRESS)

      const recordFailure = (index: number, info: { status?: number; error?: string }) => {
        failures++
        if (failureSamples.length < 10) {
          failureSamples.push({ index, ...info })
        }
      }

      const worker = async () => {
        while (true) {
          const index = cursor++
          if (index >= SAMPLE_SIZE) return

          const cryptoStart = performance.now()
          const params = signer(randomUsername())
          cryptoSumMs += performance.now() - cryptoStart

          let handled = false
          for (let attempt = 0; attempt <= MAX_5XX_RETRIES && !handled; attempt++) {
            try {
              const httpStart = performance.now()
              const response = await app.api.v1.usernames.$post({
                header: {},
                json: formatParams(params),
              })
              httpSumMs += performance.now() - httpStart
              if (response.status === 202) {
                const data = (await response.json()) as { digits: string }
                counts[parseInt(data.digits, 10) - 1]! += 1
                handled = true
                break
              }
              if (response.status >= 500 && attempt < MAX_5XX_RETRIES) {
                await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt)
                continue
              }
              recordFailure(index, { status: response.status })
              handled = true
            } catch (err) {
              if (attempt < MAX_5XX_RETRIES) {
                await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt)
                continue
              }
              recordFailure(index, { error: (err as Error).message })
              handled = true
            }
          }
        }
      }

      const wallStart = performance.now()
      await Promise.all(Array.from({ length: CONCURRENCY }, worker))
      const wallMs = performance.now() - wallStart

      void annotate(
        [
          `timing wall=${(wallMs / 1000).toFixed(1)}s`,
          `crypto_sum=${(cryptoSumMs / 1000).toFixed(1)}s (≤ wall; event-loop serialized)`,
          `http_sum=${(httpSumMs / 1000).toFixed(1)}s (can exceed wall; overlaps via concurrency)`,
          `crypto/wall=${(cryptoSumMs / wallMs * 100).toFixed(1)}%  effective_concurrency=${
            (httpSumMs / wallMs).toFixed(1)
          }`,
        ].join('  '),
      )

      const failureRate = failures / SAMPLE_SIZE
      expect(
        failureRate,
        `${failures}/${SAMPLE_SIZE} requests failed (${(failureRate * 100).toFixed(2)}%). Samples: ${
          JSON.stringify(failureSamples)
        }`,
      ).toBeLessThan(MAX_FAILURE_RATE)

      let totalObserved = 0
      for (let j = 0; j < NUM_CATEGORIES; j++) totalObserved += counts[j]!
      const expected = totalObserved / NUM_CATEGORIES

      let chiSquared = 0
      for (let j = 0; j < NUM_CATEGORIES; j++) {
        const observed = counts[j]!
        chiSquared += (observed - expected) ** 2 / expected
      }
      const pValue = chiSquaredPValue(chiSquared, DEGREES_OF_FREEDOM)

      const byBucket = Array.from(counts, (observed, j) => ({ digit: j + 1, observed }))
      const sortedDesc = [...byBucket].sort((a, b) => b.observed - a.observed)
      const top5 = sortedDesc.slice(0, 5)
      const bot5 = sortedDesc.slice(-5).reverse()
      const fmt = (b: { digit: number; observed: number }) => `${String(b.digit).padStart(2, '0')}=${b.observed}`

      void annotate(
        [
          `n=${totalObserved} k=${NUM_CATEGORIES} df=${DEGREES_OF_FREEDOM} α=${SIGNIFICANCE_LEVEL} E=${
            expected.toFixed(2)
          }`,
          `χ²=${chiSquared.toFixed(2)} p=${
            pValue.toExponential(3)
          } critical@α=0.001≈${CRITICAL_CHI_SQ_ALPHA_001_DF_98}`,
          `top5:    ${top5.map(fmt).join(' ')}`,
          `bottom5: ${bot5.map(fmt).join(' ')}`,
        ].join('\n'),
      )

      expect(
        pValue,
        `Chi-squared REJECTS uniform: χ²=${chiSquared.toFixed(2)}, p=${
          pValue.toExponential(3)
        } ≤ α=${SIGNIFICANCE_LEVEL}. Top5: ${top5.map(fmt).join(' ')}  Bot5: ${bot5.map(fmt).join(' ')}`,
      ).toBeGreaterThan(SIGNIFICANCE_LEVEL)
    }, 240_000)
  })
})
