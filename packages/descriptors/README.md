# @identity-backend/descriptors

Generate Polkadot API (papi) descriptors with turborepo caching.

## Overview

This package generates type-safe descriptors for interacting with various Polkadot-based chains using [polkadot-api](https://github.com/paritytech/polkadot-api). It supports multiple chains including:

- Westend2 People
- Paseo People
- Polkadot People

## Setup

```bash
pnpm install
```

## Usage

### Building Descriptors

```bash
pnpm build
```

This will:

1. Clean the existing descriptors
2. Generate new descriptors using the metadata files
3. Cache the results using turborepo

### Configuration

The descriptor generation is configured in `.papi/polkadot-api.json`. Each chain entry specifies either a WebSocket endpoint or a metadata file path.
