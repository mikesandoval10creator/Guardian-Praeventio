# ADR 0011 — Digital Twin Access Control: Triple-Gate Authentication

Status: **accepted** (principio arquitectónico inviolable)
Date: 2026-05-05
Aplica a: Site25DPanel, DigitalTwinFaena, FireRiskGuardian (futuro), AR Preview, capacitación inmersiva

## Contexto

El Digital Twin de Praeventio es una representación detallada del interior
de la faena: geometría 3D, posición de extintores e hidrantes, ubicación
de combustibles y materiales peligrosos, rutas de evacuación, accesos,
puntos de reunión, redes eléctricas, sistemas de ventilación.

**Esta información es propiedad de la empresa cliente y revela su
infraestructura de seguridad.**

Mostrarle el twin a un desconocido equivale a entregarle el plano
detallado de la faena. Eso es:

1. **Ilógico operacionalmente** — el supervisor no le abre las puertas
   físicas a un desconocido; tampoco debería abrirle las puertas
   digitales del twin.
2. **Riesgo de seguridad** — un atacante con acceso al twin conoce
   exactamente dónde están los puntos vulnerables: tanques de
   combustible, salidas, puntos ciegos de cámaras, redes eléctricas
   críticas.
3. **Riesgo competitivo** — el layout de una faena es know-how
   industrial. Una constructora competidora no debe poder ver el
   twin de otra constructora.
4. **Riesgo regulatorio** — Ley 19.628 (datos personales) + secretos
   industriales protegidos por art. 11 del Código Penal CL.

## Decisión

**Acceso al Digital Twin requiere TRES gates de autenticación
secuenciales y simultáneos. Sin excepción. Sin "feature flag" para
saltar gates en demo o testing.**

### Gate 1 — Project Membership (qué proyecto)

El usuario debe ser miembro confirmado del proyecto cuyo twin pide ver.

```ts
// Verificado en server-side verifyAuth + assertProjectMember
const membership = await assertProjectMember(uid, projectId);
if (!membership) throw 403 'not_a_project_member';
```

El membership se establece via:
- Aceptación de invitation por email magic-link (existing flow)
- Onboarding wizard step 4 (Sprint 24 KK)
- Manual add por supervisor del proyecto

### Gate 2 — Identity Verification (quién dice ser)

Cuenta Google verificada (Firebase Auth + OAuth). Esto da:
- Email institucional verificable
- Foto de perfil + nombre legal del usuario
- Tracker de IP / device usado para registrarse
- Audit trail vía Firebase Auth logs

Sin Google Auth, NO twin access. Cuentas anónimas, email/password
con email no verificado, magic-link sin Google handshake → bloqueados.

### Gate 3 — Biometric Step-Up (continuidad de identidad)

Inmediatamente antes de cargar el twin, el sistema pide step-up
biometric:

- iOS: Face ID / Touch ID via `@aparajita/capacitor-biometric-auth`
- Android: Fingerprint / Face Unlock via mismo plugin
- Web: WebAuthn passkey (ya implementado en `curriculum.ts:884`)

Esto cierra el gap del "device robado con sesión activa". Si alguien
roba el celular del trabajador con la app abierta, no puede entrar al
twin sin la huella del trabajador real.

## Implementación técnica

### Hook `useTwinAccess`

Archivo: `src/hooks/useTwinAccess.ts`

```ts
export type TwinAccessState =
  | 'checking'                  // verificación inicial en curso
  | 'unauthenticated'           // gate 1 falla — sin Google login
  | 'not_member'                // gate 2 falla — usuario no es miembro del proyecto
  | 'biometric_required'        // gate 3 pendiente — esperando huella
  | 'biometric_failed'          // huella rechazada
  | 'biometric_unavailable'     // device sin biometric capability — fallback passkey WebAuthn
  | 'granted';                  // las 3 puertas pasaron

export interface TwinAccessSnapshot {
  state: TwinAccessState;
  projectId: string;
  workerUid: string | null;
  grantedAtMs: number | null;   // timestamp del último step-up exitoso
  /** Re-step-up obligatorio cada N min de inactividad (default 30). */
  requiresStepUpAfterMs: number;
  /** Trigger explícito del step-up biometric. */
  requestStepUp: () => Promise<void>;
  /** Revoca acceso ahora — call cuando el twin se cierra o user cambia projectId. */
  revoke: () => void;
}

export function useTwinAccess(projectId: string): TwinAccessSnapshot;
```

