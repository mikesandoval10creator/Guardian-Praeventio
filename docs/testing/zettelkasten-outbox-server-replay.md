# Zettelkasten: authorized replay of offline node batches

## Defect and chosen boundary

`writeNodes()` persists an offline `create` envelope addressed to
`zettelkasten_nodes`, with `{ projectId, nodes }`. Before this correction,
`OfflineSyncManager` treated that envelope as a generic client `setDoc`.
The root collection is server-only, so that drain cannot succeed under the
production rules. This is a blocked replay, not evidence of silent data loss.

The replay now POSTs the persisted batch to the existing
`/api/zettelkasten/nodes` server writer. The generic executor returns before
client Firestore document lookup or mutation. No rules, roles, server write
semantics, readers, Rust/WASM engine, or production feature flags change.

Callers inspected before retaining the producer/envelope:

- `zettelkasten/flows/incidentLessonTrainingFlow.ts`: `onIncidentReported`
  uses the default production `writeNodes`, without injected writers in the
  emulator regression. The first step writes one node and no edge.
- `slm/reconciliationRunner.ts`: converts queued sessions into risk payloads
  and delegates to `writeNodes`. Its reconciliation/ack semantics are not
  changed here.

## Replay contract

- Only `create` batches for `zettelkasten_nodes` enter this replay.
- Require explicit non-empty `data.projectId`, one through 32 nodes, and the
  node IDs already persisted by the producer. Never regenerate missing IDs.
- An optional operation-level `projectId` must agree with the payload.
  Existing envelopes lacking that optional field retain their payload scope.
- Preserve every node field and persisted ID. Snapshot the JSON request before
  async authentication. Queue-only fields such as `localUpdatedAt` are not
  sent as endpoint request fields.
- Obtain a token result from the captured Firebase user. Its UID must match
  the operation owner and its custom tenant claim must match the operation.
  Re-resolve the current queue identity (owner, tenant, installation, schema)
  and reject changes before sending. Do not obtain a new account's token and
  use it to drain another account's queue.
- Send `Idempotency-Key: zk-node-batch-<persisted operation ID>`. Retries of the
  same operation retain the same header and exact body. The existing server
  idempotency middleware scopes/cache-validates it; non-2xx releases its claim
  instead of caching an authorization failure forever.
- Bound the HTTP request/body-read phase with a 30-second abort deadline and
  always clear its timer, so a stalled transport can return to the queue's
  existing retry policy. Firebase SDK token acquisition retains its own SDK
  behavior; this is not an end-to-end authentication deadline.
- Require HTTP success **and** `{ success: true, count, ids }` matching all
  persisted IDs in order before resolving the executor.
- HTTP errors, missing auth, invalid scope, malformed batch and invalid ACK
  throw to the existing state machine. HTTP response error bodies are not
  copied into the persisted error. Existing backoff, retention and dead-letter
  policy remain authoritative; this does not introduce infinite retries.
- Do not delete legacy sources, regenerate invalid envelopes, open collection
  rules, or discard queued rows to make a test pass.

## Verification layers

### Unit/component

Run with the normal Vite+ test entry:

```sh
npm run test:ci -- src/components/OfflineSyncManager src/services/zettelkasten/persistence src/services/sync/syncStateMachine src/services/zettelkasten/flows/incidentLessonTrainingFlow.test.ts src/services/slm/reconciliationRunner.test.ts src/__tests__/server/zettelkasten.test.ts
npm run verify:fresh
```

The component test invokes the actual registered executor and proves the batch
uses the endpoint with zero client `setDoc` calls. Unit tests cover owner,
tenant, installation, session changes during token acquisition, legacy dotted
node IDs, request reuse after response loss, invalid batches, HTTP failures,
and false/malformed acknowledgements. HTTP mocks at this layer are not runtime
backend evidence.

### Real production-router / emulator round trip

The new `src/rules-tests/zettelkasten-outbox-replay.test.ts` belongs to the
rules lane, **not** to the store lane that intentionally boots open test rules.
The canonical `npm run test:rules` and the GitHub rules job now boot Auth too:

```sh
firebase emulators:exec --only firestore,storage,auth --project praeventio-rules-test "npx vitest run --config vitest.rules.config.ts src/rules-tests/zettelkasten-outbox-replay.test.ts"
```

This test refuses to start without loopback Firestore/Auth emulators and a test
project. It loads the actual `firestore.rules` and the production Express
router, authenticates with the real Firebase client/Auth emulator, and uses
real Firebase Admin authorization/storage and the actual AES-GCM queue.
`fake-indexeddb` supplies the IndexedDB platform adapter in Node; it is not a
mock queue or a browser/phone certification. A loopback fetch adapter resolves
the browser-relative endpoint URL. It never synthesizes an HTTP response.

The scenario asserts:

1. A direct authenticated client write to the root collection remains DENIED.
2. The real incident caller runs offline, makes no endpoint request, and queues
   the enriched batch under its owner/tenant/installation identity.
3. Reconnection without project membership receives actual HTTP403. The queue
   exposes `online_failed` and its error, and the encrypted row remains.
4. A fresh state-machine instance rehydrates that row from the real encrypted
   persistence. Granting membership allows the existing server writer to run.
5. An explicitly injected loss of the committed HTTP response leaves the row
   retryable even though the source and canonical projection can be read back.
6. Subsequent retry and repeated replay reuse the same body/request key, return
   the server's cached acknowledgement, and do not write the source again:
   there is one source row, one canonical projection, one audit write, and an
   unchanged source document update timestamp.
7. Only after the exact ACK does the queue become synced and remove its empty
   encrypted queue record.

The first harness runs exposed assumptions about automatic retry timers and
empty-queue persistence: manual reconnection phases now control the online
getter, and a drained encrypted queue is expected to have no record (`null`),
matching `saveOperations`. No production scheduler/persistence change was made
for those harness adjustments.

## Limits

This proves the selected web/client batch replay against emulated services. It
does not prove Android process survival, native SQLite durability, phone/OEM
lifecycle, deployed service availability, notification delivery, or physical
safety. It does not certify all SLM reconciliation behavior or repair historical
canonical projections. The existing backend projection/dual-write recovery
contract is unchanged; a successful source ACK is not a new guarantee about
all downstream materializers under failure.
