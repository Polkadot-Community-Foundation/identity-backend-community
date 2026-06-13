import { describe, it } from '@effect/vitest'
import { Either, FastCheck as fc, Option } from 'effect'
import {
  decideDeviceCheckGate,
  DeviceCheckAlreadyUsed,
  DeviceCheckAvailable,
  DeviceCheckFailed,
  DeviceCheckInactive,
} from '../gate.workflow.js'

describe('decideDeviceCheckGate', () => {
  it.prop('∀Token_AvailableHardMode_=RegisterPreservingToken', [fc.uint8Array()], ([deviceToken]) => {
    const result = decideDeviceCheckGate({ verdict: new DeviceCheckAvailable({ deviceToken }), enforced: true })
    return Either.isRight(result) &&
      result.right._tag === 'DeviceCheckRegister' &&
      result.right.deviceToken === deviceToken
  })

  it.prop('∀Token_AvailableSoftMode_=ProceedAvailableTrue', [fc.uint8Array()], ([deviceToken]) => {
    const result = decideDeviceCheckGate({ verdict: new DeviceCheckAvailable({ deviceToken }), enforced: false })
    return Either.isRight(result) &&
      result.right._tag === 'DeviceCheckProceed' &&
      Option.getOrNull(result.right.available) === true
  })

  it.prop('∀Token_AlreadyUsedHardMode_=Blocked', [fc.uint8Array()], ([deviceToken]) => {
    const result = decideDeviceCheckGate({ verdict: new DeviceCheckAlreadyUsed({ deviceToken }), enforced: true })
    return Either.isRight(result) && result.right._tag === 'DeviceCheckBlocked'
  })

  it.prop('∀Token_AlreadyUsedSoftMode_=ProceedAvailableFalse', [fc.uint8Array()], ([deviceToken]) => {
    const result = decideDeviceCheckGate({ verdict: new DeviceCheckAlreadyUsed({ deviceToken }), enforced: false })
    return Either.isRight(result) &&
      result.right._tag === 'DeviceCheckProceed' &&
      Option.getOrNull(result.right.available) === false
  })

  it.prop('∀Cause_FailedHardMode_=EvaluationErrorPreservingCause', [fc.anything()], ([cause]) => {
    const result = decideDeviceCheckGate({ verdict: new DeviceCheckFailed({ cause }), enforced: true })
    return Either.isLeft(result) &&
      result.left._tag === 'DeviceCheckEvaluationError' &&
      Object.is(result.left.cause, cause)
  })

  it.prop('∀Cause_FailedSoftMode_=ProceedWithoutAdvisory', [fc.anything()], ([cause]) => {
    const result = decideDeviceCheckGate({ verdict: new DeviceCheckFailed({ cause }), enforced: false })
    return Either.isRight(result) &&
      result.right._tag === 'DeviceCheckProceed' &&
      Option.isNone(result.right.available)
  })

  it.prop('∀Mode_Inactive_=TokenRequiredWhenHardElseProceedWithoutAdvisory', [fc.boolean()], ([enforced]) => {
    const result = decideDeviceCheckGate({ verdict: new DeviceCheckInactive(), enforced })
    if (Either.isLeft(result)) return false
    return enforced
      ? result.right._tag === 'DeviceCheckTokenRequired'
      : result.right._tag === 'DeviceCheckProceed' && Option.isNone(result.right.available)
  })
})
