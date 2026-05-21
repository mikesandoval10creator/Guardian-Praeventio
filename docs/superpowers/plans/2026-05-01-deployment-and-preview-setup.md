# Guardian Praeventio — Deployment & Preview Setup Plan

> **Para agentic workers:** este plan está diseñado para que el usuario lo ejecute con asistencia paso-a-paso. Pasos usan checkbox (`- [ ]`) para tracking.

**Goal:** Tener una URL pública de Guardian Praeventio que se actualice automáticamente cada vez que hagas commit en GitHub — equivalente al preview de Google AI Studio, accesible desde el celular.

**Architecture:** El repo ya tiene GitHub Actions configurado (`ci.yml` + `deploy.yml`) que despliega a **Google Cloud Run** en el proyecto `praeventio-541ad`. El workflow corre en cada push a `main`: typecheck → tests → build de Docker image → push a Artifact Registry → deploy a Cloud Run. La URL pública resultante es tu preview.

**Tech Stack:** GitHub Actions, Google Cloud Run, Artifact Registry, Workload Identity Federation, Firebase (Firestore + Admin SDK), Gemini API.

---

## PRE-REQUISITOS (responder antes de ejecutar)

Necesito confirmar 3 cosas tuyas antes de que cualquier paso tenga sentido:

- [ ] **P1:** ¿Tienes acceso a la consola de Google Cloud del proyecto `praeventio-541ad`? Link: https://console.cloud.google.com/welcome?project=praeventio-541ad. Si no lo tienes, hay que crearlo o cambiar el `PROJECT_ID` del workflow.

- [ ] **P2:** ¿Tienes acceso a Firebase Console del mismo proyecto? Link: https://console.firebase.google.com/project/praeventio-541ad. Necesitaremos descargar un service-account JSON desde ahí.

- [ ] **P3:** ¿Tienes una API key de Gemini? Si no, sácala gratis en https://aistudio.google.com/app/apikey. Es clave porque varias features de la app la usan.

---

## Task 1: Verificar el estado actual del deployment en GitHub Actions

**Files:** ninguno (es verificación operacional, no de código)

- [ ] **Step 1.1:** Abrir el tab Actions del repo

   Ir a: https://github.com/mikesandoval10creator/Guardian-Praeventio/actions

   **Buscar:** los últimos runs del workflow `Deploy to Cloud Run`.

- [ ] **Step 1.2:** Identificar si los deploys están pasando o fallando

   - **Si todos están en verde (success):** tu app YA está deployada. Saltar a Task 4 para encontrar la URL.
   - **Si están en rojo (failure):** abrir el run más reciente y leer el error. Los errores típicos son:
     - `Permission denied` → falta configurar Workload Identity Federation (Task 2)
     - `Image not found` → falta crear el repositorio en Artifact Registry (Task 2)
     - `Service account not found` → falta crear `github-guardian-deploy@praeventio-541ad.iam.gserviceaccount.com` (Task 2)
     - `Container failed to start` → faltan env vars en Cloud Run (Task 3)
   - **Si nunca corrió:** quizás el workflow CI está fallando antes (lo cual evita que deploy arranque). Revisar el workflow `CI` en el mismo Actions tab.

- [ ] **Step 1.3:** Reportar lo que viste

   Copiar el mensaje de error si hubo, o el link del run exitoso. Yo te guío al siguiente Task según resultado.

---

## Task 2: Configurar Google Cloud (solo si Task 1 reveló errores de auth/permisos)

**Files:** ninguno (todo en consola GCP)

> Esta task tiene muchos sub-pasos en consola Google Cloud. Si nunca configuraste Cloud Run + Workload Identity, son ~30 minutos. Si ya lo tienes configurado, saltar.

- [ ] **Step 2.1:** Habilitar APIs necesarias

   En https://console.cloud.google.com/apis/library?project=praeventio-541ad habilitar:
   - Cloud Run Admin API
   - Artifact Registry API
   - IAM Service Account Credentials API
   - Cloud Build API
   - Secret Manager API (para Task 3)

- [ ] **Step 2.2:** Crear repositorio en Artifact Registry

   Ir a: https://console.cloud.google.com/artifacts?project=praeventio-541ad

   Crear repositorio llamado `guardian-praeventio`, formato Docker, región `us-central1`.

- [ ] **Step 2.3:** Crear service account `github-guardian-deploy`

   Ir a: https://console.cloud.google.com/iam-admin/serviceaccounts?project=praeventio-541ad

   - Nombre: `github-guardian-deploy`
   - Roles necesarios:
     - Cloud Run Admin
     - Artifact Registry Writer
     - Service Account User
     - Storage Admin (para subir imagen)

