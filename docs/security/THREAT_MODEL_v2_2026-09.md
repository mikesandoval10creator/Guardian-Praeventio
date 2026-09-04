# Guardian Praeventio — Threat Model v2 (2026-09)

> **Supersedes:** `docs/security/THREAT_MODEL.md` (2026-05 build).
> **Status:** Draft v1 — pendiente firma de Daniel y pentester externo.
> **Scope:** v1.0.0 Android-first; iOS, Wear OS y WebAuthn hardware-token quedan como
> gaps explícitos (§8).
> **Methodology:** STRIDE + LINDDUN + MAESTRO para AI-features; mapeado contra
> MASVS-NETWORK/PLATFORM/STORAGE/AUTH/CODE/RESILIENCE/PRIVACY y OWASP Mobile Top 10.

## 1. Sistema en alcance

| Componente | Tecnología | Versión | Notas |
|---|---|---|---|
| App cliente | Android (Capacitor 6) | API 34–36 | iOS fuera de v1.0.0 |
| FGS check-in | `foregroundServiceType=location\|health` | SDK 34+ | permissions nuevas |
| FGS mandown | `capacitor-mandown` plugin (local) | `^1.x` | foreground health |
| BLE/Mesh | plugin Capacitor local | — | offline-first |
| FCM | `firebase-admin 13` (server) → FCM v1 | — | channels críticos |
| Health Connect | `androidx.health.connect` | 1.1.x | opt-in |
| Backend | Node + Express + TypeScript | — | Cloud Run |
| DB | Firestore | — | rules v3 |
| Storage | Cloud Storage | — | buckets privados |
| KMS | Cloud KMS | — | claves CMEK |
| Observabilidad | OTel (no LLM en v1.0.0) | — | traces + logs + metrics |
| CI/CD | GitHub Actions + Fastlane | — | gates endurecidos |

## 2. Data Flow Diagram

```
[Worker Android]
  |
  |-- SOS button --> src/components/emergency/SOSButton.tsx
  |                  --> EmergencyContext
  |                  --> POST /api/emergency/sos  (idempotency-key)
  |                       --> src/server/routes/emergency.ts
  |                       --> FCM dispatcher (channel_id=critical)
  |                       --> Firestore: events/{eventId}
  |
  |-- Background check-in --> capacitor-mandown FGS
  |                          --> src/services/mobile/foregroundServiceClient.ts
  |                          --> POST /api/lone-worker/ping (idempotency-key)
  |                          --> Firestore: lone_worker_pings/{id}
  |
  |-- BLE/Mesh packet --> capacitor-mesh
  |                       --> meshKeyStore (offline signing)
  |                       --> buffer en IDB
  |                       --> replay when online
  |
  |-- Photos / video --> src/services/photoEvidence
  |                      --> hash local + signed upload to GCS
  |                      --> Firestore: photo_evidence/{id}
  |
  v
[Express on Cloud Run]
  |
  |-- Tenant guard: src/server/middleware/tenantContext.ts
  |-- Auth: WebAuthn passkey (server) + Firebase ID token (mobile)
  |-- Rate limit: src/server/middleware/rateLimit.ts
  |-- Validation: Zod en cada POST
  |-- Server-side signing: src/services/zk/  (zero-knowledge materializer)
  |
  v
[Firestore] --rules--> [GCS buckets CMEK] --kms--> [Cloud KMS]
                                |
                                v
                          [Backups GCS] (cross-region, 35 días)
```

## 3. STRIDE por superficie

### 3.1 Cliente Android

| Amenaza | Surface | Mitigación actual | Gap residual |
|---|---|---|---|
| **S**poofing (auth) | `src/contexts/AuthContext.tsx` | Firebase ID token + WebAuthn passkey | Ninguno si WebAuthn se exige en supervisor/owner |
| **T**ampering (binary) | AAB en device | Play App Signing (v3+v4), `bundletool validate` | Sin verificación del hash AAB en runtime |
| **R**epudiation | SOS events | Idempotency-Key, dual-write a Firestore + GCS | Falta audit trail inmutable (ZK materializer, §3.4) |
| **I**nformation disclosure | Logs | `FLAG_SECURE` activo, sin secrets en logs | Health Connect y biometric pueden quedar en logs de tercero si se usa Capacitor debug |
| **D**oS | FCM channels | Backpressure en server | Posible DoS por FCM device-token enumeration |
| **E**oP | FGS lifecycle | `foregroundServiceType=location\|health` con permisos exactos | Si app se suspende por Doze y Doze mata el FGS, hay vida-safety gap |
| **S**poofing (network) | `network_security_config.xml` | cleartext=false; pins SPKI placeholders | ⚠ Pins aún PLACEHOLDERS — extraer del cert real cuando prod esté arriba (GCP billing reactivado, ver Notion BLOQUEADOR) |