Política de re-autenticación:
- Step-up biometric expira después de **30 min de inactividad** (sin
  interacción con el twin).
- Cambio de proyecto invalida step-up de proyecto anterior.
- Cierre de la pestaña del browser invalida step-up.

### Component guards

Cualquier componente que renderiza twin DEBE wrappear con `<TwinAccessGuard>`:

```tsx
// src/components/digital-twin/TwinAccessGuard.tsx
<TwinAccessGuard projectId={projectId}>
  <Site25DPanel />
  <DigitalTwinFaena />
  <FireRiskTwin />
</TwinAccessGuard>
```

Internamente, `TwinAccessGuard`:
1. Llama `useTwinAccess(projectId)`
2. Renderiza `<TwinAccessLockScreen state={state} onRetry={...} />` si state ≠ 'granted'
3. Solo renderiza children cuando state === 'granted'

### Server-side enforcement

API endpoints que sirven datos del twin (mesh GLB, polígonos, posición de
PlacedObjects, rutas A* calculadas, simulaciones de fuego/dispersión)
DEBEN:

1. Verificar `verifyAuth` (token Firebase válido)
2. Verificar `assertProjectMember(uid, projectId)`
3. Verificar `verifyTwinStepUp(uid, projectId, recentMinutes: 30)` — un
   header `X-Twin-Step-Up: <signed-token>` que el cliente envía después
   del step-up biometric exitoso.

Endpoints afectados:
- GET `/api/digitalTwin/mesh/:projectId` (futuro)
- GET `/api/digitalTwin/polygons/:projectId` (existing siteGeometryStore)
- GET `/api/digitalTwin/placed-objects/:projectId`
- POST `/api/digitalTwin/simulate-fire` (futuro Bucket UU)
- POST `/api/digitalTwin/evacuation-route`

### Audit log obligatorio

Cada vez que el sistema concede acceso al twin, audit log:

```ts
await logAuditAction('twin.access.granted', 'digital_twin', {
  projectId,
  workerUidHash: hashUid(uid),     // PII protegido (Sprint 23 FF)
  gateUsed: 'biometric' | 'webauthn-passkey' | 'fido2',
  deviceFingerprint: req.deviceFingerprint,
  ipHash: hashIp(req.ip),
  projectName: project.name,
  durationMin: 30,                 // expiry del step-up
});
```

Y cada vez que se revoca o expira:

```ts
await logAuditAction('twin.access.expired', 'digital_twin', { ... });
```

### Capacitación inmersiva — caso especial

El usuario expresó: "la capacitación con Digital Twin a trabajadores
nuevos solo debe ser permitida si el trabajador nuevo entra al proyecto
de la empresa".

**Flujo de capacitación de trabajador nuevo:**

1. **Día 1**: Supervisor crea invitation desde CuadrillasDashboard.
   Email se envía al trabajador con magic-link.
2. **Trabajador acepta**: El magic-link redirige a `/onboarding/accept`,
   donde se le pide login con Google (Gate 2). Si tiene cuenta Google,
   single-click. Si no, crea cuenta vinculada a su email.
3. **Onboarding completo**: Wizard registra device + perfil. **Aquí
   se solicita registro biometric (huella o Face ID)** — opcional pero
   marcado como "obligatorio para acceso a Digital Twin".
4. **Day 1 capacitación**: Trabajador navega a `/training/twin/:projectId`.
   El sistema:
   - Verifica Gate 1 (membership) ✓
   - Verifica Gate 2 (Google + email verificado) ✓
   - Solicita Gate 3 (huella/Face ID/passkey)
   - Si los 3 pasan → twin se carga
5. **Durante capacitación**: cada acción educativa (mover extintor virtual,
   simular evacuación, identificar peligro) se registra contra el UID del
   trabajador en `training_records/{uid}/twin_sessions/{date}`.
6. **Certificación al completar**: emite certificate PDF con QR de
   verificación + audit trail completo. Sirve como evidencia legal de
   capacitación recibida (Ley 16.744 obligación del empleador).

## Modo demo / marketing

