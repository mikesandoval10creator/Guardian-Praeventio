// Praeventio Guard — Sprint 39 Fase F.10: Demos sintéticos por industria.
//
// Cierra: Documento usuario "Recomendaciones nuevas §30"
//         Plan integral Fase F.10
//
// Extiende `demoProject.ts` (que tenía solo `demo-faena-praeventio`) con
// demos específicos por industria. Cada demo trae datos realistas para
// que un prospecto pueda evaluar Guardian sin onboarding:
//
//   - Trabajadores con roles típicos
//   - Riesgos identificados del sector
//   - EPP asignado coherente con sector
//   - Capacitaciones con fechas vigentes y vencidas
//   - Incidentes históricos (mix near-miss + reportables)
//
// Cada demo se carga en LocalStorage del navegador (NO toca Firestore)
// hasta que el guest se registre — entonces se migra al tenant del nuevo
// usuario. Esto permite UX "click → ya tengo datos" sin contaminar prod.

export type DemoIndustryId =
  | 'mining'
  | 'construction'
  | 'agriculture'
  | 'transport'
  | 'hospital';

export interface IndustryDemo {
  id: DemoIndustryId;
  /** Slug del proyecto local (key en localStorage). */
  projectSlug: string;
  /** Nombre visible en LandingPage. */
  projectName: string;
  /** Prefijo industria (mapea a EPP_BY_SECTOR). */
  industryPrefix: string;
  /** Descripción corta del escenario (UI tooltip). */
  description: string;
  /** Coords aproximadas para el digital twin (lng, lat). */
  centerCoords: [number, number];
  workers: DemoWorker[];
  risks: DemoRisk[];
  trainings: DemoTraining[];
  incidents: DemoIncident[];
  eppAssignments: DemoEppAssignment[];
}

export interface DemoWorker {
  uid: string;
  fullName: string;
  rut: string;
  role: string;
  startDate: string;
  active: boolean;
}

export interface DemoRisk {
  id: string;
  riskType: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  affectedWorkerUids: string[];
}

export interface DemoTraining {
  id: string;
  course: string;
  workerUid: string;
  takenAt: string;
  validUntil: string; // ISO
  status: 'vigente' | 'vencido';
}

export interface DemoIncident {
  id: string;
  date: string;
  type: 'near_miss' | 'accident' | 'fatal';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  workerUid?: string;
}

export interface DemoEppAssignment {
  id: string;
  workerUid: string;
  itemLabel: string;
  receivedAt: string;
  expiresAt?: string;
  status: 'active' | 'expired';
}

// ────────────────────────────────────────────────────────────────────────
// Catalog
//
// Diseñado para que la suma global muestre: vencimientos + finding
// críticos + vigencias mezcladas — así el semáforo F.2 enseña los 3
// estados sin necesidad de tocar nada.
// ────────────────────────────────────────────────────────────────────────

const ISO_TODAY = '2026-05-11T12:00:00Z';
const ISO_FUT = (days: number) =>
  new Date(Date.parse(ISO_TODAY) + days * 86_400_000).toISOString();
const ISO_PAST = (days: number) => ISO_FUT(-days);

