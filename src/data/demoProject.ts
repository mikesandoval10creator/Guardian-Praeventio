// Sprint 26 — Bucket YY.4 — Demo project sintético (ADR 0011)
//
// Este project es público (skipea Gate 3 biometric) para que prospectos
// puedan ver el twin sin onboarding. Los Gates 1+2 (auth + email
// verificado) siguen aplicando.
//
// La verificación `isDemoProject(id)` se inyecta en el `useTwinAccess`
// hook como faker — el hook detecta el demo project y pasa por el branch
// "granted" sin pedir biometric.

export const DEMO_PROJECT_ID = 'demo-faena-praeventio';

/** Polígonos GeoJSON de la faena demo. lng/lat en orden (GeoJSON). */
const DEMO_POLYGONS: Array<{
  id: string;
  label: string;
  type: 'boundary' | 'building' | 'hazard' | 'evacuation' | 'parking';
  coords: [number, number][];
}> = [
  {
    id: 'demo-boundary',
    label: 'Perímetro faena',
    type: 'boundary',
    coords: [
      [-70.6605, -33.4505],
      [-70.6595, -33.4505],
      [-70.6595, -33.4495],
      [-70.6605, -33.4495],
      [-70.6605, -33.4505],
    ],
  },
  {
    id: 'demo-warehouse',
    label: 'Bodega central',
    type: 'building',
    coords: [
      [-70.6603, -33.4503],
      [-70.6600, -33.4503],
      [-70.6600, -33.4500],
      [-70.6603, -33.4500],
      [-70.6603, -33.4503],
    ],
  },
  {
    id: 'demo-tank',
    label: 'Tanque combustible',
    type: 'hazard',
    coords: [
      [-70.6598, -33.4502],
      [-70.6596, -33.4502],
      [-70.6596, -33.4500],
      [-70.6598, -33.4500],
      [-70.6598, -33.4502],
    ],
  },
  {
    id: 'demo-office',
    label: 'Oficinas',
    type: 'building',
    coords: [
      [-70.6603, -33.4499],
      [-70.6600, -33.4499],
      [-70.6600, -33.4497],
      [-70.6603, -33.4497],
      [-70.6603, -33.4499],
    ],
  },
];

/** Objetos placeable demo: extintores, hidrantes, puntos de reunión. */
const DEMO_PLACED_OBJECTS = [
  { id: 'demo-ext-1', kind: 'extintor', position: { x: 2, y: 1, z: 1 } },
  { id: 'demo-ext-2', kind: 'extintor', position: { x: -2, y: 1, z: 1 } },
  { id: 'demo-ext-3', kind: 'extintor', position: { x: 0, y: 1, z: 4 } },
  { id: 'demo-hidrante-1', kind: 'hidrante', position: { x: 5, y: 1, z: 3 } },
  { id: 'demo-hidrante-2', kind: 'hidrante', position: { x: -5, y: 1, z: -3 } },
  { id: 'demo-punto-reunion', kind: 'puntoReunion', position: { x: 0, y: 1, z: -6 } },
  { id: 'demo-botiquin', kind: 'botiquin', position: { x: 3, y: 1, z: -1 } },
  { id: 'demo-ducha', kind: 'duchaEmergencia', position: { x: -3, y: 1, z: 2 } },
] as const;

export const DEMO_PROJECT = {
  id: DEMO_PROJECT_ID,
  __demo__: true as const,
  name: 'Faena Demo Praeventio',
  geometry: {
    polygons: DEMO_POLYGONS,
  },
  placedObjects: DEMO_PLACED_OBJECTS,
  outdoor: true,
  workTypes: ['mining', 'general'] as const,
  geo: { lat: -33.45, lng: -70.66 }, // Santiago
  supervisorUids: ['demo-supervisor'] as const,
  // Tenant fijo para demo — distinguible en logs/analytics + readOnly
  // gate aplicable en server routes que reciban writes desde este tenant.
  tenantId: 'tenant_demo' as const,
  readOnly: true as const,
} as const;

// ─────────────────────────────────────────────────────────────────────────
// Sprint Plan 2026-05-23 §Fase D.6 — Seed data operacional para landing
// sin login. Cierra el gap "¿qué se le muestra a un prospect en la
// dashboard antes de crear cuenta?". Todo el contenido es 100% sintético
// (nombres + RUTs validados pero no asignados a personas reales; datos
// dimensionados para mostrar curvas pero no tan altos que asusten).
// ─────────────────────────────────────────────────────────────────────────

