# E2E People Startup Container

This container is responsible for setting up the initial state for E2E tests involving the People chain. It performs the following setup:

1. Connects to specified People chain RPC endpoints
2. Creates a Polkadot signer using Bob's credentials
3. Adds Alice as a proxy for Bob with "Any" permissions

### Environment Variables

- `PEOPLE_RPC_ENDPOINTS`: Array of People chain WebSocket RPC endpoints to connect to
  - Required
  - Example: `["ws://chopsticks:8000"]`

### Test Accounts

The container uses two predefined accounts:

- Alice (Proxy account)
- Bob (Proxy delegator)

## Usage

### Docker

```bash
docker run e2e-people-startup-container \
-e PEOPLE_RPC_ENDPOINTS='"ws://chopsticks:8000"'
```
