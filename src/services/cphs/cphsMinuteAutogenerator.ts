// Praeventio Guard — Sprint 40 Fase F.7: Autogenerador minuta CPHS.
//
// Cierra Plan F.7 "Minuta automática Comité Paritario (mensual,
// borrador estructurado)".
//
// Sin LLM. Toma el "input mensual" del proyecto (incidents del mes,
// acciones pendientes F.4, capacitaciones, inspecciones, score
// semáforo F.2, recomendaciones legalRuleEngine B.10) y produce un
// markdown estructurado que el prevencionista puede aprobar/editar
// antes de firmar.
//
// El motor es 100% determinístico. Después que el equipo apruebe
// el contenido, una pasada Gemini opcional puede mejorar redacción
// (Fase futura — fuera de scope de F.7).

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export interface MonthlyInputs {
  projectId: string;
  /** Período en YYYY-MM. */
  period: string;
  /** Empresa para encabezado. */
  companyName: string;
  /** Eventos relevantes del mes. */
  incidents: Array<{
    id: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    description: string;
    rootCauseKnown: boolean;
  }>;
  /** Acciones correctivas abiertas/cerradas (F.4). */
  correctiveActions: Array<{
    id: string;
    status: 'open' | 'in_progress' | 'closed' | 'verified_effective';
    dueDate?: string;
    label: string;
  }>;
  /** Capacitaciones impartidas. */
  trainingsCompleted: Array<{ title: string; participantsCount: number }>;
  /** Inspecciones realizadas. */
  inspectionsCompleted: number;
  /** Score semáforo cumplimiento (F.2). */
  complianceTrafficLightScore: number;
  /** Recomendaciones del legalRuleEngine (B.10). */
  legalRecommendations: string[];
  /** Asistentes esperados (paritario: trabajadores + empresa). */
  expectedAttendees: string[];
}

