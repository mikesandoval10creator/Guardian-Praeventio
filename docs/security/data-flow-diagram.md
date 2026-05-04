# Guardian Praeventio — Data Flow Diagram (DFD)

This diagram is the visual companion to [`THREAT_MODEL.md`](./THREAT_MODEL.md).
It shows the runtime data flows, the trust boundaries the platform must
defend, and where secrets live at rest. Element ids in the diagram are
referenced from the STRIDE walkthrough and the [findings table](./STRIDE_findings.md).

## Convention

- Solid arrows are synchronous request/response flows.
- Dashed arrows are asynchronous (push, background, snapshot listener).
- Subgraphs are trust boundaries — a request crossing a subgraph border
  changes principal (`browser → internet`, `internet → GCP`, etc.).
- A leaf labelled `[secret]` is held in Google Secret Manager (or an
  equivalent KMS-encrypted store) and never leaves the GCP project
  boundary in plaintext.

```mermaid
flowchart LR
    %% ─── Browser sandbox boundary ────────────────────────────────
    subgraph BrowserBoundary[Browser sandbox - end-user device]
        SPA[React SPA<br/>src/main.tsx<br/>verifyAuth via Firebase ID token]
        IDB[(IndexedDB<br/>praeventio-slm/offline_sessions<br/>NOT encrypted at rest)]
        SW[Service Worker<br/>workbox runtime cache]
        SLM[On-device SLM worker<br/>src/services/slm/worker]
        CLIENT_SENTRY[client Sentry SDK<br/>src/lib/sentry.ts<br/>redactPii beforeSend]
    end

    %% ─── Mobile app boundary ────────────────────────────────────
    subgraph MobileBoundary[Capacitor mobile app]
        MOBILE[Android/iOS shell<br/>FCM token registration<br/>POST /api/push/register-token]
    end

    %% ─── Internet boundary ──────────────────────────────────────
    INET((Public Internet))

    %% ─── GCP project boundary ───────────────────────────────────
    subgraph GCPBoundary[GCP project boundary - Cloud Run]
        EXPRESS[Express API<br/>server.ts:514 app.listen 3000<br/>helmet CSP, rate-limit 100/15min]
        VAUTH[verifyAuth middleware<br/>src/server/middleware/verifyAuth.ts<br/>admin.auth.verifyIdToken]
        GEMINI_ROUTE[/api/ask-guardian<br/>/api/gemini<br/>src/server/routes/gemini.ts]
        BILLING_ROUTE[/api/billing/*<br/>/billing/webpay/return<br/>src/server/routes/billing.ts]
        ZK_ROUTE[/api/zettelkasten/nodes<br/>src/server/routes/zettelkasten.ts]
        TEL_ROUTE[/api/telemetry/ingest<br/>HMAC canonical body]
        SERVER_SENTRY[server Sentry SDK<br/>sentryAdapter.ts]
        BG_TRIGGERS[Background triggers<br/>onSnapshot listeners<br/>setupBackgroundTriggers]
    end

    %% ─── External GCP services ─────────────────────────────────
    subgraph ExternalGCP[GCP managed services]
        FS[(Firestore<br/>KMS-encrypted at rest<br/>firestore.rules default-deny)]
        VERTEX[Vertex AI Gemini<br/>gemini-3.1-pro-preview]
        FCM[Firebase Cloud Messaging]
        SECMGR[(Secret Manager<br/>GEMINI_API_KEY [secret]<br/>WEBPAY_API_KEY [secret]<br/>SESSION_SECRET [secret]<br/>SENTRY_DSN [secret]<br/>IOT_WEBHOOK_SECRET [secret]<br/>MP_IPN_SECRET [secret])]
    end

    %% ─── Third-party services ──────────────────────────────────
    subgraph ThirdParty[Third-party processors]
        TBK[Transbank Webpay Plus<br/>integration / production]
        SENTRY_SAAS[Sentry SaaS<br/>praeventio org/guardian-praeventio project]
        RESEND[Resend - transactional email]
        GPLAY[Google Play Developer API<br/>RTDN Pub/Sub webhook]
    end

    %% ─── User-side flows ───────────────────────────────────────
    SPA -- "Bearer ID token" --> INET
    MOBILE -- "Bearer ID token" --> INET
    INET -- "TLS" --> EXPRESS

    %% ─── Internal API routing ──────────────────────────────────
    EXPRESS --> VAUTH
    VAUTH --> GEMINI_ROUTE
    VAUTH --> BILLING_ROUTE
    VAUTH --> ZK_ROUTE
    EXPRESS --> TEL_ROUTE

    %% ─── Backend data flows ────────────────────────────────────
    GEMINI_ROUTE -- "prompt + RAG context" --> VERTEX
    GEMINI_ROUTE -. "audit row" .-> FS
    BILLING_ROUTE -- "createTransaction" --> TBK
    TBK -- "browser redirect /billing/webpay/return" --> EXPRESS
    BILLING_ROUTE -. "invoices, processed_webpay" .-> FS
    ZK_ROUTE -. "zettelkasten_nodes (server-only writes)" .-> FS
    BG_TRIGGERS -. "FCM push" .-> FCM
    FCM -. "device push" .-> MOBILE
    EXPRESS -- "secrets at boot" --> SECMGR

    %% ─── Observability sinks ───────────────────────────────────
    SERVER_SENTRY -- "exceptions, no PII" --> SENTRY_SAAS
    CLIENT_SENTRY -- "exceptions, redacted" --> SENTRY_SAAS

    %% ─── Offline path ──────────────────────────────────────────
    SPA -- "navigator.onLine=false" --> SLM
    SLM -. "enqueue {query, response}" .-> IDB
    IDB -. "online event -> reconcile" .-> ZK_ROUTE

    %% ─── Email path ────────────────────────────────────────────
    BILLING_ROUTE -- "invitations, claim co-sign" --> RESEND

    %% ─── Google Play webhook ───────────────────────────────────
    GPLAY -. "RTDN Pub/Sub push" .-> BILLING_ROUTE

    %% ─── Trust boundary annotations ────────────────────────────
    classDef boundary stroke:#4db6ac,stroke-width:2px;
    class BrowserBoundary,MobileBoundary,GCPBoundary,ExternalGCP,ThirdParty boundary;
```

