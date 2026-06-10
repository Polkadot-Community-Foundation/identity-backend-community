import { Schema as S } from 'effect'
import { RpcU64Schema } from './rpc-u64.schema.js'

const SubmitRpcNew = S.Struct({ status: S.Literal('new') }).annotations({
  identifier: 'SubmitRpcNew',
})

const SubmitRpcKnown = S.Struct({ status: S.Literal('known') }).annotations({
  identifier: 'SubmitRpcKnown',
})

const SubmitRpcKnownExpired = S.Struct({ status: S.Literal('knownExpired') }).annotations({
  identifier: 'SubmitRpcKnownExpired',
})

const SubmitRpcInternalError = S.Struct({
  status: S.Literal('internalError'),
  error: S.String,
}).annotations({ identifier: 'SubmitRpcInternalError' })

const SubmitRpcInvalidNoProofBadProof = S.Union(
  S.Struct({ status: S.Literal('invalid'), reason: S.Literal('noProof') }),
  S.Struct({ status: S.Literal('invalid'), reason: S.Literal('badProof') }),
).annotations({ identifier: 'SubmitRpcInvalidNoProofBadProof' })

const SubmitRpcInvalidEncodingTooLargeWire = S.Struct({
  status: S.Literal('invalid'),
  reason: S.Literal('encodingTooLarge'),
  submittedSize: S.propertySignature(S.Finite).pipe(S.fromKey('submitted_size')),
  maxSize: S.propertySignature(S.Finite).pipe(S.fromKey('max_size')),
}).annotations({ identifier: 'SubmitRpcInvalidEncodingTooLargeWire' })

const SubmitRpcInvalidEncodingTooLarge = SubmitRpcInvalidEncodingTooLargeWire.pipe(
  S.rename({ submittedSize: 'submitted_size', maxSize: 'max_size' }),
).annotations({ identifier: 'SubmitRpcInvalidEncodingTooLarge' })

const SubmitRpcInvalidAlreadyExpired = S.Struct({
  status: S.Literal('invalid'),
  reason: S.Literal('alreadyExpired'),
}).annotations({ identifier: 'SubmitRpcInvalidAlreadyExpired' })

const SubmitRpcRejectedDataTooLargeWire = S.Struct({
  status: S.Literal('rejected'),
  reason: S.Literal('dataTooLarge'),
  submittedSize: S.propertySignature(S.Finite).pipe(S.fromKey('submitted_size')),
  availableSize: S.propertySignature(S.Finite).pipe(S.fromKey('available_size')),
}).annotations({ identifier: 'SubmitRpcRejectedDataTooLargeWire' })

const SubmitRpcRejectedDataTooLarge = SubmitRpcRejectedDataTooLargeWire.pipe(
  S.rename({ submittedSize: 'submitted_size', availableSize: 'available_size' }),
).annotations({ identifier: 'SubmitRpcRejectedDataTooLarge' })

const SubmitRpcRejectedCplWire = S.Struct({
  status: S.Literal('rejected'),
  reason: S.Literal('channelPriorityTooLow'),
  submittedExpiry: S.propertySignature(RpcU64Schema).pipe(S.fromKey('submitted_expiry')),
  minExpiry: S.propertySignature(RpcU64Schema).pipe(S.fromKey('min_expiry')),
}).annotations({ identifier: 'SubmitRpcRejectedCplWire' })

const SubmitRpcRejectedCpl = SubmitRpcRejectedCplWire.pipe(
  S.rename({ submittedExpiry: 'submitted_expiry', minExpiry: 'min_expiry' }),
).annotations({ identifier: 'SubmitRpcRejectedCpl' })

const SubmitRpcRejectedAccountFullWire = S.Struct({
  status: S.Literal('rejected'),
  reason: S.Literal('accountFull'),
  submittedExpiry: S.propertySignature(RpcU64Schema).pipe(S.fromKey('submitted_expiry')),
  minExpiry: S.propertySignature(RpcU64Schema).pipe(S.fromKey('min_expiry')),
}).annotations({ identifier: 'SubmitRpcRejectedAccountFullWire' })

const SubmitRpcRejectedAccountFull = SubmitRpcRejectedAccountFullWire.pipe(
  S.rename({ submittedExpiry: 'submitted_expiry', minExpiry: 'min_expiry' }),
).annotations({ identifier: 'SubmitRpcRejectedAccountFull' })

const SubmitRpcRejectedStoreFullAllowance = S.Union(
  S.Struct({ status: S.Literal('rejected'), reason: S.Literal('storeFull') }),
  S.Struct({ status: S.Literal('rejected'), reason: S.Literal('noAllowance') }),
).annotations({ identifier: 'SubmitRpcRejectedStoreFullAllowance' })

export const StatementSubmitRpcSchema = S.Union(
  SubmitRpcNew,
  SubmitRpcKnown,
  SubmitRpcKnownExpired,
  SubmitRpcInternalError,
  SubmitRpcInvalidNoProofBadProof,
  SubmitRpcInvalidEncodingTooLarge,
  SubmitRpcInvalidAlreadyExpired,
  SubmitRpcRejectedDataTooLarge,
  SubmitRpcRejectedCpl,
  SubmitRpcRejectedAccountFull,
  SubmitRpcRejectedStoreFullAllowance,
).annotations({ identifier: 'StatementSubmitRpcResult' })
