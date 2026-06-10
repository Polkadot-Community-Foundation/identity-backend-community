#!/usr/bin/env bun
/**
 * Generate BandersnatchVrfVerifiable Member and Intermediate for Chopsticks config
 *
 * This script generates Root values for the POP chain that include the member key
 * derived from LITE_TEST_MNEMONIC, so E2E tests can pass VRF proof validation.
 */

import { blake2b256, mnemonicToEntropy } from '@polkadot-labs/hdkd-helpers'

// The same mnemonic used in E2E tests
const LITE_TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

async function main() {
  const { member_from_entropy, members_root, members_intermediate } = await import('verifiablejs/nodejs')

  // Derive entropy from LITE_TEST_MNEMONIC using the same method as helpers.ts
  // 1. Get BIP39 entropy from mnemonic
  // 2. Hash with blake2b256
  const bip39Entropy = mnemonicToEntropy(LITE_TEST_MNEMONIC)
  const verifiableEntropy = blake2b256(bip39Entropy)

  console.log('LITE_TEST_MNEMONIC:', LITE_TEST_MNEMONIC)
  console.log('Derived entropy (hex):', Buffer.from(verifiableEntropy).toString('hex'))

  // Generate member from the derived entropy
  const member = member_from_entropy(verifiableEntropy)
  console.log('Member (hex):', Buffer.from(member).toString('hex'))
  console.log('Member length:', member.length, 'bytes')

  // Encode member as Vec<Member> for SCALE encoding (compact length 1 = 0x04 + member bytes)
  const membersVec = new Uint8Array([0x04, ...member])
  console.log('Members Vec (hex):', Buffer.from(membersVec).toString('hex'))

  const RING_EXPONENT = 10
  const root = members_root(RING_EXPONENT, membersVec)
  console.log('Ring root length:', root.length, 'bytes (expected: 768)')

  const intermediate = members_intermediate(RING_EXPONENT, membersVec)
  console.log('Intermediate length:', intermediate.length, 'bytes (expected: 848)')

  const context = new TextEncoder().encode('pop:polkadot.network/resources  ')

  console.log('\n=== RESOURCES_CONTEXT ===')
  console.log('Context (hex):', Buffer.from(context).toString('hex'))

  console.log('\n=== For Members::Root[0] ===')
  console.log('revision: 0')
  console.log('root (768 bytes):', '0x' + Buffer.from(root).toString('hex'))
  console.log('intermediate (848 bytes):', '0x' + Buffer.from(intermediate).toString('hex'))

  console.log('\n=== Summary ===')
  console.log('Root is the 768-byte MembersCommitment (RingVerifierKey)')
  console.log('Intermediate is the 848-byte MembersSet (RingVerifierKeyBuilder)')
  console.log('\nUse these values in docker/test/e2e/pop-testnet.json')
}

main().catch(console.error)