- [ ] **Step 2.4:** Configurar Workload Identity Federation

   Ir a: https://console.cloud.google.com/iam-admin/workload-identity-pools?project=praeventio-541ad

   - Crear pool: `github-pool`
   - Crear provider: `github-provider`, OIDC, issuer `https://token.actions.githubusercontent.com`
   - Mapping de atributos: `google.subject = assertion.sub`, `attribute.repository = assertion.repository`
   - Permitir solo `assertion.repository == 'mikesandoval10creator/Guardian-Praeventio'`
   - Vincular el pool al service account creado en 2.3

   El project number en `deploy.yml:35` es `565212386989`. Si tu proyecto tiene otro número, editar esa línea del workflow.

- [ ] **Step 2.5:** Re-ejecutar el workflow desde Actions tab

   En el run fallido, click "Re-run all jobs". Verificar que ahora completa.

---

## Task 3: Configurar variables de entorno (secrets) en Cloud Run

**Files:** modificar `.github/workflows/deploy.yml:66-67` para inyectar más env vars

> El workflow actual (línea 67) solo setea `NODE_ENV=production`. Falta inyectar Gemini, Resend, session secret, etc. Sin esto, el contenedor arranca pero las features fallan o se cae al cargar (como te pasó local).

- [ ] **Step 3.1:** Crear secrets en Google Secret Manager

   Ir a: https://console.cloud.google.com/security/secret-manager?project=praeventio-541ad

   Crear estos secrets (cada uno con su valor real):

   | Secret name | Valor | Obligatorio |
   |---|---|---|
   | `GEMINI_API_KEY` | tu key de aistudio.google.com | ✅ sí |
   | `SESSION_SECRET` | string random largo (ej: `openssl rand -hex 32`) | ✅ sí |
   | `RESEND_API_KEY` | de resend.com (o `re_dev` si no usas email aún) | ⚠️ requerido para boot |
   | `IOT_WEBHOOK_SECRET` | string random | ⚠️ requerido para boot |
   | `VITE_GOOGLE_MAPS_API_KEY` | de Google Cloud → Maps Platform | si usas mapas |
   | `VITE_OPENWEATHER_API_KEY` | de openweathermap.org | si usas clima |
   | `PINECONE_API_KEY` | de pinecone.io | si usas RAG |
   | `MP_IPN_SECRET` | de Mercadopago | si vas a cobrar |
   | `WEBPAY_COMMERCE_CODE` | de Transbank | si vas a cobrar |
   | `WEBPAY_API_KEY` | de Transbank | si vas a cobrar |

- [ ] **Step 3.2:** Dar permiso al service account para leer los secrets

   En cada secret → tab Permissions → "Grant access" → principal: `guardian-praeventio` (default Cloud Run runtime SA, normalmente `<project-number>-compute@developer.gserviceaccount.com`) → role: `Secret Manager Secret Accessor`.

- [ ] **Step 3.3:** Modificar `deploy.yml` para inyectar los secrets

   Reemplazar las líneas 66-67 actuales:

   ```yaml
           env_vars: |
             NODE_ENV=production
   ```

   Por:

   ```yaml
           env_vars: |
             NODE_ENV=production
             KMS_ADAPTER=in-memory-dev
           secrets: |
             GEMINI_API_KEY=GEMINI_API_KEY:latest
             SESSION_SECRET=SESSION_SECRET:latest
             RESEND_API_KEY=RESEND_API_KEY:latest
             IOT_WEBHOOK_SECRET=IOT_WEBHOOK_SECRET:latest
             VITE_GOOGLE_MAPS_API_KEY=VITE_GOOGLE_MAPS_API_KEY:latest
             VITE_OPENWEATHER_API_KEY=VITE_OPENWEATHER_API_KEY:latest
             PINECONE_API_KEY=PINECONE_API_KEY:latest
   ```

   > Nota: `KMS_ADAPTER=in-memory-dev` mantiene la app booteable hasta que configures Cloud KMS. Para producción real, cambiar a `cloud-kms` siguiendo `KMS_ROTATION.md`.

- [ ] **Step 3.4:** Commit el cambio del workflow

   Desde Claude Code o GitHub web:
   - Editar `.github/workflows/deploy.yml`
   - Commit message: `chore(deploy): inject runtime secrets from Secret Manager`
   - Push a `main` → CI corre → deploy corre → contenedor arranca con secrets

---

