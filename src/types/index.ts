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
  FINDING = 'Hallazgo',
  AUDIT = 'Auditoría',
  PROJECT = 'Proyecto',
  EMERGENCY = 'Emergencia',
  ASSET = 'Activo',
}

export interface ZettelkastenNode {
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
}

export interface WeatherData {
  temp: number;
  condition: string;
  humidity: number;
  uv: number;
  airQuality: string;
  altitude: number;
  location: string;
  recommendations: string[];
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
}
