import {
  boolean,
  char,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

const polkadotAppSchema = pgSchema('polkadot_app')

/**
 * This holds the usernames that pertain to the individuality identity pallet
 */
export const individualityUsernames = polkadotAppSchema.table(
  'individuality_usernames',
  {
    username: text('username').notNull(),
    fullUsername: text('full_username'),
    reservedUsername: text('reserved_username'),
    digits: varchar('digits', { length: 10 }).notNull(),
    network: text('network', { enum: ['westend2', 'paseo', 'polkadot'] })
      .notNull(),
    candidateAccountId: text('candidate_account_id').notNull(),
    candidateSignature: text('candidate_signature').notNull(),
    ringVrfKey: text('ring_vrf_key').notNull(),
    proofOfOwnership: text('proof_of_ownership').notNull(),
    consumerRegistrationSignature: text('consumer_registration_signature').notNull(),
    identifierKey: text('identifier_key').notNull(),
    candidateSignatureDotns: text('candidate_signature_dotns'),
    signedAt: timestamp('signed_at'),
    status: text('status', { enum: ['RESERVED', 'ASSIGNED', 'FAILED'] })
      .default('RESERVED')
      .notNull(),
    ahStatus: text('ah_status', { enum: ['PENDING', 'RESERVED', 'ASSIGNED', 'FAILED'] })
      .default('PENDING')
      .notNull(),
    source: text('source', { enum: ['INTERNAL', 'EXTERNAL'] })
      .default('INTERNAL')
      .notNull(),
    onchainData: jsonb('on_chain_data'),
    ahOnchainData: jsonb('ah_on_chain_data'),
    retryAt: timestamp('retry_at'),
    retryCount: integer('retry_count').default(0).notNull(),
    ahRetryAt: timestamp('ah_retry_at'),
    ahRetryCount: integer('ah_retry_count').default(0).notNull(),
    traceId: text('trace_id'),
    spanId: text('span_id'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).$onUpdate(
      () => new Date(),
    ),
  },
  (table) => [
    index('individuality_username_network_idx').on(table.network),
    primaryKey({ columns: [table.username, table.network, table.digits] }),
    index('individuality_username_status_idx').on(table.status),
    index('individuality_username_ah_status_idx').on(table.ahStatus),
    index('individuality_username_created_at_idx').on(table.createdAt),
    index('individuality_username_username_sort_idx').on(table.username),
    index('individuality_username_candidate_idx').on(table.candidateAccountId),
    index('individuality_username_source_idx').on(table.source),
  ],
)

export type IndividualityUsername = typeof individualityUsernames.$inferSelect

export const challenges = polkadotAppSchema.table(
  'challenges',
  {
    id: char('challenge', { length: 32 }).primaryKey(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
)

export type Challenge = typeof challenges.$inferSelect

export const appleAttestations = polkadotAppSchema.table(
  'apple-attestations',
  {
    keyId: text('key_id').primaryKey(),
    publicKey: text('public_key').notNull(),
    receipt: text('receipt').notNull(),
    signCount: integer('sign_count').default(0).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
)

export type AppleAttestation = typeof appleAttestations.$inferSelect

/**
 * DIM (Game/ProofOfInk) tickets for individuality platform
 */
export const dimTickets = polkadotAppSchema.table(
  'dim_tickets',
  {
    ticket: text('ticket').notNull(),
    network: text('network').notNull(),
    dim: text('dim', { enum: ['Game', 'ProofOfInk'] }).notNull(),
    inviter: text('inviter').notNull().default('5C4hrfjw9DjXZTzV3MwzrrAr9P1MJhSrvWGWqi1eSuyUpnhM'),
    registered: boolean('registered').notNull().default(false),
    status: text('status', { enum: ['PENDING', 'SUBMITTING', 'SUBMITTED', 'REGISTERED', 'FAILED'] }).default('PENDING')
      .notNull(),
    onchainData: jsonb('onchain_data'),
    retryAt: timestamp('retry_at'),
    retryCount: integer('retry_count').default(0).notNull(),
    traceId: text('trace_id'),
    spanId: text('span_id'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).$onUpdate(
      () => new Date(),
    ),
  },
  (table) => [
    index('dim_ticket_network_idx').on(table.network),
    index('dim_ticket_dim_idx').on(table.dim),
    index('dim_ticket_inviter_idx').on(table.inviter),
    index('dim_ticket_status_idx').on(table.status),
    index('dim_ticket_registered_idx').on(table.registered),
    index('dim_ticket_retry_at_idx').on(table.retryAt),
    primaryKey({ columns: [table.ticket] }),
  ],
)

export type DimTicket = typeof dimTickets.$inferSelect

export const invitationTickets = polkadotAppSchema.table(
  'invitation_tickets',
  {
    publicKey: text('public_key').primaryKey(),
    privateKey: text('private_key').notNull(),
    dim: text('dim', { enum: ['Game', 'ProofOfInk'] }).notNull(),
    network: text('network', { enum: ['westend2', 'paseo', 'polkadot'] }).notNull(),
    inviter: text('inviter').notNull(),
    state: text('state', {
      enum: ['available', 'claimed'],
    }).default('available').notNull(),
    claimedBy: text('claimed_by'),
    claimedAt: timestamp('claimed_at', { mode: 'date' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).$onUpdate(() => new Date()),
  },
  (table) => [
    index('invitation_ticket_claimable_idx').on(table.state, table.dim, table.network),
  ],
)

export type InvitationTicket = typeof invitationTickets.$inferSelect

/**
 * Push notification subscriptions
 */
export const pushSubscription = polkadotAppSchema.table(
  'push_subscription',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    notificationType: text('notification_type', { enum: ['apns', 'voip', 'fcm', 'web'] }).notNull(),
    token: text('token'),
    endpoint: text('endpoint'),
    p256dhKey: text('p256dh_key'),
    authKey: text('auth_key'),
    contentEncoding: text('content_encoding', { enum: ['aesgcm', 'aes128gcm'] }),
    clientId: text('client_id').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at'),
  },
  (table) => [
    index('push_subscription_notification_type_idx').on(table.notificationType),
    index('push_subscription_client_id_idx').on(table.clientId),
    unique('push_subscription_client_notify_unique_idx').on(table.clientId, table.notificationType),
    unique('push_subscription_endpoint_unique_idx').on(table.endpoint),
  ],
)

export type PushSubscription = typeof pushSubscription.$inferSelect

/**
 * Subscription rules for matching statements to subscriptions
 */
export const subscriptionRule = polkadotAppSchema.table(
  'subscription_rule',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subscriptionId: uuid('subscription_id').notNull().references(() => pushSubscription.id, { onDelete: 'cascade' }),
    senderPubkey: text('sender_pubkey').notNull(),
    topic: text('topic').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('subscription_rule_subscription_id_idx').on(table.subscriptionId),
    index('subscription_rule_sender_topic_idx').on(table.senderPubkey, table.topic),
    unique('subscription_rule_subscription_sender_topic_unique_idx').on(
      table.subscriptionId,
      table.senderPubkey,
      table.topic,
    ),
  ],
)

export type SubscriptionRule = typeof subscriptionRule.$inferSelect

/**
 * Push notification delivery records
 */
export const pushRecord = polkadotAppSchema.table(
  'push_record',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subscriptionId: uuid('subscription_id').notNull().references(() => pushSubscription.id, { onDelete: 'cascade' }),
    statementHash: text('statement_hash').notNull(),
    senderPubkey: text('sender_pubkey').notNull(),
    topic: text('topic').notNull(),
    notifyType: text('notify_type').notNull(),
    deliveryChannel: text('delivery_channel').notNull(),
    sentAt: timestamp('sent_at').defaultNow().notNull(),
  },
  (table) => [
    index('push_record_subscription_id_idx').on(table.subscriptionId),
    index('push_record_sent_at_idx').on(table.sentAt),
    unique('push_record_subscription_statement_unique_idx').on(table.subscriptionId, table.statementHash),
  ],
)

export type PushRecord = typeof pushRecord.$inferSelect

/**
 * Rate limiting state per sender/subscription
 */
export const rateLimit = polkadotAppSchema.table(
  'rate_limit',
  {
    senderPubkey: text('sender_pubkey').notNull(),
    clientId: text('client_id').notNull(),
    windowStart: timestamp('window_start').notNull(),
    notificationCount: integer('notification_count').default(0).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.senderPubkey, table.clientId] }),
  ],
)

