# Contributing to Praeventio Guard

Bienvenido. Este documento describe el flujo de trabajo de desarrollo, las
convenciones de código y los checklists obligatorios para integrar cambios al
repositorio. La filosofía guía es simple: **el riesgo se neutraliza en el
diseño, no en la reacción** — y eso aplica al código tanto como a las faenas
de los usuarios.

Si vas a contribuir por primera vez:
- Lee también [`ARCHITECTURE.md`](./ARCHITECTURE.md) (mapa de módulos y data
  flow) y [`RUNBOOK.md`](./RUNBOOK.md) (procedimientos operacionales).
- Si vas a tocar pagos, lee [`BILLING.md`](./BILLING.md).
- Si vas a tocar reglas de Firestore o KMS, lee [`SECURITY.md`](./SECURITY.md)
  y [`security_spec.md`](./security_spec.md).
- Si vas a tocar OAuth de Google Workspace, lee
  [`marketplace/scope-justifications.md`](./marketplace/scope-justifications.md).

---

## Setup local

### Prerrequisitos
- Node.js 20 LTS (el lockfile asume `npm` 10+; nada de `pnpm` o `yarn`).
- Cuenta de Firebase con Firestore habilitado (Native mode, no Datastore).
- API key de Gemini (Google AI Studio o GCP Vertex AI).
- Git ≥ 2.40.

### Clonar y arrancar

```bash
git clone https://github.com/mikesandoval10creator/Guardian-Praeventio.git
cd Guardian-Praeventio
npm install
cp .env.example .env.local      # completar con valores propios
npm run dev                     # http://localhost:3000
```

`npm run dev` arranca **un solo proceso**: `tsx server.ts` levanta Express y
monta Vite en `middlewareMode`. No corras Vite por separado — el SPA se sirve
desde el mismo origen para evitar fricciones de CORS y cookies de sesión.

### Variables de entorno

`.env.example` documenta cada variable. Mínimo viable:
- `GEMINI_API_KEY` — clave de Google AI Studio.
- `SESSION_SECRET` — `openssl rand -hex 32`.

En producción los secretos viven en **Google Secret Manager** y se inyectan
como variables de entorno al servicio Cloud Run (ver `RUNBOOK.md`). Nunca
commitees un `.env*` real, ni el `firebase-applet-config.json` (la service
account de Firebase Admin); ambos están en `.gitignore`.

### Firestore emulator (opcional pero recomendado para tests)

```bash
firebase emulators:start --only firestore
```

Ver `RUNBOOK.md` §"Run Firestore emulator locally" para cómo seedear data y
correr los tests de reglas con `@firebase/rules-unit-testing`.

---

## Convenciones de proyecto

### Test-Driven Development (estricto)

Toda lógica nueva sigue el ciclo **RED → GREEN → REFACTOR**:

1. **RED**: escribe el test primero (`*.test.ts`) y verifica que falla por
   la razón correcta. Si el test pasa antes de tocar el código de producción,
   está mal escrito.
2. **GREEN**: implementa lo mínimo necesario para que el test pase.
3. **REFACTOR**: limpia, deduplica, simplifica. Los tests no cambian.

Si tu skill harness expone `superpowers:test-driven-development`, invócala
antes de empezar. Para casos donde TDD no aplica (cambios cosméticos, copy,
documentación), explícalo en el PR.

Excepciones documentadas:
- **UI puramente visual** (className tweaks, microcopy) puede saltarse TDD.
- **Migraciones one-shot** (codemods) pueden vivir en `scripts/` sin tests
  pero deben borrarse después de ejecutar — no son código de producción.
- **Spike / prototipos**: marca el PR como `RFC` y borra antes de mergear.

### Registro lingüístico (Spanish-CL)

Todo texto orientado al usuario final está en **español de Chile**:

- Tono profesional pero cercano. Evitar voseo (`tú`, no `vos`).
- Usar terminología normativa local: "Ley 16.744", "DS 594", "Comité
  Paritario", "Mutual de Seguridad", "ACHS", "ISL", "OAL".
- Fechas: formato `DD-MM-YYYY` o `D de Mes de YYYY` (`28 de abril de 2026`).
- Moneda: `$1.234.567 CLP` (con punto separador de miles, sin decimales).
- RUT: con puntos y guion, dígito verificador en mayúscula (`12.345.678-K`).
- Términos técnicos universales (REBA, RULA, EPP, IPER, PTS) van en
  mayúscula sin traducir.

Comentarios de código, mensajes de log, nombres de variables y commits van en
**inglés** o en mezcla — el público de esos artefactos es el equipo de dev,
no el usuario final.

### Audit log obligatorio

Toda operación que cambie estado **debe** emitir un audit log. La invariante
es: si un gerente hace una pregunta legal sobre una decisión histórica del
sistema, debe poder reconstruirla a partir de `audit_logs`.

