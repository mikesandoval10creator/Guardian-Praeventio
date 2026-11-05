# Worker onboarding PDF persistence and replay

Ticket: `40daa66d-73fe-8183-a6de-ce329aeda964`.

## Defects and repair

- Online worker creation discarded the returned Firestore ID. Offline creation
  had no preallocated reference. Onboarding substituted `new` and could substitute
  a mutable selected project or `global`. The caller now carries the actual ID
  and captured project; the project-worker executor honors explicit IDs, rejecting
  invalid IDs/project mismatches and retaining the legacy derived-ID fallback only
  for old worker operations without an explicit ID.
- The producer targeted root `documents`, while `DocsModal` reads
  `projects/{project}/workers/{worker}/documents` with `archived == false`.
  Each PDF now has a preallocated document ID, matching metadata collection,
  Storage path, filename and metadata. IDs and cached immutable PDF bytes survive
  a partial generation retry. Changed worker/signature inputs create a new packet;
  closing the modal clears the session cache. Bunker keys include ownership,
  project, worker and document IDs instead of display names.
- Replay targets the exact persisted document ID, never a root/derived substitute.
  It validates the scope tuple and owner/tenant/installation/schema. It checks
  identity before and between network stages. The SDK/server still enforces the
  request's actual credentials and ACLs. This is not a claim of cancellation or
  token pinning inside every Firebase SDK asynchronous request.
- Storage commits before metadata. Failure retains the pending action; no physical
  delete is attempted. A retry reuses the same object/document paths. A transaction
  creates missing metadata without replacing an existing matching document;
  conflicting remote metadata fails closed, including missing/mismatched name or
  type and a non-boolean archive flag. An actual emulator case holds the pending
  queue on an incomplete remote row instead of acknowledging it.
  Completed/archived records are not
  rewritten and their bytes are not restored by repeated acknowledgements.
- Already-online enqueue previously did not wake the mounted legacy consumer.
  A post-persistence `sync-upload-boundary-ready` signal now wakes it. Batch drains
  are coalesced across effect replacement. ACK notifications do not emit the ready
  signal, so they do not create an error-retry loop. Manual single-action sync is
  an existing separate path; this is not a cross-process exclusive lock.
- Native `JSON.stringify` previously discarded both queued `File` bytes and the
  Bunker `Blob`. A versioned Base64 envelope now retains bytes/MIME/filename/date
  in the existing SQLCipher JSON row, atomically with the action's identity.
  The adapter strips private binary fields before replay and reconstructs a File.
  Bunker Blob values use the same codec. The codec requires strictly less than
  50 MiB, matching
  this worker-document Storage boundary; it is not a claim of support for all
  larger generic file routes. An unavailable native store, identity change or
  oversized source fails instead of claiming persistence. Missing/malformed or
  unsupported binary payloads cannot be acknowledged as completed uploads.

## Acceptance evidence

### Unit/component layer

`npm run test:ci -- src/components/workers/AddWorkerModal.test.tsx src/components/workers/TacticalOnboardingModal.test.tsx src/components/OfflineSyncManager src/services/workers src/utils/pwa-offline.test.ts src/utils/nativeBinary.test.ts src/utils/sqliteEncryption.test.ts`

- Returned/preallocated worker ID is the same reference passed to onboarding and
  used during durable worker replay. Generic collection ID semantics are retained.
- Producer emits all five canonically scoped PDF actions. Partial generation keeps
  the same document ID and Blob snapshot; it does not silently replace queued bytes.
- Missing file, ambiguous legacy scope, foreign identity, conflicting remote
  metadata, Storage failure and metadata failure do not falsely complete replay.
- Same target/cardinality after retry; archived records survive redelivery and
  concurrent creation; original File and metadata are snapshotted before awaits.
- Native tests pass real binary values through actual encoder/JSON/parser/decoder,
  including zeros/high bytes/chunk boundaries and corrupt envelopes. The SQLite
  plugin is mocked: this proves the JavaScript bridge contract, NOT physical
  SQLCipher durability, Android/OEM lifecycle or filesystem/key custody.

### Real service layer

Run the normal rules command with Firestore, Storage and Auth emulators:

`npm run test:ci -- --config vitest.rules.config.ts src/rules-tests/onboarding-storage-replay.test.ts`

The test refuses missing/non-loopback Firestore/Storage emulator hosts. It uses:

- The mounted real modal and real jsPDF renderer, workers read from real client
  Firestore, the actual IndexedDB/Bunker/queue adapter, and mounted real consumer.
- Real client SDKs and unchanged production Firestore/Storage rules.
  RulesTestEnvironment supplies synthetic authenticated/verified claim contexts;
  this does NOT demonstrate a real Firebase login session. fake-indexeddb and
  Node Blob/File plus Blob-to-Uint8Array conversion adapt the Node/JSDOM platform.
  A generated one-pixel PNG adapts canvas; signature/legal validity is not tested.
- A deliberately injected metadata transport exception after real Storage commit:
  five objects, four metadata records and one retained pending action. The public
  `force-sync` retry then yields exactly five objects/five metadata records and
  an empty queue. A byte read-back compares the actual PDF to the persisted Blob.
- Duplicate completion and archive preservation, two same-named workers without
  Bunker overwrites, and five further documents generated while the consumer is
  already mounted/online, without reconnect or manual refresh.
- Actual rejection of root Firestore metadata, rejection of worker-role Storage
  upload and rejection of foreign-tenant/project writes by both services.
  Firestore deliberately permits tenant-wide supervisor metadata access; Storage
  additionally requires project assignment. No universal same-tenant supervisor
  project-denial policy is asserted, and no rule was widened/tightened here.

The first local harness attempt used a notification event instead of the existing
`force-sync` command. The next exposed the intentional tenant-supervisor policy;
that assertion was corrected to a genuinely foreign tenant after reading the rule.
Neither failed attempt is counted as acceptance evidence.

## Limits and recovery

- Root documents, permissions, backend routes, legal document wording and signature
  validity policy were not changed. The sibling legal/signature ticket remains open.
  Existing `signed` labels are not a legal certification supplied by this repair.
- No public download URL/token is persisted. Authenticated document-view/download
  UX beyond the existing reader contract is not certified by these tests.
- A matching remote metadata row is the completion evidence of this upload protocol;
  replay does not resurrect bytes deliberately removed after completion. This does
  not certify all deletion/retention/erasure workflows or arbitrary out-of-band
  corruption across services.
- Existing legacy `new`/`global` or root-scoped actions cannot safely be mapped by
  worker name. They remain pending for explicit repair/regeneration. Bytes already
  discarded by old native JSON serialization cannot be reconstructed from metadata.
- Preserve encrypted rows/backups when repairing a native queue. Do not downgrade
  a device with pending binary envelopes to the old missing-file-ACK reader; use a
  forward repair, keeping the decoder and missing-file guard. No bulk migration,
  deletion or automatic identity rebinding is performed.
- No physical Android/SQLite process-death/reboot/OEM evidence, production deploy,
  or general application readiness is asserted. This is not life-safety delivery.
