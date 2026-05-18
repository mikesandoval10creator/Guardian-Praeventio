// Praeventio Guard — Sprint 39 Fase C.7: Legal docs desde plantilla.
//
// Cierra: Plan Fase C.7 "Documentos legales desde plantilla → Storage
// → nodo DOCUMENT linked".
//
// Plantillas iniciales (Chile):
//   - RIOHS  (Reglamento Interno de Orden, Higiene y Seguridad)
//   - DDR    (Derecho a Saber)
//   - ODI    (Obligación de Informar — riesgos del puesto)
//   - PTS    (Procedimiento de Trabajo Seguro)
//   - CPHS_ACTA (Acta de reunión Comité Paritario)
//
// Cada plantilla:
//   - Define tokens obligatorios (proyecto, empresa, fecha, etc.)
//   - Valida que todos los tokens estén provistos antes de renderizar
//   - Devuelve texto markdown renderizado + lista de citas normativas
//   - El caller pasa el markdown a `pdfkit` / `jspdf` para producir
//     PDF y persistirlo en Storage / nodo DOCUMENT linkeado.
//
// 100% determinístico — sin LLM. Cada plantilla cita la norma legal
// que la justifica; la app NUNCA inventa contenido.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type LegalDocTemplateKind = 'RIOHS' | 'DDR' | 'ODI' | 'PTS' | 'CPHS_ACTA';

export interface LegalDocTemplate {
  kind: LegalDocTemplateKind;
  title: string;
  /** Tokens requeridos en `data` para renderizar. */
  requiredTokens: string[];
  /** Tokens opcionales con valores por defecto. */
  optionalTokens: Record<string, string>;
  /** Cuerpo markdown con placeholders {{token}}. */
  bodyMarkdown: string;
  /** Citas normativas que respaldan la plantilla. */
  legalReferences: string[];
}

// ────────────────────────────────────────────────────────────────────────
// Catalog
// ────────────────────────────────────────────────────────────────────────

const RIOHS_TEMPLATE: LegalDocTemplate = {
  kind: 'RIOHS',
  title: 'Reglamento Interno de Orden, Higiene y Seguridad',
  requiredTokens: ['companyName', 'companyRut', 'projectName', 'date', 'workerCount'],
  optionalTokens: { industry: 'general', cphsRequired: 'sí' },
  bodyMarkdown: `# Reglamento Interno de Orden, Higiene y Seguridad
**Empresa**: {{companyName}} ({{companyRut}})
**Faena**: {{projectName}}
**Fecha**: {{date}}
**Dotación**: {{workerCount}} trabajadores
**Industria**: {{industry}}

## I. Disposiciones generales
El presente Reglamento se dicta en cumplimiento del DS 44/2024 (vigente
desde 2025-02-01, reemplaza al DS 40/1969 derogado) y la Ley 16.744
(art. 67). Es obligatorio para todos los trabajadores de {{companyName}}
en la faena {{projectName}}.

## II. Comité Paritario
**¿Requerido?**: {{cphsRequired}} (DS 54/1969 art. 1 — ≥25 trabajadores).

## III. Obligaciones del trabajador
1. Cumplir las normas de higiene y seguridad.
2. Usar EPP entregado.
3. Informar de inmediato cualquier accidente o condición insegura.
4. Asistir a las charlas obligatorias DDR/ODI.

## IV. Prohibiciones
1. Ingresar al trabajo bajo efectos de alcohol o drogas.
2. Operar maquinaria sin autorización.
3. Retirar dispositivos de seguridad.

## V. Sanciones
Amonestación verbal → escrita → multa (máx. 25% del jornal según
Código del Trabajo art. 157).

## VI. Anexos
- Lista de EPP por puesto.
- Protocolos de emergencia.
- Rutas de evacuación.
`,
  legalReferences: ['DS 44/2024 (reemplaza DS 40/1969 derogado 2025-02-01)', 'Ley 16.744 art. 67', 'DS 54/1969 art. 1', 'Código del Trabajo art. 157'],
};

const DDR_TEMPLATE: LegalDocTemplate = {
  kind: 'DDR',
  title: 'Derecho a Saber',
  requiredTokens: ['workerName', 'workerRut', 'position', 'companyName', 'date'],
  optionalTokens: { industry: 'general', supervisor: '' },
  bodyMarkdown: `# Derecho a Saber (DDR)
**Trabajador**: {{workerName}} ({{workerRut}})
**Cargo**: {{position}}
**Empresa**: {{companyName}}
**Fecha**: {{date}}

En cumplimiento del DS 44/2024 (vigente desde 2025-02-01, reemplaza al
DS 40/1969 derogado) y la Ley 16.744, se informa al trabajador de los
riesgos asociados a su puesto de trabajo, las medidas preventivas y los
procedimientos correctos.

## Riesgos identificados
Ver Matriz IPER vigente del puesto **{{position}}**.

## Medidas preventivas
1. Uso obligatorio del EPP asignado.
2. Cumplimiento de los Procedimientos de Trabajo Seguro (PTS).
3. Reporte inmediato de condiciones inseguras al supervisor {{supervisor}}.

## Acreditación
Firmando el presente documento, el trabajador declara haber recibido
y entendido la información sobre los riesgos de su puesto.

_____________________________
{{workerName}}
{{workerRut}}
`,
  legalReferences: ['DS 44/2024 (reemplaza DS 40/1969 derogado 2025-02-01)', 'Ley 16.744'],
};

