import type { Statement as SdkStatement } from '@novasamatech/sdk-statement'
import { Effect } from 'effect'
import {
  SignedStatementBuilder,
  type SignedStatementBuilder as SignedStatementBuilderApi,
  type SignedStatementFixture,
  type SignedStatementFixtureError,
} from './signed-statement-builder.js'

export const SignedStatementMother = {
  valid: (label: string): SignedStatementBuilderApi => SignedStatementBuilder.fromLabel(label),
  tampered: (
    label: string,
  ): Effect.Effect<SignedStatementFixture, SignedStatementFixtureError, never> =>
    SignedStatementBuilder.fromLabel(label).buildTampered(),
  expired: (label: string): SignedStatementBuilderApi => SignedStatementBuilder.fromLabel(label).withExpiry(1n),
  emptyTopics: (label: string): SignedStatementBuilderApi => SignedStatementBuilder.fromLabel(label).withTopics([]),
  withoutProof: (label: string): Effect.Effect<SdkStatement, SignedStatementFixtureError, never> =>
    SignedStatementBuilder.fromLabel(label).buildWithoutProof(),
}
