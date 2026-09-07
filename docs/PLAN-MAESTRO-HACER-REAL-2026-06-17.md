# Plan Maestro — "Hacer Real Toda la App" · Guardian Praeventio

## Actualización vigente — 2026-09-06: aplicación completa, evidencia reconciliada

**Pedido de Daniel:** actualizar este plan con las investigaciones del Segundo Cerebro,
hacer reales **todas** las funciones y no confundir tickets pendientes con funciones
inexistentes. La finalidad es proteger vidas y mejorar el bienestar de las personas,
no solamente conseguir una compilación o publicar pantallas.

Esta actualización tiene precedencia sobre diagnósticos, porcentajes, estimaciones y
alternativas de recorte de las secciones históricas de junio. **Se conserva el documento
anterior íntegro** para mantener su razonamiento y los paquetes WP; ninguno se reabre ni
se considera resuelto automáticamente. No se crea otro backlog ni otro plan maestro.
El tracker de ejecución sigue siendo Notion Alpha 41.

### 1. Qué sabemos y qué no mide el porcentaje de auditoría

Corte de código: `e27d4244ecfc667a442115f6e3ee8de49e498a5a`, también base de
`origin/main` al preparar esta actualización. Lectura focalizada de investigaciones y
código: **no es una auditoría total de Guardian**.

| Medición | Resultado comprobado | Interpretación correcta |
|---|---|---|
| Notas Markdown de `01-Guardian` inventariadas | 294 | Inventario físico, no 294 notas leídas íntegramente en esta revisión |
| Ledger histórico de código | 3.943 filas; 124 declaradas estrictas | Conserva un denominador anterior; requiere actualización antes de un nuevo porcentaje global |
| Revalidación de esas 124 filas | 96 conservan hash y evidencia resoluble; 28 cambiaron o faltan | 2,435% **del denominador histórico**, no porcentaje construido ni toda la lectura realizada |
| Historia candidata sobre código productivo `src` actual | 855 rutas declaradas en frontmatter; 2.119 mencionadas | Declaración y mención no son lectura certificada; los conjuntos se superponen y no se suman |
| Inventario `src` TS/TSX actual | 3.895 archivos; 2.126 productivos; 141 rutas no presentes en el ledger anterior | Alcance distinto del ledger, que también incluye código nativo, infra y automatización |
| Notion completo, consulta paginada del 06-sep | 1.710 páginas únicas: 734 activas, 372 cerradas por estado, 604 canceladas | No hay equivalencia entre ticket y función; cancelado no significa implementado |
| Inventario de navegación de la revisión anterior | 208 patrones URL y 160 entradas de navegación | Existencia de superficie, no certificación de 208 funciones |

El «5–6% aproximadamente» es una referencia a la cobertura de investigación, **no un
porcentaje exacto que esta revisión pueda ratificar**, ni una medida del producto que
falta construir. No reemplazar la historia por el piso estricto ni afirmar «falta el
resto de la app». Tampoco afirmar «queda poco» sin medir recorridos completos.

**Trabajo de reconciliación:** recuperar lecturas históricas completas, comparar hashes,
leer diffs y volver a revisar solo lo que cambió; promover cada archivo con su evidencia.
No reiniciar la lectura ni acreditar un archivo porque aparece mencionado. Esta
actualización no modifica ni infla el ledger.

### 2. Investigación aprovechable y correcciones al diagnóstico anterior

