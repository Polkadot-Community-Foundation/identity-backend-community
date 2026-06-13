export const LedgerAttributes = Object.freeze(
  {
    SYSTEM: 'ledger.system',
    NETWORK: 'ledger.network',
    TX_HASH: 'ledger.tx.hash',
    BLOCK_NUMBER: 'ledger.block.number',
    BLOCK_HASH: 'ledger.block.hash',
    TX_SUCCESS: 'ledger.tx.success',
  } as const,
)

export const LinkRelationship = Object.freeze(
  {
    CREATED_BY: 'created_by',
    INCLUDED_BY: 'included_by',
    TRIGGERED_BY: 'triggered_by',
    SUBMITTED_BY: 'submitted_by',
  } as const,
)

export const LINK_RELATIONSHIP_ATTRIBUTE = 'link.relationship' as const