export interface MinuteDraft {
  /** Markdown del borrador. */
  markdown: string;
  /** Secciones enumeradas para QA. */
  sections: string[];
  /** Resoluciones sugeridas (basadas en datos). */
  suggestedResolutions: Array<{ text: string; responsibleHint?: string }>;
  /** Score 0-100 de "completitud" del input para alertar al usuario si faltan datos. */
  completenessScore: number;
  /** Métricas para auditoría. */
  metrics: {
    incidentsCount: number;
    criticalIncidentsCount: number;
    openActionsCount: number;
    closedActionsCount: number;
    trainingParticipantsTotal: number;
  };
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function bullets(items: string[]): string {
  if (items.length === 0) return '- _Sin elementos para este período._';
  return items.map((s) => `- ${s}`).join('\n');
}

function trafficColor(score: number): string {
  if (score >= 80) return '🟢 verde';
  if (score >= 60) return '🟡 amarillo';
  return '🔴 rojo';
}

function deriveCompleteness(input: MonthlyInputs): number {
  let score = 0;
  let total = 0;
  const check = (cond: boolean, weight = 10) => {
    total += weight;
    if (cond) score += weight;
  };
  check(input.incidents.length >= 0, 5); // dato presente, aún si 0
  check(input.correctiveActions.length > 0);
  check(input.trainingsCompleted.length > 0);
  check(input.inspectionsCompleted > 0);
  check(input.complianceTrafficLightScore > 0);
  check(input.legalRecommendations.length >= 0, 5);
  check(input.expectedAttendees.length >= 2); // CPHS requires both reps
  check(input.companyName.length > 0);
  return Math.round((score / total) * 100);
}

// ────────────────────────────────────────────────────────────────────────
// Suggested resolutions logic
// ────────────────────────────────────────────────────────────────────────

function suggestResolutions(
  input: MonthlyInputs,
): MinuteDraft['suggestedResolutions'] {
  const out: MinuteDraft['suggestedResolutions'] = [];

  // 1) Incident-driven
  const criticals = input.incidents.filter((i) => i.severity === 'critical' || i.severity === 'high');
  if (criticals.length > 0) {
    out.push({
      text: `Investigación raíz formal para ${criticals.length} incidente(s) de severidad alta/crítica.`,
      responsibleHint: 'prevencionista + supervisor del área',
    });
  }
  const withoutCause = input.incidents.filter((i) => !i.rootCauseKnown);
  if (withoutCause.length > 0) {
    out.push({
      text: `Cerrar análisis causa raíz pendiente: ${withoutCause.length} incidente(s) sin clasificar.`,
    });
  }

  // 2) Action backlog
  const open = input.correctiveActions.filter((a) => a.status !== 'closed' && a.status !== 'verified_effective');
  if (open.length >= 5) {
    out.push({
      text: `Priorizar y reasignar las ${open.length} acciones correctivas abiertas; revisar acumulación.`,
      responsibleHint: 'gerente de operaciones',
    });
  }

  // 3) Compliance traffic light bajo
  if (input.complianceTrafficLightScore < 60) {
    out.push({
      text: `Plan de mejora cumplimiento (semáforo en ${trafficColor(input.complianceTrafficLightScore)}; score ${input.complianceTrafficLightScore}/100).`,
      responsibleHint: 'prevencionista + gerente',
    });
  }

  // 4) Training participation low
  const totalParticipants = input.trainingsCompleted.reduce(
    (sum, t) => sum + t.participantsCount,
    0,
  );
  if (totalParticipants < 5) {
    out.push({
      text: 'Aumentar cobertura de capacitación mensual; participación bajo el mínimo deseable.',
    });
  }

  // 5) Each legal recommendation becomes a resolution candidate
  for (const rec of input.legalRecommendations) {
    out.push({ text: `Implementar: ${rec}` });
  }

  return out;
}

// ────────────────────────────────────────────────────────────────────────
// Main builder
// ────────────────────────────────────────────────────────────────────────

export function buildMonthlyMinuteDraft(input: MonthlyInputs): MinuteDraft {
  const totalParticipants = input.trainingsCompleted.reduce(
    (sum, t) => sum + t.participantsCount,
    0,
  );
  const criticalCount = input.incidents.filter(
    (i) => i.severity === 'critical' || i.severity === 'high',
  ).length;
  const openActions = input.correctiveActions.filter(
    (a) => a.status !== 'closed' && a.status !== 'verified_effective',
  );
  const closedActions = input.correctiveActions.filter(
    (a) => a.status === 'closed' || a.status === 'verified_effective',
  );

  const sections: string[] = [];
  let md = '';

  // Header
  md += `# Acta CPHS — ${input.companyName}\n`;
  md += `**Proyecto**: ${input.projectId}  \n`;
  md += `**Período**: ${input.period}  \n`;
  md += `**Semáforo cumplimiento**: ${trafficColor(input.complianceTrafficLightScore)} (${input.complianceTrafficLightScore}/100)\n\n`;
  sections.push('Encabezado');

  // Asistentes
  md += `## I. Asistentes esperados\n${bullets(input.expectedAttendees)}\n\n`;
  sections.push('Asistentes');

  // Incidentes
  md += `## II. Incidentes del período (${input.incidents.length})\n`;
  if (input.incidents.length === 0) {
    md += '_Sin incidentes registrados durante el período._\n\n';
  } else {
    const lines = input.incidents.map(
      (i) =>
        `- [${i.severity.toUpperCase()}] ${i.description}${
          i.rootCauseKnown ? '' : ' (causa raíz pendiente)'
        }`,
    );
    md += bullets(lines) + '\n\n';
  }
  sections.push('Incidentes');

  // Acciones correctivas
  md += `## III. Acciones correctivas\n`;
  md += `- Abiertas: **${openActions.length}**\n`;
  md += `- Cerradas: **${closedActions.length}**\n\n`;
  if (openActions.length > 0) {
    md += `### Pendientes destacables\n`;
    md += bullets(
      openActions.slice(0, 10).map((a) => `${a.label} (status: ${a.status})`),
    );
    md += '\n\n';
  }
  sections.push('Acciones correctivas');

  // Capacitaciones
  md += `## IV. Capacitaciones impartidas (${input.trainingsCompleted.length})\n`;
  if (input.trainingsCompleted.length === 0) {
    md += '_Sin capacitaciones registradas._\n\n';
  } else {
    md += bullets(
      input.trainingsCompleted.map(
        (t) => `${t.title} — ${t.participantsCount} participantes`,
      ),
    );
    md += `\n**Total participantes**: ${totalParticipants}\n\n`;
  }
  sections.push('Capacitaciones');

  // Inspecciones
  md += `## V. Inspecciones realizadas\n**Total**: ${input.inspectionsCompleted}\n\n`;
  sections.push('Inspecciones');

  // Resoluciones sugeridas
  const suggestedResolutions = suggestResolutions(input);
  md += `## VI. Acuerdos / Resoluciones sugeridas\n`;
  if (suggestedResolutions.length === 0) {
    md += '_Sin resoluciones derivadas automáticamente._\n\n';
  } else {
    md += suggestedResolutions
      .map(
        (r, i) =>
          `${i + 1}. ${r.text}${r.responsibleHint ? ` _(${r.responsibleHint})_` : ''}`,
      )
      .join('\n');
    md += '\n\n';
  }
  sections.push('Acuerdos sugeridos');

  // Recomendaciones normativas
  if (input.legalRecommendations.length > 0) {
    md += `## VII. Cumplimiento normativo destacado\n${bullets(input.legalRecommendations)}\n\n`;
    sections.push('Recomendaciones normativas');
  }

  // Footer
  md += '---\n';
  md += '_Borrador generado por Praeventio Guard (Fase F.7). Editable_';
  md += '_por el CPHS antes de la firma definitiva._\n';

  return {
    markdown: md,
    sections,
    suggestedResolutions,
    completenessScore: deriveCompleteness(input),
    metrics: {
      incidentsCount: input.incidents.length,
      criticalIncidentsCount: criticalCount,
      openActionsCount: openActions.length,
      closedActionsCount: closedActions.length,
      trainingParticipantsTotal: totalParticipants,
    },
  };
}
