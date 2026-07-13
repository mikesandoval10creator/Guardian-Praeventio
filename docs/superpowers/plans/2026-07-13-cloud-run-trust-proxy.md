# Cloud Run Trust Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Express derive stable client IPs behind Cloud Run without trusting arbitrary forwarded-header values or changing existing limiter behavior.

**Architecture:** A focused `src/server/config/trustProxy.ts` module resolves the deployment policy from environment variables and applies it to an Express app. `server.ts` calls it immediately after `express()`, while existing limiter key generators continue consuming `req.ip` and `ipKeyGenerator` unchanged.

**Tech Stack:** TypeScript, Express 4, express-rate-limit 8, Vitest 4, Supertest, Cloud Run, Firebase Hosting.

## Global Constraints

- Preserve every existing limiter, quota, route order, authentication gate, and Firestore-backed store.
- Default local and non-Cloud-Run processes to `trust proxy = false`.
- Default Cloud Run processes identified by `K_SERVICE` to exactly one trusted hop.
- Accept only `0` or a positive safe integer in `TRUST_PROXY_HOPS`; reject empty, negative, fractional, and non-numeric explicit values at startup.
- Keep `ipKeyGenerator` as the IPv6 normalization mechanism.
- Do not add a public diagnostic endpoint or log client IP addresses.
- Follow strict RED, GREEN, REFACTOR sequencing.

---

### Task 1: Pure trust-proxy policy resolver

**Files:**
- Create: `src/server/config/trustProxy.ts`
- Create: `src/server/config/trustProxy.test.ts`

**Interfaces:**
- Consumes: `NodeJS.ProcessEnv`-compatible `Record<string, string | undefined>`.
- Produces: `resolveTrustProxySetting(env): false | number`.

- [ ] **Step 1: Write failing policy tests**

Create table-driven Vitest coverage for the local default, the Cloud Run
default, explicit `0`, explicit positive integers, and invalid values:

```ts
import { describe, expect, it } from 'vitest';
import { resolveTrustProxySetting } from './trustProxy.js';

describe('resolveTrustProxySetting', () => {
  it('keeps direct local processes untrusted by default', () => {
    expect(resolveTrustProxySetting({})).toBe(false);
  });

  it('trusts exactly the managed ingress hop on Cloud Run', () => {
    expect(resolveTrustProxySetting({ K_SERVICE: 'guardian-praeventio' })).toBe(1);
  });

  it.each([
    ['0', false],
    ['1', 1],
    ['2', 2],
  ] as const)('maps TRUST_PROXY_HOPS=%s to %s', (raw, expected) => {
    expect(resolveTrustProxySetting({ TRUST_PROXY_HOPS: raw })).toBe(expected);
  });

  it.each(['', ' ', '-1', '1.5', 'abc', '1e2', '9007199254740992'])(
    'rejects ambiguous TRUST_PROXY_HOPS=%j',
    (raw) => {
      expect(() => resolveTrustProxySetting({ TRUST_PROXY_HOPS: raw })).toThrow(
        'TRUST_PROXY_HOPS must be 0 or a positive safe integer',
      );
    },
  );
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
npm.cmd run test -- src/server/config/trustProxy.test.ts --reporter=dot
```

Expected: FAIL because `./trustProxy.js` does not exist.

- [ ] **Step 3: Implement the minimal resolver**

Create the module with an environment type and strict decimal parsing:

