import { Duration } from 'effect'

export type StatementStoreContractHarnessLabel = 'Live' | 'Fake'

export const liveReplaySettleDuration = Duration.seconds(5)

export const liveObserveBothMintedHashesTimeoutMillis = 180_000

export const statementStoreVitestCiTestTimeoutMillis = Duration.toMillis(liveReplaySettleDuration) +
  liveObserveBothMintedHashesTimeoutMillis + 25_000

export const statementStoreContractStreamTimeouts = (
  harnessLabel: StatementStoreContractHarnessLabel,
) =>
  ({
    observeOne: harnessLabel === 'Live' ? Duration.seconds(90) : Duration.seconds(12),
    observeOneFiltered: harnessLabel === 'Live' ? Duration.seconds(90) : Duration.seconds(12),
    observeBothMintedHashes: harnessLabel === 'Live'
      ? Duration.millis(liveObserveBothMintedHashesTimeoutMillis)
      : Duration.seconds(18),
  }) as const

export const subscribeBeforeSubmitLeadDuration = Duration.millis(50)

export const streamExpiryLeadDuration = Duration.seconds(6)

export const streamExpirySettleBuffer = Duration.seconds(2)

export const ppnContainerStartupTimeoutMillis = 420_000

export const grantAllowanceRpcTimeout = Duration.seconds(15)

export const grantAllowanceTxFinalizationTimeout = Duration.seconds(120)