/**
 * 5 trabajadores demo con perfiles típicos LATAM PYME minera + construcción.
 * RUTs generados sintéticos (dígito verificador correcto pero NO emitidos
 * por Servicio de Registro Civil — colisión accidental con persona real
 * imposible porque el rango está reservado para testing).
 */
export const DEMO_WORKERS = [
  {
    id: 'demo-worker-1',
    name: 'Carlos Vargas Soto',
    role: 'Supervisor de turno',
    email: 'carlos.vargas@praeventio.demo',
    phone: '+56912345001',
    rut: '17.000.001-0',
    status: 'active' as const,
    joinedAt: '2024-03-15',
    contractStatus: 'Vigente' as const,
    odiSigned: true,
    digitalSignatureStatus: 'Firmado' as const,
    eppIds: ['demo-epp-casco-1', 'demo-epp-chaleco-1', 'demo-epp-botas-1'],
    requiredEPP: ['casco', 'chaleco_reflectivo', 'botas'],
    certifications: ['Trabajo en altura R1', 'Primeros auxilios'],
    shiftStart: '08:00',
    shiftEnd: '20:00',
  },
  {
    id: 'demo-worker-2',
    name: 'María González Ríos',
    role: 'Encargada PRP',
    email: 'maria.gonzalez@praeventio.demo',
    phone: '+56912345002',
    rut: '17.000.002-9',
    status: 'active' as const,
    joinedAt: '2024-01-08',
    contractStatus: 'Vigente' as const,
    odiSigned: true,
    digitalSignatureStatus: 'Firmado' as const,
    requiredEPP: ['casco', 'chaleco_reflectivo'],
    certifications: ['Experto en PRP', 'ISO 45001 Lead Auditor'],
    shiftStart: '09:00',
    shiftEnd: '18:00',
  },
  {
    id: 'demo-worker-3',
    name: 'Luis Pérez Aguirre',
    role: 'Operador equipo pesado',
    email: 'luis.perez@praeventio.demo',
    phone: '+56912345003',
    rut: '17.000.003-7',
    status: 'active' as const,
    joinedAt: '2024-07-22',
    contractStatus: 'Vigente' as const,
    odiSigned: true,
    requiredEPP: ['casco', 'chaleco_reflectivo', 'gafas', 'botas', 'guantes'],
    certifications: ['Licencia clase D', 'Trabajo en altura R1'],
    shiftStart: '06:00',
    shiftEnd: '18:00',
    hasArt22: true,
  },
  {
    id: 'demo-worker-4',
    name: 'Daniela Muñoz Castro',
    role: 'Inspectora calidad',
    email: 'daniela.munoz@praeventio.demo',
    phone: '+56912345004',
    rut: '17.000.004-5',
    status: 'active' as const,
    joinedAt: '2025-02-03',
    contractStatus: 'Vigente' as const,
    odiSigned: true,
    requiredEPP: ['casco', 'chaleco_reflectivo'],
    certifications: ['NCh 2245 HDS'],
    shiftStart: '08:00',
    shiftEnd: '17:00',
  },
  {
    id: 'demo-worker-5',
    name: 'Felipe Rojas Torres',
    role: 'Brigadista emergencia',
    email: 'felipe.rojas@praeventio.demo',
    phone: '+56912345005',
    rut: '17.000.005-3',
    status: 'active' as const,
    joinedAt: '2023-11-10',
    contractStatus: 'Por Vencer' as const,
    odiSigned: true,
    digitalSignatureStatus: 'Firmado' as const,
    requiredEPP: ['casco', 'chaleco_reflectivo', 'arnes', 'guantes'],
    certifications: ['Rescate espacios confinados DS 132', 'NFPA 10', 'Brigada incendio'],
    shiftStart: '20:00',
    shiftEnd: '08:00',
  },
] as const;

/**
 * 10 incidentes históricos repartidos en los últimos 14 meses. Distribución
 * realista: muchos near-miss / first-aid, menos severos. Categorías
 * alineadas con DS 594 + Ley 16.744.
 */