## Task 4: Encontrar la URL pública y verificar que la app carga

**Files:** ninguno

- [ ] **Step 4.1:** Abrir Cloud Run console

   https://console.cloud.google.com/run?project=praeventio-541ad

   Buscar el servicio `guardian-praeventio`.

- [ ] **Step 4.2:** Copiar la URL pública

   Aparece arriba del servicio con formato `https://guardian-praeventio-XXXX-uc.a.run.app`. **Esta es tu URL de preview.** Guárdala — es tu reemplazo de AI Studio preview.

- [ ] **Step 4.3:** Abrir la URL en el navegador (PC o celular)

   Esperado: la UI de Guardian Praeventio carga. Si ves página en blanco o error 502, ir a Step 4.4.

- [ ] **Step 4.4:** Si falla — ver logs de Cloud Run

   En el servicio → tab Logs. Buscar el error de arranque. Errores típicos:
   - `Missing API key` → falta secret en Step 3.1
   - `permission denied on secret` → falta grant en Step 3.2
   - `Could not load default credentials` → el service account de runtime de Cloud Run no tiene acceso a Firestore. Solución: en IAM, dar al runtime SA el role `Cloud Datastore User` o `Firebase Admin SDK Administrator`.

- [ ] **Step 4.5:** Verificar features clave

   - Login (¿Firebase Auth funciona?)
   - Una pantalla con Gemini (¿responde el chat?)
   - Una pantalla con Firestore (¿lista datos?)

---

## Task 5: Establecer el workflow Claude Code móvil → preview

**Files:** ninguno (workflow de uso, no código)

- [ ] **Step 5.1:** Confirmar que tienes Claude Code en celular

   App iOS/Android de Anthropic, o https://claude.ai/code en navegador móvil. Login con la misma cuenta.

- [ ] **Step 5.2:** Conectar Claude Code al repo

   En la app, conectar al repo `mikesandoval10creator/Guardian-Praeventio`. Las ediciones desde Claude Code móvil van a commits en el repo (igual que ahora estás trabajando).

- [ ] **Step 5.3:** Flujo de trabajo confirmado

   1. Editar código en Claude Code (móvil o web)
   2. Pedirle que haga commit a `main` (o a una rama)
   3. Esperar 2-5 min — GitHub Actions corre CI → deploy
   4. Recargar la URL de Cloud Run en el navegador del celular → ves los cambios

   ⚠️ **Diferencia con AI Studio:** AI Studio mostraba cambios en ~3 segundos (hot reload). Cloud Run tarda ~3-5 min porque construye Docker image y reinicia. **No es tiempo real**, pero sí automático.

- [ ] **Step 5.4 (opcional):** Habilitar previews por PR

   Si quieres una URL distinta por cada branch/PR (mejor para experimentar sin romper main), agregar workflow `preview.yml` que deploy a un servicio Cloud Run efímero. Hablar conmigo cuando estés en este punto, lo planeamos aparte.

---

## Task 6 (opcional): Workflow alternativo con tiempos rápidos — Vercel

**Files:** Crear `vercel.json` en raíz del repo

> Si los 3-5 min de Cloud Run te frustran, **Vercel** despliega más rápido (~1-2 min) y tiene preview por PR built-in. Vercel soporta tu stack (Vite + Express). Cloud Run es más adecuado para producción real con costos optimizados; Vercel es más rápido para iteración.

- [ ] **Step 6.1:** Decidir si quieres este camino

   No empezar hasta haber probado Cloud Run. Si la velocidad es problema real, hablamos.

---

## Self-review (lo que validé al escribir este plan)

- ✅ Cubre la pregunta original: "¿está bien mi GitHub?" → SÍ, está bien. Cubierto en intro + Task 1.
- ✅ Cubre el preview: Task 4 entrega URL.
- ✅ Cubre el workflow móvil con Claude Code: Task 5.
- ✅ Cubre el problema de "API errors al lanzar": Task 3 (configurar secrets).
- ✅ No hay placeholders ni TODOs vagos — cada paso dice qué consola/archivo/comando.
- ⚠️ Asumí que el `PROJECT_ID` en el workflow (`praeventio-541ad`) es tuyo. Si no, hay que cambiarlo.
- ⚠️ Project number `565212386989` en `deploy.yml:35` también puede ser de otro proyecto. Verificar.

---

## Próximo paso

Ejecutar **Task 1.1**: ir a https://github.com/mikesandoval10creator/Guardian-Praeventio/actions y reportarme qué ves en el último run de "Deploy to Cloud Run".
