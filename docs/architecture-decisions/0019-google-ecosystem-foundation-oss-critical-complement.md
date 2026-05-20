# ADR 0019 — Google ecosystem como fundación + OSS sólo en puntos críticos

* **Status:** Accepted (directiva usuario 2026-05-19)
* **Date:** 2026-05-19
* **Deciders:** Daho Sandoval (founder)
* **Supersedes / clarifies:** ADR 0005 (photogrammetry — formaliza la "duality online/offline" mencionada ahí), ADR 0017 (per-country emission adapters — mismo patrón de online/offline)
* **Related:** ADR 0008 (DWG isolation), ADR 0011 (Digital Twin auth), ADR 0013 (Mesh information relay)

## Context

Durante la sesión 2026-05-19 surgió la pregunta arquitectónica: "¿deberíamos migrar todo a OSS self-host para evitar suscripciones (Gemini API, Modal GPU, Firebase, Sentry, etc.)?" La respuesta del founder fue una **clarificación explícita**, no una migración:

> "Todo el ecosistema en sí funciona con los servidores de Google y lo que Google tiene para ofrecernos, porque tiene todas las soluciones ya hechas y planteadas. No podemos pasar por encima de Google, tenemos que siempre utilizar su servicio y mejorar la calidad de la aplicación de acuerdo a lo que Google nos ofrece. Por eso la aplicación se basa en Google Workspace y en Firebase."

> "Hay funciones que pueden parecer duplicadas, pero el funcionamiento de la aplicación tiene [versión] con Internet y sin Internet, por lo que [...] debería aparecer como funciones duplicadas, pero son situaciones que usan una alternativa u otra dependiendo del entorno en el cual se encuentre el usuario."

Esta ADR codifica esa directiva para evitar futuros agentes / sesiones que propongan migrar Firebase a PocketBase, Cloud Run a K3s, Sentry a GlitchTip, etc. La respuesta a esas propuestas es **rechazo automático** — Google es la plataforma, no un proveedor a optimizar fuera.

## Decision

### Principio 1 — Google ecosystem es la fundación inamovible

Praeventio Guard se construye **encima de Google Workspace + Firebase + Google Cloud Run + Gemini + Vertex AI**, no como un proveedor entre muchos sino como la **plataforma base**. Los componentes Google son:

| Capa | Servicio Google | Notas |
|---|---|---|
| **Hosting** | Cloud Run | Region `southamerica-west1`, autoscaling, multi-region failover Day-1+ |
| **Database** | Firestore | Multi-tenant, rules default-deny, KMS envelope encryption per-tenant |
| **Auth identity** | Firebase Auth | Google SSO + WebAuthn capa server-side |
| **Storage** | Cloud Storage (GCS) | Para video/mesh/PDF assets |
| **Notificaciones** | FCM (Firebase Cloud Messaging) | Push notifications mobile + web |
| **AI runtime productivo** | Gemini API + Vertex AI Agent Builder | Inferencia LLM en cloud |
| **Crypto** | Cloud KMS | Per-tenant KEK rotation 90d |
| **Marketplace distribution** | Google Workspace Marketplace | Canal de distribución B2B |
| **Mobile distribution** | Google Play Store (Android) | App nativa |
| **Pagos cloud-side** | Google Play IAP | Para in-app purchases mobile |
| **Búsqueda + dominio** | Google Search Console | Verificación dominio `praeventio.net` |

**No están en evaluación**: PocketBase, Supabase, Authentik, Keycloak, GlitchTip, K3s, Coolify, Dokku, MariaDB, PostgreSQL self-hosted, Mailcow, Postfix, etc. La respuesta a cualquier propuesta de migración a esos es: NO, salvo que se acompañe de una decisión nueva del founder.

### Principio 2 — OSS complementa SOLO en puntos críticos

OSS se incorpora **únicamente cuando**:

1. **No existe equivalente Google turnkey** para la función (ejemplo: COLMAP para SfM, MapLibre para mapas extruidos sin pagar Maps API). Y/o
2. **Se requiere ejecución offline** (sin red disponible en faena). Y/o
3. **Se requiere ejecución on-device sin GPU externa** (smartphone del trabajador, no servidor con A100).

Los OSS aprobados como **complemento crítico** al ecosistema Google son:

| OSS | Licencia | Reemplaza / complementa | Justificación |
|---|---|---|---|
| Gemma 2 2B (via `transformers.js` + ONNX Runtime Web) | Apache-2.0 | Gemini API en modo offline | El trabajador en faena minera SIN red necesita "preguntarle al asistente" igual. SLM local resuelve. Tier 4 del orchestrator. |
| COLMAP | BSD-3 | Photogrammetry SfM (sin GPU externa) | Software OSS gratis, corre en Google Cloud Run CPU (~10-15 min, ~$0.40/job en infra Google). Sin dependencia de plataforma third-party GPU rental. Ver §"Distinción SW-OSS vs infra-Google" abajo. |
| MapLibre GL JS | BSD-3 | Google Maps Platform API | Maps API cobra por carga. Para mapas internos de faena (no necesitan tráfico real-time) MapLibre + tiles OSM cubre con 2.5D extruido. |
| OpenStreetMap tiles | ODbL | Google Maps tiles base | Para zonas mineras chilenas donde la cobertura Google Maps es escasa, OSM frecuentemente tiene más detalle de trochas + caminos faena. |
| MediaPipe (Google sí lo mantiene OSS) | Apache-2.0 | EPP detection edge en cliente | Detección postura ergonomic + pose en el teléfono sin enviar video al cloud. Privacy + latencia + offline. |
| ONNX Runtime Web | MIT | Ejecutar Gemma 2 en navegador | Runtime SLM cliente. WebGPU usa la GPU del navegador (no servidor). |
| Blender (CLI) + glTF | GPL (Blender), MIT (glTF) | Modelado 3D pre-render para Digital Twin | Para sitios donde fotogrametría no se justifica, modelado manual una vez genera el mesh para el visor. |
| three.js / @react-three/fiber | MIT | Visor 3D web (no hay turnkey Google) | Rendering 3D en navegador. CPU-friendly. |
| WebXR (estándar W3C, no OSS per se) | Open standard | AR + VR sin servicio externo | El navegador del teléfono provee la sesión XR; no necesita servidor. |
| @noble/hashes (Argon2, Scrypt) | MIT | Cloud KMS local equivalents para offline | Cuando KMS no es accesible (modo offline), derivación de clave determinística local con Argon2. |
| OpenCV.js | Apache-2.0 | (evaluación abierta) | Si se necesita procesamiento imagen edge sin MediaPipe. |
| @noble/secp256k1 / @noble/ed25519 | MIT | Firmas + verificación offline | Tamper-proof audit log local sin firmar contra HSM cloud. |
| `simplewebauthn/server` y `/browser` | MIT | (Google ofrece Identity Platform pero esto es OSS independiente) | WebAuthn signature verify estándar. |
| `firebase-emulator` (Google lo provee como tooling) | Apache-2.0 | (No es reemplazo — es el oficial) | Tests E2E sin tocar prod. |

### Distinción crítica — SW-OSS vs infra-Google vs plataforma-third-party

Pregunta del founder 2026-05-19 que motivó esta sección: **"¿Modal es gratis? ¿COLMAP es gratis?"**

La respuesta separa tres conceptos que frecuentemente se confunden:

| Concepto | Ejemplo | ¿Cumple ADR 0019? | Costo |
|---|---|---|---|
| **Software OSS** (licencia libre) | COLMAP (BSD-3), MapLibre (BSD-3), Gemma 2 (Apache-2.0), MediaPipe (Apache-2.0) | ✅ Sí (Principio 2) | **$0 por usar el software**. La licencia NO cobra. |
| **Infra Google** (compute pago en Google Cloud) | Cloud Run, Firestore, Cloud Storage, KMS, Vertex AI | ✅ Sí (Principio 1) | **Pago a Google** por uso (CPU-seconds, storage, reads/writes). Aceptable porque es Google. |
| **Plataforma third-party** (rental cloud externo Google) | Modal.run, RunPod, Replicate, Banana, Beam, Heroku, Vercel Functions, AWS Lambda | ❌ **NO** (Principio 1 + 4) | Pago a tercero. **REJECT automático**, indiferente al precio. |

**Implicaciones:**

1. **COLMAP es OSS** → software licencia libre BSD-3 → cumple. **Pero ejecutar COLMAP cuesta** cuando corre en Cloud Run (~$0.40/job). El costo va a Google = aceptable.
2. **Modal NO es OSS** ni Google. Es plataforma third-party. **REJECT** indiferente al precio (incluso si fuera gratis, sigue violando Principio 1 "Google ecosystem foundation").
3. **MapLibre + OSM tiles** son OSS + servidos desde Google Cloud Storage/CDN → cumple doble.
4. **Gemma 2 local en navegador** vía ONNX Runtime Web → corre en el dispositivo del trabajador, costo $0 al app, cumple Principio 2 (offline + sin GPU externa).

**Regla operativa para reviews de PR:**

* Si el PR introduce `import` de software OSS para correr en Cloud Run / Firebase / browser cliente → ✅ OK.
* Si el PR introduce SDK / cliente HTTP a una plataforma cloud externa pagada (Modal, Replicate, Vercel Functions, etc.) → ❌ REJECT.
* Si el PR introduce SDK Google nuevo (Vertex AI Agent Builder, Cloud Tasks, etc.) → ✅ OK.