Para que ventas pueda mostrar twin en demos comerciales SIN exponer faenas
reales, existe el twin **demo project** con geometría sintética:

- Project ID: `demo-faena-praeventio`
- Geometría: faena ficticia generada (warehouse + tanques + oficinas)
- Datos de extintores/hidrantes: posiciones inventadas, físicamente válidas
- Cualquier usuario logueado (Gate 1 = miembro automático del demo project)
  puede ver este twin sin biometric (Gate 3 skipped solo para demo project)

**Hard-coded** en `src/data/demoProject.ts` con flag `__demo__: true` que
los guards reconocen para skip Gate 3. NUNCA un proyecto real se marca
como demo.

## Consecuencias

### Operacionales

- **Login con Google es de facto requerido para acceso a Digital Twin**.
  Workers que solo usan email/password con email no verificado NO pueden
  acceder al twin (siguen accediendo al resto de la app).
- **Onboarding agrega step de registro biometric** (opcional general,
  obligatorio para twin).
- **Demo project** existe como entry point comercial separado.

### Técnicas

- `useTwinAccess` es el único path autorizado para mostrar el twin.
  PRs que renderizan Site25DPanel sin TwinAccessGuard son rechazados
  en code review.
- Server endpoints validan triple-gate. Cliente NO puede hacer fetch
  de mesh sin pasar por gateway.
- Step-up token tiene TTL 30 min, signed con KMS-backed HMAC.

### Legales

- ✅ Ley 19.628 — datos sensibles industriales protegidos
- ✅ Art. 11 Código Penal CL — secretos industriales
- ✅ Ley 21.719 (vigor 2026) — proporcionalidad cumplida
- ✅ Defensa empresa cliente — el audit log demuestra "controlamos quién
  accede al plano de nuestra faena"

### Filosóficas — coherencia con ADR 0010

El ADR 0010 estableció: "datos íntimos del trabajador son sagrados".
Este ADR 0011 establece: "datos íntimos de la faena son sagrados".

**Ambos lados tienen privacidad simétrica:**
- El trabajador conserva su privacidad personal (sleep, HR fuera de
  turno, vida fuera de faena no se tocan).
- La empresa conserva su privacidad industrial (twin no se muestra a
  desconocidos).

Praeventio respeta a ambos. Eso es coherencia total.

## Tests obligatorios

Para cualquier PR que toque twin access:

```ts
describe('TwinAccessGuard — triple gate enforcement', () => {
  it('blocks unauthenticated user', () => { ... });
  it('blocks user not a project member', () => { ... });
  it('shows biometric prompt when membership ok', () => { ... });
  it('grants access after successful biometric step-up', () => { ... });
  it('expires step-up after 30 min inactivity', () => { ... });
  it('revokes step-up on project change', () => { ... });
  it('demo project skips gate 3 only', () => { ... });
});
```

```ts
describe('Server twin endpoints — triple gate enforcement', () => {
  it('GET /api/digitalTwin/mesh/:projectId returns 401 without auth', () => { ... });
  it('returns 403 when not project member', () => { ... });
  it('returns 403 when X-Twin-Step-Up header missing', () => { ... });
  it('returns 403 when step-up token expired', () => { ... });
  it('returns 200 when all 3 gates pass', () => { ... });
  it('audit log written on grant + on expiry', () => { ... });
});
```

## Migration path

**Sprint 26** (próximo) implementa:
1. `useTwinAccess` hook + `TwinAccessGuard` component
2. `verifyTwinStepUp` server middleware + signed token system
3. Audit log entries `twin.access.granted` / `twin.access.expired`
4. Onboarding wizard step "Registro biometric" opcional general /
   obligatorio para twin
5. Demo project sintético + flag `__demo__`
6. Migration de Site25DPanel + DigitalTwinFaena para wrap con guard

## Referencias

- ADR 0010 (privacy by design — simétrico desde el lado trabajador)
- Sprint 21 Bucket P (`useBiometricAuth.ts`)
- Sprint 21 curriculum.ts (WebAuthn passkey register/verify)
- Ley 19.628 + Art. 11 Código Penal CL
- NIST SP 800-63B (multi-factor authentication)
- Memoria usuario `feedback_no_blind_sweeps.md` (no decisiones por defecto)