```ts
export type TrustProxyEnvironment = Readonly<Record<string, string | undefined>>;
export type TrustProxySetting = false | number;

const TRUST_PROXY_ERROR =
  'TRUST_PROXY_HOPS must be 0 or a positive safe integer';

export function resolveTrustProxySetting(
  env: TrustProxyEnvironment = process.env,
): TrustProxySetting {
  const raw = env.TRUST_PROXY_HOPS;
  if (raw === undefined) return env.K_SERVICE ? 1 : false;
  if (!/^\d+$/.test(raw)) throw new Error(TRUST_PROXY_ERROR);

  const hops = Number(raw);
  if (!Number.isSafeInteger(hops)) throw new Error(TRUST_PROXY_ERROR);
  return hops === 0 ? false : hops;
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the command from Step 2.

Expected: one test file passes with every table row green.

- [ ] **Step 5: Commit the policy unit**

```powershell
git add src/server/config/trustProxy.ts src/server/config/trustProxy.test.ts
git commit -m "feat(security): resolve Cloud Run proxy trust"
```

---

### Task 2: Express behavior and production wiring

**Files:**
- Modify: `src/server/config/trustProxy.ts`
- Modify: `src/server/config/trustProxy.test.ts`
- Modify: `src/__tests__/server/serverMountOrder.test.ts`
- Modify: `server.ts`

**Interfaces:**
- Consumes: `resolveTrustProxySetting(env): false | number` from Task 1.
- Produces: `configureTrustProxy(app, env): false | number`, which calls `app.set('trust proxy', setting)`.

- [ ] **Step 1: Add failing Express behavior tests**

Extend `trustProxy.test.ts` with a small app that returns the derived address and
existing limiter key:

```ts
import express from 'express';
import request from 'supertest';
import { ipOnlyKey } from '../middleware/limiters.js';
import { configureTrustProxy, resolveTrustProxySetting } from './trustProxy.js';

function makeProbeApp(env: Record<string, string | undefined>) {
  const app = express();
  configureTrustProxy(app, env);
  app.get('/probe', (req, res) => res.json({ ip: req.ip, key: ipOnlyKey(req) }));
  return app;
}

it('ignores a forged forwarded address outside Cloud Run', async () => {
  const response = await request(makeProbeApp({}))
    .get('/probe')
    .set('X-Forwarded-For', '198.51.100.10');
  expect(response.body.ip).not.toBe('198.51.100.10');
});

it.each(['198.51.100.10', '203.0.113.20'])(
  'uses distinct managed-ingress client address %s',
  async (clientIp) => {
    const response = await request(makeProbeApp({ K_SERVICE: 'guardian-praeventio' }))
      .get('/probe')
      .set('X-Forwarded-For', clientIp);
    expect(response.body).toEqual({ ip: clientIp, key: clientIp });
  },
);

it('ignores caller-controlled values before the trusted suffix', async () => {
  const response = await request(makeProbeApp({ K_SERVICE: 'guardian-praeventio' }))
    .get('/probe')
    .set('X-Forwarded-For', '192.0.2.44, 198.51.100.10');
  expect(response.body.ip).toBe('198.51.100.10');
});
```

Add a source-order contract to `serverMountOrder.test.ts` that finds
`const app = express()`, `configureTrustProxy(app)`, and the first `app.use` or
limiter declaration, then asserts the configuration call is after app creation
and before middleware registration.

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
npm.cmd run test -- src/server/config/trustProxy.test.ts src/__tests__/server/serverMountOrder.test.ts --reporter=dot
```

Expected: FAIL because `configureTrustProxy` and the `server.ts` call do not yet
exist.

- [ ] **Step 3: Implement and wire the helper**

Add to `trustProxy.ts`:

```ts
import type { Express } from 'express';

export function configureTrustProxy(
  app: Pick<Express, 'set'>,
  env: TrustProxyEnvironment = process.env,
): TrustProxySetting {
  const setting = resolveTrustProxySetting(env);
  app.set('trust proxy', setting);
  return setting;
}
```

Import it in `server.ts`:

```ts
import { configureTrustProxy } from './src/server/config/trustProxy.js';
```

Apply it immediately after app creation:

```ts
const app = express();
configureTrustProxy(app);
const PORT = Number(process.env.PORT) || 57335;
```

- [ ] **Step 4: Run focused and existing limiter tests**

