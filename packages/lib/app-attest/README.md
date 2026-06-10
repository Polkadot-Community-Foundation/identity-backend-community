# @identity-backend/app-attest

A TypeScript implementation of Apple's App Attest service for validating iOS app authenticity and preventing app tampering.

## Overview

This package provides functionality to verify Apple App Attest attestations and assertions, helping protect your backend services from unauthorized access and potential abuse. It implements Apple's [App Attest service](https://developer.apple.com/documentation/devicecheck/validating-apps-that-connect-to-your-server) specifications.

## Features

- Attestation verification
- Assertion verification
- Type-safe implementation using Effect
- Built-in certificate validation
- Support for development and production environments

## Installation

```bash
pnpm add @identity-backend/app-attest
```

## Usage

### Setting up the service

```typescript
import { AppAttestService } from '@identity-backend/app-attest'
import { sha256 } from '@noble/hashes/sha2.js'
import { Effect, Layer } from 'effect'

const appAttestLayer = Layer.effect(
  AppAttestService,
  Effect.provide(
    AppAttestService.Config({
      appIds: ['TEAM_ID.BUNDLE_ID'],
      buildClientDataHash: ({ payload }) => Effect.sync(() => sha256(payload)),
    }),
  ),
)
```

### Verifying Attestation

```typescript
import { Effect } from 'effect'

const verifyAttestation = Effect.gen(function*() {
  const service = yield* AppAttestService

  const result = yield* service.verifyAttestation({
    keyId: keyIdBytes,
    challenge: challengeBytes,
    attestation: attestationBytes,
  })

  // result contains:
  // - publicKey: CryptoKey
  // - receipt: Uint8Array
})
```

### Verifying Assertion

```typescript
import { Effect } from 'effect'

const verifyAssertion = Effect.gen(function*() {
  const service = yield* AppAttestService

  const signCount = yield* service.verifyAssertion({
    assertion: assertionBytes,
    clientData: clientDataBytes,
    challenge: challengeBytes,
    publicKey: publicKey,
    signCount: previousSignCount,
  })
})
```

## API Reference

### AppAttestService

The main service interface providing attestation and assertion verification.

```typescript
interface AppAttestService {
  verifyAttestation: (params: VerifyAttestation.Params) => Effect<VerifyAttestation.Result, VerifyAttestation.Error>
  verifyAssertion: (params: VerifyAssertion.Params) => Effect<VerifyAssertion.Result, VerifyAssertion.Error>
}
```

### Configuration

```typescript
interface AppAttestServiceConfig {
  readonly rootCert?: string | BufferSource
  readonly buildClientDataHash: (params: { payload: Uint8Array }) => Effect<Uint8Array>
  readonly appIds: ReadonlyArray<string>
}
```

## Testing

The package includes comprehensive tests demonstrating usage with example data from Apple's documentation:

```bash
pnpm test
```
