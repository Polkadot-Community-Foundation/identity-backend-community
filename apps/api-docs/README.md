# API Docs

Interactive API reference for the identity backend, built with [Scalar](https://scalar.com).

Serves two routes:

- `/` — Sign in with credentials to load the API spec from the backend at `/api/swagger/json`.
- `/docs` — Renders the full interactive API reference using `@scalar/api-reference-react`.

## How it works

The backend's OpenAPI spec lives at `/api/swagger/json` and is basic-auth protected. The sign-in page authenticates with `swagger:swagger` (local defaults) and fetches the spec. The fetched spec is stored as a blob URL in `sessionStorage` and rendered by Scalar's React component.

## Running

```bash
pnpm --filter @polkadot-app/api-docs dev    # dev server, proxies to localhost:8080
pnpm --filter @polkadot-app/api-docs build   # production build
```

In development, Vite proxies `/api` and `/rpc` to `http://localhost:8080` so you don't need CORS configuration.
