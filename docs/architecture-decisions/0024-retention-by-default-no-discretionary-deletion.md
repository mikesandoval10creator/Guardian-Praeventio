# ADR 0024 — Retención por defecto: no eliminar datos de prevención (sin borrado discrecional)

Status: **Accepted** (2026-06-16)
Aplica a: todo dato de prevención que la empresa cliente nos entrega o que la
app genera (incidentes, evaluaciones IPER/ergonómicas, actas CPHS, capacitación,
EPP, telemetría, nodos Zettelkasten, etc.) y a cualquier feature futura que
proponga eliminar, purgar o "depurar" datos a escala.

> Decisión de producto del fundador (sesión 2026-06-16), elevada a ADR. Cierra
> el ítem OLA 2 "retención PII" del plan Phase 5: el resultado es **no construir
> tooling de borrado**, no construir un reaper.

## Contexto

El plan de remediación (OLA 2) listaba un "job de retención PII (reap-expired)".
Al mapear el alcance (Workflow de descubrimiento, 2026-06-16) surgieron dos
hechos:

1. **Casi todo dato de prevención tiene retención legal MÍNIMA, no máxima.**
   DS 594 art. 11 y Ley 16.744 art. 76 obligan a conservar registros de
   seguridad (incidentes, SOS, auditoría) **7 años**. `ley19628.ts:482` ya los
   marca `LEGAL_RETENTION_COLLECTIONS` y la erasura por-usuario los preserva por
   defecto. Solo telemetría (`driving_reports`/`commute_sessions`/`pings`) tiene
   una ventana corta documentada (90 días).
2. **Las ventanas de retención y la decisión purgar/anonimizar son una decisión
   legal (DPO), no un default de ingeniería.**

El fundador planteó además la pregunta de responsabilidad correcta: *"¿qué pasa
legalmente si una empresa hace algo ilegal solo porque la aplicación lo
permite?"* — p. ej. destruir la evidencia de un accidente que la ley obliga a
conservar. Dar esa capacidad nos convierte en el **instrumento** de un acto
potencialmente ilícito.

## Decisión

**Praeventio Guard NO elimina datos de prevención. Retención por defecto.**

No se construye ningún mecanismo de borrado discrecional ni automático de los
datos de la empresa: **ni** un cron/reaper de retención, **ni** un botón de
empresa "eliminar registros", **ni** una recomendación de purga. La app retiene.

La **única** erasura existente y permitida es el **derecho del trabajador
individual** (Ley 19.628 / Ley 21.719 — derecho de supresión/ARCO), y aun esa:

- **ANONIMIZA, no destruye** — `src/server/services/anonymizeUser.ts` mantiene
  el `uid` y los registros, redacta la PII de la persona y escribe una prueba
  inmutable (`anonymization_events`). Quita la *identidad* de la persona; **no
  borra el dato de prevención**.
- **Preserva los registros legalmente obligatorios** —
  `eraseUserData(uid, { keepLegalRecords: true })` (default) conserva
  `audit_logs` / `incidents` / `sos_alerts` 7 años (`ley19628.ts`).

Es decir: incluso el caso legalmente exigido respeta el principio de "no
borrar el dato de prevención".

## Razones

1. **Responsabilidad legal / no ser el instrumento.** Destruir registros de
   seguridad que la ley obliga a conservar (DS 594 art. 11, Ley 16.744) puede
   ser una infracción y, ante un accidente, eliminación de evidencia. Si la app
   *ofrece* esa palanca, podemos quedar como facilitadores. No construirla =
   nunca somos el instrumento. Misma filosofía que ADR 0021 (recomendar, no
   bloquear) y ADR 0022 (generar, no empujar): **la app facilita y recomienda;
   la decisión riesgosa no se le entrega a un click**.
2. **La retención es mayormente OBLIGATORIA por ley.** "Retener por defecto" es,
   por tanto, la postura legalmente segura — no la riesgosa.
3. **El dato es el activo que mejora la prevención (perspectiva de producto).**
   La inteligencia de Praeventio — Zettelkasten, generadores Bernoulli,
   índice predictivo, benchmarks de rubro — **crece con los datos acumulados**.
   Borrar es contraproducente: destruye el activo que genera las oportunidades
   de mejora que constituyen nuestro valor.
4. **Somos encargado de tratamiento, no dueño — pero eso no obliga a dar una
   palanca destructiva.** Gestionamos los datos de la empresa y le devolvemos
   oportunidades de mejora; "no decidir por ellos" no significa darles una
   capacidad de borrado que la ley no exige y que podría usarse mal.

## Consecuencias

- **NO se implementa el reaper de retención** (ni cron, ni report-only orientado
  a borrar). El ítem OLA 2 "retención PII" queda **resuelto por decisión
  deliberada de no-construir**, no por implementación.
- **El motor advisory `src/services/privacyRetention/dataRetentionPolicy.ts` +
  la ruta `privacyRetention.ts` quedan como REFERENCIA documental** (qué
  ventanas legales existen) — puros, sin escrituras, sin nada que actúe
  destructivamente sobre su resultado. No se eliminan, pero tampoco se les
  conecta un ejecutor de borrado.
- **El borrado por-trabajador (anonimización ARCO) se mantiene** (obligación
  legal) — `anonymizeUser` / `eraseUserData(keepLegalRecords:true)`, que ya
  conserva los registros de seguridad. Es el único camino de "supresión".
- **Revisores deben rechazar** cualquier PR que agregue eliminación masiva o
  discrecional de datos de prevención (cron de purga, endpoint de borrado por
  empresa, "depurar antiguos"). La excepción es exclusivamente el derecho de
  supresión individual del trabajador, vía anonimización que preserva lo legal.
- Las reglas Firestore que ya fijan `delete: if false` en colecciones legales
  (incidentes, evaluaciones, actas, evidencia, etc.) refuerzan este ADR a nivel
  de datos — mantenerlas.

## Condiciones de revisión

Este ADR solo se revisa si se cumplen **ambas**:

1. **Una obligación legal explícita de eliminar** — p. ej. una orden judicial
   concreta, o un régimen de un país objetivo (PIPL/152-FZ) que IMPONGA un borrado
   que la anonimización no satisfaga — con el análisis legal resuelto por counsel
   y las ventanas fijadas por el DPO.
2. **Decisión consciente y explícita del fundador**, registrada en un nuevo ADR
   que supersede a este por alcance acotado (qué colección, qué jurisdicción,
   purga vs. anonimización). Este ADR no autoriza borrado de antemano.

Hasta entonces: **retener; anonimizar al trabajador que lo pida conservando los
registros legales; nunca eliminar el dato de prevención.**

## Referencias

- ADR 0021 — Life-safety features free (recomendar, no bloquear): misma filosofía
  de no entregar a un click una decisión de alto riesgo.
- ADR 0022 — Nunca push a APIs externas: la empresa decide y presenta; nosotros
  generamos. Aquí: la empresa conserva; nosotros no destruimos.
- ADR 0012 — Health data sovereignty (no diagnóstico): soberanía del dato.
- `src/services/compliance/ley19628.ts` — `eraseUserData` + `LEGAL_RETENTION_COLLECTIONS`.
- `src/server/services/anonymizeUser.ts` — anonimización que preserva registros.
- Memoria: `project_pii_retention_findings_2026-06-16`.