**Plataformas third-party explícitamente descartadas y por qué:**

| Plataforma | Use-case típico | Por qué descartada | Alternativa Google |
|---|---|---|---|
| Modal.run | Serverless GPU para SfM/ML | Third-party + GPU externa (doble violación) | COLMAP en Cloud Run CPU |
| RunPod | GPU rental general | Third-party + GPU externa | Vertex AI (para ML inference) o Cloud Run CPU |
| Replicate | API ML pre-trained models | Third-party + paga | Vertex AI Model Garden (mismo concepto, Google) |
| Vercel / Netlify Functions | Edge functions deploy | Third-party hosting | Cloud Functions / Cloud Run |
| AWS Lambda / Azure Functions | Serverless multi-cloud | NO Google | Cloud Functions |
| Heroku / Render / Fly.io | App hosting | NO Google | Cloud Run |
| Cloudflare Workers / Pages | Edge compute | NO Google | Cloud Run + Cloud CDN |
| GlitchTip | Error tracking OSS self-host | El SW es OSS pero el SaaS reemplaza Sentry, fuera de Google | Sentry (paid pero ya está en stack) o Cloud Error Reporting Google |
| PocketBase / Supabase self-hosted | BaaS alternative | Reemplaza Firebase, fuera de Google | Firebase (canónico) |

**Plataformas third-party aceptadas (legacy / pagos):**

| Plataforma | Por qué se acepta | Notas |
|---|---|---|
| Webpay (Transbank) | Procesador de pagos Chile, sin alternativa Google equivalente | Pago per-transacción, NO suscripción mensual |
| MercadoPago | Procesador pagos LatAm, ídem | Pago per-transacción |
| Resend | Email transactional, podría migrarse a Google Workspace Mail | A evaluar trimestralmente: ¿Google Workspace Send API cubre? Si sí, migrar. |
| Sentry | Error tracking, podría migrarse a Cloud Error Reporting | A evaluar trimestralmente: ¿Cloud Error Reporting + Cloud Logging cubre nuestros requisitos? Si sí, migrar. |
| GitHub | Source hosting + Actions CI | A evaluar: ¿Cloud Source Repositories + Cloud Build cubre? GitHub tiene mejor UX dev hoy, mantener. |
| Cloudflare CDN (si se usa) | Static CDN, podría usar Cloud CDN | A evaluar trimestralmente. |

Esta lista de "aceptadas" debe REVISARSE cada 6 meses. Cualquiera de estas migraciones a Google es trabajo legítimo bajo Principio 4 ("mejorar calidad de acuerdo a lo que Google ofrece").

---

### Principio 3 — Online/offline duality es DISEÑO, no duplicación

Cuando una feature aparece "duplicada" en la arquitectura (dos implementaciones del mismo concepto), **antes de proponer dedup, verificar si una es online y la otra offline**. Si sí, son funciones HERMANAS no duplicadas y AMBAS deben mantenerse.

Ejemplos canónicos:

| Feature | Implementación online | Implementación offline | Activación |
|---|---|---|---|
| Pregunta al asistente IA | Gemini API (`/api/ask-guardian`) | SLM Gemma 2 2B local (transformers.js) | `navigator.onLine` o `forceOffline` flag |
| Reconstrucción 3D faena | Modal GPU (Meshroom 180s) | COLMAP CPU Cloud Run (10-15min) o Blender pre-render | `PHOTOGRAMMETRY_ENGINE` env |
| Sync inspecciones | Firestore write directo | IndexedDB outbox + sync queue | Online detection |
| Audit logs | Firestore + hash chain | IndexedDB + hash chain local, sync diferido | Online detection |
| Mapa faena | Google Maps (tráfico real-time) | MapLibre + OSM tiles cached + extruded | Online detection |
| Detección EPP | Gemini Vision (cloud) | MediaPipe + TF.js (edge) | Bandera por dispositivo |
| Firma biométrica | WebAuthn server verify (Firebase) | TOTP / PIN fallback local | Network availability + biometric availability |
| Notificaciones | FCM (push real-time) | Local notifications (Capacitor) | Network availability |
| Encriptación at-rest | Cloud KMS envelope | @noble Argon2 + local key derivation | KMS accessibility |
| Generación PDF Suseso | Server-side via `diatPdfRenderer` | Client-side fallback con `jsPDF` | Online detection |

**Reglas para nuevos features:**

1. Si la feature toca un workflow CRÍTICO de prevención (SOS, inspección, evacuación, capacitación), **DEBE** tener ambas variantes online + offline.
2. Si la feature es **administrativa** (configurar tier, ver reportes, panel admin), puede ser online-only.
3. Nunca decir "es un duplicado, eliminemos uno" sin verificar el par online/offline.
4. Documentar la duality en JSDoc/comentario del módulo: `// Online sibling: <path>` o `// Offline sibling: <path>`.

