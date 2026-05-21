// Praeventio Guard — §12.1.6: 5 smart actions Proto-1 ausentes en
// useZettelkastenIntelligence.
//
// Patrones canónicos que el motor de inteligencia debe detectar y
// proponer al supervisor cuando el grafo está incompleto:
//
//   1. create-worker-epp-connection — Worker existe sin EPP asignado
//      según matriz Cargo→EPP (DS 594 art. 53)
//   2. suggest-normatives-for-project — Proyecto recién creado sin
//      normativa wireada (Ley 16.744 base + DS sectoriales)
//   3. link-industry-to-project — Proyecto sin industria asignada,
//      detecta del nombre/descripción
//   4. suggest-epp-for-worker — Worker con riesgo pero EPP genérico,
//      sugiere EPP especializado según industry+rol
//   5. auto-link-training-to-worker — Worker recién contratado sin
//      capacitación obligatoria DS 54
//
// Determinístico — sin LLM. Output es lista de acciones sugeridas
// que el supervisor APRUEBA o DESCARTA (regla: nunca auto-aplicar).

export type SmartActionKind =
  | 'create-worker-epp-connection'
  | 'suggest-normatives-for-project'
  | 'link-industry-to-project'
  | 'suggest-epp-for-worker'
  | 'auto-link-training-to-worker';

export interface SmartActionSuggestion {
  /** ID estable de la sugerencia. */
  id: string;
  /** Tipo de smart action. */
  kind: SmartActionKind;
  /** Prioridad alta/media/baja según severidad. */
  priority: 'high' | 'medium' | 'low';
  /** Texto humano para mostrar al supervisor. */
  message: string;
  /** Razón citable (norma chilena cuando aplique). */
  rationale: string;
  /** Nodos afectados (worker/project/epp/etc.). */
  affectedNodes: Array<{ nodeId: string; kind: string }>;
  /**
   * Payload sugerido — si el supervisor aprueba, se ejecuta este
   * conjunto de mutaciones via writeNodesDebounced + auto-promote.
   * Es DRY-RUN — caller decide cuando aplicarlo.
   */
  proposedMutations: ProposedMutation[];
  /** ISO 8601 cuándo se detectó la sugerencia. */
  detectedAt: string;
  /** Confianza 0-1 del matcher. */
  confidence: number;
}

export interface ProposedMutation {
  operation: 'create_node' | 'create_edge' | 'update_node';
  nodeKind?: string;
  nodeId?: string;
  payload?: Record<string, unknown>;
  edgeFromId?: string;
  edgeToId?: string;
  edgeKind?: string;
}

// Mapping cargo → EPP típico (referencial DS 594 + Mutual de Seguridad).
const EPP_BY_CARGO: Record<string, string[]> = {
  operario_construccion: ['helmet', 'boots', 'gloves', 'glasses', 'vest'],
  electricista: ['helmet_dielectric', 'gloves_dielectric', 'boots_dielectric'],
  soldador: ['helmet_welding', 'gloves_leather', 'apron_leather'],
  conductor_vehiculos: ['vest_reflective', 'seatbelt'],
  paramedico: ['gloves_nitrile', 'mask_n95', 'glasses'],
  supervisor: ['helmet', 'vest', 'boots'],
  default: ['helmet', 'boots', 'vest'],
};

// Capacitaciones obligatorias DS 54 art. 21 (derecho a saber).
const MANDATORY_TRAINING = [
  'induccion_general_riesgos',
  'uso_correcto_epp',
  'emergencias_evacuacion',
  'primeros_auxilios_basicos',
];

export interface WorkerNodeData {
  id: string;
  name: string;
  cargo?: string;
  industryHint?: string;
  hireDate?: string;
}

export interface ProjectNodeData {
  id: string;
  name: string;
  description?: string;
  industry?: string;
  countries?: string[];
}

export interface KnowledgeGraphSnapshot {
  workers: WorkerNodeData[];
  projects: ProjectNodeData[];
  /** Map workerId → connected EPP node IDs. */
  workerEppConnections: Map<string, string[]>;
  /** Map workerId → connected training node IDs. */
  workerTrainingConnections: Map<string, string[]>;
  /** Map projectId → normative IDs. */
  projectNormatives: Map<string, string[]>;
}

/**
 * Detecta workers sin EPP base asignado.
 */
