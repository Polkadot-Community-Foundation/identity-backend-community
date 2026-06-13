import { Either, Match, Option, Schema as S } from 'effect'

export class DeviceCheckAvailable extends S.TaggedClass<DeviceCheckAvailable>()(
  'DeviceCheckAvailable',
  { deviceToken: S.Uint8ArrayFromSelf },
) {}

export class DeviceCheckAlreadyUsed extends S.TaggedClass<DeviceCheckAlreadyUsed>()(
  'DeviceCheckAlreadyUsed',
  { deviceToken: S.Uint8ArrayFromSelf },
) {}

export class DeviceCheckFailed extends S.TaggedClass<DeviceCheckFailed>()(
  'DeviceCheckFailed',
  { cause: S.Unknown },
) {}

export class DeviceCheckInactive extends S.TaggedClass<DeviceCheckInactive>()(
  'DeviceCheckInactive',
  {},
) {}

export const DeviceCheckState = S.Union(
  DeviceCheckAvailable,
  DeviceCheckAlreadyUsed,
  DeviceCheckFailed,
  DeviceCheckInactive,
)

export type DeviceCheckState = S.Schema.Type<typeof DeviceCheckState>

export class DeviceCheckBlocked extends S.TaggedClass<DeviceCheckBlocked>()(
  'DeviceCheckBlocked',
  {},
) {}

export class DeviceCheckRegister extends S.TaggedClass<DeviceCheckRegister>()(
  'DeviceCheckRegister',
  { deviceToken: S.Uint8ArrayFromSelf },
) {}

export class DeviceCheckProceed extends S.TaggedClass<DeviceCheckProceed>()(
  'DeviceCheckProceed',
  { available: S.OptionFromSelf(S.Boolean) },
) {}

export class DeviceCheckTokenRequired extends S.TaggedClass<DeviceCheckTokenRequired>()(
  'DeviceCheckTokenRequired',
  {},
) {}

export const DeviceCheckDecision = S.Union(
  DeviceCheckBlocked,
  DeviceCheckRegister,
  DeviceCheckProceed,
  DeviceCheckTokenRequired,
)

export type DeviceCheckDecision = S.Schema.Type<typeof DeviceCheckDecision>

export class DeviceCheckEvaluationError extends S.TaggedError<DeviceCheckEvaluationError>()(
  'DeviceCheckEvaluationError',
  { cause: S.Unknown },
) {}

export interface DeviceCheckGateInput {
  readonly verdict: DeviceCheckState
  readonly enforced: boolean
}

type GateResult = Either.Either<DeviceCheckDecision, DeviceCheckEvaluationError>

const branchOnEnforcement = (
  enforced: boolean,
  whenHard: () => GateResult,
  whenSoft: () => GateResult,
): GateResult =>
  Match.value(enforced).pipe(
    Match.when(true, whenHard),
    Match.when(false, whenSoft),
    Match.exhaustive,
  )

export const decideDeviceCheckGate = (input: DeviceCheckGateInput): GateResult =>
  Match.value(input.verdict).pipe(
    Match.tag('DeviceCheckAvailable', (verdict) =>
      branchOnEnforcement(
        input.enforced,
        () => Either.right(new DeviceCheckRegister({ deviceToken: verdict.deviceToken })),
        () => Either.right(new DeviceCheckProceed({ available: Option.some(true) })),
      )),
    Match.tag('DeviceCheckAlreadyUsed', () =>
      branchOnEnforcement(
        input.enforced,
        () => Either.right(new DeviceCheckBlocked()),
        () => Either.right(new DeviceCheckProceed({ available: Option.some(false) })),
      )),
    Match.tag('DeviceCheckFailed', (verdict) =>
      branchOnEnforcement(
        input.enforced,
        () => Either.left(new DeviceCheckEvaluationError({ cause: verdict.cause })),
        () => Either.right(new DeviceCheckProceed({ available: Option.none() })),
      )),
    Match.tag('DeviceCheckInactive', () =>
      branchOnEnforcement(
        input.enforced,
        () => Either.right(new DeviceCheckTokenRequired()),
        () => Either.right(new DeviceCheckProceed({ available: Option.none() })),
      )),
    Match.exhaustive,
  )