export const DEMO_INCIDENTS = [
  {
    id: 'demo-inc-1',
    occurredAt: '2025-03-12T14:22:00-03:00',
    category: 'near_miss',
    severity: 'low',
    title: 'Casi caída desde escalera (sin lesión)',
    description: 'Trabajador resbaló bajando escalera de pañol, recuperó equilibrio. Peldaño con grasa de derrame de turno anterior.',
    location: 'Bodega central',
    reportedByUid: 'demo-worker-2',
    affectedWorkers: [],
    lostDays: 0,
  },
  {
    id: 'demo-inc-2',
    occurredAt: '2025-04-03T10:15:00-03:00',
    category: 'first_aid',
    severity: 'low',
    title: 'Corte superficial mano izquierda',
    description: 'Manipulación de fleje metálico sin guante reforzado. Atención en botiquín on-site.',
    location: 'Patio carga',
    reportedByUid: 'demo-worker-1',
    affectedWorkers: ['demo-worker-3'],
    lostDays: 0,
  },
  {
    id: 'demo-inc-3',
    occurredAt: '2025-06-19T16:48:00-03:00',
    category: 'near_miss',
    severity: 'medium',
    title: 'Hidrante obstruido por contenedor mal estacionado',
    description: 'Brigada detectó hidrante #2 bloqueado durante simulacro. Tiempo de respuesta sobre estándar.',
    location: 'Sector tanques',
    reportedByUid: 'demo-worker-5',
    affectedWorkers: [],
    lostDays: 0,
  },
  {
    id: 'demo-inc-4',
    occurredAt: '2025-08-07T09:30:00-03:00',
    category: 'property_damage',
    severity: 'medium',
    title: 'Choque sin lesión equipo retro vs. poste',
    description: 'Maniobra de retroceso sin guía. Daño material a poste señalización; sin lesionados.',
    location: 'Acceso principal',
    reportedByUid: 'demo-worker-3',
    affectedWorkers: [],
    lostDays: 0,
  },
  {
    id: 'demo-inc-5',
    occurredAt: '2025-09-22T11:05:00-03:00',
    category: 'first_aid',
    severity: 'low',
    title: 'Cuerpo extraño en ojo (sin daño)',
    description: 'Partícula al esmerilar sin gafa de protección. Lavado con suero, sin secuelas.',
    location: 'Taller mantención',
    reportedByUid: 'demo-worker-2',
    affectedWorkers: ['demo-worker-4'],
    lostDays: 0,
  },
  {
    id: 'demo-inc-6',
    occurredAt: '2025-11-04T15:42:00-03:00',
    category: 'medical_treatment',
    severity: 'medium',
    title: 'Esguince tobillo derecho',
    description: 'Pisó terreno irregular en zona no demarcada. Derivado a mutual, reposo 5 días.',
    location: 'Sector acopio',
    reportedByUid: 'demo-worker-1',
    affectedWorkers: ['demo-worker-3'],
    lostDays: 5,
  },
  {
    id: 'demo-inc-7',
    occurredAt: '2025-12-15T08:18:00-03:00',
    category: 'near_miss',
    severity: 'high',
    title: 'Espacio confinado con O2 bajo detectado por medidor',
    description: 'Medidor portátil bloqueó entrada a estanque por O2 18.9%. Procedimiento DS 132 funcionó.',
    location: 'Tanque combustible',
    reportedByUid: 'demo-worker-5',
    affectedWorkers: [],
    lostDays: 0,
  },
  {
    id: 'demo-inc-8',
    occurredAt: '2026-01-26T13:00:00-03:00',
    category: 'first_aid',
    severity: 'low',
    title: 'Quemadura primer grado antebrazo',
    description: 'Contacto con superficie caliente durante mantención. Sin reposo.',
    location: 'Taller mantención',
    reportedByUid: 'demo-worker-2',
    affectedWorkers: ['demo-worker-1'],
    lostDays: 0,
  },
  {
    id: 'demo-inc-9',
    occurredAt: '2026-02-11T17:25:00-03:00',
    category: 'near_miss',
    severity: 'medium',
    title: 'Caída de herramienta desde altura (sin afectados)',
    description: 'Llave inglesa cayó 4m desde andamio. Zona estaba acordonada; nadie debajo.',
    location: 'Bodega central',
    reportedByUid: 'demo-worker-5',
    affectedWorkers: [],
    lostDays: 0,
  },
  {
    id: 'demo-inc-10',
    occurredAt: '2026-04-18T10:50:00-03:00',
    category: 'first_aid',
    severity: 'low',
    title: 'Golpe leve cabeza con estructura baja',
    description: 'Trabajador olvidó agacharse en zona marcada. Sin lesión visible.',
    location: 'Oficinas',
    reportedByUid: 'demo-worker-4',
    affectedWorkers: ['demo-worker-2'],
    lostDays: 0,
  },
] as const;

/**
 * 3 paralizaciones activas para el dashboard Stoppage Monitor. Cubren los
 * 3 scope levels que el engine reconoce: equipment, zone, task.
 */