export function detectWorkersWithoutEpp(
  snapshot: KnowledgeGraphSnapshot,
  nowIso: string,
): SmartActionSuggestion[] {
  return snapshot.workers
    .filter((w) => {
      const epp = snapshot.workerEppConnections.get(w.id) ?? [];
      return epp.length === 0;
    })
    .map((w, idx): SmartActionSuggestion => {
      const cargoKey = w.cargo?.toLowerCase().replace(/\s+/g, '_') ?? 'default';
      const recommendedEpp = EPP_BY_CARGO[cargoKey] ?? EPP_BY_CARGO.default!;
      return {
        id: `epp-conn-${w.id}-${idx}`,
        kind: 'create-worker-epp-connection',
        priority: 'high',
        message: `${w.name} no tiene EPP asignado en el grafo. Sugiero conectar EPP base por cargo "${w.cargo ?? 'genérico'}".`,
        rationale:
          'DS 594 art. 53: empleador DEBE proporcionar EPP gratuito según riesgo del cargo.',
        affectedNodes: [{ nodeId: w.id, kind: 'worker' }],
        proposedMutations: recommendedEpp.map((eppKind) => ({
          operation: 'create_edge' as const,
          edgeFromId: w.id,
          edgeToId: eppKind,
          edgeKind: 'requires_epp',
        })),
        detectedAt: nowIso,
        confidence: w.cargo ? 0.85 : 0.55, // mayor confianza si tiene cargo
      };
    });
}

/**
 * Detecta proyectos sin normativa wireada.
 */
export function detectProjectsWithoutNormatives(
  snapshot: KnowledgeGraphSnapshot,
  nowIso: string,
): SmartActionSuggestion[] {
  return snapshot.projects
    .filter((p) => {
      const norms = snapshot.projectNormatives.get(p.id) ?? [];
      return norms.length === 0;
    })
    .map((p, idx): SmartActionSuggestion => ({
      id: `norm-${p.id}-${idx}`,
      kind: 'suggest-normatives-for-project',
      priority: 'high',
      message: `Proyecto "${p.name}" sin normativa wireada. Sugiero conectar base Ley 16.744 + DS 44/2024 + sectoriales aplicables.`,
      rationale:
        'Ley 16.744 art. 66 obliga existencia de Reglamento Interno con normativa de prevención mínima.',
      affectedNodes: [{ nodeId: p.id, kind: 'project' }],
      proposedMutations: [
        {
          operation: 'create_edge',
          edgeFromId: p.id,
          edgeToId: 'ley_16744',
          edgeKind: 'applies_normative',
        },
        {
          operation: 'create_edge',
          edgeFromId: p.id,
          edgeToId: 'ds_44_2024',
          edgeKind: 'applies_normative',
        },
        {
          operation: 'create_edge',
          edgeFromId: p.id,
          edgeToId: 'ds_594',
          edgeKind: 'applies_normative',
        },
      ],
      detectedAt: nowIso,
      confidence: 0.95,
    }));
}

/**
 * Detecta proyectos sin industria + sugiere desde nombre/descripción.
 */
export function detectProjectsWithoutIndustry(
  snapshot: KnowledgeGraphSnapshot,
  nowIso: string,
): SmartActionSuggestion[] {
  return snapshot.projects
    .filter((p) => !p.industry)
    .map((p, idx): SmartActionSuggestion => {
      const hint = inferIndustryFromText(`${p.name} ${p.description ?? ''}`);
      return {
        id: `industry-${p.id}-${idx}`,
        kind: 'link-industry-to-project',
        priority: hint ? 'medium' : 'low',
        message: hint
          ? `Proyecto "${p.name}" sin industria asignada. Sugiero "${hint}" según nombre/descripción.`
          : `Proyecto "${p.name}" sin industria. Necesario para reglas IPER + EPP por sector.`,
        rationale:
          'Industria es prerequisito para wire matriz Cargo→EPP + Normativa sectorial + Catalog IPER.',
        affectedNodes: [{ nodeId: p.id, kind: 'project' }],
        proposedMutations: hint
          ? [
              {
                operation: 'update_node',
                nodeId: p.id,
                payload: { industry: hint },
              },
            ]
          : [],
        detectedAt: nowIso,
        confidence: hint ? 0.7 : 0.3,
      };
    });
}

/**
 * Detecta workers recién contratados (<30 días) sin capacitación obligatoria.
 */
