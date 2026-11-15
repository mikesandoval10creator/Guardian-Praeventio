# Training capsule DTO contract

## Scope

Notion: `3cdaa66d-73fe-811e-a3bf-f0bcf76e58c9` — Training AI capsule: object treated as string and persisted without normalization.

The provider in `src/services/gemini/personPlans.ts` returns `{title, content, keyTip, duration}`. The client now normalizes this unknown payload once in `generateSafetyCapsule` through `src/lib/safetyCapsule.ts`. Both Training and SafetyCapsules receive `SafetyCapsuleDto`, not arbitrary provider objects.

- Version: `schemaVersion: 1`.
- Structured responses require nonempty string fields, within 300/20000/2000/100 characters respectively. Unsupported versions, arrays, nulls, wrong types and oversized data fail closed.
- Legacy nonempty plain text is retained as content with a neutral title and empty keyTip/duration; no safety advice or timing is fabricated.
- Provider-only properties are stripped. They cannot replace project/user stamps in a saved record.
- Training writes the canonical fields at the document root in `projects/{projectId}/training_capsules`; `content` is text, not a nested provider object. Graph metadata carries the same versioned fields and the returned capsule document ID.
- No existing document is migrated. Global Wisdom capsules, completion/history, identity rules and cross-surface collection convergence remain separate tickets.

## Rendering, errors and lifecycle

The modal renders title, content, keyTip and duration separately as React text (no HTML injection). Malformed payloads are not persisted; both consumers show a Spanish retry message instead of raw provider errors. Training does not equate generation with completion or durable graph delivery.

`addDoc` success proves a project-document write acknowledgement. `useRiskEngine.addNode` returns a node only after a durable local outbox enqueue, or null on failure. The success copy therefore says the graph entry is **queued for synchronization**, not delivered to the server. A null result does not become success.

Project/user changes and unmount invalidate the generation token. Late responses cannot populate the new context or start its persistence. An already submitted Firestore write cannot be cancelled retroactively; the guard prevents a subsequent graph enqueue after a context change.

## Reproducible tests

Use the repository-compatible Node runtime (package.json engines), installed dependencies and the canonical Vite+ runner:

```sh
vp test run src/pages/Training.capsule.test.tsx src/lib/safetyCapsule.test.ts src/services/geminiService.cancel.test.ts src/services/gemini/personPlans.test.ts
npm run typecheck
```

RED was observed before implementing the object/legacy/error paths and before the persistence-success/context guards. The original object path produced `Objects are not valid as a React child`.

The component tests run the real Training/SafetyCapsules code and real `generateSafetyCapsule` client. Fetch/provider results, Firestore methods, graph enqueue, context/hooks and unrelated child panels are controlled fixtures. Motion is a DOM-only test adapter: no animation, visual fidelity, focus trapping or real-browser claim. These tests verify the **writer payload** and UI behavior, not deployed Firestore read-back, security rules, Google model availability, physical Android, or graph outbox server replay. No such broader closure is claimed by this slice.
