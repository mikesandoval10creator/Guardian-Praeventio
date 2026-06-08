# Evidencia de runtime + deuda técnica — 2026-06-08

> **Cambio de método.** La app ya está **viva, pública y renderiza completa**
> (`https://guardian-praeventio-565212386989.southamerica-west1.run.app`). Eso
> habilita un tipo de auditoría que antes no teníamos: **evidenciar deuda
> CORRIENDO la app**, no solo leyendo código. Hallazgo central: **CI verde ≠
> feature funcionando en producción** — lo demostramos abajo con un bug de vida
> que los tests no veían porque mockean el `fetch`.

Relacionado: `docs/audits/file-ledger/PHASE5-REMEDIATION.md` (ledger por bloque),
`TODO.md` §2.32–2.34, `INDEX-CONSOLIDADO.md`.

---

## 1. Verificado FUNCIONANDO (navegando el app live, perspectiva positiva)

Confirmado con Playwright contra la URL de producción:

- **Portada de marketing** (`LandingPage`) renderiza completa: hero "La revolución
  de la prevención de riesgos", badges normativos (DS 54 · DS 44/2024 · Ley 16.744
  · ISO 45001 · OHSAS 18001 · SUSESO · ISL · ACHS · IST), secciones "Por qué
  Guardian", features, "Cómo funciona", planes, footer con enlaces a `praeventio.net`.
- **App-shell + Dashboard (la página de inicio rica) renderizan**, alcanzables
  **sin iniciar sesión**:
  - Sidebar con **~60 módulos** (Centro de Mando: Inicio, CPHS, LOTO, Bitácora,
    Brigada, Tablero Evacuación, Trabajo Solitario, Causa Raíz… + grupos IA,
    Módulos Operativos, Salud Ocupacional, Configuración).
  - **Boletín climático** (`WeatherBulletin`): Santiago, calidad del aire,
    recomendaciones de seguridad, amanecer/atardecer (`SunTracker`).
  - **EPP Requerido por rubro** (`EPPRequiredWidget`, driven por `selectedProject`).
  - **Carrusel de Módulos** (`ModuleGroupsGrid`): 10 grupos (Principal, Gestión
    Operativa, Prevención y Riesgos, Salud Ocupacional, Cumplimiento, Emergencias,
    Conocimiento, IA y Coach, Innovación, Administración).
  - **Selector de 4 modos UX**: Claro / Oscuro / Conducir / Emergencia.
  - Buscador IA Gemini, Despertar Matutino + EPP check, quick-actions (Fast Check,
    Planificador, **Emergencia** → `/emergency`, Mapa Vivo), Consejo del día,
    Estado Operativo, descarga SLM offline.

## 2. Deuda evidenciada CORRIENDO la app (lo que el CI verde NO detecta)

| Sev | Evidencia (consola de producción) | Causa raíz | Estado |
|---|---|---|---|
| 🔴 vida | `connect-src` del CSP **bloquea** `earthquake.usgs.gov` (2 endpoints: `/fdsnws/event/1/query` y `/earthquakes/feed/.../all_day.geojson`) | `securityHeaders.ts` tenía las APIs NASA pero **olvidó USGS**; el monitor sísmico recibe 0 datos. Los unit tests mockean `fetch` → nunca lo vieron | **FIX** → PR `fix/csp-usgs-seismic` (añade el host + test que asserta el allowlist) |
| 🟡 | "Executing inline event handler violates CSP" en `index.html:24` | handler inline sin nonce en el HTML shell | pendiente (mover a script con nonce) |
| 🟡 | `fonts.gstatic.com/.../jetbrainsmono...woff2` → `net::ERR_FAILED` | font-src/red bloquea una fuente Google | pendiente (self-host o `font-src`) |

**Principio que esto evidencia:** una feature puede pasar todos los tests (mock del
`fetch`) y aun así estar **rota en producción** por configuración de runtime (CSP,
red, env). La auditoría de runtime es complementaria e indispensable.

## 3. Reconciliación del análisis del prototipo (corrección del usuario, verificada)