export type RateLimit = typeof rateLimit.$inferSelect

/**
 * Failed push notification records
 */
export const failedPushRecord = polkadotAppSchema.table(
  'failed_push_record',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subscriptionId: uuid('subscription_id').notNull().references(() => pushSubscription.id, { onDelete: 'cascade' }),
    statementHash: text('statement_hash').notNull(),
    senderPubkey: text('sender_pubkey').notNull(),
    topic: text('topic').notNull(),
    notifyType: text('notify_type').notNull(),
    deliveryChannel: text('delivery_channel').notNull(),
    traceId: text('trace_id'),
    spanId: text('span_id'),
    retryable: boolean('retryable').notNull(),
    attemptedAt: timestamp('attempted_at').defaultNow().notNull(),
  },
  (table) => [
    index('failed_push_record_subscription_id_idx').on(table.subscriptionId),
    index('failed_push_record_statement_hash_idx').on(table.statementHash),
    index('failed_push_record_attempted_at_idx').on(table.attemptedAt),
  ],
)

export type FailedPushRecord = typeof failedPushRecord.$inferSelect

export const androidDeviceIdentifiers = polkadotAppSchema.table(
  'android_device_identifiers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    androidId: text('android_id').notNull().unique(),
    widevineId: text('widevine_id').notNull().unique(),
    accountId: text('account_id').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('android_device_identifiers_account_id_idx').on(table.accountId),
  ],
)

