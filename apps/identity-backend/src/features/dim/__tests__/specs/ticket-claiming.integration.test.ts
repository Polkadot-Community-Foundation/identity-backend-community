import { DB } from '#root/db/drizzle.js'
import { ClaimCommand, ClaimInvitationTicketShell } from '#root/features/dim/claim-invitation-ticket.shell.js'
import { expect } from '@effect/vitest'
import { And, Given, Then, When } from '@identity-backend/effect-vitest-gherkin'
import { Effect, Either } from 'effect'
import {
  ALICE,
  BOB,
  DIM_GAME,
  DIM_PROOF_OF_INK,
  MAX_CONCURRENT_CLAIMS,
  NETWORK_WESTEND2,
} from '../helpers/constants.js'
import { cleanUp, insertAvailableTicket, insertClaimedTicket, readTicket } from '../helpers/db-helpers.js'
import { generateTestTicket } from '../helpers/factories.js'
import { feature, testLayer } from '../helpers/layers.js'

feature('Invitation Ticket Claiming')
  .withScenarioLayer(testLayer)
  .withScope({ db: DB, shell: ClaimInvitationTicketShell })
  .body(({ scenario, background, scope }) => {
    background(cleanUp)

    scenario(
      'Should_ClaimTicketAndReturnSignature_When_TicketAvailable',
      scope.pipe(
        Given('an available ticket in the Game pool')('ticket', ({ db }) =>
          Effect.gen(function*() {
            const ticket = yield* generateTestTicket
            yield* insertAvailableTicket(db, { publicKey: ticket.publicKey }, { privateKey: ticket.privateKey })
            return ticket
          })),
        When('claiming the ticket')(
          'result',
          ({ shell }) => shell.execute(new ClaimCommand({ who: ALICE.ss58Address, dim: DIM_GAME })),
        ),
        Then('claim returns a signature')(({ result }) => {
          expect(result.signature).toBeDefined()
        }),
        And('remaining count is zero')(({ result }) => {
          expect(result.remaining).toBe(0)
        }),
        And('ticket is marked as claimed')(({ db, ticket }) =>
          Effect.gen(function*() {
            const row = yield* readTicket(db, ticket.publicKey)
            expect(row?.state).toBe('claimed')
          })
        ),
      ),
    )

    scenario(
      'Should_ConsumeOldestTicket_When_MultipleAvailable',
      scope.pipe(
        Given('three tickets inserted in chronological order')('tickets', ({ db }) =>
          Effect.gen(function*() {
            const t1 = new Date('2025-01-01T00:00:00Z')
            const t2 = new Date('2025-01-01T00:00:01Z')
            const t3 = new Date('2025-01-01T00:00:02Z')
            const tk1 = yield* generateTestTicket
            const tk2 = yield* generateTestTicket
            const tk3 = yield* generateTestTicket
            yield* insertAvailableTicket(db, { publicKey: tk1.publicKey, createdAt: t1 }, {
              privateKey: tk1.privateKey,
            })
            yield* insertAvailableTicket(db, { publicKey: tk2.publicKey, createdAt: t2 }, {
              privateKey: tk2.privateKey,
            })
            yield* insertAvailableTicket(db, { publicKey: tk3.publicKey, createdAt: t3 }, {
              privateKey: tk3.privateKey,
            })
            return { tk1 }
          })),
        When('claiming a ticket')(
          'result',
          ({ shell }) => shell.execute(new ClaimCommand({ who: ALICE.ss58Address, dim: DIM_GAME })),
        ),
        Then('two tickets remain')(({ result }) => {
          expect(result.remaining).toBe(2)
        }),
        And('the oldest ticket is consumed')(({ db, tickets }) =>
          Effect.gen(function*() {
            const oldest = yield* readTicket(db, tickets.tk1.publicKey)
            expect(oldest?.state).toBe('claimed')
          })
        ),
      ),
    )

    scenario(
      'Should_RejectClaim_When_PoolExhausted',
      scope.pipe(
        When('claiming from an empty pool')(
          'result',
          ({ shell }) => shell.execute(new ClaimCommand({ who: ALICE.ss58Address, dim: DIM_GAME })).pipe(Effect.either),
        ),
        Then('returns PoolExhaustedError')(({ result }) => {
          expect(result).toMatchObject(Either.left({ _tag: 'PoolExhaustedError' }))
        }),
      ),
    )

    scenario(
      'Should_AllowOneWinner_When_TwoConcurrentClaims',
      scope.pipe(
        Given('one available ticket')(({ db }) =>
          Effect.gen(function*() {
            const ticket = yield* generateTestTicket
            yield* insertAvailableTicket(db, { publicKey: ticket.publicKey }, { privateKey: ticket.privateKey })
          })
        ),
        When('two addresses claim concurrently')('results', ({ shell }) => {
          const claimA = shell.execute(new ClaimCommand({ who: ALICE.ss58Address, dim: DIM_GAME })).pipe(Effect.either)
          const claimB = shell.execute(new ClaimCommand({ who: BOB.ss58Address, dim: DIM_GAME })).pipe(Effect.either)
          return Effect.all([claimA, claimB], { concurrency: 2 })
        }),
        Then('exactly one claim succeeds')(({ results }) => {
          const winners = results.filter(Either.isRight)
          const losers = results.filter(Either.isLeft)
          expect(winners.length).toBe(1)
          expect(losers.length).toBe(1)
          const loserTags = losers.map(Either.match({ onLeft: (e) => e._tag, onRight: () => null }))
          expect(loserTags).toEqual(['TicketRaceError'])
        }),
      ),
    )

    scenario(
      'Should_AllowExactlyOneWinner_When_ManyConcurrentClaims',
      scope.pipe(
        Given('one available ticket')(({ db }) =>
          Effect.gen(function*() {
            const ticket = yield* generateTestTicket
            yield* insertAvailableTicket(db, { publicKey: ticket.publicKey }, { privateKey: ticket.privateKey })
          })
        ),
        When('MAX_CONCURRENT_CLAIMS addresses claim concurrently')('results', ({ shell }) => {
          const claims = Array.from(
            { length: MAX_CONCURRENT_CLAIMS },
            () => shell.execute(new ClaimCommand({ who: ALICE.ss58Address, dim: DIM_GAME })).pipe(Effect.either),
          )
          return Effect.all(claims, { concurrency: 'unbounded' })
        }),
        Then('exactly one claim succeeds')(({ results }) => {
          const winners = results.filter(Either.isRight)
          const losers = results.filter(Either.isLeft)
          expect(winners.length).toBe(1)
          expect(losers.length).toBe(MAX_CONCURRENT_CLAIMS - 1)
          const loserTags = losers.map(Either.match({ onLeft: (e) => e._tag, onRight: () => null }))
          expect(loserTags).toEqual(
            Array.from({ length: MAX_CONCURRENT_CLAIMS - 1 }, () => 'TicketRaceError'),
          )
        }),
      ),
    )

    scenario(
      'Should_RejectClaim_When_WrongPoolExhausted',
      scope.pipe(
        Given('a ticket exists in the Game pool but not ProofOfInk')(({ db }) =>
          Effect.gen(function*() {
            const ticket = yield* generateTestTicket
            yield* insertAvailableTicket(db, {
              publicKey: ticket.publicKey,
              dim: DIM_GAME,
              network: NETWORK_WESTEND2,
            }, { privateKey: ticket.privateKey })
          })
        ),
        When('claiming from the ProofOfInk pool')(
          'result',
          ({ shell }) =>
            shell.execute(new ClaimCommand({ who: ALICE.ss58Address, dim: DIM_PROOF_OF_INK })).pipe(Effect.either),
        ),
        Then('returns PoolExhaustedError for the wrong pool')(({ result }) => {
          expect(result).toMatchObject(Either.left({ _tag: 'PoolExhaustedError' }))
        }),
      ),
    )

    scenario(
      'Should_RejectClaim_When_AllTicketsConsumed',
      scope.pipe(
        Given('a ticket that is already claimed')(({ db }) =>
          Effect.gen(function*() {
            const ticket = yield* generateTestTicket
            yield* insertClaimedTicket(db, {
              publicKey: ticket.publicKey,
              claimedBy: ALICE.ss58Address,
            })
          })
        ),
        When('claiming from a pool with only claimed tickets')(
          'result',
          ({ shell }) => shell.execute(new ClaimCommand({ who: ALICE.ss58Address, dim: DIM_GAME })).pipe(Effect.either),
        ),
        Then('returns PoolExhaustedError')(({ result }) => {
          expect(result).toMatchObject(Either.left({ _tag: 'PoolExhaustedError' }))
        }),
      ),
    )

    scenario(
      'Should_PersistClaimantAndTimestamp_When_ClaimSucceeds',
      scope.pipe(
        Given('an available ticket')('ticket', ({ db }) =>
          Effect.gen(function*() {
            const ticket = yield* generateTestTicket
            yield* insertAvailableTicket(db, { publicKey: ticket.publicKey }, { privateKey: ticket.privateKey })
            return ticket
          })),
        And('claiming the ticket')(({ shell }) =>
          shell.execute(new ClaimCommand({ who: ALICE.ss58Address, dim: DIM_GAME }))
        ),
        Then('ticket is marked as claimed')(({ db, ticket }) =>
          Effect.gen(function*() {
            const row = yield* readTicket(db, ticket.publicKey)
            expect(row?.state).toBe('claimed')
          })
        ),
        And('claimant address is persisted')(({ db, ticket }) =>
          Effect.gen(function*() {
            const row = yield* readTicket(db, ticket.publicKey)
            expect(row?.claimedBy).toBe(ALICE.ss58Address)
          })
        ),
        And('claim timestamp is persisted')(({ db, ticket }) =>
          Effect.gen(function*() {
            const row = yield* readTicket(db, ticket.publicKey)
            expect(row?.claimedAt).toBeInstanceOf(Date)
          })
        ),
      ),
    )

    scenario(
      'Should_NotDoubleConsume_When_RetryingClaim',
      scope.pipe(
        Given('an available ticket')(({ db }) =>
          Effect.gen(function*() {
            const ticket = yield* generateTestTicket
            yield* insertAvailableTicket(db, { publicKey: ticket.publicKey }, { privateKey: ticket.privateKey })
          })
        ),
        And('the ticket is claimed successfully')(({ shell }) =>
          shell.execute(new ClaimCommand({ who: ALICE.ss58Address, dim: DIM_GAME }))
        ),
        When('retrying the same claim')(
          'retry',
          ({ shell }) => shell.execute(new ClaimCommand({ who: ALICE.ss58Address, dim: DIM_GAME })).pipe(Effect.either),
        ),
        Then('retry returns PoolExhaustedError')(({ retry }) => {
          expect(retry).toMatchObject(Either.left({ _tag: 'PoolExhaustedError' }))
        }),
      ),
    )

    scenario(
      'Should_NotAffectOtherPool_When_ClaimingFromOnePool',
      scope.pipe(
        Given('tickets in both Game and ProofOfInk pools')('tickets', ({ db }) =>
          Effect.gen(function*() {
            const gameTicket = yield* generateTestTicket
            const inkTicket = yield* generateTestTicket
            yield* insertAvailableTicket(db, {
              publicKey: gameTicket.publicKey,
              dim: DIM_GAME,
              network: NETWORK_WESTEND2,
            }, { privateKey: gameTicket.privateKey })
            yield* insertAvailableTicket(db, {
              publicKey: inkTicket.publicKey,
              dim: DIM_PROOF_OF_INK,
              network: NETWORK_WESTEND2,
            }, { privateKey: inkTicket.privateKey })
            return { gameTicket, inkTicket }
          })),
        And('claiming from the Game pool')(({ shell }) =>
          shell.execute(new ClaimCommand({ who: ALICE.ss58Address, dim: DIM_GAME }))
        ),
        Then('Game ticket is claimed')(({ db, tickets }) =>
          Effect.gen(function*() {
            const gameRow = yield* readTicket(db, tickets.gameTicket.publicKey)
            expect(gameRow?.state).toBe('claimed')
          })
        ),
        And('ProofOfInk ticket is still available')(({ db, tickets }) =>
          Effect.gen(function*() {
            const inkRow = yield* readTicket(db, tickets.inkTicket.publicKey)
            expect(inkRow?.state).toBe('available')
          })
        ),
      ),
    )
  })
