export enum RiskCategory {
  FISICO = 'Físico',
  QUIMICO = 'Químico',
  BIOLOGICO = 'Biológico',
  ERGONOMICO = 'Ergonómico',
  PSICOSOCIAL = 'Psicosocial',
  SEGURIDAD = 'Seguridad',
}

export enum NodeType {
  WORKER = 'Trabajador',
  MACHINE = 'Máquina',
  RISK = 'Riesgo',
  NORMATIVE = 'Normativa',
  EPP = 'EPP',
  INSPECTION = 'Inspección',
  INCIDENT = 'Incidente',
  COST = 'Costo',
  REPORT = 'Informe',
  TASK = 'Tarea',
  DOCUMENT = 'Documento',
  HYGIENE = 'Higiene',
  MEDICINE = 'Medicina',
  ERGONOMICS = 'Ergonomía',
  PSYCHOSOCIAL = 'Psicosocial',
  FINDING = 'Hallazgo',
  AUDIT = 'Auditoría',
  PROJECT = 'Proyecto',
  EMERGENCY = 'Emergencia',
  ASSET = 'Activo',
  TRAINING = 'Capacitación',
  ATTENDANCE = 'Asistencia',
  SAFE_ZONE = 'Zona de Seguridad',
  CONTROL = 'Control',
}

export interface RiskNode {
  id: string;
  type: NodeType;
  title: string;
  description: string;
  tags: string[];
  metadata: Record<string, any>;
  connections: string[]; // IDs of connected nodes
  projectId?: string;
  isPublic?: boolean;
  createdAt: string;
  updatedAt: string;
  embedding?: number[];
  isPendingSync?: boolean;
}

export interface WeatherData {
  temp: number;
  condition: string;
  humidity: number;
  uv: number;
  /**
   * Air Quality Index label. `null` means no AQI source available
   * for these coordinates — UI must surface "Datos no disponibles"
   * instead of substituting a fake value.
   */
  airQuality: string | null;
  /**
   * Elevation (m). `null` means the geocoding/elevation API is not
   * wired — render an honest empty state, not a synthesized number.
   */
  altitude: number | null;
  location: string;
  recommendations: string[];
  windSpeed?: number;
  sunrise?: number;
  sunset?: number;
}

export interface SeismicData {
  magnitude: number;
  location: string;
  time: number;
  depth: number;
  alertLevel: 'green' | 'yellow' | 'orange' | 'red';
  url?: string;
}

export interface EnvironmentContext {
  weather: WeatherData | null;
  seismic: SeismicData | null;
  earthquakes?: any[];
  lastUpdated: number;
}

export interface EPPItem {
  id: string;
  projectId: string;
  name: string;
  category: string;
  description: string;
  imageUrl: string;
  required: boolean;
  stock: number;
  createdAt: string;
  ispCertification?: string; // Certificación del Instituto de Salud Pública (ISP)
  expirationDate?: string;   // Fecha de vencimiento del lote
}

export interface EPPAssignment {
  id: string;
  projectId: string;
  workerId: string;
  workerName: string;
  eppItemId: string;
  eppItemName: string;
  assignedAt: string;
  expiresAt?: string;
  status: 'active' | 'replaced' | 'expired';
  condition?: 'Nuevo' | 'Bueno' | 'Desgastado' | 'Dañado';
}

export interface Worker {
  id: string;
  name: string;
  role: string;
  email: string;
  phone?: string;
  photoUrl?: string;
  status: 'active' | 'inactive';
  joinedAt: string;
  projectId?: string;
  nodeId?: string;
  eppIds?: string[];
  requiredEPP?: string[];
  coordinates?: { lat: number; lng: number }; // Added for SiteMap
  medicalClearanceDate?: string; // Added for Access Control
  certifications?: string[]; // Added for Access Control
  contractStatus?: 'Vigente' | 'Vencido' | 'Por Vencer';
  odiSigned?: boolean;
  digitalSignatureStatus?: 'Firmado' | 'Pendiente' | 'Rechazado';
  hasArt22?: boolean; // Artículo 22 (24/7 tracking)
  shiftStart?: string;
  shiftEnd?: string;
}

export interface TrainingSession {
  id: string;
  title: string;
  description?: string;
  date: string;
  duration: number;
  status: 'scheduled' | 'completed';
  attendees: string[];
  projectId?: string;
  youtubeUrl?: string;
  points?: number;
  isCurated?: boolean; // If true, it's in the global library
}

export interface SafetyPost {
  id: string;
  userId: string;
  userName: string;
  userPhoto?: string;
  content: string;
  type: 'SafetyMoment' | 'Tip' | 'SuccessStory' | 'Warning';
  imageUrl?: string;
  likes: string[]; // User IDs
  comments: {
    userId: string;
    userName: string;
    text: string;
    createdAt: string;
  }[];
  createdAt: string;
  projectId?: string;
  riskNodeId?: string;
}

export interface SafetySolution {
  id: string;
  title: string;
  problem: string;
  solution: string;
  successRate: number; // 0-100
  implementations: number;
  tags: string[];
  createdAt: string;
  createdBy: string;
}

export interface UserStats {
  userId: string;
  userName: string;
  userPhoto?: string;
  points: number;
  completedTrainings: number;
  safetyPosts: number;
  rank: number;
}

export interface Asset {
  id: string;
  name: string;
  type: 'Maquinaria' | 'Vehículo' | 'Herramienta';
  status: 'Operativo' | 'En Mantenimiento' | 'Fuera de Servicio';
  lastMaintenance?: string;
  nextMaintenance?: string;
  operatorId?: string;
  projectId: string;
  createdAt: string;
  coordinates?: { lat: number; lng: number }; // Added for SiteMap
  isPendingSync?: boolean;
}
