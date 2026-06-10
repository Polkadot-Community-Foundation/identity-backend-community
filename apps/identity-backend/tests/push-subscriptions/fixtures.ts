import { Topic } from '#root/features/subscriptions/types.js'

export const OTHER_PUBKEY = '0x' + 'd'.repeat(64)
export const SECOND_CLIENT_PUBKEY = '0x' + 'b'.repeat(64)
export const OTHER_TOPIC = '0x' + 'e'.repeat(64)
export const TEST_JWT_SECRET = 'test-jwt-secret-for-subscription-tests'

export const TOPIC_2 = Topic.make('0x' + 'f'.repeat(64))
export const OTHER_SENDER = '0x' + 'a'.repeat(64)
export const ANOTHER_RECEIVER_CLIENT_ID = '0x' + '9'.repeat(64)
