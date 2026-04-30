import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { NodeType } from '../types';

interface SeedNode {
  type: NodeType;
  title: string;
  description: string;
  tags: string[];
  block: 'I' | 'II' | 'III' | 'IV' | 'V' | 'VI' | 'VII' | 'VIII';
}

// Template nodes that provide a useful starting scaffold for any OHS project
const SEED_TEMPLATES: SeedNode[] = [
  // Block I — Identification
  { block: 'I', type: NodeType.RISK, title: 'Riesgo Físico General', description: 'Nodo base para riesgos físicos del proyecto (ruido, vibración, temperatura).', tags: ['físico', 'DS594', 'template'] },
  { block: 'I', type: NodeType.RISK, title: 'Riesgo Químico General', description: 'Nodo base para exposición a agentes químicos.', tags: ['químico', 'DS594', 'template'] },
  { block: 'I', type: NodeType.RISK, title: 'Riesgo Psicosocial General', description: 'Nodo base para evaluación ISTAS21 y factores psicosociales.', tags: ['psicosocial', 'ISTAS21', 'template'] },
  { block: 'I', type: NodeType.NORMATIVE, title: 'Ley 16.744', description: 'Ley de Accidentes del Trabajo y Enfermedades Profesionales — base legal del SGSST.', tags: ['legal', 'Ley16744', 'fundamento'] },
  { block: 'I', type: NodeType.NORMATIVE, title: 'DS 594/1999', description: 'Condiciones sanitarias y ambientales básicas. Límites permisibles de exposición.', tags: ['DS594', 'higiene', 'ambiental'] },
  // Block II — Controls
  { block: 'II', type: NodeType.CONTROL, title: 'Control Administrativo Base', description: 'Procedimientos, capacitaciones y señalética como medidas de control.', tags: ['control', 'administrativo', 'template'] },
  { block: 'II', type: NodeType.EPP, title: 'EPP Básico Obra', description: 'Casco, zapatos de seguridad, chaleco reflectante, lentes.', tags: ['EPP', 'obra', 'template'] },
  { block: 'II', type: NodeType.INSPECTION, title: 'Inspección Mensual SST', description: 'Inspección periódica de condiciones de trabajo según DS 594.', tags: ['inspección', 'mensual', 'template'] },
  // Block III — Emergency
  { block: 'III', type: NodeType.EMERGENCY, title: 'Plan de Evacuación General', description: 'Rutas de evacuación, puntos de encuentro y roles de brigada.', tags: ['evacuación', 'emergencia', 'template'] },
  { block: 'III', type: NodeType.SAFE_ZONE, title: 'Punto de Encuentro Principal', description: 'Zona de reunión en caso de emergencia — debe estar a >20m de la faena.', tags: ['zona-segura', 'evacuación', 'template'] },
  // Block IV — Monitoring
  { block: 'IV', type: NodeType.TRAINING, title: 'Inducción de Seguridad', description: 'Capacitación obligatoria de ingreso. Cubre normativa, EPP y procedimientos de emergencia.', tags: ['inducción', 'capacitación', 'ingreso'] },
  { block: 'IV', type: NodeType.AUDIT, title: 'Auditoría ISO 45001 Inicial', description: 'Diagnóstico inicial de brecha vs. ISO 45001 para planificación del SGSST.', tags: ['ISO45001', 'auditoría', 'diagnóstico'] },
  // Block V — Collective Intelligence
  { block: 'V', type: NodeType.LESSON_LEARNED, title: 'Registro de Lecciones Aprendidas', description: 'Nodo central para capturar aprendizajes de incidentes e inspecciones anteriores.', tags: ['lecciones', 'mejora', 'aprendizaje'] },
  { block: 'V', type: NodeType.BEST_PRACTICE, title: 'Buenas Prácticas del Sector', description: 'Prácticas reconocidas por la industria para prevención de riesgos del rubro.', tags: ['buenas-prácticas', 'industria', 'referencia'] },
  // Block VI — Enterprise Ecosystem
  { block: 'VI', type: NodeType.CONTRACTOR, title: 'Gestión de Contratistas', description: 'Requisitos de habilitación SST para empresas contratistas y subcontratistas (Ley 20.123).', tags: ['contratistas', 'subcontrato', 'Ley20123'] },
  { block: 'VI', type: NodeType.SUPPLIER, title: 'Registro de Proveedores SST', description: 'Criterios de evaluación SST para proveedores de EPP y servicios críticos.', tags: ['proveedores', 'adquisición', 'EPP'] },
  // Block VII — Regional / Environmental
  { block: 'VII', type: NodeType.ENVIRONMENTAL_IMPACT, title: 'Impacto Ambiental del Proyecto', description: 'Identificación de aspectos e impactos ambientales asociados a las operaciones.', tags: ['ambiental', 'ISO14001', 'impacto'] },
  // Block VIII — Advanced AI
  { block: 'VIII', type: NodeType.AI_PREDICTION, title: 'Modelo Predictivo de Incidentes', description: 'Nodo de predicción IA basado en historial de telemetría y condiciones ambientales.', tags: ['IA', 'predicción', 'telemetría'] },
  { block: 'VIII', type: NodeType.DIGITAL_TWIN, title: 'Gemelo Digital del Sitio', description: 'Representación digital del sitio para simulación de escenarios de riesgo.', tags: ['gemelo-digital', 'simulación', 'IA'] },
];

export async function seedProjectNodes(projectId: string, userId: string): Promise<number> {
  const col = collection(db, 'nodes');
  const now = new Date().toISOString();
  let seeded = 0;

  for (const template of SEED_TEMPLATES) {
    try {
      await addDoc(col, {
        type: template.type,
        title: template.title,
        description: template.description,
        tags: template.tags,
        projectId,
        connections: [],
        isPublic: false,
        isTemplate: true,
        block: template.block,
        metadata: {
          seededBy: 'nodeSeedService',
          seededAt: now,
          createdBy: userId,
        },
        createdAt: now,
        updatedAt: now,
      });
      seeded++;
    } catch {
      // Non-fatal: continue seeding remaining nodes
    }
  }

  return seeded;
}

export const SEED_COUNT = SEED_TEMPLATES.length;