export function detectWorkersWithoutMandatoryTraining(
  snapshot: KnowledgeGraphSnapshot,
  nowIso: string,
): SmartActionSuggestion[] {
  const now = Date.parse(nowIso);
  return snapshot.workers
    .filter((w) => {
      if (!w.hireDate) return true; // sin fecha, asumimos potencial gap
      const hire = Date.parse(w.hireDate);
      if (isNaN(hire)) return true;
      const daysSinceHire = (now - hire) / (1000 * 60 * 60 * 24);
      // Workers contratados últimos 30 días Y sin capacitación
      const trainingIds = snapshot.workerTrainingConnections.get(w.id) ?? [];
      const hasMandatory = MANDATORY_TRAINING.every((t) =>
        trainingIds.includes(t),
      );
      return daysSinceHire <= 30 && !hasMandatory;
    })
    .map((w, idx): SmartActionSuggestion => {
      const existing = snapshot.workerTrainingConnections.get(w.id) ?? [];
      const missing = MANDATORY_TRAINING.filter((t) => !existing.includes(t));
      return {
        id: `training-${w.id}-${idx}`,
        kind: 'auto-link-training-to-worker',
        priority: 'high',
        message: `${w.name} (contratado reciente) sin capacitación obligatoria: ${missing.join(', ')}`,
        rationale:
          'DS 54 art. 21 "Derecho a saber": capacitación obligatoria sobre riesgos del puesto antes de iniciar funciones.',
        affectedNodes: [{ nodeId: w.id, kind: 'worker' }],
        proposedMutations: missing.map((t) => ({
          operation: 'create_edge' as const,
          edgeFromId: w.id,
          edgeToId: t,
          edgeKind: 'requires_training',
        })),
        detectedAt: nowIso,
        confidence: 0.9,
      };
    });
}

/**
 * Heurística: infiere industria desde texto del proyecto.
 * Determinístico — no LLM.
 */
function inferIndustryFromText(text: string): string | null {
  const lower = text.toLowerCase();
  const patterns: Array<[RegExp, string]> = [
    [/construc|edificio|obra|inmueble/i, 'GP-CONS-EDI'],
    [/minería|cobre|litio|extracción/i, 'GP-MIN-MET'],
    [/forestal|silvicultura|tala|bosque/i, 'GP-FOR-SILV'],
    [/pesca|acuicultura|salmón|salmon/i, 'GP-PESCA-EXT'],
    [/agroindustrial|frut|cosecha|cultivo/i, 'GP-AGR-FRU'],
    [/transporte|camión|camion|conductor/i, 'GP-TRANS-TER'],
    [/eléctric|electric|generador|distribución/i, 'GP-ELEC-DIST'],
    [/químic|reactor|petroquím/i, 'GP-QUIM-IND'],
    [/papel|celulosa|kraft/i, 'GP-PAPEL-CEL'],
    [/salud|hospital|clínic/i, 'GP-SALUD-HOSP'],
    [/logística|logistica|bodega|warehouse/i, 'GP-LOG-BOD'],
    [/hostel|restaurant|hotel|cocina/i, 'GP-HOSP-TUR'],
    [/educación|educacion|escuel|colegio/i, 'GP-EDU-EST'],
    [/portuari|estiba|grúa pórtico/i, 'GP-PORT-SERV'],
    [/banco|banca|financ|cajero/i, 'GP-FIN-BAN'],
    [/software|tecnolog|programador|devops/i, 'GP-TIC-SOFT'],
  ];
  for (const [re, industry] of patterns) {
    if (re.test(lower)) return industry;
  }
  return null;
}

/**
 * Ejecuta todos los detectores y retorna lista combinada ordenada
 * por prioridad descendente.
 */
export function detectAllSmartActions(
  snapshot: KnowledgeGraphSnapshot,
  nowIso: string,
): SmartActionSuggestion[] {
  const all = [
    ...detectWorkersWithoutEpp(snapshot, nowIso),
    ...detectProjectsWithoutNormatives(snapshot, nowIso),
    ...detectProjectsWithoutIndustry(snapshot, nowIso),
    ...detectWorkersWithoutMandatoryTraining(snapshot, nowIso),
  ];
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  return all.sort(
    (a, b) =>
      priorityOrder[a.priority] - priorityOrder[b.priority] ||
      b.confidence - a.confidence,
  );
}
