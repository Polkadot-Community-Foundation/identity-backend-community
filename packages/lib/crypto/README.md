# @identity-backend/crypto

A TypeScript package providing cryptographic utilities with a focus on SR25519 functionality. Built with Effect for type-safe, functional programming.

## Features

- **SR25519 Cryptography**
  - Key pair generation and management
  - Signing and verification
  - Type-safe public and private key handling
  - Redacted private key support for security

## Installation

```bash
pnpm add @identity-backend/crypto
```

## Usage

### SR25519

```typescript
import { sr25519 } from '@identity-backend/crypto'
import { Effect } from 'effect'

// Generate a new keypair
const program = Effect.gen(function*() {
  const keypair = yield* sr25519.generateKeypair()
  
  // Sign a message
  const message = new TextEncoder().encode('Hello, World!')
  const signature = yield* keypair.sign(message)
  
  // Verify the signature
  const isValid = yield* keypair.verify(message, signature)
})

// Create a readonly keypair from public key
const readonlyProgram = Effect.gen(function*() {
  const publicKey = // ... your public key as Uint8Array ...
  const readonlyKeypair = yield* sr25519.fromPublicKey({ publicKey })
  
  // Can verify but not sign
  const isValid = yield* readonlyKeypair.verify(message, signature)
})
```
