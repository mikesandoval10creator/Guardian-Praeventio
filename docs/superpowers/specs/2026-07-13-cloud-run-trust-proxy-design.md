# Cloud Run trust proxy and rate-limit identity

## Context

Praeventio Guard runs Express behind Firebase Hosting and Cloud Run. The
deployment path is declared in `firebase.json`, which rewrites all Hosting
traffic to the `guardian-praeventio` Cloud Run service. Express is currently
created without a `trust proxy` policy, while the global and public-route rate
limiters derive their keys from `req.ip`.

The distributed Firestore rate-limit store already prevents per-instance
counter divergence. This change addresses the remaining identity problem:
Express must trust the known ingress hop so `req.ip` represents the client
address instead of the Cloud Run peer address.

## Goals

- Configure a narrow, explicit proxy policy before any middleware or limiter.
- Preserve every existing limiter and its thresholds.
- Keep local development and non-proxied test processes untrusted by default.
- Prevent a caller from selecting an arbitrary `X-Forwarded-For` value.
- Make deployment behavior and staging verification explicit.

## Non-goals

- Replacing `express-rate-limit` or the Firestore-backed store.
- Changing rate-limit quotas, route ordering, authentication, or billing tiers.
- Adding a new public diagnostic endpoint.
- Generalizing the deployment to arbitrary, undocumented proxy chains.

## Considered approaches

1. Set `trust proxy` to `true`. Rejected because Express would accept the
   left-most forwarded value and could trust caller-supplied entries.
2. Always trust a fixed hop count in every environment. Rejected because local
   and alternate deployments would silently change their security boundary.
3. Apply a Cloud Run-aware one-hop policy with an explicit configuration
   override. Selected because the immediate managed ingress is the only trusted
   hop in the documented Cloud Run path, while other environments remain
   fail-closed.

## Design

Create `src/server/config/trustProxy.ts` with a pure resolver and a small
application helper:

- No Cloud Run marker and no explicit setting: return `false`.
- Cloud Run marker (`K_SERVICE`) and no explicit setting: trust exactly one
  hop.
- `TRUST_PROXY_HOPS=0`: disable proxy trust explicitly.
- `TRUST_PROXY_HOPS=<positive integer>`: trust exactly that many hops for a
  deployment whose topology has been verified.
- Empty, negative, fractional, or non-numeric explicit values: throw during startup so
  production cannot boot with an ambiguous security boundary.

`server.ts` will call the helper immediately after `express()` and before
request IDs, parsers, routers, or rate limiters are mounted. Existing key
generators continue using `req.ip` and `ipKeyGenerator`, preserving IPv6 `/64`
normalization.

The override exists for a verified future topology such as an additional load
balancer. It is configuration, not automatic header guessing. Any value above
one requires the staging procedure below before deployment.

## Request flow

1. Cloud Run accepts the network connection from its managed ingress.
2. Express trusts only the configured number of hops.
3. Express computes `req.ip` from the trusted suffix of the forwarded chain.
4. Existing `ipKeyGenerator` helpers normalize that address.
5. The existing Firestore store shares the resulting bucket across replicas.

In local development, forwarded headers remain untrusted unless a developer
opts in explicitly, so a direct caller cannot spoof its limiter identity.

## Error handling and observability

Invalid `TRUST_PROXY_HOPS` is a startup configuration error with a message that
names the variable but never emits request data or secrets. The selected mode
is exposed as a pure return value for tests; no client IP is logged by this
change.

## Tests

Unit tests will cover default local behavior, Cloud Run auto-configuration,
explicit disablement, valid positive hop counts, and every invalid value class.
An Express/Supertest integration test will prove:

- direct local requests ignore a forged `X-Forwarded-For` header;
- Cloud Run mode resolves two distinct forwarded client addresses separately;
- only the trusted suffix is used when extra caller-controlled values exist;
- `ipOnlyKey` continues to normalize the resulting `req.ip`.

Existing limiter and server mount-order suites must remain green. Final
verification includes focused tests, typecheck, lint on touched files, and the
production build.

## Staging verification

After deploying a revision with the default Cloud Run policy:

1. Send requests through the Firebase Hosting/custom-domain URL from two known
   public egress IPs.
2. Confirm rate-limit headers advance independently for both clients.
3. Send a request with a forged leading `X-Forwarded-For` value and confirm it
   does not create a caller-selected bucket.
4. Repeat through the permitted canonical ingress paths. If a path has an
   additional trusted proxy, set `TRUST_PROXY_HOPS` only after documenting the
   observed chain and rerun all three checks.

The task is complete when the application derives stable, distinct limiter
keys for real clients behind the deployed ingress without trusting arbitrary
forwarded values.
