export const REGISTER_SIGNATURE_MESSAGE_PREFIX = 'pop:people-lite:register using'

export const MAXIMUM_USERNAME_ALLOCATION = 100

export const MAX_USERNAME_LENGTH = 32
export const N_USERNAME_DIGITS = 2

export const HEX_STRING_REGEXP = /^(0x)?[a-fA-F0-9]+$/

export const USERNAME_V0_REGEXP = /^([a-z0-9]{4,})\.([a-z0-9]+)$/

export const USERNAME_BASE_V1_REGEXP = /^([a-z]{6,})$/
export const USERNAME_DIGITS_V1_REGEXP = /^(0[1-9]|[1-9][0-9])$/
export const USERNAME_V1_REGEXP = /^([a-z]{6,})\.(0[1-9]|[1-9][0-9])$/

export const USERNAME_DIGIT_V1_SET = Array.from({ length: 100 }, (_, index) => index.toString().padStart(2, '0'))
