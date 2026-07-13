# Background trigger restart recovery design

## Context

Guardian runs three Firestore listeners inside the server process for critical
incident notification, RAG embedding, and incident post-mortem generation. Each
listener currently discards its first snapshot. Events created while no process
was listening therefore remain permanently unprocessed after a restart.

Existing protection is insufficient: the mutex is process-local, the critical
alert marker is written before the external send, RAG can remain `processing`
forever after a crash, and post-mortem generation has no source marker.

## Delivery model

Use at-least-once delivery. External FCM/email calls cannot participate in a
Firestore transaction, so exactly-once delivery is impossible. A crash after an
external send but before completion may produce a duplicate after lease expiry;
losing a life-critical alert is the worse outcome.

## Transactional claim protocol

Each source document carries a deterministic claim with:

- completion marker;
- lease-until epoch milliseconds;
- opaque claim token;
- attempt counter.

A Firestore transaction atomically:

1. skips completed work;
2. skips a live lease and reports when it may be retried;
3. steals an expired/missing lease and records a new claim token.

Completion is another transaction that writes the completion marker only when
the token still owns the claim. Failure releases the lease for a later snapshot
or scheduled retry. Live leases seen during startup schedule a local retry at
lease expiry; unsubscribe cancels those timers.

## Trigger policies

### Critical incidents

Treat the existing `_criticalAlertSentAt` as a completed legacy marker to avoid
re-alerting all historical incidents on rollout. New work claims a lease, sends
FCM/email, then writes `_criticalAlertSentAt`. No recipients is a successful
terminal outcome. Failure releases the claim.

### RAG ingestion

`completed` and `skipped_too_short` are terminal. `processing` is terminal only
while its lease is live; missing or expired leases are reclaimed. Successful
embedding writes completion and clears the lease; failure writes `failed` and
releases it for retry.

### Incident post-mortem

Closed/resolved incidents with a root cause claim a lease. Before generating,
check the deterministic post-mortem node; if it already exists, backfill the
source completion marker without duplicating its audit entry. Otherwise run the
existing deterministic writer and mark completion only on `{ ok: true }`.

## Startup and multi-instance behavior

Initial snapshots are processed exactly like later snapshots. Transactions
serialize claims across Cloud Run instances; the existing in-memory mutex remains
as a low-cost local queue but is no longer the correctness boundary.

## Verification

Tests must prove that initial pending snapshots execute, completed markers skip,
stale leases recover, live leases retry after expiry, failures do not mark
completion, and duplicate snapshots produce one completed effect in the normal
case.

