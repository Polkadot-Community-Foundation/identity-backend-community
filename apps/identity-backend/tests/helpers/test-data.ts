import type * as schema from '#root/db/schema.js'

type IndividualityUsernameInsert = typeof schema.individualityUsernames.$inferInsert

const defaults = {
  username: 'testuser',
  fullUsername: null,
  digits: '1',
  network: 'westend2' as const,
  candidateAccountId: '5CG4z7rYrzJfhDY5Nh1KeQEFXPXD6fL5PQfXVLTMmUSM0042',
  candidateSignature: '',
  ringVrfKey: '',
  proofOfOwnership: '',
  consumerRegistrationSignature: '',
  identifierKey: '',
  status: 'ASSIGNED' as const,
  source: 'INTERNAL' as const,
} satisfies IndividualityUsernameInsert

export const generateUsernameData = (
  overrides: Partial<IndividualityUsernameInsert> = {},
  seed = 42,
): IndividualityUsernameInsert => ({
  ...defaults,
  digits: String(seed),
  candidateAccountId: `5CG4z7rYrzJfhDY5Nh1KeQEFXPXD6fL5PQfXVLTMmUSM${String(seed).padStart(4, '0')}`,
  ...overrides,
})

export const generateUsernameDataArray = (
  count: number,
  overrides: Partial<IndividualityUsernameInsert> = {},
  baseSeed = 42,
): IndividualityUsernameInsert[] =>
  Array.from({ length: count }, (_, i) => generateUsernameData(overrides, baseSeed + i))

export const generatePaginationData = (
  baseUsername: string,
  count = 15,
  baseSeed = 42,
): IndividualityUsernameInsert[] =>
  Array.from({ length: count }, (_, i) =>
    generateUsernameData(
      { username: baseUsername, digits: String(i + 1), fullUsername: null, network: 'westend2' },
      baseSeed + i,
    ))
