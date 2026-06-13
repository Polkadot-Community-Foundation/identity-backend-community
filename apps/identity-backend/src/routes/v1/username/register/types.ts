import { HEX_STRING_REGEXP, USERNAME_BASE_V1_REGEXP, USERNAME_DIGITS_V1_REGEXP } from '#root/constants.js'
import { z } from '@hono/zod-openapi'
import { HexString } from '@identity-backend/substrate-schema'
import { decodeHex } from '@std/encoding/hex'
import { Schema as S } from 'effect'

export const PreferredDigitsSchema = z.string().regex(USERNAME_DIGITS_V1_REGEXP, {
  message: 'Digits must be between 01-99',
})

export const RegisterUsernamesV1Request = z.object({
  candidateAccountId: z.string()
    .openapi({
      description: 'The SS58 address of the candidate account.',
      examples: ['5FbRAkhDvNVecNzHLFxBNXFXNwvBaV69S1W3nfBbnxYypkkT'],
    }),
  username: z.string()
    .regex(USERNAME_BASE_V1_REGEXP, { abort: true })
    .openapi({
      description: 'Base username (username without the trailing .xx) to reserve in the individuality pallet.',
      examples: ['alice'],
    }),
  preferredDigits: PreferredDigitsSchema.optional().openapi({
    description:
      'Optional preferred two-digit suffix (01-99). If provided and available, assigns these digits. If taken, rejects with 409.',
    examples: ['42'],
  }),
  candidateSignature: z.string()
    .regex(/^0x[a-fA-F0-9]{128}$/, {
      message: 'Must be a hexadecimal string of exactly 64 bytes.',
    })
    .transform((value) => decodeHex(S.decodeSync(HexString)(value)))
    .openapi({
      description: 'Hex-encoded sr25519 signature proving username ownership.',
    }),
  ringVrfKey: z.string()
    .regex(HEX_STRING_REGEXP, { abort: true })
    .transform((value) => decodeHex(S.decodeSync(HexString)(value)))
    .openapi({
      description: 'Hex-encoded ring VRF key supplied by the candidate.',
    }),
  proofOfOwnership: z.string()
    .regex(/^0x[a-fA-F0-9]{128}$/, {
      message: 'Must be a hexadecimal string of exactly 64 bytes.',
    })
    .transform((value) => decodeHex(S.decodeSync(HexString)(value)))
    .openapi({
      description: 'Hex-encoded proof of device or account ownership.',
    }),
  consumerRegistrationSignature: z.string()
    .regex(/^0x[a-fA-F0-9]{128}$/, {
      message: 'Must be a hexadecimal string of exactly 64 bytes.',
    })
    .transform((value) => decodeHex(S.decodeSync(HexString)(value)))
    .openapi({
      description: 'Hex-encoded signature for the consumer registration payload.',
    }),

  identifierKey: z.string()
    .regex(/^0x[a-fA-F0-9]{130}$/, {
      message: 'Must be a hexadecimal string of exactly 65 bytes.',
    })
    .transform((value) => decodeHex(S.decodeSync(HexString)(value)))
    .openapi({
      description: 'Hex-encoded uncompressed secp256k1 ECDH public key (65 bytes). Used as ' +
        '`identifier_key` in the People-side consumer registration payload AND as `chat_key` ' +
        "on the dotNS gateway entry — both fields are the user's communication pubkey " +
        '(see `CommunicationIdentifier` in the individuality pallet).',
    }),
  dotns: z.object({
    signature: z.string()
      .regex(/^0x[a-fA-F0-9]{128}$/, {
        message: 'Must be a hexadecimal string of exactly 64 bytes.',
      })
      .transform((value) => decodeHex(S.decodeSync(HexString)(value)))
      .openapi({
        description: 'Hex-encoded sr25519 signature over the dotNS gateway reservation message ' +
          '(SCALE-encoded tuple of attester, candidate, lite_label, chat_key, reserved_base_label, ' +
          'signed_at). The chain rejects expired or mismatched signatures.',
      }),
    signedAt: z.number().int().nonnegative().openapi({
      description: 'Unix timestamp (seconds) at which dotns.signature was produced. Part of the ' +
        'signed payload, so it MUST match the value used to construct the signature. Validated ' +
        'against the dotNS gateway validity window (MaxValiditySeconds / MaxFutureSkewSeconds).',
    }),
    reservedUsername: z.string()
      .regex(USERNAME_BASE_V1_REGEXP, { abort: true })
      .optional()
      .openapi({
        description: 'Optional second base name held for later full-person registration. ' +
          'Distinct from `username` above: `username` becomes the lite-person ' +
          '`lite_label` registered now (e.g. alice.42); reservedUsername is parked ' +
          'as `reserved_base_label` on the dotNS gateway for a later upgrade. ' +
          'When present, also part of the signed payload.',
      }),
  })
    .optional()
    .openapi({
      description: 'Optional dotNS gateway block. Presence engages the AH dual-write path ' +
        '(ah_status=RESERVED); absence keeps ah_status=PENDING. Mirrors the dotns-gateway ' +
        'pallet `reserve_name` extrinsic.',
    }),
}).openapi({
  title: 'RegisterUsernamesV1Request',
})

export const RegisterUsernamesV1Response = z.object({
  base_username: z.string()
    .openapi({
      description: 'The base username (username without the trailing .xx).',
      examples: ['charlie'],
    }),
  digits: z.string()
    .openapi({
      description: 'The two-digit suffix assigned to the username.',
      examples: ['23'],
    }),
  username: z.string()
    .openapi({
      description: 'The full username (base_username.digits).',
      examples: ['alice.23'],
    }),
  device_check_available: z.boolean()
    .optional()
    .openapi({
      description:
        'Advisory iOS DeviceCheck outcome surfaced in soft mode (ENFORCE_AUTH=false) and on the hard-mode success ' +
        'path. true: the device was available; false: the device was already registered (soft mode only — hard mode ' +
        'blocks with PAYMENT_REQUIRED). Omitted when no device token was supplied or the check could not run.',
      examples: [true],
    }),
}).openapi({
  title: 'RegisterUsernamesV1Response',
})