| Área / fuente del Segundo Cerebro | Avance o conocimiento que se conserva | Próxima comprobación; no volver a construir por defecto |
|---|---|---|
| `Smoke-Lab-Android-Emuladores-2026-09-02` y reporte final `C:/tmp/android-ui-smoke-final-2026-09-03.md` | Smoke documentado en API 36, bundle interno, acceso y rutas públicas; el APK final conservado coincide con el SHA-256 `b3816722a9e6ef3e595b202e451c6f7180e3fe9d2e5d1b8a072cd9afdaeb395b` del reporte | Preservar la evidencia: DOM se inspeccionó con variante debug del mismo bundle; no confundirla con el APK final ni con un AAB de producción. Pasar a sesión autenticada, persistencia y hardware; no se repitió el smoke en esta actualización |
| `Indice-E9-ManDown-2026-08-31` | Mapa de sensores, foreground, watchdog, cola y transporte; permisos y lifecycle como puntos de riesgo | Contrastar cada hallazgo con PRs actuales y demostrar el recorrido en dispositivo. No certificarlo por mocks |
| `Indice-E10-Notifications-Emergency-2026-08-31` | Mapa de FCM, canales, permisos, acción y emergencia; historial de falsos positivos | Probar recepción, acción y confirmación con proceso muerto/pantalla apagada; preservar identidad del SOS |
| `Indice-E11-Workers-Offline-2026-08-31`, `Indice-E12-Geolocation-Tenant-2026-08-31`, `Indice-E13-Worker-Readiness-History-2026-08-31` | Dependencias entre trabajadores, tenant, geolocalización, readiness e historial | Auditar cambios de proyecto/usuario, aislamiento, permisos, modo offline y convergencia. Sus hallazgos son candidatos hasta revalidar el HEAD |
| `Barrido-E7c-Wisdom-Capsules-2026-08-31`, `Barrido-E7d-Zettelkasten-Graph-Risk-2026-08-31` | Investigación de cápsulas, conocimiento y conexiones de riesgo, con código y límites registrados | Completar incidente → acción/lección → capacitación/conocimiento y demostrar consumo real; no tratar Zettelkasten como pantalla aislada |
| `Barrido-E14-Consistency-Privacy-Revalidacion-2026-09-02` | Ya rechazó falsos positivos sobre mounts: `consistencyRouter` y `privacyRetentionRouter` existen en `server.ts` | El ADR 0024 exige retención sin borrado discrecional, pero no demuestra que todos los ejecutores lo cumplan: `runRetentionSweep.ts:230-232` todavía contiene borrado. Mantener esa brecha explícita |
| `Barrido-E14-Consolidado-Scheduler-Observability-Backup-2026-08-31` | Mapa útil de jobs, observabilidad y recuperación | Corregir inferencias antes de generar trabajo: `*/5 * * * *` y `*/1 * * * *` tienen cinco campos; existen `DR_RUNBOOK.md`, backup e importación Firestore. Falta probar operación real, no necesariamente escribir todo desde cero |
| Revisión Graphify/código del 05–06-sep | IPER tiene cálculo/persistencia/auditoría; incidentes tiene conexiones; gemelo requiere revisar alimentación del panel | Trazar entrada → servicio → datos reales → resultado visible. No extrapolar esos ejemplos a toda la app |

**Nivel de evidencia:** las notas documentan observaciones de sus respectivos snapshots.
Esta revisión revalidó directamente la muestra de abajo, el ledger por hash y los
artefactos indicados; no vuelve actuales todos los hallazgos de cada índice.

### 3. Muestra de Notion reconciliada con código y pruebas

Los siguientes veredictos orientan la siguiente acción; **no se cambiaron estados de
Notion durante la actualización del plan**.