Patrones aceptados:
- **Cliente** → `auditService.logAuditAction(...)` (en `src/services/auditService.ts`),
  que internamente llama a `POST /api/audit-log`. El servidor estampa el uid
  y email desde el token verificado, no desde el body — el cliente NO puede
  fabricar entradas a nombre de otro.
- **Servidor** → escribir directo a la colección `audit_logs` con la
  Admin SDK (ver server.ts:345 para el shape canónico).

`audit_logs` es **append-only por reglas Firestore** (`audit_logs:create:true,
update:false, delete:false`). Si una operación no aparece en audit_logs, para
efectos legales/regulatorios no ocurrió.

### Reglas de Firestore: default-deny

`firestore.rules` rechaza por defecto. Cada colección nueva REQUIERE:

1. Una entrada explícita en `firestore.rules` con el modelo de acceso.
2. **Mínimo 5 tests** en `src/__tests__/firestore.rules.*.test.ts` cubriendo:
   - Lectura/escritura del owner legítimo (allow).
   - Lectura/escritura de un no-miembro (deny).
   - Mutación que viola schema (deny).
   - Tentativa de update/delete sobre append-only post-sign (deny).
   - Tentativa de fabricar campos del servidor desde el cliente (deny).
3. Documentar las invariantes en `security_spec.md` (la "Dirty Dozen").
4. Si la colección guarda PII o datos médicos, encolar la rotación KMS
   en `KMS_ROTATION.md`.

### Sin nuevas dependencias sin justificación

Cada `npm install` cuesta peso de bundle, superficie de ataque y tiempo de
revisión de licencias. Antes de agregar una dependencia:

1. ¿Se puede resolver con stdlib o con código existente del repo?
2. ¿El paquete tiene mantenimiento activo (último commit < 1 año, > 5
   contributors)?
3. ¿La licencia es compatible (MIT, Apache-2.0, BSD)? GPL/AGPL → no.
4. ¿Cuál es el tamaño del bundle? (`npm run size` después).
5. Documenta en el PR el peso agregado y la razón.

---

## Cómo agregar una nueva ruta de servidor

`server.ts` está en migración hacia `src/server/{routes,middleware,triggers}/`
(ver R5 en `ARCHITECTURE.md`). Mientras tanto:

1. Decide la ubicación: si el split del dominio ya migró, usa
   `src/server/routes/{domain}.ts`. Si no, edita `server.ts` directo.
2. Aplica `verifyAuth` excepto si la ruta es deliberadamente pública
   (health, webhooks con secret, magic-link tokens). Documenta el motivo
   en un comentario sobre la línea del `app.{verb}(...)`.
3. Si la ruta acepta `projectId` (en path, body o query), llama a
   `assertProjectMember(uid, projectId, db)` antes de cualquier escritura.
   Caso contrario: estás permitiendo cross-tenant pollution.
4. Valida el body con guardas explícitas:
   - Tipo (`typeof x === 'string'`).
   - Longitud máxima (≤64 chars para identificadores, ≤500 para texto libre,
     ≤1024 para firmas/blobs).
   - Regex/enum cuando aplique (`UID_REGEX`, `VALID_PAYMENT_METHODS`).
   - Rechaza con 400 + mensaje específico ANTES de tocar Firestore.
5. En éxito, escribe a `audit_logs` con `action: '<dominio>.<verbo>'`,
   `details: { ... }` (sin secretos), y los campos `userId`, `userEmail`,
   `projectId` desde el token verificado.
6. Agrega un test HTTP en `src/__tests__/server/{domain}.test.ts` con
   `supertest` (ver patrón consolidado en R15 I3). Mínimo 3 casos:
   - 401 sin token.
   - 200 happy path.
   - 400/403/404 según las reglas de validación.

### Errores: nunca filtrar internals

`process.env.NODE_ENV === 'production' ? "Internal server error" : err.message`
es el patrón obligatorio para 5xx. Stack traces, mensajes de Firebase Admin
y cuerpos de upstream (Resend, Webpay, MercadoPago) **nunca** salen en una
response de producción.

---

## Cómo agregar una nueva acción de Gemini AI

Las llamadas a Gemini desde el cliente pasan por el proxy
`POST /api/gemini { action, args }` (server.ts:1680). Esto significa:
- El cliente nunca ve `GEMINI_API_KEY`.
- Un atacante autenticado solo puede invocar acciones whitelisted.

Pasos para agregar una acción:

1. **Whitelist**: agrega el nombre de la función al array
   `ALLOWED_GEMINI_ACTIONS` en `server.ts` (~línea 1593). Sin esta entrada,
   el proxy responde 403.
2. **Implementación**: exporta la función desde `src/services/geminiBackend.ts`
   (post-R18 split: `src/services/gemini/{domain}.ts`). Convención:
   ```ts
   export async function nombreDeAccion(arg1: T1, arg2: T2): Promise<R> {
     const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
     const model = ai.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
     // ...
   }
   ```
   Modelos preferidos: `gemini-2.0-flash-exp` (default), `gemini-1.5-pro`
   (razonamiento profundo), `text-embedding-004` (embeddings).
