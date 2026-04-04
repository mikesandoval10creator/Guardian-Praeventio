import React, { useState, useEffect } from 'react';
import { useParams, Link, Navigate, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { 
  Briefcase, Users, Folder, UserCheck, Calendar, Activity, 
  ShieldAlert, AlertOctagon, AlertTriangle, Shield, Grid, FileText,
  HeartPulse, Droplets, Brain,
  ClipboardCheck, Book, ShieldCheck, ClipboardList, BookOpen,
  Map, Zap, Award, BarChart3, Clock, ArrowLeft, Network, Home,
  TrendingUp, CheckCircle2, Lightbulb, Wrench, AlertCircle, CalendarClock, Loader2, Sparkles, Car
} from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useRiskEngine } from '../hooks/useRiskEngine';
import { generateModuleRecommendations } from '../services/geminiService';

// Define the hub configurations focusing on conditions, equipment, and responsibilities
const hubsData: Record<string, any> = {
  'main': {
    title: 'Principal',
    icon: Home,
    color: 'from-emerald-400 to-emerald-600',
    bgColor: 'bg-emerald-500',
    textColor: 'text-emerald-500',
    description: 'Centro de mando principal. Visión global de condiciones subestándar y estado de la operación.',
    keywords: ['general', 'sistema', 'gestión', 'proyecto', 'ia'],
    getIndustryContext: (industry: string) => `En el rubro de ${industry || 'operaciones generales'}, la visión global permite anticipar fallas sistémicas en los procesos antes de que se conviertan en incidentes.`,
    frequentRisks: ['Falta de orden y aseo en áreas comunes', 'Interacción hombre-máquina', 'Trabajos simultáneos no coordinados'],
    criticalMaintenance: [
      { equipment: 'Servidor Central de Telemetría', status: 'Óptimo', date: 'Al día' },
      { equipment: 'Red de Sensores Ambientales', status: 'Revisión', date: 'Próx. semana' }
    ],
    responsibilities: [
      { task: 'Revisión de Matriz Global', responsible: 'Admin. de Contrato', deadline: 'Fin de mes' }
    ],
    items: [
      { title: 'Red Neuronal', icon: Network, path: '/risk-network', color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
      { title: 'Proyectos', icon: Briefcase, path: '/projects', color: 'text-blue-500', bg: 'bg-blue-500/10' },
      { title: 'AI Hub', icon: Zap, path: '/ai-hub', color: 'text-violet-500', bg: 'bg-violet-500/10' },
      { title: 'Muro', icon: Users, path: '/safety-feed', color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
    ],
    stats: [
      { label: 'Condiciones Subestándar Abiertas', value: '12', icon: AlertTriangle, trend: '-3 esta semana' },
      { label: 'Equipos Críticos Operativos', value: '98%', icon: Wrench, trend: 'Óptimo' }
    ]
  },
  'operations': {
    title: 'Gestión Operativa',
    icon: Briefcase,
    color: 'from-blue-400 to-blue-600',
    bgColor: 'bg-blue-500',
    textColor: 'text-blue-500',
    description: 'Control de áreas de trabajo, estado de maquinaria y coordinación de tareas en terreno.',
    keywords: ['operación', 'terreno', 'maquinaria', 'condición', 'área'],
    getIndustryContext: (industry: string) => `Para ${industry || 'su sector'}, mantener las áreas de trabajo despejadas y la maquinaria calibrada asegura la continuidad y minimiza escenarios inseguros.`,
    frequentRisks: ['Superficies de trabajo irregulares', 'Iluminación deficiente en turno noche', 'Falta de segregación de áreas'],
    criticalMaintenance: [
      { equipment: 'Grúa Horquilla #04', status: 'Pendiente', date: 'Hoy' },
      { equipment: 'Generador Principal', status: 'Programado', date: 'En 3 días' }
    ],
    responsibilities: [
      { task: 'Inspección de pre-uso maquinaria', responsible: 'Supervisores de Turno', deadline: 'Diario 08:00' },
      { task: 'Validación de permisos de trabajo', responsible: 'Jefe de Terreno', deadline: 'Continuo' }
    ],
    items: [
      { title: 'Trabajadores', icon: Users, path: '/workers', color: 'text-violet-500', bg: 'bg-violet-500/10' },
      { title: 'Documentos', icon: Folder, path: '/documents', color: 'text-violet-500', bg: 'bg-violet-500/10' },
      { title: 'Asistencia', icon: UserCheck, path: '/attendance', color: 'text-zinc-400', bg: 'bg-zinc-500/10' },
      { title: 'Calendario', icon: Calendar, path: '/calendar', color: 'text-zinc-400', bg: 'bg-zinc-500/10' },
      { title: 'Telemetría', icon: Activity, path: '/telemetry', color: 'text-zinc-400', bg: 'bg-zinc-500/10' },
      { title: 'Activos', icon: Wrench, path: '/assets', color: 'text-zinc-400', bg: 'bg-zinc-500/10' },
      { title: 'Conducción', icon: Car, path: '/safe-driving', color: 'text-zinc-400', bg: 'bg-zinc-500/10' },
      { title: 'Mapa de Sitio', icon: Map, path: '/site-map', color: 'text-zinc-400', bg: 'bg-zinc-500/10' },
    ],
    stats: [
      { label: 'Áreas Inspeccionadas', value: '8/10', icon: Map, trend: 'Faltan 2' },
      { label: 'Mantenciones Atrasadas', value: '1', icon: Wrench, trend: 'Atención req.' }
    ]
  },
  'risks': {
    title: 'Prevención y Riesgos',
    icon: ShieldAlert,
    color: 'from-violet-400 to-violet-600',
    bgColor: 'bg-violet-500',
    textColor: 'text-violet-500',
    description: 'Identificación de escenarios inseguros, gestión de hallazgos físicos y control de EPP en terreno.',
    keywords: ['riesgo', 'peligro', 'incidente', 'hallazgo', 'epp', 'matriz', 'pts', 'condición'],
    getIndustryContext: (industry: string) => `La gestión de riesgos en ${industry || 'su industria'} requiere identificar proactivamente las condiciones subestándar del entorno antes de que interactúen con el personal.`,
    frequentRisks: ['Trabajos en altura sin líneas de vida certificadas', 'Excavaciones sin entibación', 'Cargas suspendidas'],
    criticalMaintenance: [
      { equipment: 'Líneas de vida Eje Norte', status: 'Vencidas', date: 'Ayer' },
      { equipment: 'Arneses Lote A', status: 'Revisión', date: 'Mañana' }
    ],
    responsibilities: [
      { task: 'Levantamiento de Hallazgos', responsible: 'Comité Paritario', deadline: 'Semanal' },
      { task: 'Actualización PTS Izaje', responsible: 'Prevencionista', deadline: 'Viernes' }
    ],
    items: [
      { title: 'Riesgos', icon: AlertOctagon, path: '/risks', color: 'text-violet-500', bg: 'bg-violet-500/10' },
      { title: 'Hallazgos', icon: AlertTriangle, path: '/findings', color: 'text-amber-500', bg: 'bg-amber-500/10' },
      { title: 'EPP', icon: Shield, path: '/epp', color: 'text-violet-500', bg: 'bg-violet-500/10' },
      { title: 'Matriz', icon: Grid, path: '/matrix', color: 'text-zinc-400', bg: 'bg-zinc-500/10' },
      { title: 'PTS', icon: FileText, path: '/pts', color: 'text-zinc-400', bg: 'bg-zinc-500/10' },
      { title: 'Guardia Predictivo', icon: Zap, path: '/predictive-guard', color: 'text-zinc-400', bg: 'bg-zinc-500/10' },
    ],
    stats: [
      { label: 'Hallazgos Críticos Abiertos', value: '3', icon: AlertTriangle, trend: 'Acción Inmediata' },
      { label: 'EPP por Renovar', value: '14', icon: Shield, trend: 'Próximos 7 días' }
    ]
  },
  'health': {
    title: 'Salud Ocupacional',
    icon: HeartPulse,
    color: 'from-rose-400 to-rose-600',
    bgColor: 'bg-rose-500',
    textColor: 'text-rose-500',
    description: 'Evaluación de puestos de trabajo, control de agentes ambientales (ruido, polvo) y ergonomía del entorno.',
    keywords: ['salud', 'ergonomía', 'psicosocial', 'higiene', 'puesto', 'ruido', 'polvo'],
    getIndustryContext: (industry: string) => `En ${industry || 'su faena'}, el diseño ergonómico de los puestos y el control de agentes físicos (ruido, sílice) son vitales para evitar enfermedades profesionales.`,
    frequentRisks: ['Exposición a ruido > 85dB', 'Puestos con diseño ergonómico deficiente', 'Ventilación inadecuada en espacios confinados'],
    criticalMaintenance: [
      { equipment: 'Extractores de Polvo Nivel 2', status: 'Falla', date: 'Inmediato' },
      { equipment: 'Sonómetros', status: 'Calibración', date: 'Próx. mes' }
    ],
    responsibilities: [
      { task: 'Evaluación TMERT Puesto A', responsible: 'Ergónomo', deadline: 'Jueves' },
      { task: 'Medición de Sílice', responsible: 'Higienista', deadline: 'Programado' }
    ],
    items: [
      { title: 'Higiene', icon: Droplets, path: '/hygiene', color: 'text-zinc-400', bg: 'bg-zinc-500/10' },
      { title: 'Medicina', icon: HeartPulse, path: '/medicine', color: 'text-zinc-400', bg: 'bg-zinc-500/10' },
      { title: 'Ergonomía', icon: UserCheck, path: '/ergonomics', color: 'text-zinc-400', bg: 'bg-zinc-500/10' },
      { title: 'Psicosocial', icon: Brain, path: '/psychosocial', color: 'text-zinc-400', bg: 'bg-zinc-500/10' },
      { title: 'Bio-Análisis', icon: Activity, path: '/bio-analysis', color: 'text-zinc-400', bg: 'bg-zinc-500/10' },
    ],
    stats: [
      { label: 'Puestos Evaluados (Ergonomía)', value: '45/50', icon: UserCheck, trend: '90% Cobertura' },
      { label: 'Agentes Ambientales Fuera de Norma', value: '1', icon: Droplets, trend: 'Ruido Sector B' }
    ]
  },
  'compliance': {
    title: 'Cumplimiento',
    icon: ClipboardCheck,
    color: 'from-amber-400 to-amber-600',
    bgColor: 'bg-amber-500',
    textColor: 'text-amber-500',
    description: 'Control de plazos legales, resoluciones sanitarias y estado de certificaciones de equipos e instalaciones.',
    keywords: ['ley', 'norma', 'decreto', 'auditoría', 'minsal', 'suseso', 'legal', 'plazo'],
    getIndustryContext: (industry: string) => `El control estricto de certificaciones de maquinaria y resoluciones sanitarias protege a su organización en ${industry || 'operaciones'} frente a paralizaciones.`,
    frequentRisks: ['Certificación de grúas vencida', 'Falta de resolución sanitaria de casino', 'Comité Paritario no constituido'],
    criticalMaintenance: [
      { equipment: 'Certificación Ascensores', status: 'Vence pronto', date: 'En 15 días' },
      { equipment: 'Permisos de Calderas', status: 'Al día', date: 'Vigente' }
    ],
    responsibilities: [
      { task: 'Declaración en plataforma SUSESO', responsible: 'Depto. Prevención', deadline: 'Día 15' },
      { task: 'Renovación Resolución Sanitaria', responsible: 'Gerencia', deadline: 'En trámite' }
    ],
    items: [
      { title: 'Normativas', icon: Book, path: '/normatives', color: 'text-zinc-400', bg: 'bg-zinc-500/10' },
      { title: 'Protocolos MINSAL', icon: ShieldCheck, path: '/minsal-protocols', color: 'text-zinc-400', bg: 'bg-zinc-500/10' },
      { title: 'Auditorías', icon: ClipboardList, path: '/audits', color: 'text-zinc-400', bg: 'bg-zinc-500/10' },
      { title: 'Reportes SUSESO', icon: FileText, path: '/suseso', color: 'text-zinc-400', bg: 'bg-zinc-500/10' },
      { title: 'Glosario', icon: BookOpen, path: '/glossary', color: 'text-zinc-400', bg: 'bg-zinc-500/10' },
    ],
    stats: [
      { label: 'Plazos Legales Críticos', value: '2', icon: CalendarClock, trend: 'Vencen este mes' },
      { label: 'Auditorías Pendientes', value: '1', icon: Clock, trend: 'Esta semana' }
    ]
  },
  'emergencies': {
    title: 'Emergencias',
    icon: AlertTriangle,
    color: 'from-red-400 to-red-600',
    bgColor: 'bg-red-500',
    textColor: 'text-red-500',
    description: 'Estado de rutas de evacuación, mantención de extintores y sistemas de extinción de incendios.',
    keywords: ['emergencia', 'evacuación', 'sismo', 'incendio', 'rescate', 'extintor', 'ruta'],
    getIndustryContext: (industry: string) => `En ${industry || 'su instalación'}, mantener las vías de evacuación despejadas y los sistemas contra incendio operativos es la diferencia entre un incidente y una catástrofe.`,
    frequentRisks: ['Rutas de evacuación obstruidas por material', 'Extintores despresurizados', 'Luces de emergencia sin batería'],
    criticalMaintenance: [
      { equipment: 'Red Húmeda Sector Sur', status: 'Falla de presión', date: 'Inmediato' },
      { equipment: 'Extintores P2 y P3', status: 'Recarga', date: 'Esta semana' }
    ],
    responsibilities: [
      { task: 'Prueba de Alarmas', responsible: 'Mantenimiento', deadline: 'Viernes 12:00' },
      { task: 'Inspección de Vías de Escape', responsible: 'Líderes de Emergencia', deadline: 'Diario' }
    ],
    items: [
      { title: 'Emergencia', icon: AlertTriangle, path: '/emergency', color: 'text-rose-500', bg: 'bg-rose-500/10' },
      { title: 'Evacuación', icon: Map, path: '/evacuation', color: 'text-zinc-400', bg: 'bg-zinc-500/10' },
      { title: 'Simulador', icon: Zap, path: '/emergency-generator', color: 'text-zinc-400', bg: 'bg-zinc-500/10' },
    ],
    stats: [
      { label: 'Sistemas Contra Incendio', value: '95%', icon: ShieldCheck, trend: 'Operativos' },
      { label: 'Vías Obstruidas Reportadas', value: '0', icon: Map, trend: 'Despejadas' }
    ]
  },
  'training': {
    title: 'Capacitación',
    icon: BookOpen,
    color: 'from-blue-400 to-blue-600',
    bgColor: 'bg-blue-500',
    textColor: 'text-blue-500',
    description: 'Gestión de competencias, inducciones de sitio (ODI) y entrenamiento sobre procedimientos seguros.',
    keywords: ['capacitación', 'entrenamiento', 'curso', 'aprendizaje', 'odi', 'competencia'],
    getIndustryContext: (industry: string) => `Asegurar que el personal conozca los riesgos específicos de ${industry || 'su sector'} mediante la ODI es una obligación legal y la primera barrera preventiva.`,
    frequentRisks: ['Personal operando equipos sin certificación', 'Inducción ODI vencida o incompleta', 'Desconocimiento de PTS'],
    criticalMaintenance: [
      { equipment: 'Simulador VR de Extintores', status: 'Actualización', date: 'Pendiente' },
      { equipment: 'Plataforma E-learning', status: 'Óptimo', date: 'Al día' }
    ],
    responsibilities: [
      { task: 'Inducción Personal Nuevo', responsible: 'Prevencionista', deadline: 'Lunes 08:00' },
      { task: 'Renovación Certificación Altura', responsible: 'RRHH', deadline: 'En curso' }
    ],
    items: [
      { title: 'Capacitaciones', icon: BookOpen, path: '/training', color: 'text-zinc-400', bg: 'bg-zinc-500/10' },
      { title: 'Gamificación', icon: Award, path: '/gamification', color: 'text-zinc-400', bg: 'bg-zinc-500/10' },
      { title: 'Entrenamiento IA', icon: Zap, path: '/knowledge-ingestion', color: 'text-zinc-400', bg: 'bg-zinc-500/10' },
    ],
    stats: [
      { label: 'Brechas de Competencia', value: '12', icon: AlertCircle, trend: 'Personal sin ODI' },
      { label: 'Cursos Programados', value: '3', icon: Calendar, trend: 'Esta semana' }
    ]
  },
  'reports': {
    title: 'Reportes',
    icon: BarChart3,
    color: 'from-emerald-400 to-emerald-600',
    bgColor: 'bg-emerald-500',
    textColor: 'text-emerald-500',
    description: 'Análisis de accidentabilidad, seguimiento de cierres de hallazgos y métricas de gestión.',
    keywords: ['reporte', 'estadística', 'indicador', 'kpi', 'frecuencia', 'gravedad', 'cierre'],
    getIndustryContext: (industry: string) => `El análisis de datos permite a la gerencia de ${industry || 'su empresa'} enfocar los recursos en las áreas con mayor concentración de condiciones subestándar.`,
    frequentRisks: ['Retraso en el cierre de acciones correctivas', 'Sub-reporte de incidentes (Near Miss)', 'Falta de investigación de causas raíces'],
    criticalMaintenance: [
      { equipment: 'Generador de Informes Gerenciales', status: 'Automático', date: 'Día 1 de cada mes' }
    ],
    responsibilities: [
      { task: 'Presentación Comité Ejecutivo', responsible: 'Gerente SST', deadline: 'Viernes' },
      { task: 'Cierre de No Conformidades', responsible: 'Jefaturas de Área', deadline: 'Continuo' }
    ],
    items: [
      { title: 'Reportabilidad', icon: BarChart3, path: '/analytics', color: 'text-zinc-400', bg: 'bg-zinc-500/10' },
      { title: 'Historia', icon: Clock, path: '/history', color: 'text-zinc-400', bg: 'bg-zinc-500/10' },
    ],
    stats: [
      { label: 'Acciones Correctivas Atrasadas', value: '5', icon: Clock, trend: 'Requiere gestión' },
      { label: 'Tasa de Cierre de Hallazgos', value: '85%', icon: CheckCircle2, trend: 'Meta: 95%' }
    ]
  }
};

export function ModuleHub() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { selectedProject } = useProject();
  const { nodes } = useRiskEngine();
  
  const [aiRecommendations, setAiRecommendations] = useState<any>(null);
  const [loadingAi, setLoadingAi] = useState(false);

  const hub = id ? hubsData[id] : null;

  useEffect(() => {
    if (!hub || !selectedProject) return;

    const fetchRecommendations = async () => {
      setLoadingAi(true);
      try {
        const relatedNodesContext = nodes
          .filter(n => hub.keywords.some((k: string) => 
            n.tags.some(t => t.toLowerCase().includes(k.toLowerCase())) || 
            n.title.toLowerCase().includes(k.toLowerCase())
          ))
          .slice(0, 5)
          .map(n => `${n.title}: ${n.description}`)
          .join('\n');

        const result = await generateModuleRecommendations(
          hub.title,
          selectedProject.industry || 'General',
          relatedNodesContext || 'Sin datos históricos en la Red Neuronal para este módulo.'
        );
        setAiRecommendations(result);
      } catch (error) {
        console.error("Error fetching AI recommendations:", error);
      } finally {
        setLoadingAi(false);
      }
    };

    fetchRecommendations();
  }, [hub?.title, selectedProject?.id, nodes.length]);

  if (!hub) {
    return <Navigate to="/" />;
  }

  // Filter Risk nodes based on hub keywords
  const relatedNodes = nodes
    .filter(n => hub.keywords.some((k: string) => 
      n.tags.some(t => t.toLowerCase().includes(k.toLowerCase())) || 
      n.title.toLowerCase().includes(k.toLowerCase())
    ))
    .slice(0, 3);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8 min-h-[calc(100vh-4rem)]">
      {/* Header / Hero */}
      <div className="relative overflow-hidden rounded-3xl bg-zinc-900 border border-white/10 p-6 sm:p-10 shadow-2xl">
        <div className={`absolute top-0 right-0 w-64 h-64 bg-gradient-to-br ${hub.color} opacity-10 blur-3xl rounded-full -translate-y-1/2 translate-x-1/2`} />
        
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
          <div className="flex items-start gap-5">
            <button 
              onClick={() => navigate('/')}
              className="mt-1 w-10 h-10 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-zinc-400 hover:text-white transition-colors shrink-0"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className={`p-2 rounded-xl ${hub.bgColor} text-white shadow-lg`}>
                  <hub.icon className="w-6 h-6" />
                </div>
                <h1 className="text-2xl sm:text-4xl font-black text-white uppercase tracking-tighter leading-none">
                  {hub.title}
                </h1>
              </div>
              <p className="text-sm text-zinc-400 max-w-2xl leading-relaxed mt-4">
                {hub.description}
              </p>
            </div>
          </div>
          
          <div className="flex flex-col items-start sm:items-end gap-1 shrink-0">
            <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Proyecto Activo</span>
            <span className={`text-sm font-black ${hub.textColor} uppercase tracking-wider bg-white/5 px-3 py-1.5 rounded-lg border border-white/5`}>
              {selectedProject?.name || 'Global'}
            </span>
          </div>
        </div>
      </div>

      {/* Modules Grid - Moved up for better mobile visibility */}
      <div>
        <h2 className="text-xs font-black text-zinc-500 uppercase tracking-widest mb-4 flex items-center gap-2">
          <Grid className="w-4 h-4" />
          Módulos Disponibles
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-6">
          {hub.items.map((item: any, i: number) => (
            <Link
              key={i}
              to={item.path}
              className="flex flex-col items-center justify-center gap-3 sm:gap-4 p-4 sm:p-6 rounded-2xl bg-zinc-900/30 border border-white/5 hover:bg-zinc-900 hover:border-white/10 transition-all hover:-translate-y-1 group relative overflow-hidden"
            >
              <div className={`absolute inset-0 opacity-0 group-hover:opacity-10 transition-opacity duration-500 ${hub.bgColor}`} />
              
              <div className={`w-12 h-12 sm:w-14 sm:h-14 rounded-2xl ${item.bg} flex items-center justify-center ${item.color} group-hover:scale-110 transition-transform duration-300 shadow-inner relative z-10`}>
                <item.icon className="w-6 h-6 sm:w-7 sm:h-7" />
              </div>
              <span className="text-[10px] sm:text-xs font-bold text-zinc-300 group-hover:text-white uppercase tracking-widest text-center relative z-10">
                {item.title}
              </span>
            </Link>
          ))}
        </div>
      </div>

      {/* Panel de Control de Condiciones y Responsabilidades */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        {/* Riesgos Frecuentes */}
        <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-5 sm:p-6 flex flex-col">
          <h3 className="text-xs font-black text-zinc-500 uppercase tracking-widest mb-4 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            Condiciones Subestándar Frecuentes
          </h3>
          <div className="space-y-3 flex-1">
            {hub.frequentRisks?.map((risk: string, idx: number) => (
              <div key={idx} className="flex items-start gap-3 bg-zinc-900 p-3 rounded-xl border border-white/5">
                <div className={`w-1.5 h-1.5 rounded-full mt-2 shrink-0 ${hub.bgColor}`} />
                <span className="text-sm text-zinc-300 leading-relaxed">{risk}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Mantenciones y Equipos */}
        <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-5 sm:p-6 flex flex-col">
          <h3 className="text-xs font-black text-zinc-500 uppercase tracking-widest mb-4 flex items-center gap-2">
            <Wrench className="w-4 h-4" />
            Estado de Equipos Críticos
          </h3>
          <div className="space-y-3 flex-1">
            {hub.criticalMaintenance?.map((maint: any, idx: number) => (
              <div key={idx} className="bg-zinc-900 p-3 rounded-xl border border-white/5 flex flex-col gap-2">
                <div className="flex justify-between items-start">
                  <span className="text-sm font-bold text-white">{maint.equipment}</span>
                  <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md font-bold ${
                    maint.status === 'Óptimo' || maint.status === 'Al día' || maint.status === 'Vigente' || maint.status === 'Automático'
                      ? 'bg-emerald-500/10 text-emerald-500' 
                      : maint.status === 'Pendiente' || maint.status === 'Vencidas' || maint.status === 'Falla' || maint.status === 'Falla de presión'
                      ? 'bg-red-500/10 text-red-500'
                      : 'bg-amber-500/10 text-amber-500'
                  }`}>
                    {maint.status}
                  </span>
                </div>
                <div className="flex items-center gap-1 text-xs text-zinc-500">
                  <CalendarClock className="w-3 h-3" />
                  {maint.date}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Responsabilidades y Plazos */}
        <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-5 sm:p-6 flex flex-col">
          <h3 className="text-xs font-black text-zinc-500 uppercase tracking-widest mb-4 flex items-center gap-2">
            <UserCheck className="w-4 h-4" />
            Responsabilidades y Plazos
          </h3>
          <div className="space-y-3 flex-1">
            {hub.responsibilities?.map((resp: any, idx: number) => (
              <div key={idx} className="bg-zinc-900 p-3 rounded-xl border border-white/5 flex flex-col gap-2">
                <span className="text-sm text-zinc-300 font-medium">{resp.task}</span>
                <div className="flex justify-between items-center mt-1">
                  <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                    <Briefcase className="w-3 h-3" />
                    {resp.responsible}
                  </div>
                  <div className={`text-[10px] font-bold uppercase tracking-wider ${hub.textColor}`}>
                    {resp.deadline}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Asistente Profesional (IA) */}
      <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-5 sm:p-6 flex flex-col">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h3 className="text-xs font-black text-zinc-500 uppercase tracking-widest flex items-center gap-2">
              <Brain className="w-4 h-4" />
              Asistente Profesional (IA)
            </h3>
            <p className="text-sm text-zinc-400 mt-1">
              Recomendaciones basadas en estándares ISO y análisis predictivo.
            </p>
          </div>
          {loadingAi && (
            <div className="flex items-center gap-2 text-xs text-zinc-500 bg-zinc-900 px-3 py-1.5 rounded-full border border-white/5">
              <Loader2 className="w-3 h-3 animate-spin" />
              Analizando contexto...
            </div>
          )}
        </div>

        {aiRecommendations ? (
          <div className="space-y-6">
            {/* Contexto Industrial & ISO */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-zinc-900 p-4 rounded-xl border border-white/5">
                <div className="flex items-center gap-2 mb-2">
                  <Briefcase className={`w-4 h-4 ${hub.textColor}`} />
                  <h4 className="text-xs font-black text-white uppercase tracking-widest">Contexto Industrial</h4>
                </div>
                <p className="text-sm text-zinc-400 leading-relaxed">{aiRecommendations.industryRelation}</p>
              </div>
              <div className="bg-zinc-900 p-4 rounded-xl border border-white/5">
                <div className="flex items-center gap-2 mb-2">
                  <ShieldCheck className={`w-4 h-4 ${hub.textColor}`} />
                  <h4 className="text-xs font-black text-white uppercase tracking-widest">Referencia Normativa</h4>
                </div>
                <p className="text-sm text-zinc-400 leading-relaxed">{aiRecommendations.isoReference}</p>
              </div>
            </div>

            {/* Alerta Predictiva */}
            {aiRecommendations.predictiveAlert && (
              <div className="bg-rose-500/10 border border-rose-500/20 p-4 rounded-xl flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-xs font-black text-rose-500 uppercase tracking-widest mb-1">Alerta Predictiva</h4>
                  <p className="text-sm text-rose-400/90 leading-relaxed">{aiRecommendations.predictiveAlert}</p>
                </div>
              </div>
            )}

            {/* Recomendaciones Accionables */}
            <div>
              <h4 className="text-xs font-black text-zinc-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                <Sparkles className="w-4 h-4" />
                Recomendaciones Accionables
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {aiRecommendations.recommendations?.map((rec: any, idx: number) => (
                  <div key={idx} className="bg-zinc-900 p-4 rounded-xl border border-white/5 hover:border-white/10 transition-colors">
                    <h5 className="text-sm font-bold text-white mb-2">{rec.title}</h5>
                    <p className="text-xs text-zinc-400 leading-relaxed">{rec.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : !loadingAi ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 bg-zinc-900 rounded-xl border border-white/5 border-dashed">
            <Brain className="w-8 h-8 text-zinc-600 mb-3" />
            <p className="text-sm text-zinc-400">El asistente está listo para analizar.</p>
            <p className="text-xs text-zinc-500 mt-1">Selecciona un proyecto para obtener recomendaciones personalizadas.</p>
          </div>
        ) : null}
      </div>

      {/* Inteligencia Preventiva (Red Neuronal) */}
      <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-5 sm:p-6 flex flex-col">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h3 className="text-xs font-black text-zinc-500 uppercase tracking-widest flex items-center gap-2">
              <Lightbulb className="w-4 h-4" />
              Inteligencia Preventiva (Red Neuronal)
            </h3>
            <p className="text-sm text-zinc-400 mt-1">
              {hub.getIndustryContext(selectedProject?.industry || '')}
            </p>
          </div>
        </div>
        
        {relatedNodes.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {relatedNodes.map(node => (
              <div key={node.id} className="bg-zinc-900 p-4 rounded-xl border border-white/5 hover:border-white/10 transition-colors">
                <h4 className="text-sm font-bold text-white mb-1">{node.title}</h4>
                <p className="text-xs text-zinc-400 line-clamp-2">{node.description}</p>
                <div className="flex flex-wrap gap-1 mt-3">
                  {node.tags.slice(0, 3).map(tag => (
                    <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-zinc-400">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 bg-zinc-900 rounded-xl border border-white/5 border-dashed">
            <Network className="w-8 h-8 text-zinc-600 mb-3" />
            <p className="text-sm text-zinc-400">El Guardián está analizando las condiciones del entorno.</p>
            <p className="text-xs text-zinc-500 mt-1">No hay nodos en la Red Neuronal relacionados aún.</p>
          </div>
        )}
      </div>

      {/* Quick Stats Widgets */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
        {hub.stats.map((stat: any, idx: number) => (
          <div key={idx} className="bg-zinc-900/50 border border-white/5 rounded-2xl p-5 flex items-center justify-between group hover:bg-zinc-900 transition-colors">
            <div className="flex items-center gap-4">
              <div className={`w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center ${hub.textColor} group-hover:scale-110 transition-transform`}>
                <stat.icon className="w-6 h-6" />
              </div>
              <div>
                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">{stat.label}</p>
                <p className="text-2xl font-black text-white leading-none">{stat.value}</p>
              </div>
            </div>
            <div className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-md bg-white/5 ${hub.textColor}`}>
              {stat.trend}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