### 3.2 Backend (Express + Cloud Run)

| Amenaza | Surface | Mitigación actual | Gap residual |
|---|---|---|---|
| **S**poofing | Firebase Auth + WebAuthn | Claims validados server-side | RBAC verifier omite `platform_operator` (Audit-2026-08-31) |
| **T**ampering | Firestore | rules v3 con tenant guard | ZK `get-edges` entrega aristas de otros proyectos del mismo tenant (Audit-2026-08-31) |
| **R**epudiation | Audit logs | OTel traces, Firestore audit collection | Falta retention policy y WORM storage |
| **I**nformation disclosure | Cloud Run env | Secrets en Secret Manager (target) | Algunos secrets aún en env vars (migrar) |
| **D**oS | Express | Rate limit por IP y por user | Rate limiter cae a por-IP si `req.user` undefined (Audit-2026-08-30) |
| **E**oP | RBAC | Roles verifier v2 | platform_operator omitido |
| **S**poofing (admin) | ARCO endpoints | Admin role + Firebase Auth | ARCO endpoints sin chequeo de tenant (cross-tenant erasure) (Audit-2026-08-30 P0) |

### 3.3 Datos y storage

| Amenaza | Surface | Mitigación actual | Gap residual |
|---|---|---|---|
| Tampering (data) | Firestore | rules + tenant guard | runRetentionSweep contradice ADR-0024 (Audit-2026-08-31) |
| Disclosure | GCS | CMEK encryption | Backups sin cifrado adicional de envelope |
| Tampering (evidence) | `photoEvidence` | Hash local + signed upload | PhotoEvidence GET sin verificar hash declarado (Audit-2026-08-31) |
| Cross-tenant | `wisdomCapsules` | Top-level read con tenant claim | Lectura geográfica top-level sin aislamiento tenant/project (Audit-2026-08-31) |

### 3.4 Vida-safety (lo más crítico)

| Función | Amenaza | Mitigación actual | Gap residual |
|---|---|---|---|
| SOS | Botón accidental | Doble-tap required + countdown | SOSButton idempotency-key también en POST inicial (Audit-2026-08-30) |
| ManDown | False positive | Cancelación con countdown | Serializar cancelación y expiración del countdown (Audit-2026-08-30); ManDown motor siempre 'none' (Hy3-architect-oleada-1) |
| Lone worker | Doze kills FGS | foregroundServiceType=location\|health + REQUEST_IGNORE_BATTERY_OPTIMIZATIONS | Foreground service de trabajador solitario no ejecuta protección real (P0 In-progress Notion) |
| Mesh | Packet replay | meshKeyStore con signing keys | meshKeyStore: race condition + record IDB corrupto + provision siempre hace fetch (P1 Hy3) |
| Health Connect | Permisos | Opt-in explícito | Sin test de revocación en mid-flight |

## 4. OWASP Mobile Top 10 (2024) cross-check

| ID | Riesgo | Estado en Guardian |
|---|---|---|
| M1 | Improper Credential Use | ✅ Firebase Auth + WebAuthn |
| M2 | Inadequate Supply Chain Security | ✅ npm audit + dependabot + lockfile |
| M3 | Insecure Authentication/Authorization | ⚠️ RBAC verifier omite platform_operator |
| M4 | Insufficient Input/Output Validation | ⚠️ Critical permit validators permiten metadatos numéricos no finitos |
| M5 | Insecure Communication | ⚠️ Pins SPKI aún PLACEHOLDERS |
| M6 | Inadequate Privacy Controls | ✅ Consentimiento + GDPR ARCO endpoints (gap: tenant check) |
| M7 | Insufficient Binary Protections | ⚠️ Sin runtime hash check |
| M8 | Security Misconfiguration | ⚠️ Capacitor.config.ts + App ID AdMob de prueba (Play rechazaría) |
| M9 | Insecure Data Storage | ✅ IDB cifrado + GCS CMEK |
| M10 | Insufficient Cryptography | ✅ TLS 1.3 + pins + WebAuthn |

