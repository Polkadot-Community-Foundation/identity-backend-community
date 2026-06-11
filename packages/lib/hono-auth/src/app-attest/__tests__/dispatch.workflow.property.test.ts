import { describe, it } from '@effect/vitest'
import { ruleOfSchemas } from '@identity-backend/testing/schema'
import { Either } from 'effect'
import { AppAttestDispatchCommand, AppAttestDispatchDecision, decideAppAttestDispatch } from '../dispatch.workflow.js'

const REQUIRED_ASSERTION_FIELDS = ['payload', 'keyId', 'challenge', 'clientId'] as const

const absentRequiredFields = (command: AppAttestDispatchCommand): ReadonlyArray<string> =>
  REQUIRED_ASSERTION_FIELDS.filter((field) => command[field] === undefined)

describe('decideAppAttestDispatch', () => {
  ruleOfSchemas('AppAttestDispatchCommand', AppAttestDispatchCommand)
  ruleOfSchemas('AppAttestDispatchDecision', AppAttestDispatchDecision)

  it.prop(
    '∀Command_NoIosPackage_=Skip',
    [AppAttestDispatchCommand],
    ([command]) =>
      command.iosPackage !== undefined ||
      Either.match(decideAppAttestDispatch(command), {
        onLeft: () => false,
        onRight: (decision) => decision._tag === 'Skip',
      }),
  )

  it.prop(
    '∀Command_CompleteIosAssertion_=Verify',
    [AppAttestDispatchCommand],
    ([command]) =>
      command.iosPackage === undefined || absentRequiredFields(command).length !== 0 ||
      Either.match(decideAppAttestDispatch(command), {
        onLeft: () => false,
        onRight: (decision) => decision._tag === 'Verify',
      }),
  )

  it.prop(
    '∀Command_IncompleteIosAssertion_≡AbsentFields',
    [AppAttestDispatchCommand],
    ([command]) => {
      const absent = absentRequiredFields(command)
      return command.iosPackage === undefined || absent.length === 0 ||
        Either.match(decideAppAttestDispatch(command), {
          onLeft: (error) => error.missing.join(',') === absent.join(','),
          onRight: () => false,
        })
    },
  )
})
