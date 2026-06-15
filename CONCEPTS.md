# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## Authentication handshake

### Handshake

The unauthenticated bootstrap exchange a client completes to obtain a JWT before it can call authenticated endpoints: it requests a Challenge, proves itself with an Attestation, and receives an access token. The handshake routes are the only ones reachable without a prior token, so they are the hardest-to-defend unauthenticated surface — protected at the edge and by input bounding rather than by an origin per-principal rate limit.

### Challenge

A stateless, self-authenticating freshness nonce the server mints and the client echoes back during the Handshake. It carries its own authenticity (only the server can mint one the server will later accept) and freshness (it expires after a fixed TTL) with no server-side storage. It is deliberately **not** single-use: a valid Challenge is replayable until it expires — non-replay is not a guarantee, only authenticity and TTL-bounded freshness are.

### Attestation

Cryptographic proof that a request originates from a genuine, unmodified instance of the app on a genuine device, presented during the Handshake. Distinct kinds exist per platform — Apple App Attest (iOS), Google Play Integrity and Android key attestation (Android), plus a voucher secret for out-of-band enrolment — but all answer the same question: is this a real instance of our app? The Attestation binds the flow; the Challenge only proves freshness.

## Rate limiting

### Rate-limit profile

Whether the origin limiter keys on the principal alone or also on the source IP. Under the shared-NAT profile the origin must never key on IP — one address fronts many principals, so an IP bucket would throttle the whole population — so only per-JWT limiting applies and unauthenticated requests are left to the edge and proof-of-compute. The global profile assumes each client has its own IP, where per-IP limiting of unauthenticated requests is safe.

### Shared-NAT carve-out

The edge rate-limiting strategy for a high-density shared egress IP — an event venue, office, or carrier CGNAT — whose address is known and static ahead of time. Traffic from the known shared IP is metered by one generous, bounded ceiling while every other source IP keeps a tight per-principal bucket, so many legitimate principals behind one address are not collateral-blocked yet a lone attacker on its own IP still is. It substitutes for per-visitor edge identification: per-principal control inside the carve-out comes from the per-JWT origin limit, proof-of-compute on the public search path, and Attestation on the Handshake — never the edge bucket.