### Principio 4 — "Mejorar la calidad de la aplicación de acuerdo a lo que Google ofrece"

Cuando Google lanza una mejora a su stack (nueva versión Gemini, nuevo SDK Firebase, nueva opción Cloud Run, etc.), **es trabajo legítimo migrar a esa mejora**. Ejemplos:

- Migrar de Gemini Flash 1.5 → 2.0 cuando GA. ✓
- Adoptar Cloud Run jobs si reemplaza un Cloud Scheduler + Function chain. ✓
- Usar Firestore Security Rules v2 si simplifica las reglas. ✓
- Adoptar Vertex AI Agent Builder para casos de uso donde estábamos manualmente orquestando function-calling. ✓

Lo que **NO** es trabajo legítimo bajo esta ADR:

- Reemplazar Firebase Auth por Better Auth porque "es OSS". ✗
- Reemplazar Cloud Run por self-host en VPS. ✗
- Reemplazar Sentry por GlitchTip "para no pagar suscripción". ✗
- Reemplazar Gemini API por self-hosted Ollama. ✗ (Gemma 2 LOCAL es complemento offline, no reemplazo del cloud tier).

## Consequences

**Positive:**

- **Velocidad de iteración:** no perdemos tiempo manteniendo infraestructura. Google opera la capa pesada; nosotros nos enfocamos en producto.
- **Compliance acelerado:** Google KMS, audit logs, Cloud DLP, etc. ya están certificados ISO/SOC2/etc. Nosotros heredamos esa certificación.
- **Marketplace fit:** estar en el ecosistema Google es un canal de distribución (Workspace Marketplace, OAuth integraciones).
- **Robustez offline preservada:** las contrapartes OSS críticas (SLM, COLMAP, MapLibre, MediaPipe) garantizan que la app funciona en faena sin red, sin GPU externa, sin pagar suscripción adicional por dispositivo.

**Negative:**

- **Vendor lock-in real:** un colapso de servicios Google nos afecta de forma sistémica. Mitigación: el offline mode protege en parcial — los workers pueden seguir registrando datos local hasta que Google vuelva.
- **Costos crecen con escala:** Firestore, Cloud Run, Gemini API costean por uso. Mitigación: el SLM offline reduce calls a Gemini cuando se puede (Tier 4 del orchestrator).
- **Innovaciones OSS pueden quedar atrás:** si Ollama / vLLM / etc. ofrecen 10x mejor rendimiento que Gemini en algún workload, no podemos adoptar. Mitigación: revisar trimestralmente si la directiva sigue alineada con los resultados.

**Operational:**

- **PR review gate:** cualquier PR que proponga reemplazar un servicio Google por un OSS self-host debe ser rechazado citando esta ADR, salvo que venga acompañado de una decisión nueva del founder.
- **Onboarding nuevos devs:** Esta ADR es lectura obligatoria. Junto con ADR 0005 (photogrammetry duality), forma el marco mental del stack.
- **Audits trimestrales:** ¿siguen vivas las contrapartes OSS críticas? ¿Gemma 2 sigue siendo SOTA para 2B params? ¿COLMAP sigue manteniendo? ¿MapLibre sigue activo?

## Alternatives considered

* **Full self-host (Lectura B propuesta en la sesión)** — rechazada por el founder. Implicaría 3-6 meses de re-implementar la capa de persistencia + infra + auth + email. ROI negativo dado que Google ya provee todo eso con SLAs.
* **Hybrid Google + AWS / Azure** — no evaluada porque no aporta sobre Google solo. Multi-cloud incrementa costos operativos.
* **Sin offline (cloud-only)** — rechazada implícitamente. Faenas mineras/forestales/marítimas chilenas frecuentemente operan sin red. Una app de prevención que no funciona ahí no sirve.

## References

* Mensaje founder 2026-05-19 (sesión local) — directiva original. Quoted en §Context arriba.
* ADR 0005 — Photogrammetry pipeline (primer ejemplo concreto de duality online/offline).
* ADR 0008 — DWG converter (mismo patrón HTTP-boundary OSS isolation).
* ADR 0011 — Digital Twin triple-gate auth (Firebase Auth + RBAC + KMS — todo Google).
* ADR 0013 — Mesh information relay (offline-first sync pattern).
* ADR 0017 — Per-country emission adapters (otro ejemplo duality).
* `DIGITAL_TWIN_GPU_FREE_PLAN.md` (2026-05-03) — análisis exhaustivo de 11 alternativas SfM evaluadas, con recomendación MapLibre Phase A. Backed esta ADR.
* `docs/audits/BRANCH_REVIEW_2026-05-19.md` — verificación que las branches OSS-relevantes principales (SLM, WebGPU, ONNX, AR, COLMAP, Euler-Matrix) ya están en main.