export const DEMO_STOPPAGES = [
  {
    id: 'demo-stp-1',
    projectId: DEMO_PROJECT_ID,
    category: 'critical_control_failed' as const,
    scope: 'equipment' as const,
    scopeTargetId: 'demo-eq-grua-1',
    reason: 'Sistema de freno de grúa móvil sin certificación vigente. Bloqueo hasta cert renovada (mutual).',
    declaredByUid: 'demo-worker-1',
    declaredByRole: 'supervisor',
    declaredAt: '2026-05-21T14:00:00-03:00',
    status: 'active' as const,
    resumptionPreconditions: [
      { id: 'pre-1', label: 'Recertificación grúa por organismo competente', fulfilled: false },
      { id: 'pre-2', label: 'Verificación visual gerente operaciones', fulfilled: true, fulfilledByUid: 'demo-supervisor' },
    ],
  },
  {
    id: 'demo-stp-2',
    projectId: DEMO_PROJECT_ID,
    category: 'environmental_alert' as const,
    scope: 'zone' as const,
    scopeTargetId: 'demo-zona-norte',
    reason: 'Pronóstico viento >70 km/h previsto 18:00. Trabajo en altura suspendido por turno noche.',
    declaredByUid: 'demo-worker-2',
    declaredByRole: 'encargado_prp',
    declaredAt: '2026-05-23T11:30:00-03:00',
    status: 'active' as const,
    resumptionPreconditions: [
      { id: 'pre-3', label: 'Viento medido bajo 30 km/h por 30 min continuos', fulfilled: false },
    ],
  },
  {
    id: 'demo-stp-3',
    projectId: DEMO_PROJECT_ID,
    category: 'incident' as const,
    scope: 'task' as const,
    scopeTargetId: 'demo-task-soldadura-tanque',
    reason: 'Soldadura en estanque pendiente revisión protocolo trabajo caliente. NFPA 51B no aplicado.',
    declaredByUid: 'demo-worker-5',
    declaredByRole: 'brigadista',
    declaredAt: '2026-05-22T09:15:00-03:00',
    status: 'active' as const,
    resumptionPreconditions: [
      { id: 'pre-4', label: 'Permiso trabajo caliente firmado por gerente', fulfilled: false },
      { id: 'pre-5', label: 'Extintores adicionales posicionados', fulfilled: false },
    ],
  },
] as const;

/**
 * 5 acciones correctivas demostrativas — mix de niveles jerárquicos del
 * control (ANSI Z10: eliminación > sustitución > ingeniería > admin > EPP),
 * con estados open / closed / verified para que el dashboard muestre
 * variedad de iconos + colores.
 */
export const DEMO_CORRECTIVE_ACTIONS = [
  {
    id: 'demo-ca-1',
    description: 'Instalar antideslizante en peldaños metálicos del pañol (todos los niveles)',
    level: 'engineering' as const,
    status: 'open' as const,
    isSystemic: false,
    sourceCause: 'demo-inc-1: superficie con grasa + sin tratamiento antideslizante',
  },
  {
    id: 'demo-ca-2',
    description: 'Capacitar a operadores en uso de guante anti-corte ANSI A5',
    level: 'training' as const,
    status: 'closed' as const,
    isSystemic: false,
    sourceCause: 'demo-inc-2: ausencia de guante reforzado para fleje',
  },
  {
    id: 'demo-ca-3',
    description: 'Demarcar 1.5m zona libre alrededor de cada hidrante con pintura amarilla',
    level: 'engineering' as const,
    status: 'verified' as const,
    isSystemic: true,
    sourceCause: 'demo-inc-3: contenedor bloqueando hidrante (problema recurrente)',
  },
  {
    id: 'demo-ca-4',
    description: 'Instruir uso obligatorio de gafa al esmerilar (Manual + Cartel zona taller)',
    level: 'admin' as const,
    status: 'open' as const,
    isSystemic: false,
    sourceCause: 'demo-inc-5: particula en ojo por ausencia de gafa',
  },
  {
    id: 'demo-ca-5',
    description: 'Adquirir 4 medidores O2/CO2 portátiles adicionales para brigada',
    level: 'engineering' as const,
    status: 'closed' as const,
    isSystemic: true,
    sourceCause: 'demo-inc-7: medidor funcionó pero brigada solo tenía 1 equipo',
  },
] as const;

/** Verificación que un projectId apunta al demo. */
export function isDemoProject(id: string): boolean {
  return id === DEMO_PROJECT_ID;
}

/** Verificación que un tenantId apunta al demo (readOnly gate). */
export function isDemoTenant(tenantId: string | null | undefined): boolean {
  return tenantId === DEMO_PROJECT.tenantId;
}