El análisis automatizado del prototipo `praevium-guard` **confundió dos páginas**:
la **portada de marketing** (`LandingPage`, "6 cards") con la **página de inicio
rica** (`Dashboard`). Verificado corriendo la app, varios "huecos" que reportó **ya
están hechos** y NO se tocan:

- Item "directorio de módulos explorable" → **YA EXISTE** (`ModuleGroupsGrid`, 10
  grupos navegables en el Dashboard anónimo).
- Item "EPP por rubro" → **YA EXISTE** (`EPPRequiredWidget`, por `selectedProject`).
- Boletín climático, toggle de modo claro/oscuro/conducir/emergencia, carrusel →
  **YA EXISTEN**.

## 4. Huecos GENUINOS de recuperación del prototipo (lo que sí falta)

1. **SOS/Emergencia sin login en la PORTADA `/`** — hoy el acceso a emergencia
   está en el shell (tras "Entrar"); la portada de marketing no tiene un afford
   directo. Componente listo: `src/components/emergency/PublicEmergencyButton.tsx`
   (context-free, llamadas `tel:` geo-aware + primeros auxilios offline). Falta
   montarlo **solo** en `LandingPage.tsx`.
2. **TriageBeacon** (`src/components/emergency/TriageBeacon.tsx`) — componente
   completo pero **muerto** (0 usos). Visión del usuario: el **color de pantalla**
   (verde/amarillo/rojo) ES la señal de triage para que los paramédicos, al llegar
   a una emergencia, sepan a quién atender primero. Requiere: (a) campo `bloodType`
   en el perfil/HealthVault **on-device, nunca se transmite** (CLAUDE.md #12);
   (b) montar al detectar man-down (`useManDownDetection.onManDownConfirmed`). La
   severidad debe basarse en parámetros **medibles y consistentes**.
3. **Mapa "DEA más cercano a mí" público** — hoy `DEAZones.tsx` es solo inventario
   admin por proyecto. Falta el mapa geolocalizado público + **verificación
   in-situ** (¿está el DEA?, ¿tiene piezas?, ¿hay personal capacitado?) entrenable
   vía el modelo Zettelkasten.

## 5. Reencuadre del usuario: "huérfanos" → NODOS SUB-CONECTADOS

> "Puede que no estén huérfanos, pero pueden ser utilizados por más funciones — una
> información o un nodo puede ser requerido por otro menú."

El foco de desarrollo no es solo **montar huérfanos**, sino mapear el **grafo de
consumo**: qué nodo/dato alimenta a qué features, y conectar un mismo nodo a los
**múltiples** menús que lo necesitan. Ejemplo concreto: el `HealthVault` (tipo de
sangre/alergias) debería alimentar al `TriageBeacon`, a `/profile`, al flujo de
emergencia y al man-down — un dato, varios consumidores. Este principio se suma al
de Fase 5 (huérfanos→montar) como **cross-connection de nodos**.

## 6. Deuda Fase 5 vigente (sigue siendo sustancial — perspectiva honesta)

Cerrado en esta racha (con PR): deploy LIVE + 18/20 secretos reales + B1 (ManDown→FCM,
SOS dead-letter) + B6 (microtraining cert=caller) + B8 (LOTO) + B10 (horómetro
recomendar-no-bloquear) + B13 (MOC auditado) + 3 bugs ZK + DR replication + voseo.
Pendiente (ver `PHASE5-REMEDIATION.md`): emulador (B7 health_vault rules+KMS / B9
site_book / B12 CPHS), F4 WebAuthn verify, iOS mesh CBUUID, y los 17 patrones
sistémicos de `TODO.md` §2.33.

## Método propuesto (positivo + enfocado)

**Auditoría de runtime continua** como complemento de la estática: navegar las
páginas clave del app live → capturar consola/red/render → evidenciar (este doc) →
arreglar (un PR por ítem, TDD) → re-verificar en el navegador. Mantiene el enfoque
en "que TODO funcione de verdad", que es la meta del usuario dado el tamaño de la app.