const ODI_TEMPLATE: LegalDocTemplate = {
  kind: 'ODI',
  title: 'Obligación de Informar (ODI)',
  requiredTokens: ['workerName', 'workerRut', 'position', 'companyName', 'date', 'specificRisks'],
  optionalTokens: { industry: 'general', supervisor: '' },
  bodyMarkdown: `# Obligación de Informar (ODI)
**Trabajador**: {{workerName}} ({{workerRut}})
**Cargo**: {{position}}
**Empresa**: {{companyName}}
**Fecha**: {{date}}

En cumplimiento de la Ley 16.744 art. 21 y el DS 44/2024 (vigente desde
2025-02-01, reemplaza al DS 40/1969 derogado), se informa al trabajador
de los siguientes riesgos específicos de su puesto:

## Riesgos específicos del puesto
{{specificRisks}}

## Medidas de prevención aplicables
1. EPP correspondiente al riesgo (ver matriz).
2. Capacitación inicial completada.
3. Procedimientos de trabajo seguro entregados.

## Compromiso del trabajador
Declaro haber leído y entendido la información de los riesgos
específicos de mi puesto y comprometo a respetar las medidas
preventivas.

_____________________________
{{workerName}} | {{workerRut}}
`,
  legalReferences: ['Ley 16.744 art. 21', 'DS 44/2024 (reemplaza DS 40/1969 derogado 2025-02-01)'],
};

const PTS_TEMPLATE: LegalDocTemplate = {
  kind: 'PTS',
  title: 'Procedimiento de Trabajo Seguro',
  requiredTokens: ['taskName', 'companyName', 'projectName', 'date', 'steps', 'requiredEpp'],
  optionalTokens: { author: '', criticalControls: '', references: '' },
  bodyMarkdown: `# Procedimiento de Trabajo Seguro
**Tarea**: {{taskName}}
**Empresa**: {{companyName}}
**Faena**: {{projectName}}
**Fecha**: {{date}}
**Elaborado por**: {{author}}

## EPP obligatorio
{{requiredEpp}}

## Controles críticos
{{criticalControls}}

## Pasos
{{steps}}

## Referencias normativas
{{references}}
`,
  legalReferences: ['DS 44/2024 (reemplaza DS 40/1969 derogado 2025-02-01)', 'DS 594/1999', 'Ley 16.744'],
};

const CPHS_ACTA_TEMPLATE: LegalDocTemplate = {
  kind: 'CPHS_ACTA',
  title: 'Acta CPHS — Reunión Mensual',
  requiredTokens: ['meetingDate', 'companyName', 'projectName', 'attendees', 'agenda', 'agreements'],
  optionalTokens: { nextMeetingDate: '' },
  bodyMarkdown: `# Acta de Reunión — Comité Paritario de Higiene y Seguridad
**Fecha**: {{meetingDate}}
**Empresa**: {{companyName}}
**Faena**: {{projectName}}

## Asistentes
{{attendees}}

## Agenda tratada
{{agenda}}

## Acuerdos adoptados
{{agreements}}

## Próxima reunión
{{nextMeetingDate}}

---
Esta acta es exigida por el DS 54/1969 art. 24 y debe conservarse
mínimo 5 años.
`,
  legalReferences: ['DS 54/1969 art. 24', 'Ley 16.744 art. 66'],
};

export const TEMPLATES: Record<LegalDocTemplateKind, LegalDocTemplate> = {
  RIOHS: RIOHS_TEMPLATE,
  DDR: DDR_TEMPLATE,
  ODI: ODI_TEMPLATE,
  PTS: PTS_TEMPLATE,
  CPHS_ACTA: CPHS_ACTA_TEMPLATE,
};

// ────────────────────────────────────────────────────────────────────────
// Validation + render
// ────────────────────────────────────────────────────────────────────────

export interface RenderInput {
  kind: LegalDocTemplateKind;
  data: Record<string, string>;
}

export interface RenderResult {
  ok: boolean;
  markdown?: string;
  references?: string[];
  missingTokens?: string[];
}

export function validateInput(input: RenderInput): { ok: boolean; missingTokens: string[] } {
  const template = TEMPLATES[input.kind];
  if (!template) return { ok: false, missingTokens: ['__unknown_template_kind'] };
  const missing: string[] = [];
  for (const tok of template.requiredTokens) {
    if (!input.data[tok] || input.data[tok].trim().length === 0) {
      missing.push(tok);
    }
  }
  return { ok: missing.length === 0, missingTokens: missing };
}

export function renderLegalDoc(input: RenderInput): RenderResult {
  const validation = validateInput(input);
  if (!validation.ok) {
    return { ok: false, missingTokens: validation.missingTokens };
  }
  const template = TEMPLATES[input.kind];
  const merged = { ...template.optionalTokens, ...input.data };
  let md = template.bodyMarkdown;
  for (const [k, v] of Object.entries(merged)) {
    md = md.split(`{{${k}}}`).join(v);
  }
  // Detect any remaining unsubstituted tokens (optional sin valor → empty)
  // y los reemplazamos por '—' para no dejar {{}} literal en el doc final.
  md = md.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, '—');
  return {
    ok: true,
    markdown: md,
    references: [...template.legalReferences],
  };
}

// ────────────────────────────────────────────────────────────────────────
// Listing
// ────────────────────────────────────────────────────────────────────────

export interface TemplateMeta {
  kind: LegalDocTemplateKind;
  title: string;
  requiredTokenCount: number;
  references: string[];
}

export function listTemplates(): TemplateMeta[] {
  return Object.values(TEMPLATES).map((t) => ({
    kind: t.kind,
    title: t.title,
    requiredTokenCount: t.requiredTokens.length,
    references: [...t.legalReferences],
  }));
}