## 5. AI / MAESTRO (capacidades IA)

| Amenaza | Surface | Mitigación | Gap |
|---|---|---|---|
| Prompt injection | Gemini/Vertex AI endpoints | System prompt blindado + input validation | Sin audit de prompts en runtime |
| Model exfiltration | AI Hub routes | Auth + rate limit + tenant guard | Sin logging de inferencias sensibles |
| Training data leak | `ai-hub` flows | No entrenamos con datos de usuarios | Pendiente política escrita |
| Bias en scoring de riesgos | `riskEngine` | Tipos estrictos + Zod | Sin test adversarial |

## 6. Privacy (GDPR/Ley 19.628 Chile)

- ARCO endpoints presentes pero **sin chequeo de tenant** (P0 Notion).
- Consentimiento explícito por feature (Health Connect, OBS, ubicación background).
- Eliminación de cuenta: pendiente script + verificación cross-tenant (W6).
- Export de datos: pendiente portal usuario (W6/W8).
- Retention: `runRetentionSweep` contradice ADR-0024 (debe rehacerse).

## 7. Gaps explícitos (no cerrar antes de v1.0.0 → W7/W8)

| Gap | Riesgo | Plan owner |
|---|---|---|
| Pins SPKI reales (bloqueado por GCP billing) | M5 / production | Daniel (GCP reactivación) |
| App ID AdMob de producción | M8 / Play rejection | Daniel (decisión AdMob) |
| Capacitor-mesh hardening + signing | Vida-safety / Mesh | W3-W4 |
| `capacitor-mandown` tests nativos | Vida-safety / FGS | W4 |
| RBAC verifier + platform_operator | M3 | W2 |
| ARCO tenant check | M3 / M6 | W2 |
| runRetentionSweep rewrite | M9 | W6 |

## 8. Out of scope para v1.0.0 (acordado contractualmente)

- **iOS:** Diferido a v1.1.0. App Store entitlements, NSPinnedDomains,
  HealthKit-equivalent, no en este lanzamiento.
- **Wear OS:** Diferido a v1.2.0. `WearableListenerService` + DataClient no
  implementados. La promesa comercial actual no incluye wearable nativo;
  BLE/Mesh vía teléfono es suficiente.
- **WebAuthn hardware-token (YubiKey etc.):** Diferido a v1.2.0. WebAuthn
  passkey del teléfono es la v1.
- **AI Hub adversarial test:** Diferido a v1.1.0.

## 9. Sign-off

| Rol | Nombre | Fecha | Comentarios |
|---|---|---|---|
| Product owner | Daniel Sandoval | — | pendiente |
| Security lead | (vacante, post-v1.0.0) | — | — |
| Pentester externo | TBD | — | scope: §3 entero, ventana Q4-2026 |
| Cloud architect | TBD | — | — |

## 10. Change log

- **2026-09-03** — v2 inicial. Reemplaza THREAT_MODEL.md (2026-05). Daniel
  autoriza no cerrar iOS/Wear OS en v1.0.0.
- **pendiente v2.1** — Cerrar §3.1 networking pins cuando GCP billing esté
  reactivado.
- **pendiente v2.2** — Cerrar §3.4 después de W4 (ManDown + FGS + Mesh).
- **pendiente v3** — Post-v1.0.0 launch; incluir iOS + Wear OS + AI Hub
  adversarial.

Refs:
- Plan maestro: `M:/Guardian Praeventio/wt-smoke-lab/.hermes/plans/2026-09-03_171944-guardian-v1-master-delivery-plan.md`
- Audit Notion: `[Audit-2026-08-30] Android Launch Triage — Notion ↔ código Guardian` (id 3ccaa66d-73fe-81e2-8efe-d24072b0da74)
- Feature registry: `docs/guardian/FEATURE_REGISTRY.yaml`