export type AndroidDeviceIdentifier = typeof androidDeviceIdentifiers.$inferSelect

export const refreshTokens = polkadotAppSchema.table(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    familyId: uuid('family_id'),
    rotatedFrom: uuid('rotated_from'),
    revokedAt: timestamp('revoked_at'),
    revokedReason: text('revoked_reason'),
  },
  (table) => [
    index('refresh_tokens_user_id_idx').on(table.userId),
    index('refresh_tokens_expires_at_idx').on(table.expiresAt),
    index('refresh_tokens_rotated_from_idx').on(table.rotatedFrom),
    index('refresh_tokens_family_id_idx').on(table.familyId),
  ],
)

export type RefreshToken = typeof refreshTokens.$inferSelect

export const registrationQueueEntries = polkadotAppSchema.table(
  'registration_queue_entries',
  {
    id: serial('id').primaryKey(),
    candidateAccountId: text('candidate_account_id').notNull(),
    username: text('username').notNull(),
    priorityGroup: integer('priority_group').notNull(),
    network: text('network').notNull(),
    enqueuedAt: timestamp('enqueued_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).$onUpdate(
      () => new Date(),
    ),
  },
  (table) => [
    index('registration_queue_priority_enqueued_idx').on(
      table.priorityGroup,
      table.enqueuedAt,
    ),
    index('registration_queue_candidate_idx').on(table.candidateAccountId),
    unique('registration_queue_account_network_unique').on(table.candidateAccountId, table.network),
  ],
)

export const lifetimePoudVouchers = polkadotAppSchema.table(
  'lifetime_poud_vouchers',
  {
    key: text('key').primaryKey(),
    used: boolean('used').notNull().default(false),
    usedAt: timestamp('used_at', { mode: 'date' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('lifetime_poud_vouchers_used_idx').on(table.used),
  ],
)

export type LifetimePoudVoucher = typeof lifetimePoudVouchers.$inferSelect

export const leaderElection = polkadotAppSchema.table(
  'leader_election',
  {
    key: text('key').notNull(),
    holder: text('holder').notNull(),
    acquiredAt: timestamp('acquired_at', { withTimezone: true }).notNull().defaultNow(),
    generation: integer('generation').notNull().default(1),
  },
  (table) => [
    primaryKey({ columns: [table.key] }),
  ],
)

export type RegistrationQueueEntry = typeof registrationQueueEntries.$inferSelect
