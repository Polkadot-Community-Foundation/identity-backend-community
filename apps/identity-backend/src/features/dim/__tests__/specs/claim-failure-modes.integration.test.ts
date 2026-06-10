import { DBTest } from '#root/db/drizzle.js'
import { ClaimCommand, ClaimInvitationTicketShell } from '#root/features/dim/claim-invitation-ticket.shell.js'
import { expect } from '@effect/vitest'
import { Then, When } from '@identity-backend/effect-vitest-gherkin'
import { Cause, Effect, Exit } from 'effect'
import { ALICE, DIM_GAME } from '../helpers/constants.js'
import { feature, infraScenarioLayer } from '../helpers/layers.js'

feature('Invitation Ticket Claim Failure Modes')
  .withLayer(DBTest)
  .withScenarioLayer(infraScenarioLayer)
  .withScope({ shell: ClaimInvitationTicketShell })
  .body(({ scenario, scope }) => {
    scenario(
      'Should_DieAsDefect_When_DbConnectionFails',
      scope.pipe(
        When('claiming with a failing db')(
          'exit',
          ({ shell }) => shell.execute(new ClaimCommand({ who: ALICE.ss58Address, dim: DIM_GAME })).pipe(Effect.exit),
        ),
        Then('exit is a die-type defect')(({ exit }) => {
          expect(Exit.isFailure(exit)).toBe(true)
          if (!Exit.isFailure(exit)) return
          expect(Cause.isDieType(exit.cause)).toBe(true)
        }),
      ),
    )
  })
