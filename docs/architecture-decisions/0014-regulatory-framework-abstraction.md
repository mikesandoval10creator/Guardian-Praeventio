# ADR 0014 — Regulatory Framework Abstraction (ISO 45001 baseline + jurisdictional adapters)

Status: **accepted**
Date: 2026-05-05
Aplica a: módulo normativo, compliance multi-país, citas regulatorias en
features HSE, expansión global Sprint 28+

## Contexto

La aplicación nació en Chile y todo el módulo normativo está acoplado a
regulación chilena: `bcnKnowledgeBase.ts` carga DS 54, DS 109, DS 594,
NCh, Ley 16.744; `NormativeContext.tsx` asume ese vocabulario; los
componentes HSE citan referencias chilenas en string literal.

Para lanzar globalmente necesitamos que la app:

1. Opere en cualquier país sin que el usuario reciba citas a normas que
   no le aplican.
2. Mantenga un **contrato mínimo universal** que asegure que ningún
   control HSE se "pierde" al cambiar de jurisdicción.
3. Permita añadir países nuevos sin tocar features ni romper la versión
   chilena ya validada.

ISO 45001:2018 es el estándar internacional de sistemas de gestión SST
adoptado por todos los países priorizados. Sirve como denominador común.

## Decisión

**ISO 45001 es el contrato mínimo universal; cada país añade requisitos
más estrictos cuando aplican.** La capa regulatoria expone:

- Un catálogo de `ComplianceControl` indexado por ID estable
  (`PPE_HEAD_PROTECTION`, `WORKER_PARTICIPATION`, etc.) anclado a una
  cláusula ISO 45001.
- Un mapeo por jurisdicción que añade `RegulationRef` locales sobre el
  mismo control.
- Un registry que, dado un `tenantOrCountry`, devuelve siempre
  `['ISO-45001', countrySpecific?]` y compone las citas.

Las features existentes que llaman al módulo chileno SIGUEN funcionando
sin cambios. La nueva capa convive en `src/services/regulatory/`. El
wire global (que las features lean del registry) queda para Sprint 29.

### Jurisdicciones priorizadas (orden de roll-out)

1. **ISO 45001** — baseline universal (siempre activa).
2. **Chile (CL)** — paridad con lo existente.
3. **US OSHA** — mercado prioritario por volumen.
4. **EU (Directiva 89/391/CEE)** — bloque grande, marco unificado.
5. **México (NOM-019-STPS)** — expansión LATAM natural.
6. **Brasil (NRs)** — mercado grande con regulación muy específica
   (NR-1, NR-7, NR-9, NR-15, NR-17, NR-35).
7. **UK (HSE)** — post-Brexit, separado de EU.
8. **Canadá (CCOHS)** — federal + provincial.
9. **Australia (WHS Act)** — model law nacional armonizada.

Sprint 28 carga ISO 45001 + Chile + US OSHA + EU + México + Brasil. UK,
CA y AU quedan como stubs vacíos en sprints siguientes.

### Mapeo: cada control HSE cita 1+ regulación por jurisdicción activa

```
ComplianceControl
├── id: 'PPE_HEAD_PROTECTION'
├── iso45001Clause: '8.1' (control operacional)
└── references: [
    { code: 'ISO-45001:8.1', jurisdiction: 'ISO-45001' },   ← siempre
    { code: 'DS-594', jurisdiction: 'CL' },                  ← si CL activa
    { code: 'OSHA-1910.135', jurisdiction: 'US-OSHA' },      ← si US activa
    { code: 'NOM-115-STPS', jurisdiction: 'MX' },            ← si MX activa
  ]
```

`getReferencesForControl(controlId, ['ISO-45001', 'CL'])` filtra y
devuelve solo las dos primeras.

### Filosofía explícita

**ISO 45001 es el contrato mínimo universal; cada país añade requisitos
más estrictos cuando aplican.** Si un país no tiene mapeo para un
control, la cita ISO 45001 sigue siendo válida y suficiente para que la
feature funcione legalmente en ese país (al menos como mejor práctica
internacional). Esto evita que la app "se quede muda" en países sin
adapter aún.

## Implementación

### Archivos

- `src/services/regulatory/types.ts` — `JurisdictionCode`,
  `RegulationRef`, `ComplianceControl`.
- `src/services/regulatory/iso45001.ts` — catálogo baseline (~10
  controles fundamentales).
- `src/services/regulatory/jurisdictions/cl.ts` — adaptador Chile.
- `src/services/regulatory/jurisdictions/us-osha.ts` — adaptador US.
- `src/services/regulatory/jurisdictions/eu.ts` — adaptador EU.
- `src/services/regulatory/jurisdictions/mx.ts` — adaptador México.
- `src/services/regulatory/jurisdictions/br.ts` — adaptador Brasil.
- `src/services/regulatory/registry.ts` — orchestrator + `cite()`.
- `src/services/regulatory/registry.test.ts` — 10+ tests.

### Reglas

- NO se toca `bcnKnowledgeBase.ts`.
- NO se toca `NormativeContext.tsx`.
- Las features chilenas existentes siguen llamando al módulo chileno
  vigente.
- La nueva capa es aditiva. El wire (features → registry) llega en
  Sprint 29.

## Consecuencias

### Operacionales

- Añadir un país nuevo = un archivo nuevo bajo `jurisdictions/` + entry
  en `registry.ts`. Sin tocar features.
- Lanzamientos por país no requieren branch features especiales.

### Legales

- ISO 45001 actúa como red de seguridad: incluso en un país sin adapter,
  la app cita un estándar internacional reconocido.
- Las citas locales (DS 54, OSHA 1910.132, NR-9, etc.) aparecen solo en
  la jurisdicción que aplica → no se confunde al usuario.

### Técnicas

- Tipo discriminado `JurisdictionCode` permite `switch` exhaustivos.
- Catálogo ISO 45001 estable; controles son IDs simbólicos (no strings
  libres) → refactor seguro.

## Coherencia con ADRs anteriores

- **ADR 0012** (HealthVault sin diagnóstico): el módulo médico cita
  Ley 16.744 / Ley 20.584 hoy; con esta capa se pueden mapear esos
  controles a HIPAA (US), GDPR art. 9 (EU), LFPDPPP (MX), LGPD (BR)
  cuando llegue Sprint 29.
- **ADR 0010 / 0011** (privacy-by-design): los `RegulationRef` de datos
  personales (Ley 21.719 CL, GDPR EU, CCPA US, LGPD BR) entran como
  controles independientes del módulo HSE puro.

## Referencias

- ISO 45001:2018 — Occupational health and safety management systems
- DS 54 / DS 594 / DS 109 / Ley 16.744 (Chile)
- 29 CFR 1910 (US OSHA)
- Directiva 89/391/CEE (EU framework)
- NOM-019-STPS, NOM-002-STPS, NOM-017-STPS, NOM-035-STPS (México)
- NR-1, NR-5, NR-7, NR-9, NR-15, NR-17, NR-35 (Brasil)

## Decisión final

**ISO 45001 es el contrato mínimo universal. Cada país suma requisitos
más estrictos cuando aplican. La app cita siempre ISO + jurisdicción
activa. Las features existentes en Chile NO se tocan en Sprint 28; el
wire global llega en Sprint 29.**