```powershell
npm.cmd run test -- src/server/config/trustProxy.test.ts src/__tests__/server/serverMountOrder.test.ts src/__tests__/server/limiters.test.ts --reporter=dot
```

Expected: all three test files pass; the existing limiter thresholds and key
strategies remain unchanged.

- [ ] **Step 5: Commit runtime wiring**

```powershell
git add server.ts src/server/config/trustProxy.ts src/server/config/trustProxy.test.ts src/__tests__/server/serverMountOrder.test.ts
git commit -m "fix(security): trust Cloud Run ingress for rate limits"
```

---

### Task 3: Deployment contract and staging runbook

**Files:**
- Modify: `.env.example`
- Modify: `RUNBOOK.md`

**Interfaces:**
- Consumes: `TRUST_PROXY_HOPS` behavior from Tasks 1 and 2.
- Produces: an operator-visible configuration contract and repeatable staging verification.

- [ ] **Step 1: Document the environment variable**

Near `PORT` and the Cloud Run variables in `.env.example`, document:

```dotenv
# TRUST_PROXY_HOPS: cantidad exacta de proxies confiables delante de Express.
# Default: 1 cuando Cloud Run inyecta K_SERVICE; 0/falso fuera de Cloud Run.
# No aumentar sin verificar la cadena X-Forwarded-For en staging: un valor
# excesivo permite que el cliente elija la IP usada por el rate limiter.
# TRUST_PROXY_HOPS=1
```

Keep the example commented: the variable must be omitted, not set to an empty
string, unless an explicit numeric value is required.

- [ ] **Step 2: Add the staging procedure to `RUNBOOK.md`**

Under Cloud Run deployment verification, add exact checks for two known egress
IPs, independent `RateLimit` headers, a forged leading `X-Forwarded-For` value,
and rollback/removal of an unverified override. State that the default path is
Firebase Hosting rewrite to Cloud Run as declared in `firebase.json`.

- [ ] **Step 3: Verify documentation and diff**

```powershell
git diff --check
git diff -- .env.example RUNBOOK.md
```

Expected: no whitespace errors; only proxy configuration and staging guidance
are changed.

- [ ] **Step 4: Commit the operational contract**

```powershell
git add .env.example RUNBOOK.md
git commit -m "docs(ops): verify rate-limit client identity"
```

---

### Task 4: Final verification and delivery

**Files:**
- Verify all files changed in Tasks 1-3 and the design/plan documents.

**Interfaces:**
- Consumes: the complete change set.
- Produces: evidence for the draft PR and Notion `Review` update.

- [ ] **Step 1: Run focused regression tests**

```powershell
npm.cmd run test -- src/server/config/trustProxy.test.ts src/__tests__/server/serverMountOrder.test.ts src/__tests__/server/limiters.test.ts --reporter=dot
```

Expected: all focused files pass with zero failed tests.

- [ ] **Step 2: Run static and build gates**

```powershell
npm.cmd run typecheck
npx eslint server.ts src/server/config/trustProxy.ts src/server/config/trustProxy.test.ts src/__tests__/server/serverMountOrder.test.ts
npm.cmd run build
```

Expected: typecheck and ESLint exit 0; production build completes.

- [ ] **Step 3: Inspect scope and staged content**

```powershell
git diff --check origin/main...HEAD
git status --short
git log --oneline origin/main..HEAD
```

Expected: only the planned files are changed, no secret or generated artifact
is staged, and commits are scoped to design, policy, runtime, and operations.

- [ ] **Step 4: Push and open a draft PR**

Push `codex/cloud-run-trust-proxy`, create a draft PR targeting `main`, include
the Notion task link, RED/GREEN evidence, staging limitation, and the
pre-existing missing `scripts/check-open-reads-ratchet.cjs` hook condition.

- [ ] **Step 5: Update Notion**

Set the task to `Review`, attach the PR URL, and store the exact focused test,
typecheck, ESLint, and build commands used for verification.