## Trust boundary inventory

| Boundary | Crosses | Defenses |
|----------|---------|----------|
| Internet | Browser/Mobile -> Cloud Run | TLS, rate-limit (100/15min global, per-uid limiters), helmet CSP, body 64kb default |
| GCP project | Express -> Vertex/Firestore/FCM | IAM roles on Cloud Run service account, Admin SDK uses default credentials |
| Browser sandbox | SPA -> SW -> IndexedDB | Service-worker scope, IndexedDB origin isolation. NOTE: IDB contents are NOT encrypted at rest (see TM-T03) |
| Third-party | Express -> Transbank/Sentry/Resend/Play | Per-vendor secrets; signed callbacks for Webpay (idempotency lock), HMAC for MP IPN, shared-secret for Play webhook |

## Asset locations at rest

- `Firestore` (managed by Google): all PII (worker name, RUT, project members,
  medical exams sub-collection), audit logs, Zettelkasten nodes, OAuth refresh
  tokens (envelope-encrypted via KMS adapter — see `server.ts:75-92`).
- `Secret Manager`: API keys, webhook secrets, SESSION_SECRET. Never embedded
  in container images.
- `IndexedDB` (browser, not encrypted): SLM offline session queue, cached
  model weights. Treated as untrusted on reconciliation.
- `localStorage`: only `praeventio_first_login_<uid>` flag and feature
  toggles. NOT used for tokens (Firebase SDK manages its own indexedDB
  for refresh tokens, scoped per origin).

## Out of scope of this DFD

- GCP infra hardening (VPC-SC, Org Policies, BeyondCorp) — separate work.
- Build/CI supply chain (npm registry, GitHub Actions, secret leakage in
  workflow files) — partially covered in `docs/security/incident-response.md`.
- Physical device security on the Capacitor shell (rooted phones, jailbreak,
  root-of-trust) — out of scope; Praeventio Guard does not store secrets on
  the device beyond Firebase's per-origin storage.