3. **Wrap try/catch**: las respuestas del LLM son texto libre y pueden ser
   malformadas, truncadas o evasivas. Cualquier `JSON.parse(response.text)`
   debe estar dentro de un try/catch que devuelva un fallback seguro o lance
   un error tipado para que el handler HTTP devuelva 502.
4. **Rate limiting**: el proxy ya aplica `geminiLimiter` (30 req / 15 min /
   uid). Si tu acción es especialmente costosa (contexto grande, varios
   roundtrips), considera un sub-limiter dedicado.
5. **Tests**: agrega un test en `src/services/__tests__/geminiBackend.*.test.ts`
   con un mock del SDK que verifique el shape del prompt y el manejo de
   respuestas malformadas.

---

## Cómo agregar un nuevo motor de cálculo de seguridad

Ej: REBA, RULA, IPER, NIOSH, OWAS, exposición a ruido (DS 594 art. 70).

1. **Función pura** en `src/services/{ergonomics|protocols|...}/{nombre}.ts`.
   Sin side effects, sin lecturas a Firestore, sin fechas (`Date.now()`)
   inyectables como parámetro si afectan el resultado.
2. **Inputs validados**: rechaza inputs fuera de rango con `Error` tipado.
   Ej: ángulo de tronco REBA es `[0, 90]` — fuera de eso, `throw`.
3. **Outputs deterministas**: misma entrada → misma salida, idempotente.
   Si necesitas aleatoriedad (Monte Carlo de propagación de riesgo),
   inyecta el RNG.
4. **Tests unitarios** cubriendo:
   - Mínimo, máximo, valores de tabla del estándar normativo (cita la fila
     del Annex correspondiente en el comment).
   - Boundary off-by-one (REBA score cambia en `4 vs 5`, `8 vs 9`).
   - Inputs inválidos → throw con mensaje útil.
5. **Integración UI**: usa el patrón "wizard" multi-paso de
   `src/components/AddErgonomicsModal.tsx` como referencia. Cada paso
   captura un sub-set de inputs con validación inline.
6. **Persistencia**: escribe a una colección dedicada, **NUNCA** a la
   colección genérica `nodes`. Ej: `ergonomic_assessments`,
   `chemical_exposure_records`. Esto permite reglas Firestore específicas y
   queries indexadas eficientes.
7. **Append-only post-sign**: una vez firmado por el prevencionista
   (`signedAt`, `signedBy`), las reglas Firestore deben rechazar updates.
   Patrón:
   ```
   allow update: if !resource.data.signedAt
                 && request.auth.uid == resource.data.workerId;
   ```

---

## PR review checklist

Marca cada item antes de pedir review. Cualquiera vacío bloquea el merge.

- [ ] `npm run typecheck` → 0 errores.
- [ ] `npm run test` → suite verde (≥866 tests al cierre de R16).
- [ ] `npm run build` → build exitoso, sin warnings de chunk size sobre el
      umbral configurado en `vite.config.ts`.
- [ ] Cobertura: las funciones nuevas tienen tests (rama feliz + ≥1 sad path).
- [ ] Audit log: cada operación de cambio de estado escribe a `audit_logs`,
      y los `action` strings están documentados en el PR.
- [ ] Spanish-CL: copy verificado, no quedó "guardar" en lugar de "guardar"
      ni cadenas en inglés en superficies de usuario.
- [ ] Reglas Firestore: si tocaste `firestore.rules`, los tests
      correspondientes (`src/__tests__/firestore.rules.*.test.ts`) cubren
      los nuevos casos.
- [ ] Sin secretos commiteados (verifica `git diff --cached | grep -i
      'apikey\|secret\|token\|password'`).
- [ ] PR referencia el issue / round / hallazgo de AUDIT.md que cierra.

---

## Estilo de mensajes de commit

Convención liviana inspirada en Conventional Commits:

```
<tipo>: <imperativo en presente, ≤72 chars>

[cuerpo opcional explicando el "porqué", no el "qué"]
```

Tipos aceptados: `feat`, `fix`, `audit`, `refactor`, `test`, `docs`, `chore`,
`security`. El cuerpo se separa con una línea en blanco.

Ejemplo:
```
fix(billing): apply length cap to invoiceId before Firestore lookup

The previous regex allowed ids up to 256 chars, which Firestore rejects
silently with a 400 from the underlying gRPC call. Caps to 128 chars
matching the existing UID_REGEX pattern.
```

---

## Reportar problemas de seguridad

**No abras un issue público.** Sigue el procedimiento documentado en
[`SECURITY.md`](./SECURITY.md) y, si quieres cifrar el reporte, usa la clave
publicada en [`/.well-known/pgp-key.asc`](./public/.well-known/pgp-key.asc)
(placeholder hasta que se genere la real — ver SECURITY.md §17).

---

¿Dudas? Abre una discussion o escribe a `dev@praeventio.net`.
