# @identity-backend/testing

Type-safe HTTP response assertion utilities for testing Hono applications.

## Installation

```bash
pnpm add -D @identity-backend/testing
```

## Features

- **checkResponse**: Type-safe assertion function for HTTP response status codes with Hono client responses. Uses soft assertions by default so failed status checks do not terminate the test; execution continues and all failures are reported together for better diagnostics.

## Usage

### Response Status Assertion

```typescript
import { checkResponse } from '@identity-backend/testing'
import { testClient } from 'hono/testing'

const client = testClient(app)

// Make a request
const response = await client.api.$post({ json: { data: 'test' } })

// Assert the response status - this narrows the TypeScript type
checkResponse(response, 200)

// After checkResponse, TypeScript knows response.status is 200
const data = await response.json()
```

### In Vitest Tests

```typescript
import { it } from '@effect/vitest'
import { checkResponse } from '@identity-backend/testing'
import { testClient } from 'hono/testing'

it.effect('returns 401 for invalid auth', () =>
  Effect.gen(function*() {
    const client = testClient(app)

    const res = yield* Effect.tryPromise(() =>
      client.test.$post({ json: {} }, {
        headers: { 'Auth-Invalid': 'header' },
      })
    )

    // checkResponse asserts the status and narrows the type
    checkResponse(res, 401)

    const body = yield* Effect.promise(() => res.json())
    expect(body).toEqual({ error: 'Unauthorized' })
  }))
```

## Type Safety

The `checkResponse` function provides TypeScript type narrowing. After calling it with a specific status code, TypeScript will know that the response has that exact status, enabling better type inference for subsequent operations.