export const INDUSTRY_DEMOS: Record<DemoIndustryId, IndustryDemo> = {
  mining: {
    id: 'mining',
    projectSlug: 'demo-mina-cobre-norte',
    projectName: 'Demo: Mina Cobre Norte (Minería)',
    industryPrefix: 'GP-MIN',
    description: '120 trabajadores · pique vertical 800m · faena con espacios confinados, sílice y maquinaria pesada',
    centerCoords: [-69.32, -22.45],
    workers: [
      { uid: 'demo-min-w1', fullName: 'Carlos Alarcón Fuentes', rut: '12.345.678-9', role: 'Operador Maquinaria', startDate: ISO_PAST(720), active: true },
      { uid: 'demo-min-w2', fullName: 'Lorena Vidal Soto', rut: '13.456.789-0', role: 'Prevencionista', startDate: ISO_PAST(450), active: true },
      { uid: 'demo-min-w3', fullName: 'Juan Pérez Rojas', rut: '14.567.890-1', role: 'Topógrafo subterráneo', startDate: ISO_PAST(180), active: true },
      { uid: 'demo-min-w4', fullName: 'Mariela Castro Lillo', rut: '15.678.901-2', role: 'Geóloga', startDate: ISO_PAST(90), active: true },
    ],
    risks: [
      { id: 'demo-min-r1', riskType: 'silice en polvo respirable', severity: 'high', affectedWorkerUids: ['demo-min-w1', 'demo-min-w3'] },
      { id: 'demo-min-r2', riskType: 'trabajo en espacio confinado', severity: 'critical', affectedWorkerUids: ['demo-min-w3'] },
      { id: 'demo-min-r3', riskType: 'maquinaria pesada en movimiento', severity: 'high', affectedWorkerUids: ['demo-min-w1'] },
      { id: 'demo-min-r4', riskType: 'ruido sobre 85 dB', severity: 'medium', affectedWorkerUids: ['demo-min-w1', 'demo-min-w3'] },
    ],
    trainings: [
      { id: 'demo-min-t1', course: 'espacios_confinados', workerUid: 'demo-min-w3', takenAt: ISO_PAST(365), validUntil: ISO_FUT(0), status: 'vencido' },
      { id: 'demo-min-t2', course: 'exposicion_silice', workerUid: 'demo-min-w1', takenAt: ISO_PAST(180), validUntil: ISO_FUT(180), status: 'vigente' },
      { id: 'demo-min-t3', course: 'rescate_minero', workerUid: 'demo-min-w2', takenAt: ISO_PAST(30), validUntil: ISO_FUT(700), status: 'vigente' },
    ],
    incidents: [
      { id: 'demo-min-i1', date: ISO_PAST(45), type: 'near_miss', severity: 'medium', description: 'Casi-impacto camión extracción con peatón en bocamina', workerUid: 'demo-min-w1' },
      { id: 'demo-min-i2', date: ISO_PAST(120), type: 'accident', severity: 'low', description: 'Esguince tobillo en escalera mina', workerUid: 'demo-min-w3' },
    ],
    eppAssignments: [
      { id: 'demo-min-epp1', workerUid: 'demo-min-w1', itemLabel: 'Respirador gases', receivedAt: ISO_PAST(180), expiresAt: ISO_FUT(180), status: 'active' },
      { id: 'demo-min-epp2', workerUid: 'demo-min-w1', itemLabel: 'Casco minero', receivedAt: ISO_PAST(365), expiresAt: ISO_PAST(10), status: 'active' },
      { id: 'demo-min-epp3', workerUid: 'demo-min-w3', itemLabel: 'Protec. auditivo', receivedAt: ISO_PAST(90), expiresAt: ISO_FUT(275), status: 'active' },
    ],
  },

  construction: {
    id: 'construction',
    projectSlug: 'demo-edif-residencial-las-condes',
    projectName: 'Demo: Edificio Residencial Las Condes (Construcción)',
    industryPrefix: 'GP-CONS',
    description: '45 trabajadores · 12 pisos · andamios + trabajo en altura + subcontratistas eléctricos',
    centerCoords: [-70.5673, -33.4156],
    workers: [
      { uid: 'demo-con-w1', fullName: 'Patricio Henríquez Vergara', rut: '16.789.012-3', role: 'Jefe de Obra', startDate: ISO_PAST(450), active: true },
      { uid: 'demo-con-w2', fullName: 'Roberto Quiroga Bustos', rut: '17.890.123-4', role: 'Maestro Albañil', startDate: ISO_PAST(180), active: true },
      { uid: 'demo-con-w3', fullName: 'Luis Mardones Águila', rut: '18.901.234-5', role: 'Eléctrico (subcontrato)', startDate: ISO_PAST(60), active: true },
    ],
    risks: [
      { id: 'demo-con-r1', riskType: 'trabajo en altura piso 8+', severity: 'critical', affectedWorkerUids: ['demo-con-w2'] },
      { id: 'demo-con-r2', riskType: 'mantenimiento eléctrico baja tensión', severity: 'high', affectedWorkerUids: ['demo-con-w3'] },
      { id: 'demo-con-r3', riskType: 'manejo manual de cargas pesadas', severity: 'medium', affectedWorkerUids: ['demo-con-w2'] },
    ],
    trainings: [
      { id: 'demo-con-t1', course: 'trabajo_altura_r1', workerUid: 'demo-con-w2', takenAt: ISO_PAST(200), validUntil: ISO_FUT(165), status: 'vigente' },
      { id: 'demo-con-t2', course: 'electricidad_baja_tension', workerUid: 'demo-con-w3', takenAt: ISO_PAST(400), validUntil: ISO_PAST(35), status: 'vencido' },
    ],
    incidents: [
      { id: 'demo-con-i1', date: ISO_PAST(15), type: 'near_miss', severity: 'high', description: 'Caída material desde piso 6 sin afectar peatones', workerUid: 'demo-con-w2' },
    ],
    eppAssignments: [
      { id: 'demo-con-epp1', workerUid: 'demo-con-w2', itemLabel: 'Arnés seguridad', receivedAt: ISO_PAST(60), expiresAt: ISO_FUT(305), status: 'active' },
      { id: 'demo-con-epp2', workerUid: 'demo-con-w3', itemLabel: 'Guantes aislantes', receivedAt: ISO_PAST(60), expiresAt: ISO_FUT(25), status: 'active' },
    ],
  },

  agriculture: {
    id: 'agriculture',
    projectSlug: 'demo-vinedo-valle-colchagua',
    projectName: 'Demo: Viñedo Valle de Colchagua (Agricultura)',
    industryPrefix: 'GP-AGR',
    description: '80 trabajadores · vendimia · agroquímicos · exposición UV alta',
    centerCoords: [-71.21, -34.61],
    workers: [
      { uid: 'demo-agr-w1', fullName: 'María Espinoza Cataldo', rut: '19.012.345-6', role: 'Aplicador Agroquímicos', startDate: ISO_PAST(150), active: true },
      { uid: 'demo-agr-w2', fullName: 'José Riveros Bahamondes', rut: '20.123.456-7', role: 'Tractorista', startDate: ISO_PAST(900), active: true },
      { uid: 'demo-agr-w3', fullName: 'Camila Morales Pizarro', rut: '21.234.567-8', role: 'Vendimiadora', startDate: ISO_PAST(40), active: true },
    ],
    risks: [
      { id: 'demo-agr-r1', riskType: 'exposicion uv ocupacional al sol', severity: 'medium', affectedWorkerUids: ['demo-agr-w3'] },
      { id: 'demo-agr-r2', riskType: 'químico aplicación agroquímicos', severity: 'high', affectedWorkerUids: ['demo-agr-w1'] },
    ],
    trainings: [
      { id: 'demo-agr-t1', course: 'hazmat_nivel_1', workerUid: 'demo-agr-w1', takenAt: ISO_PAST(90), validUntil: ISO_FUT(275), status: 'vigente' },
    ],
    incidents: [],
    eppAssignments: [
      { id: 'demo-agr-epp1', workerUid: 'demo-agr-w1', itemLabel: 'Respirador gases', receivedAt: ISO_PAST(30), expiresAt: ISO_FUT(305), status: 'active' },
    ],
  },

  transport: {
    id: 'transport',
    projectSlug: 'demo-flota-camiones-norte',
    projectName: 'Demo: Flota Camiones Norte Grande (Transporte)',
    industryPrefix: 'GP-TRANS',
    description: '35 conductores · ruta minera · turnos nocturnos · fatiga + carga vehicular',
    centerCoords: [-70.40, -23.65],
    workers: [
      { uid: 'demo-tr-w1', fullName: 'Cristián Toro Berríos', rut: '22.345.678-9', role: 'Conductor Senior', startDate: ISO_PAST(1200), active: true },
      { uid: 'demo-tr-w2', fullName: 'Andrea Saavedra Lillo', rut: '23.456.789-0', role: 'Conductora Nocturna', startDate: ISO_PAST(360), active: true },
    ],
    risks: [
      { id: 'demo-tr-r1', riskType: 'fatiga jornada nocturna', severity: 'high', affectedWorkerUids: ['demo-tr-w2'] },
      { id: 'demo-tr-r2', riskType: 'ruido cabina sostenido', severity: 'medium', affectedWorkerUids: ['demo-tr-w1'] },
    ],
    trainings: [
      { id: 'demo-tr-t1', course: 'manejo_defensivo', workerUid: 'demo-tr-w1', takenAt: ISO_PAST(60), validUntil: ISO_FUT(305), status: 'vigente' },
    ],
    incidents: [
      { id: 'demo-tr-i1', date: ISO_PAST(7), type: 'near_miss', severity: 'medium', description: 'Microsueño detectado por sistema fatiga', workerUid: 'demo-tr-w2' },
    ],
    eppAssignments: [
      { id: 'demo-tr-epp1', workerUid: 'demo-tr-w1', itemLabel: 'Chaleco reflectante', receivedAt: ISO_PAST(180), expiresAt: ISO_FUT(540), status: 'active' },
    ],
  },

  hospital: {
    id: 'hospital',
    projectSlug: 'demo-hospital-regional',
    projectName: 'Demo: Hospital Regional (Salud)',
    industryPrefix: 'GP-SAL',
    description: '200 funcionarios · pabellón + UCI · turnos rotativos · riesgo biológico',
    centerCoords: [-73.05, -36.83],
    workers: [
      { uid: 'demo-sal-w1', fullName: 'Dr. Felipe Aravena González', rut: '24.567.890-1', role: 'Médico UCI', startDate: ISO_PAST(2200), active: true },
      { uid: 'demo-sal-w2', fullName: 'Enf. Daniela Cerda Pino', rut: '25.678.901-2', role: 'Enfermera Pabellón', startDate: ISO_PAST(900), active: true },
      { uid: 'demo-sal-w3', fullName: 'TENS Juan Vergara Ríos', rut: '26.789.012-3', role: 'TENS Urgencia', startDate: ISO_PAST(180), active: true },
    ],
    risks: [
      { id: 'demo-sal-r1', riskType: 'biologico exposicion fluidos', severity: 'high', affectedWorkerUids: ['demo-sal-w1', 'demo-sal-w2', 'demo-sal-w3'] },
      { id: 'demo-sal-r2', riskType: 'ergonomico movilización pacientes', severity: 'medium', affectedWorkerUids: ['demo-sal-w2', 'demo-sal-w3'] },
    ],
    trainings: [
      { id: 'demo-sal-t1', course: 'higiene_respiratoria', workerUid: 'demo-sal-w1', takenAt: ISO_PAST(150), validUntil: ISO_FUT(215), status: 'vigente' },
    ],
    incidents: [
      { id: 'demo-sal-i1', date: ISO_PAST(30), type: 'near_miss', severity: 'medium', description: 'Pinchazo accidental con aguja contaminada (PPE evitó)', workerUid: 'demo-sal-w3' },
    ],
    eppAssignments: [
      { id: 'demo-sal-epp1', workerUid: 'demo-sal-w2', itemLabel: 'Mascarilla N95', receivedAt: ISO_PAST(15), expiresAt: ISO_FUT(75), status: 'active' },
    ],
  },
};

export function getDemoByIndustry(id: DemoIndustryId): IndustryDemo {
  return INDUSTRY_DEMOS[id];
}

export function listAvailableIndustries(): Array<{
  id: DemoIndustryId;
  projectName: string;
  description: string;
}> {
  return (Object.keys(INDUSTRY_DEMOS) as DemoIndustryId[]).map((id) => ({
    id,
    projectName: INDUSTRY_DEMOS[id].projectName,
    description: INDUSTRY_DEMOS[id].description,
  }));
}