| Ticket / asunto | Contraste actual | Clasificación y acción mínima |
|---|---|---|
| [`3c2aa66d-73fe-81bc-b505-c1ef6047c01f`](https://www.notion.so/3c2aa66d73fe81bcb505c1ef6047c01f), ausencia de tests de `aggregateAiFeedback` | PR [#1618](https://github.com/mikesandoval10creator/Guardian-Praeventio/pull/1618) integrado; `src/server/jobs/aggregateAiFeedback.test.ts:27-131` cubre ventana temporal, tenant vacío, agregación, idempotencia y fallo de lectura. El ticket solapado [`3cfaa66d-73fe-8141-8b74-e24313982e04`](https://www.notion.so/3cfaa66d73fe81418b74e24313982e04) figura Verified | **Parcialmente resuelto; no cerrar como duplicado íntegro**. El original pide además >1.000 feedbacks y schema drift, no demostrados por esta suite. Reutilizar lo existente y completar esos criterios; el ticket Verified tampoco demuestra por su etiqueta cada prueba exigida |
| [`3ceaa66d-73fe-81a8-8033-dcf3343f4278`](https://www.notion.so/3ceaa66d73fe81a88033dcf3343f4278), supuesto path incorrecto del scheduler | `src/server/routes/adminJobs.ts:26` define `/aggregate-ai-feedback`; `server.ts:806` monta `/api/admin/jobs`; `.github/workflows/deploy.yml:434-437` coincide. El mount distinto del test aislado no prueba un 404 productivo | **Premisa refutada en código**. Falta test que relacione deploy con el mount productivo y comprobar URL desplegada, autenticación y ejecución del scheduler antes de cerrar su alcance operativo |
| [`3ceaa66d-73fe-8176-add7-fdbf74f3c4e2`](https://www.notion.so/3ceaa66d73fe8176add7fdbf74f3c4e2), `runRetentionSweep` contradice ADR 0024 | `src/server/jobs/runRetentionSweep.ts:209-216` protege audit logs, pero `:230-232` todavía ejecuta `doc.ref.delete()` para otros registros; el ADR prohíbe borrado discrecional | **Brecha vigente en código; no descartar ni cerrar**. Trazar callers y exposición productiva, impedir purga masiva conforme al ADR y añadir regresión. No ejecutar el job contra datos reales ni inventar una política alternativa sin decisión autorizada |
| Backup/restore en E14 | Existen exportación/importación en `scripts/backup-firestore.cjs` y `scripts/restore-firestore.cjs`, runbook y validador con tests | **Implementación presente; evidencia operativa pendiente**. Ejecutar un drill autorizado en staging, medir restauración/integridad y recién acreditar RPO/RTO. No ejecutar restore de producción desde esta revisión |

Pruebas realizadas sobre archivos equivalentes a la base del plan:

```text
npx --no-install vitest run src/server/jobs/aggregateAiFeedback.test.ts src/__tests__/server/adminJobs.test.ts --reporter=dot
Test Files  2 passed (2)
Tests       7 passed (7)

node scripts/validate-scheduler-crons.cjs
SCHEDULER_CRONS=PASS (4 vital jobs validated)

node --test scripts/verify-firestore-restore.test.cjs
# tests 3
# pass 3
# fail 0
```

No son pruebas de despliegue, de restauración cloud ni E2E de toda la aplicación.
No extrapolar esta muestra a los 734 pendientes; sí demuestra por qué la reconciliación
puede ahorrar implementación innecesaria.

### 4. Método de ejecución: completar recorridos, sin recortar funciones

**Unidad de trabajo = una capacidad y su recorrido demostrable**, no una pantalla ni un
número de ticket. Para cada capacidad conservar: identificador actual de catálogo/Notion,
usuario/rol, entrada UI/API/nativa, servicio, persistencia/tenant, trabajo offline,
recuperación, salida útil, prueba, PR/SHA, evidencia de entorno y limitación vigente.

Clasificarla como: **verificada en el entorno requerido**, **implementada sin evidencia
suficiente**, **integración incompleta**, **defecto reproducido**, **dependencia externa**,
**especificación desactualizada/duplicada** o **sin investigar**. Esta clasificación se
anota en tickets existentes; no sustituye sus estados ni crea una segunda lista ejecutable.

Orden de trabajo por dependencia y riesgo, **no orden de exclusión del lanzamiento**:

| Frente del plan existente | Aprovechar primero | Criterio de salida para la aplicación completa |
|---|---|---|
| R0 — Reconciliar alcance y conocimiento | WP históricos, Notion, `FEATURE_REGISTRY.yaml`, `READINESS_MATRIX.md`, navegación, Graphify y bóveda | Toda capacidad conocida tiene ticket/evidencia y recorrido; duplicados y cancelaciones preservan su capacidad en un ticket canónico. Ningún tier decide un recorte automático |
| R1 — Base ejecutable y datos | Capacitor/proyecto Android existente y smoke documentado; backend, identidad, roles/proyectos y seed | Build reproducible identificado; sesión real; datos persistentes aislados por tenant; DNS/TLS/pinning, APIs y proveedores comprobados. Separar configuración/coste externo de cambio de código |
| R2 — Vida-safety | SOS, man-down, trabajador solitario, alertas, brigadas, evacuación, mesh y outbox existentes | Evento real → recepción → acción → confirmación/reintento; offline, permisos denegados, Doze, reinicio, pantalla apagada y varios dispositivos BLE. Nunca bloquear protección por pago ni usar datos simulados como protección real |
| R3 — Prevención y operación | IPER/EPP/controles, PTS/LOTO, cuadrillas, inspecciones, sustancias y riesgos ambientales | Riesgo detectado → medida/responsable → evidencia → seguimiento; recalcular con datos reales y demostrar permisos, sincronización e historial |
| R4 — Incidentes y aprendizaje | Investigación/PDCA, acciones, lecciones, cápsulas, capacitación, mentoría y Zettelkasten | Incidente → investigación → acción → lección/capacitación → evaluación → conocimiento reutilizado. Evitar doble captura y vínculos solo decorativos |
| R5 — Salud y cumplimiento | TMERT/PREXOR/PLANESI/CEAL-SM, HealthVault, CPHS/SUSESO, custodia y firma | Recorrido autorizado, privacidad y trazabilidad; exportación/firma verificable; retención conforme al ADR. No acreditar cumplimiento legal solo por tener un formulario |
| R6 — IA, gemelo digital y AR | Servicios, modelos, OCR, conocimiento, escena/paneles y fuentes IoT/wearables existentes | Datos reales autorizados → inferencia/escena → resultado útil/explicable; límites y degradación explícitos. Conectar paneles a trabajadores/equipos/sensores sin inventar mediciones ni eliminar la función |
| R7 — Gestión e integraciones | ERP/Drive/SSO, pagos y demás proveedores prometidos | Credenciales/entorno correctos, operación real, idempotencia, errores/reintentos y salida verificable; ningún sandbox presentado como producción |
| R8 — Operación sostenida | Jobs, scheduler, observabilidad, backup/restore y runbooks existentes | Drill staging, alertas útiles, métricas, ejecución autenticada de jobs, recuperación y rollback demostrados. Evidencia de operación además del wiring |
| R9 — Validación Android y publicación completa | Contratos móviles, artefactos previos y scripts del proyecto | Matriz real de dispositivos/entornos, AAB firmado y trazable, permisos/requisitos Play vigentes, privacidad y todas las capacidades reconciliadas. Publicación es una acción posterior autorizada, no una consecuencia automática de este plan |

**Paralelización:** investigar/reconciliar verticales independientes a la vez; código en
worktrees aislados y contratos compartidos coordinados. Implementación, verificación e
integración son pasos separados. No poner varios agentes a modificar el mismo servicio.

### 5. Primer tramo concreto y gates de cierre

1. Reconciliar los tickets de la muestra anterior y los PRs integrados contra sus
   criterios completos. Empezar por trabajo ya realizado; no crear duplicados.
2. Actualizar el catálogo existente para enlazar **todas** las familias funcionales,
   incluidos tiers C/D que el snapshot A/B no enumera. Auditar cancelaciones para asegurar
   que no se perdió una capacidad prometida. La actualización de este plan no reetiqueta
   en masa el catálogo ni afirma haber completado esa conciliación. Su opción histórica
   de retirar funciones no rige este plan. El YAML presenta un error de sintaxis previo
   (`name: [P1] ...` sin comillas); repararlo y validar el registro completo antes de
   usarlo como entrada automatizada. Esta revisión no modificó dicho snapshot.
3. Reproducir el smoke Android con nuevo hash/commit/entorno, preparar cuenta de prueba
   y datos autorizados y recorrer primero un flujo vital y uno de operación persistente.
   Esa selección es una secuencia de pruebas, **no un MVP recortado**.
4. Atacar el primer fallo real de cada recorrido con reproducción → test rojo → fix mínimo
   preservando capacidades → test verde → PR → CI → merge normal cuando esté verde/clean.
5. Tras el merge, revalidar en el entorno exigido, enlazar evidencia a Notion y bóveda y
   cerrar únicamente los criterios satisfechos. No cerrar un ticket amplio con un fix menor.

**Gate de lanzamiento completo:** todos los pendientes de Alpha 41 deben reconciliarse y
quedar resueltos con evidencia bajo el contrato de Daniel; los cancelados no se cuentan
como implementados y no pueden ocultar funciones retiradas. Además deben pasar los
recorridos funcionales y las pruebas Android/operativas requeridas. Con **734 activos en
el corte actual: NO está acreditado el lanzamiento completo**. Esto no expresa cuánto
software falta escribir ni invalida los avances existentes.

No se asignan fechas, horas ahorradas ni un porcentaje «listo» hasta medir los recorridos.
El progreso se comunicará por capacidad demostrada, integración completada, defecto
resuelto y deuda documental reconciliada, manteniendo separada la incertidumbre.

### 6. Fuentes y continuidad

- Bóveda: `01-Guardian/01-MOC-INDEX/00-MOC-Guardian-Maestro.md` y
  `Ledger-Cobertura-Codigo-Guardian.{md,csv}`; investigaciones citadas arriba.
- Evidencia reproducible de esta revisión:
  `C:/Users/Usuario/guardian-review-2026-09-05/plan-coverage-evidence.json`,
  `plan-live-ticket-samples.json`, `notion-snapshot.json`, `notion-counts.json` y
  `reconcile_plan_evidence.py`. Son artefactos de auditoría, no un backlog nuevo.
- [Registro funcional existente](guardian/FEATURE_REGISTRY.yaml),
  [matriz existente](readiness/READINESS_MATRIX.md),
  [ADR 0024](architecture-decisions/0024-retention-by-default-no-discretionary-deletion.md),
  [runbook de recuperación](../DR_RUNBOOK.md).
- La revisión `REVISION-GUARDIAN-ANDROID.md` del 05–06-sep se complementa con esta
  actualización: no sustituye las investigaciones históricas ni certifica totalidad.

---

## Histórico preservado — diagnóstico y paquetes de junio de 2026

> **▶ Actualización 2026-06-19 (APROBADO — ejecución en curso).** Tras auditar la ola
> MiMo (#1000+) + 2 auditorías externas (40k LOC), el fundador aprobó el plan end-to-end
> de 6 fases: **F0** consolidar conocimiento (este commit) · **F1** cerrar ola MiMo
> (14 PRs limpios + 3 mounts fantasma + 4 cascarones + CPHS) · **F2** fortalecer CI
> (reglas #23 render-ratchet / #24 scope-gate + coverage-gate) · **F3** tests E2E a
> estándar (un-fixme 3 specs vida-safety, seed helpers, des-mockear Gemini) · **F4**
> vida-safety nativo (iOS mesh >512B, proximity plugin, DTE firma, WebAuthn E2E) · **F5**
> limpieza ponytail (~2.170 LOC). Pendiente vivo en `docs/PENDIENTE.md` §2026-06-19.
> Flujo MiMo corregido: specs concretos + Claude merge-gate (ver CLAUDE.md "Active work").
> Las fases de abajo (Track A/B/C) siguen vigentes y se mapean dentro de F1-F5.

> **Estado: BORRADOR consolidado para revisar juntos.** No es compromiso de ejecución.
> **Norte del fundador:** hacer real la aplicación **entera** — nada que finje funcionar.
> No es "elegir 3 módulos de un vertical" (eso fue una lectura del 1er informe que NO es la intención).
> Consolida **3 fuentes**, todas reconciliadas contra HEAD posterior a #965:
> 1. **Inventario sistemático** (workflow 8 lentes, 93 hallazgos verificados file:line contra HEAD actual) — backbone.
> 2. **Informe MimoClaw** (verificado vs #955; deuda P0-P3 + arquitectura/seguridad/UX con esfuerzo) — Track C.
> 3. **Review "perspectiva"** (encuadre estratégico módulo×módulo) — ya absorbido en los WP.
> Supersede el borrador `PROPUESTA-POST-REVIEW-2026-06-17.md`. Al aprobarse, se vuelca a `PHASE5-REMEDIATION.md`.

---

## 0. Reconciliación de las 3 fuentes (qué aportó cada una · qué estaba stale)

- **Coinciden y es la verdad:** la app **es real en sus flujos core** (SOS, evacuación, incidentes, ergonomía, IPER, facturación, capacitación, cumplimiento-CL) — no es prototipo. P0-vida = 0 abiertos.
- **Lo que el inventario encontró y los informes NO** (porque miraron flujos, no superficie completa): **~140 componentes huérfanos + ~100 hooks `use*` huérfanos** (features enteros construidos: engine+API+hook+componente, sin montar en página); **144 tests `router.stack` + 66 routers sin cobertura conductual + ~15 tests mock-the-SUT** (código que *parece* testeado y no lo está); **datos falsos aún vivos** (GamifiedHUD CO/HP como vitales, "Simular IoT" inyecta evento Gemini al pipeline real sin tag, Digital-Twin 4 trabajadores default alimentan la ruta de evacuación, chips verdes "EPP Detectado").
- **Stale / ya resuelto (excluido del plan):** PDCA→ZK edges (incidentFlow.ts:89/91 createEdge real — #957 lo confirmó); mesh BLE GATT signing; REBA auto-medida; SloErrorBudget Math.sin; root_cause_analyses rules; RiskNodeMarkers tenant bug; + los 10 PRs de hoy (#956-#965: zone-entry, circadiano, survival-breadcrumb, SOS-parallel, DTE-retry, emergency-a11y, Ley-Karin-SLA, weeklyDigest…).
- **Reconciliaciones de contradicción:**
  - **Tier-gating:** ambos informes dicen "report-only por defecto" — **impreciso**. El middleware `requireTier.ts:82` default-ea a **enforce** (`enforce !== false`). Real = auditar call-sites montados con `enforce:false` (fase-1 rollout) y flipearlos; NO un flip global (ADR 0021: vida nunca gated).
  - **WebAuthn stubs en compliance builders (MimoClaw P2.8):** el marcador `STUB_REPLACE_WITH_WEBAUTHN_ASSERTION` **ya no aparece** en HEAD → probablemente resuelto post-#955 (vía #937). El inventario sí halló un hueco análogo real: `dteSigner.test.ts` deja pasar una **firma falsa** (WP-L14a) — ese es el riesgo vivo.
  - **SII:** ambos correctos — `bsale` es real; `openfactura/simpleapi/libredte` son stubs que tiran `NotImplemented`; en prod fail-closes a `noop` (un DTE no-emitido nunca se ve emitido). Acción = decidir bsale-only vs implementar otro (WP-L1).

---

## 1. Track A — Cierre de deuda hygiene (ya en curso · yo ejecuto, sin decisión tuya)

6 bloques verificados (workflow previo), 1 PR c/u, TDD + review en el sensible. Cierran el backlog de mejoras a 23/23:
`N16 jsPDF dynamic · N15 ExecutiveDashboard useMemo · N6mural comentarios/kebab/like · N13 N+1 sweep · N18 Settings toggles→/security-shield · N7b2d cron MRR + regla b2d_mrr_snapshots (review)`.

---

## 2. Track B — Hacer Real Toda la App (63 paquetes · 6 fases) — **esto revisamos juntos**

Tags: **[P]** prioridad (vida>legal>integridad>ux/perf>release) · **[D]** dependencia (none/credencial/hardware/decisión) · **[E]** esfuerzo (S≤0.5d, M≤2d, L>2d).

### FASE 0 — Emergencias de honestidad (datos fabricados en superficies de seguridad) · **primero**
Pequeños, máximo impacto de confianza. *Un número de CO o trabajadores inventados en una pantalla de seguridad es la mentira más peligrosa de la app.*
- **WP-V1** Matar trabajadores/maquinaria default del Digital-Twin (`twinStateMapper.ts:11-39`) [vida·none·S] — raíz; también limpia la ruta de evacuación.
- **WP-V2** Gatear ruta de evacuación a fuente de trabajadores REAL (`Evacuation.tsx:143`) [vida·none·M] (dep WP-V1).
- **WP-I1** GamifiedHUD CO/HP: quitar el juego de gas de Telemetry prod o drivear de `telemetry_events` reales + badge "simulación" [integridad·none·M].
- **WP-I2** "Simular IoT": taggear `simulated:true` en origen; gas-gate + `triggerEmergency` ignoran simulados; arreglar 401 tragado [integridad·none·M].
- **WP-I7** EPP color detector: chips con % confianza + tier + disclaimer "no es certificación" [integridad·none·S].
- **WP-U3** PortableCurriculum: construir lista real desde `audit_logs` + **quitar "próximamente"** [ux·none·M].

### FASE 1 — Cableado de vida + reglas + crons de vida
- **WP-V3** Montar `LoneWorkerAdminPanel` + `EmergencyBrigadePanel` (punto ciego del supervisor) [vida·none·S].
- **WP-V4** Wire del event-bus + A2 fatiga→soft-block (recomendar, no bloquear) + A6 handover→pre-turno [vida·none·M].
- **WP-V5** C5 adjuntar DEA/refugio más cercano al payload de escalación lone-worker [vida·none·S].
- **WP-V6** VectorialEvacuationMap: reemplazar plano falso por `site_geometry` real [vida·none·M].
- **WP-V7** Calendar pre-warn: reemplazar 8 loaders no-op por Firestore real (`maintenance.ts:201-212`) [vida·none·M].
- **WP-V10** Priorización de cola de sync offline (emergencia>incidente>médico>…) [vida·none·S].
- **WP-V11** Montar `LineOfFireValidationCard` + reword bloqueo→recomendación [vida·none·M].
- **WP-L3** Regla `site_book_counters` + preferible folio server-side `runTransaction` (secuencia legal DS44 hoy forjable) [legal·none·S· **review rules**].
- **WP-L4** Provisionar cron `daily-housekeeping` en deploy.yml (hoy expiry/recordatorios legales NO corren) [legal·scheduler·S· **review deploy**].
- **WP-I12** `commute_sessions`: quitar write cliente, enrutar por `/api/commute` [integridad·none·S· **review rules**].

### FASE 2 — Correctitud legal + tests legales huecos
- **WP-L1** Decisión SII: lock a bsale O implementar openfactura (quitar adapters que tiran) [legal·decisión+credencial·M-L].
- **WP-L5** Consolidar generador PDF DIAT (susesoCertificate vs diatPdfRenderer) [legal·none·M].
- **WP-L6** Dashboard de ciclo de vida/vencimientos de EPP [legal·none·M].
- **WP-L7** Montar `HazmatStorageManager` (DS 43/2016) + C4 OCR→HDS feed [legal·none·M-L].
- **WP-L8** Pre-calificación de contratistas: persistir + `ContractorRankingTable` + acreditación (recomendar) [legal·none·L].
- **WP-L9** B2 incidente→DIAT prellenada + reloj legal (generar doc, **nunca push SUSESO**) [legal·none·L].
- **WP-L10** LTIFR/TRIR en ExecutiveDashboard + motor de tendencia real [legal·dato horas-hombre·M].
- **WP-L11** A4 firma de permiso lee currículum portátil verificado (no bool del cliente) [legal·none·M].
- **WP-L12** Widget "exámenes ocupacionales vencidos/próximos" en Dashboard [legal·none·S].
- **WP-L13** `ConfidentialReportInbox` Ley Karin: una sola fuente (montar o borrar) [legal·decisión·S].
- **WP-L14** Tests legales huecos: (a) `dteSigner` firma falsa debe fallar [**review crypto**]; (b) `auditCoverage` extraer 7 handlers de server.ts a routers reales; (c) consolidar CPHS; (d) decisión MOC orphan-half [legal·none·L].

### FASE 3 — Integridad: consolidaciones, aristas, tests honestos
- **WP-I3** Montar `PredictiveAlertsList` + test conductual [integridad·none·S].
- **WP-I4** incidentFlow cluster vs IncidentReport canónico (cerrar loop Consolidación) [integridad·decisión·L].
- **WP-I5** C2 excepciones-repetidas→MOC (regla R13) + cron consistency-audit [integridad·scheduler·M].
- **WP-I6** C7 cierre-proyecto→ranking proveedores auto-feed [integridad·none·M].
- **WP-I8** Consolidar event-store (×3→1) preservando snapshot+replay [integridad·none·M].
- **WP-I9** Consolidar Coach IA (legacy `coachBackend` → `coach/` + SLM fallback) [integridad·none·M].
- **WP-I10/U1** Glosario: 1 fuente (`glossaryEngine`), reemplazar HOC roto + 2 parsers [integridad/ux·none·M].
- **WP-I11** Tests reimplementados→routers reales: webauthnVerify, mercadoPagoIpn, telemetryCanonical, coachChatTenant, externalAuditPortal, iotDeviceRegister, hazmat, visitors, backlinks [integridad·none·L· **review crypto/payments**].
- **WP-I13** 8 tests "contrato" Gemini → conductuales (prompt + JSON-parse fallback) [integridad·none·M].
- **WP-I14** ZK materializer assert-vs-title + SLM proxy + DR dry-run + telemetry tautologías [integridad·none·S-M].
- **WP-I15** Provisionar crons: aggregate-ai-feedback, consolidateZettelkasten, run-consistency-audit [integridad·scheduler·M].
- **WP-I16** Reconciliar 9 páginas duplicate-orphan + RiskMatrix5x5 (montar el rico o borrar el inline) [integridad·none·L].
- **WP-V8** Supertest conductual routers de VIDA primero (evacuation/refuges/fatigue/predictive/qrAck/routing…) [vida·none·L].
- **WP-V9** Des-fixme 3 e2e de seguridad (sos-button, process-lifecycle, offline-resilience) [vida·none·L].
- **WP-I17** ⭐ **Gate knip/ts-unused-exports** (ratchet huérfanos→0, whitelist hooks API-only) — **corre AL FINAL**, bloquea regresión de todo lo montado [integridad·none·M].

### FASE 4 — UX/perf: surfaceo, dashboards, consolidación IA
- **WP-U2** WeatherBulletin AQI real (Open-Meteo air-quality) o "sin dato" [ux·endpoint·M].
- **WP-U4** TierDowngradeModal archive/export real [ux·none·M].
- **WP-U5** Montar SafetyMetrics/SPI dashboards [ux·none·M].
- **WP-U6** EvacuationStatusBoard: confirmar supersesión y borrar [ux·none·S].
- **WP-U7** Montar huérfanos conocimiento/training/QA (KnowledgeBase, SpacedRepetition, LightningTrainingPlayer, 5S) [ux·none·L].
- **WP-U8** Montar tarjetas legal/compliance huérfanas (LegalObligation, NonConformity, ResidualRisk, RACI, ISO45001) [legal/ux·none·L].
- **WP-U9** Montar ShiftHandover orphan-half [ux·none·S].
- **WP-U10** C6 SunTracker→factores pre-turno [ux·none·M].
- **WP-U11** Consolidar subsistema Driving (4 páginas + 2 dirs) [ux·decisión·L].
- **WP-U12** Risk hub: modelo de riesgo compartido para 7 dirs fragmentados (consolidación, preservar engines) [ux·decisión·L].
- **WP-U13** Panel "Costo del Riesgo" operacional (Heinrich + ROI sobre datos reales) [ux·campo directCost·M].

### FASE 5 — Release/enhancement + gate
- **WP-R4** Montar widgets monetización/PYME (ROICalculator, TierComparator, Pyme onboarding) [release·none·L].
- **WP-R5** Consolidar SUSESO monthlyReport vs clientReporting [release·none·M].
- **WP-R3** Crons aggregate-ai-feedback + b2d-mrr (con WP-I15) [release·scheduler·S].

### FASE 6 — Needs-founder / external (listados, NO abandonados; en paralelo según lleguen insumos)
- **WP-L2** Secretos Bsale + certificación SII → enciende DTE real (sin código) [credencial+cert].
- **WP-R1** Adapters ERP SAP/Buk/Talana [credencial cliente].
- **WP-R2** capacitor-mesh Wi-Fi Direct [hardware multi-device].
- **WP-X1** Observability GCP/Prometheus (Sentry ya es real) [decisión].
- **WP-X2** Vertex Trainer (tombstone descartado) [decisión+budget].
- **WP-X3** Gemma 2 2B SHA-256 pin (Qwen es el default real) [token HF].
- **WP-X4** CAD DWG converter deploy (DXF ya anda on-device) [infra].
- **WP-X5** Proximity sensor native bridge [hardware].
- **WP-X6** wisdomCapsules: feature viva (agregar writer) vs superseded (borrar) [decisión].
- **WP-X7** 3D twin path + dual-write `incidents` (revisión de integridad DS67) [decisión].

---

## 3. Track C — Deuda técnica / arquitectura (de MimoClaw · ortogonal a "no-real")
Estos NO son "fake vs real" sino calidad/arquitectura/seguridad — los integro para no dejarlos afuera. Se intercalan entre fases (o como su propio frente):
- **Arquitectura:** A1 completar split `server.ts` (1552 LOC/222 mounts → routers) · A2 componer middleware `verifyAuth+assertProjectMember` (×218) en wrapper · A3 versionado `/api/v1/` · A4 lógica-de-negocio en componentes→servicios.
- **Robustez/perf (MimoClaw P2):** `as any` ×18 en `KnowledgeGraph.tsx` · virtualización KG >1k nodos (react-window+worker) · code-splitting eager (KG/Site25D/PortableCurriculum) · **background triggers `Promise.all` sin límite → p-limit** (`backgroundTriggers.ts`) · Stryker CI crash Windows · seeds determinísticos (8 archivos).
- **Seguridad (MimoClaw S):** CSP nonce dinámico (regex frágil) · evaluar WAF.
- **UX (MimoClaw U):** onboarding wizard (backend existe, falta UI — solapa con WP-U7/R4) · banner offline persistente.
- **Limpieza (MimoClaw P3):** 214 branches sin fusionar · ~40 .md en raíz→docs/ · console.log `runWithGuardrails.ts` · @ts-ignore `SafetyCoach.tsx`.
- **i18n:** expandir es-AR/MX/PE (5-8%) + pt-BR (87%→paridad) — solapa con lanzamiento global.

---

## 4. Totales
- **~63 paquetes Track B** (56 accionables + 7 needs-founder) + **~20 ítems Track C** + 6 bloques Track A.
- **Esfuerzo Track B accionable:** S≈16 · M≈24 · L≈16 (≈216 effort-units; el grueso = montar huérfanos + 66 routers + consolidación 7-dirs).
- **Doable-ahora (sin dependencia externa):** ~48 paquetes Track B (toda la fase vida, casi toda integridad/legal/ux).
- **Bloqueado-externo:** ~15 (credencial: WP-L1/L2/R1/X3 · scheduler-IAM: L4/I5/I15/R3 · hardware: R2/X5 · infra: X4 · datos: U2/L10/U13 son "agregar campo/endpoint", no bloqueo real).

## 5. Las 6 decisiones que son tuyas (gates de negocio/arquitectura)
1. **SII:** bsale-only vs implementar un 2º PSE (WP-L1).
2. **Ley Karin inbox:** montar `ConfidentialReportInbox` vs mantener inline (WP-L13).
3. **incidentFlow:** montar el cluster completo vs consolidar con IncidentReport inline (WP-I4).
4. **Driving:** qué superficie es la de lanzamiento (WP-U11).
5. **Risk hub:** unificar los 7 dirs en una IA (WP-U12).
6. **3D twin / wisdomCapsules:** feature viva vs descartar (WP-X6/X7).

## 6. Mayor riesgo/valor + mandatos de review adversarial
**Top valor (vida×honestidad / legal):** (1) WP-V1/V2 trabajadores fabricados envenenando la ruta de evacuación — **lo más peligroso**; (2) WP-L3 folio libro-de-obras forjable sin regla; (3) WP-L4+I15 crons no provisionados → recordatorios legales/expiry NO corren en prod hoy; (4) WP-L14a/I11 firma falsa que pasa tests verdes.
**Review obligatorio (no merge en una pasada):** rules (WP-L3, WP-I12) · crypto (dteSigner, webauthnVerify) · payments (mercadoPagoIpn, Bsale) · life-safety+directiva no-bloquear (WP-V4/V11, evacuación V2/V6/V7/V8) · deploy (crons L4/I5/I15) · legal (L8/L9/L13) · integridad (WP-I17 ratchet — whitelist o borra código real).

## 7. Orden recomendado de arranque
1. **Ahora:** Track A (hygiene) — en curso.
2. **FASE 0 honestidad** (WP-V1/V2/I1/I2/I7/U3) — chico, máxima confianza, ataca la mentira más peligrosa.
3. **FASE 1 vida** + las reglas/crons legales de vida.
4. Luego FASE 2 (legal) → 3 (integridad, con WP-I17 ratchet al final) → 4 (ux) → 5 (release).
5. Track C se intercala (background-triggers p-limit y CSP-nonce son seguridad temprana; el resto oportunista).
6. FASE 6 / needs-founder en paralelo según tus desbloqueos.

> **Decime qué ajustas** (orden de fases, las 6 decisiones, alcance) y lo vuelvo el plan de ejecución definitivo + lo vuelco a `PHASE5-REMEDIATION.md`. Cero ejecución de Track B hasta tu OK; Track A (hygiene) sigue como deuda autónoma salvo que digas lo contrario.
