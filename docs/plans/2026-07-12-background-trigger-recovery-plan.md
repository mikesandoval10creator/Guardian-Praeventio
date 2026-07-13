# Background trigger restart recovery implementation plan

**Goal:** Recover every pending critical notification, RAG embedding, and
post-mortem after restart without relying on process-local state.

**Architecture:** Add a generic transaction/lease claim helper, process initial
snapshots, and adapt each trigger to claim, execute, complete, or release work.

**Tech stack:** TypeScript, Firebase Admin Firestore transactions, Vitest.

## Task 1: Transactional claim helper

Create a pure-testable helper in `backgroundTriggerClaim.ts` with claim,
completion, release, lease retry metadata, claim tokens, and injected clock/token
generation. Prove completed, live, expired, competing, and stale-owner cases.

## Task 2: Critical incident recovery

Replace initial-snapshot discard and pre-send marker with claim/send/complete.
Add tests showing a critical incident present at startup sends once, a legacy
completion marker skips, and a failed send remains retryable.

## Task 3: RAG recovery

Process startup documents, reclaim `processing` without a live lease, and clear
leases on terminal states. Add restart and duplicate-snapshot tests.

## Task 4: Post-mortem recovery

Capture the third listener in the fake database, process startup closed
incidents, check deterministic output existence, and mark completion only after a
successful writer result.

## Task 5: Verification and publication

Run focused trigger/post-mortem tests, typecheck, production build, and relevant
server lifecycle regressions. Review the diff, commit, push a dedicated branch,
open a draft PR, and update Notion to Review.

