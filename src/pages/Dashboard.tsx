import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Shield, 
  Zap,
  Map,
  FileText,
  Layout,
  RefreshCw,
  Sun,
  Moon,
  Activity,
  Users,
  CheckCircle2,
  AlertTriangle,
  Briefcase,
  Image,
  Calendar,
  BookOpen,
  Lightbulb,
  Folder,
  ShieldAlert,
  UserCheck,
  Droplets,
  Clock,
  Award,
  Package,
  Grid,
  HeartPulse,
  Sliders,
  Book,
  ClipboardList,
  ShieldCheck,
  AlertOctagon,
  MapPin,
  Target,
  Brain,
  Wind,
  Plus,
  ChevronRight,
  Share2,
  TrendingUp,
  BarChart3,
  BrainCircuit,
  Eye,
  Sparkles,
  Sunrise,
  Sunset,
  Network,
  Home,
  ClipboardCheck,
  Wrench,
  Car
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useProject } from '../contexts/ProjectContext';
import { useRiskEngine } from '../hooks/useRiskEngine';
import { useUniversalKnowledge } from '../contexts/UniversalKnowledgeContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { cacheAIResponse, getCachedAIResponse } from '../utils/pwa-offline';
import { FastCheckModal } from '../components/FastCheckModal';
import { AIInsightsModal } from '../components/dashboard/AIInsightsModal';
import { ComplianceModal } from '../components/dashboard/ComplianceModal';
import { RealTimeStatusWidget } from '../components/dashboard/RealTimeStatusWidget';
import { PredictiveAlertWidget } from '../components/dashboard/PredictiveAlertWidget';
import { useGamification } from '../hooks/useGamification';
import { NodeType } from '../types';

type ChallengePeriod = 'daily' | 'weekly' | 'monthly' | 'annual';

const industryChallenges: Record<string, Record<ChallengePeriod, string[]>> = {
  'Construcción': {
    daily: ['Check-in EPP', 'Charla 5 min', 'Reportar 1 Hallazgo', 'Inspección de Andamios', 'Limpieza de área'],
    weekly: ['Auditoría de Terreno', 'Revisión de Maquinaria', 'Capacitación Altura', 'Simulacro de Evacuación', 'Reunión de Comité'],
    monthly: ['Informe de Siniestralidad', 'Inspección de Grúas', 'Capacitación Primeros Auxilios', 'Revisión de PTS', 'Inventario de EPP'],
    annual: ['Examen Médico Ocupacional', 'Renovación de Certificaciones', 'Plan de Emergencia Anual', 'Auditoría Externa', 'Cierre de Brechas'],
  },
  'Minería': {
    daily: ['Control de Fatiga', 'Check-list Camión Extracción', 'Medición de Gases', 'Reportar Condición Subestándar', 'Charla de Inicio'],
    weekly: ['Inspección de Taludes', 'Prueba de Frenos', 'Capacitación Espacios Confinados', 'Revisión de Extintores', 'Control de Polvo'],
    monthly: ['Mantenimiento Preventivo', 'Auditoría de Procesos', 'Capacitación Sustancias Peligrosas', 'Revisión de Refugios', 'Informe de Producción Segura'],
    annual: ['Certificación de Operadores', 'Simulacro General de Mina', 'Revisión de Estabilidad de Botaderos', 'Auditoría de Seguridad', 'Plan de Cierre Progresivo'],
  },
  'General': {
    daily: ['Check-in Asistencia', 'Orden y Limpieza', 'Reportar Incidente', 'Pausa Activa', 'Revisión de Herramientas'],
    weekly: ['Charla de Seguridad', 'Inspección de Oficina', 'Capacitación Básica', 'Revisión de Botiquín', 'Reunión de Equipo'],
    monthly: ['Informe Mensual', 'Simulacro de Incendio', 'Capacitación Específica', 'Revisión de Políticas', 'Encuesta de Clima'],
    annual: ['Evaluación de Desempeño', 'Plan de Capacitación Anual', 'Revisión de Objetivos', 'Auditoría Interna', 'Cena de Seguridad'],
  }
};

export function Dashboard() {
  const navigate = useNavigate();
  const { selectedProject, projects } = useProject();
  const { stats, completeChallenge } = useGamification();
  const { environment } = useUniversalKnowledge();
  const weather = environment?.weather;
  const seismic = environment?.seismic;
  const loadingWeather = !environment;
  const [isFastCheckOpen, setIsFastCheckOpen] = useState(false);
  const [isPlannerOpen, setIsPlannerOpen] = useState(false);
  const [isAIInsightsOpen, setIsAIInsightsOpen] = useState(false);
  const [isComplianceModalOpen, setIsComplianceModalOpen] = useState(false);
  const [activePeriod, setActivePeriod] = useState<ChallengePeriod>('daily');
  const [aiInsights, setAiInsights] = useState<any>(null);
  const [loadingInsights, setLoadingInsights] = useState(false);
  const [activeModuleGroup, setActiveModuleGroup] = useState<any | null>(null);
  const { nodes } = useRiskEngine();
  const isOnline = useOnlineStatus();

  useEffect(() => {
    const fetchInsights = async () => {
      if (nodes.length === 0) return;
      setLoadingInsights(true);
      try {
        if (!isOnline) {
          const cached = await getCachedAIResponse('dashboard-insights');
          if (cached) {
            setAiInsights(cached);
          }
          setLoadingInsights(false);
          return;
        }

        const { predictGlobalIncidents } = await import('../services/geminiService');
        const context = nodes.slice(0, 20).map(n => `${n.type}: ${n.title}`).join(', ');
        
        let envContext = '';
        if (weather) {
          envContext += `Clima: ${weather.temp}°C, Viento: ${weather.windSpeed} km/h, Condición: ${weather.condition}. `;
        }
        if (seismic) {
          envContext += `Último Sismo: ${seismic.magnitude} magnitud en ${seismic.location}.`;
        }

        const insights = await predictGlobalIncidents(context, envContext);
        setAiInsights(insights);
        await cacheAIResponse('dashboard-insights', insights);
      } catch (error) {
        console.error('Error fetching AI insights:', error);
        const cached = await getCachedAIResponse('dashboard-insights');
        if (cached) {
          setAiInsights(cached);
        }
      } finally {
        setLoadingInsights(false);
      }
    };

    fetchInsights();
  }, [nodes.length, weather, seismic, isOnline]);

  const industry = selectedProject?.industry || 'General';
  const currentChallenges = industryChallenges[industry] || industryChallenges['General'];

  // Helper to check if a challenge is completed in the current period
  const isChallengeCompleted = (challengeName: string, period: ChallengePeriod) => {
    if (!stats.completedChallenges) return false;
    const completedAt = stats.completedChallenges[challengeName];
    if (!completedAt) return false;

    const date = new Date(completedAt);
    const now = new Date();

    switch (period) {
      case 'daily':
        return date.toDateString() === now.toDateString();
      case 'weekly':
        // Simple check: within last 7 days
        const diffTime = Math.abs(now.getTime() - date.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
        return diffDays <= 7;
      case 'monthly':
        return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
      case 'annual':
        return date.getFullYear() === now.getFullYear();
      default:
        return false;
    }
  };

  const calculateCompliance = (project: any) => {
    if (!project) return 0;
    
    const projectNodes = nodes.filter(n => n.projectId === project.id);
    
    // 1. Hallazgos (Findings)
    const findings = projectNodes.filter(n => n.type === NodeType.FINDING);
    let findingsScore = 100;
    if (findings.length > 0) {
      const closedFindings = findings.filter(n => n.metadata?.status === 'Cerrado' || n.metadata?.estado === 'Cerrado').length;
      findingsScore = (closedFindings / findings.length) * 100;
    }

    // 2. Tareas (Tasks)
    const tasks = projectNodes.filter(n => n.type === NodeType.TASK);
    let tasksScore = 100;
    if (tasks.length > 0) {
      const completedTasks = tasks.filter(n => n.metadata?.status === 'Completada' || n.metadata?.estado === 'Completada').length;
      tasksScore = (completedTasks / tasks.length) * 100;
    }

    // 3. Capacitaciones (Trainings)
    const trainings = projectNodes.filter(n => n.type === NodeType.TRAINING);
    let trainingsScore = 100;
    if (trainings.length > 0) {
      const completedTrainings = trainings.filter(n => n.metadata?.status === 'completed' || n.metadata?.estado === 'Completada').length;
      trainingsScore = (completedTrainings / trainings.length) * 100;
    }

    const totalScore = (findingsScore + tasksScore + trainingsScore) / 3;
    return Math.round(totalScore);
  };

  const getComplianceData = () => {
    if (selectedProject) {
      return {
        percentage: calculateCompliance(selectedProject),
        label: selectedProject.name
      };
    }
    
    if (projects && projects.length > 0) {
      const total = projects.reduce((acc, p) => acc + calculateCompliance(p), 0);
      return {
        percentage: Math.round(total / projects.length),
        label: 'Promedio Global'
      };
    }

    return {
      percentage: 0,
      label: 'Sin proyectos'
    };
  };

  const complianceData = getComplianceData();

  // Automated Gamification Logic
  useEffect(() => {
    if (!selectedProject || nodes.length === 0) return;

    const now = new Date();
    const todayStr = now.toDateString();
    
    // Check nodes created today for the current project
    const nodesToday = nodes.filter(n => 
      n.projectId === selectedProject.id && 
      new Date(n.createdAt).toDateString() === todayStr
    );

    // Define rules for auto-completion
    const checkAndComplete = async (challengeName: string, condition: boolean, period: ChallengePeriod = 'daily') => {
      if (condition && !isChallengeCompleted(challengeName, period)) {
        const pointsMap = { daily: 10, weekly: 50, monthly: 200, annual: 1000 };
        await completeChallenge(challengeName, pointsMap[period]);
      }
    };

    // Example rules based on industry challenges
    // 'Reportar 1 Hallazgo' -> if there is a FINDING node today
    const hasFindingToday = nodesToday.some(n => n.type === NodeType.FINDING);
    checkAndComplete('Reportar 1 Hallazgo', hasFindingToday);

    // 'Check-in EPP' -> if there is an EPP node today
    const hasEPPToday = nodesToday.some(n => n.type === NodeType.EPP);
    checkAndComplete('Check-in EPP', hasEPPToday);

    // 'Charla 5 min' -> if there is a TRAINING node today
    const hasTrainingToday = nodesToday.some(n => n.type === NodeType.TRAINING);
    checkAndComplete('Charla 5 min', hasTrainingToday);

    // 'Inspección de Andamios' or 'Inspección de Grúas' -> if there is an INSPECTION node today
    const hasInspectionToday = nodesToday.some(n => n.type === NodeType.INSPECTION);
    checkAndComplete('Inspección de Andamios', hasInspectionToday);
    checkAndComplete('Inspección de Grúas', hasInspectionToday, 'monthly');

    // 'Simulacro de Evacuación' -> if there is an EMERGENCY node today
    const hasEmergencyToday = nodesToday.some(n => n.type === NodeType.EMERGENCY);
    checkAndComplete('Simulacro de Evacuación', hasEmergencyToday, 'weekly');

  }, [nodes, selectedProject, stats.completedChallenges]);

  const getCompletedCount = (period: ChallengePeriod) => {
    return currentChallenges[period].filter(c => isChallengeCompleted(c, period)).length;
  };

  const toggleObjective = async (challenge: string) => {
    if (isChallengeCompleted(challenge, activePeriod)) return; // Already completed
    
    // Points based on period
    const pointsMap = {
      daily: 10,
      weekly: 50,
      monthly: 200,
      annual: 1000
    };
    
    await completeChallenge(challenge, pointsMap[activePeriod]);
  };

  const handleSyncCalendar = () => {
    // Generate a basic .ics file for the current challenges
    let icsContent = "BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Praeventio Guard//ES\n";
    
    currentChallenges.daily.forEach((challenge, index) => {
      const now = new Date();
      const start = now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
      const end = new Date(now.getTime() + 30 * 60000).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'; // 30 mins later
      
      icsContent += "BEGIN:VEVENT\n";
      icsContent += `UID:praeventio-daily-${index}-${now.getTime()}@praeventioguard.com\n`;
      icsContent += `DTSTAMP:${start}\n`;
      icsContent += `DTSTART:${start}\n`;
      icsContent += `DTEND:${end}\n`;
      icsContent += `SUMMARY:${challenge}\n`;
      icsContent += `DESCRIPTION:Tarea diaria de seguridad en Praeventio Guard\n`;
      icsContent += "END:VEVENT\n";
    });
    
    icsContent += "END:VCALENDAR";
    
    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const link = document.createElement('a');
    link.href = window.URL.createObjectURL(blob);
    link.setAttribute('download', 'praeventio_tareas.ics');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const moduleGroups = [
    {
      id: 'main',
      title: 'Principal',
      icon: Home,
      color: 'bg-[#10B981]',
      items: [
        { title: 'Red Neuronal', icon: Network, path: '/risk-network', color: 'text-emerald-500' },
        { title: 'Proyectos', icon: Briefcase, path: '/projects', color: 'text-blue-500' },
        { title: 'AI Hub', icon: Zap, path: '/ai-hub', color: 'text-violet-500' },
        { title: 'Muro', icon: Users, path: '/safety-feed', color: 'text-emerald-500' },
      ]
    },
    {
      id: 'operations',
      title: 'Gestión Operativa',
      icon: Briefcase,
      color: 'bg-[#3B82F6]',
      items: [
        { title: 'Trabajadores', icon: Users, path: '/workers', color: 'text-violet-500' },
        { title: 'Documentos', icon: Folder, path: '/documents', color: 'text-violet-500' },
        { title: 'Asistencia', icon: UserCheck, path: '/attendance', color: 'text-zinc-400' },
        { title: 'Calendario', icon: Calendar, path: '/calendar', color: 'text-zinc-400' },
        { title: 'Telemetría', icon: Activity, path: '/telemetry', color: 'text-zinc-400' },
        { title: 'Activos', icon: Wrench, path: '/assets', color: 'text-zinc-400' },
        { title: 'Conducción', icon: Car, path: '/safe-driving', color: 'text-zinc-400' },
        { title: 'Mapa de Sitio', icon: Map, path: '/site-map', color: 'text-zinc-400' },
      ]
    },
    {
      id: 'risks',
      title: 'Prevención y Riesgos',
      icon: ShieldAlert,
      color: 'bg-[#A855F7]',
      items: [
        { title: 'Riesgos', icon: AlertOctagon, path: '/risks', color: 'text-violet-500' },
        { title: 'Hallazgos', icon: AlertTriangle, path: '/findings', color: 'text-amber-500' },
        { title: 'EPP', icon: Shield, path: '/epp', color: 'text-violet-500' },
        { title: 'Matriz', icon: Grid, path: '/matrix', color: 'text-zinc-400' },
        { title: 'PTS', icon: FileText, path: '/pts', color: 'text-zinc-400' },
        { title: 'Guardia Predictivo', icon: Zap, path: '/predictive-guard', color: 'text-zinc-400' },
      ]
    },
    {
      id: 'health',
      title: 'Salud Ocupacional',
      icon: HeartPulse,
      color: 'bg-[#EF4444]',
      items: [
        { title: 'Higiene', icon: Droplets, path: '/hygiene', color: 'text-zinc-400' },
        { title: 'Medicina', icon: HeartPulse, path: '/medicine', color: 'text-zinc-400' },
        { title: 'Ergonomía', icon: UserCheck, path: '/ergonomics', color: 'text-zinc-400' },
        { title: 'Psicosocial', icon: Brain, path: '/psychosocial', color: 'text-zinc-400' },
        { title: 'Bio-Análisis', icon: Activity, path: '/bio-analysis', color: 'text-zinc-400' },
      ]
    },
    {
      id: 'compliance',
      title: 'Cumplimiento',
      icon: ClipboardCheck,
      color: 'bg-[#F59E0B]',
      items: [
        { title: 'Normativas', icon: Book, path: '/normatives', color: 'text-zinc-400' },
        { title: 'Protocolos MINSAL', icon: ShieldCheck, path: '/minsal-protocols', color: 'text-zinc-400' },
        { title: 'Auditorías', icon: ClipboardList, path: '/audits', color: 'text-zinc-400' },
        { title: 'Reportes SUSESO', icon: FileText, path: '/suseso', color: 'text-zinc-400' },
        { title: 'Glosario', icon: BookOpen, path: '/glossary', color: 'text-zinc-400' },
      ]
    },
    {
      id: 'emergencies',
      title: 'Emergencias',
      icon: AlertTriangle,
      color: 'bg-[#EF4444]',
      items: [
        { title: 'Emergencia', icon: AlertTriangle, path: '/emergency', color: 'text-rose-500' },
        { title: 'Evacuación', icon: Map, path: '/evacuation', color: 'text-zinc-400' },
        { title: 'Simulador', icon: Zap, path: '/emergency-generator', color: 'text-zinc-400' },
      ]
    },
    {
      id: 'training',
      title: 'Capacitación',
      icon: BookOpen,
      color: 'bg-[#3B82F6]',
      items: [
        { title: 'Capacitaciones', icon: BookOpen, path: '/training', color: 'text-zinc-400' },
        { title: 'Gamificación', icon: Award, path: '/gamification', color: 'text-zinc-400' },
        { title: 'Entrenamiento IA', icon: Zap, path: '/knowledge-ingestion', color: 'text-zinc-400' },
      ]
    },
    {
      id: 'reports',
      title: 'Reportes',
      icon: BarChart3,
      color: 'bg-[#10B981]',
      items: [
        { title: 'Reportabilidad', icon: BarChart3, path: '/analytics', color: 'text-zinc-400' },
        { title: 'Historia', icon: Clock, path: '/history', color: 'text-zinc-400' },
      ]
    }
  ];

  const formatTime = (isoString: string) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="flex-1 flex flex-col justify-start gap-1 sm:gap-4 pb-20 sm:pb-4 pt-1 sm:pt-4 px-2 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full min-h-[calc(100vh-4rem)]">
      <PredictiveAlertWidget />
      
      {/* 1. Boletín Climático - Denser */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-1 sm:gap-4 mt-1 sm:mt-0">
        <section className="bg-[#bbf7d0] dark:bg-emerald-900/20 rounded-xl sm:rounded-2xl p-1.5 sm:p-5 shadow-sm relative overflow-hidden border border-emerald-500/10">
          <div className="flex flex-col sm:flex-row justify-between gap-1.5 sm:gap-5 relative z-10">
            <div className="flex-1">
              <div className="flex justify-between items-start mb-1.5 sm:mb-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-[10px] sm:text-base font-black text-zinc-900 dark:text-emerald-50 tracking-tight leading-none uppercase">Boletín climático</h2>
                  <p className="text-[8px] sm:text-xs text-zinc-600 dark:text-emerald-200/70 flex items-center gap-1">
                    <Map className="w-2.5 h-2.5 sm:w-4 sm:h-4" /> Santiago
                  </p>
                </div>
                <RefreshCw 
                  className={`w-3 h-3 sm:w-5 sm:h-5 text-zinc-500 dark:text-emerald-400 cursor-pointer ${loadingWeather ? 'animate-spin' : ''}`} 
                />
              </div>

              <div className="flex flex-row items-center gap-2 sm:gap-4">
                <div className="hidden sm:flex w-12 h-12 sm:w-14 sm:h-14 bg-emerald-100 dark:bg-emerald-800/50 rounded-full items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
                  {weather && weather.sunrise && weather.sunset && (new Date().getTime() > weather.sunrise && new Date().getTime() < weather.sunset) ? <Sun className="w-7 h-7 sm:w-8 sm:h-8" /> : <Moon className="w-7 h-7 sm:w-8 sm:h-8" />}
                </div>
                
                {weather ? (
                  <div className="grid grid-cols-4 gap-1 sm:gap-3 flex-1 w-full">
                    <div className="flex flex-col bg-white/40 dark:bg-black/20 p-1 sm:p-3 rounded-lg sm:rounded-xl items-center sm:items-start text-center sm:text-left">
                      <span className="text-[7px] sm:text-xs font-bold text-zinc-500 uppercase tracking-wider">Temp</span>
                      <span className="text-xs sm:text-lg font-black text-zinc-900 dark:text-emerald-50 leading-none mt-0.5 sm:mt-1">{Math.round(weather.temp)}°C</span>
                    </div>
                    <div className="flex flex-col bg-white/40 dark:bg-black/20 p-1 sm:p-3 rounded-lg sm:rounded-xl items-center sm:items-start text-center sm:text-left">
                      <span className="text-[7px] sm:text-xs font-bold text-zinc-500 uppercase tracking-wider">Condición</span>
                      <span className="text-[9px] sm:text-lg font-black text-zinc-900 dark:text-emerald-50 leading-none truncate mt-0.5 sm:mt-1 max-w-full" title={weather.condition}>{weather.condition}</span>
                    </div>
                    <div className="flex flex-col bg-white/40 dark:bg-black/20 p-1 sm:p-3 rounded-lg sm:rounded-xl items-center sm:items-start text-center sm:text-left">
                      <span className="text-[7px] sm:text-xs font-bold text-zinc-500 uppercase tracking-wider">Viento</span>
                      <span className="text-xs sm:text-lg font-black text-zinc-900 dark:text-emerald-50 leading-none mt-0.5 sm:mt-1">{Math.round(weather.windSpeed || 0)} <span className="text-[6px] sm:text-xs">km/h</span></span>
                    </div>
                    <div className="flex flex-col bg-white/40 dark:bg-black/20 p-1 sm:p-3 rounded-lg sm:rounded-xl items-center sm:items-start text-center sm:text-left">
                      <span className="text-[7px] sm:text-xs font-bold text-zinc-500 uppercase tracking-wider">Humedad</span>
                      <span className="text-xs sm:text-lg font-black text-zinc-900 dark:text-emerald-50 leading-none mt-0.5 sm:mt-1">{weather.humidity}%</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-[10px] sm:text-sm text-zinc-500">Cargando...</p>
                )}
              </div>
              
              <div className="flex flex-wrap gap-1 mt-1.5 sm:mt-4">
                {weather?.windSpeed && weather.windSpeed > 40 && (
                  <span className="flex items-center gap-1 bg-rose-500 text-white px-1.5 sm:px-2.5 py-0.5 sm:py-1.5 rounded text-[8px] sm:text-xs font-bold uppercase tracking-widest shadow-sm">
                    <Wind className="w-2.5 h-2.5 sm:w-3.5 sm:h-3.5" /> Alerta Viento
                  </span>
                )}
                {weather?.temp && weather.temp > 30 && (
                  <span className="flex items-center gap-1 bg-rose-500 text-white px-1.5 sm:px-2.5 py-0.5 sm:py-1.5 rounded text-[8px] sm:text-xs font-bold uppercase tracking-widest shadow-sm">
                    <AlertTriangle className="w-2.5 h-2.5 sm:w-3.5 sm:h-3.5" /> Estrés Térmico
                  </span>
                )}
                {weather?.condition?.toLowerCase().includes('lluvia') && (
                  <span className="flex items-center gap-1 bg-blue-500 text-white px-1.5 sm:px-2.5 py-0.5 sm:py-1.5 rounded text-[8px] sm:text-xs font-bold uppercase tracking-widest shadow-sm">
                    <Droplets className="w-2.5 h-2.5 sm:w-3.5 sm:h-3.5" /> Lluvia
                  </span>
                )}
                {weather?.temp && weather.temp <= 30 && (!weather.windSpeed || weather.windSpeed <= 40) && (!weather.condition?.toLowerCase().includes('lluvia')) && (
                  <span className="flex items-center gap-1 bg-emerald-500 text-white px-1.5 sm:px-2.5 py-0.5 sm:py-1.5 rounded text-[8px] sm:text-xs font-bold uppercase tracking-widest shadow-sm">
                    <CheckCircle2 className="w-2.5 h-2.5 sm:w-3.5 sm:h-3.5" /> Óptimo
                  </span>
                )}
              </div>
            </div>

            <div className="hidden sm:flex w-full sm:w-[120px] shrink-0 sm:border-l border-t sm:border-t-0 border-emerald-500/10 pt-2 sm:pt-0 sm:pl-4 flex-col justify-center relative">
              <div className="flex justify-between text-[9px] sm:text-xs font-bold text-zinc-500 dark:text-emerald-400/70 mb-1 sm:mb-2">
                <span>{weather?.sunrise ? new Date(weather.sunrise).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) : '07:00'}</span>
                <span>{weather?.sunset ? new Date(weather.sunset).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) : '19:00'}</span>
              </div>
              <div className="relative w-full h-6 sm:h-12 overflow-visible mt-1 sm:mt-2">
                <svg viewBox="-5 -5 110 60" className="w-full h-full overflow-visible">
                  <path d="M 0 50 A 50 50 0 0 1 100 50" fill="none" stroke="currentColor" strokeWidth="2" className="text-emerald-500/20" strokeDasharray="4 2" />
                  {weather && (
                    <circle 
                      cx={(() => {
                        const now = new Date().getTime();
                        const sunrise = weather.sunrise || new Date().setHours(7, 0, 0, 0);
                        const sunset = weather.sunset || new Date().setHours(19, 0, 0, 0);
                        
                        if (now < sunrise) return 0;
                        if (now > sunset) return 100;
                        
                        const progress = (now - sunrise) / (sunset - sunrise);
                        return progress * 100;
                      })()} 
                      cy={(() => {
                        const now = new Date().getTime();
                        const sunrise = weather.sunrise || new Date().setHours(7, 0, 0, 0);
                        const sunset = weather.sunset || new Date().setHours(19, 0, 0, 0);
                        
                        if (now < sunrise) return 50;
                        if (now > sunset) return 50;
                        
                        const progress = (now - sunrise) / (sunset - sunrise);
                        const x = progress * 100;
                        return 50 - Math.sqrt(2500 - Math.pow(x - 50, 2));
                      })()} 
                      r="6" 
                      className="fill-amber-500" 
                    />
                  )}
                </svg>
              </div>
            </div>
          </div>
        </section>

        {/* Porcentaje de Cumplimiento */}
        <section 
          onClick={() => setIsComplianceModalOpen(true)}
          className="rounded-xl sm:rounded-2xl p-1.5 sm:p-4 shadow-sm relative overflow-hidden border bg-zinc-100 dark:bg-zinc-900/50 border-zinc-500/10 cursor-pointer hover:border-emerald-500/30 transition-colors group flex flex-row sm:flex-col items-center sm:items-start justify-between sm:justify-between h-auto sm:h-full"
        >
          <div className="absolute -right-4 -bottom-4 opacity-5 group-hover:scale-110 transition-transform hidden sm:block">
            <Target className="w-24 h-24 text-emerald-500" />
          </div>
          
          {/* Mobile Layout: Horizontal */}
          <div className="flex sm:hidden items-center justify-between w-full relative z-10">
            <div className="flex items-center gap-1.5">
              <div className="relative flex items-center justify-center w-6 h-6 shrink-0">
                <svg className="w-full h-full transform -rotate-90 absolute inset-0">
                  <circle cx="50%" cy="50%" r="40%" stroke="currentColor" strokeWidth="2" fill="transparent" className="text-zinc-200 dark:text-zinc-800" />
                  <circle cx="50%" cy="50%" r="40%" stroke="currentColor" strokeWidth="2" fill="transparent" strokeDasharray={100.5} strokeDashoffset={100.5 * (1 - (complianceData.percentage / 100))} className="text-emerald-500" />
                </svg>
                <span className="text-[7px] font-black text-zinc-900 dark:text-white relative z-10">{complianceData.percentage}%</span>
              </div>
              <div className="flex flex-col">
                <h2 className="text-[9px] font-black text-zinc-900 dark:text-white uppercase leading-tight">Cumplimiento</h2>
                <p className="text-[7px] text-zinc-500 dark:text-zinc-400 truncate max-w-[100px]">{complianceData.label}</p>
              </div>
            </div>
            <div className="flex items-center gap-1 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 rounded text-[7px] font-bold uppercase tracking-widest">
              Optimizar
            </div>
          </div>

          {/* Desktop Layout: Vertical */}
          <div className="hidden sm:flex flex-col justify-between h-full relative z-10 w-full">
            <div className="flex justify-between items-start mb-2">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-black text-zinc-900 dark:text-white tracking-tight leading-none uppercase">Cumplimiento</h2>
                <p className="text-xs text-zinc-600 dark:text-zinc-400 flex items-center gap-1 truncate max-w-[150px]">
                  <Briefcase className="w-3 h-3" /> {complianceData.label}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="relative flex flex-col items-center justify-center w-14 h-14 shrink-0">
                <svg className="w-full h-full transform -rotate-90">
                  <circle cx="50%" cy="50%" r="40%" stroke="currentColor" strokeWidth="3" fill="transparent" className="text-zinc-200 dark:text-zinc-800" />
                  <circle cx="50%" cy="50%" r="40%" stroke="currentColor" strokeWidth="3" fill="transparent" strokeDasharray={100.5} strokeDashoffset={100.5 * (1 - (complianceData.percentage / 100))} className="text-emerald-500" />
                </svg>
                <span className="absolute text-xs font-black text-zinc-900 dark:text-white">
                  {complianceData.percentage}%
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-zinc-900 dark:text-white leading-tight truncate">
                  {complianceData.percentage >= 90 ? 'Nivel Óptimo' : complianceData.percentage >= 70 ? 'Nivel Aceptable' : 'Requiere Atención'}
                </p>
                <div className="flex items-center gap-1 mt-1">
                  <div className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 truncate">
                    Falta {100 - complianceData.percentage}%
                  </div>
                </div>
              </div>
            </div>
            
            <div className="mt-2 flex items-center gap-1 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest shadow-sm w-fit">
              <TrendingUp className="w-3 h-3" /> Optimizar
            </div>
          </div>
        </section>
      </div>

      {/* 3. Quick Actions - Smaller */}
      <section className="grid grid-cols-4 gap-1 sm:gap-3 w-full mt-1 sm:mt-0">
        <button 
          onClick={() => setIsFastCheckOpen(true)}
          className="flex-1 bg-[var(--btn-primary-bg)] hover:opacity-80 text-[var(--btn-primary-text,white)] px-0.5 py-1 sm:py-2 rounded-lg sm:rounded-xl font-black uppercase tracking-widest text-[7px] sm:text-xs shadow-sm transition-transform hover:scale-105 flex flex-col items-center justify-center gap-0.5 overflow-hidden"
        >
          <Eye className="w-3 h-3 sm:w-4 sm:h-4 shrink-0" /> <span className="truncate">Fast Check</span>
        </button>
        <button 
          onClick={() => setIsPlannerOpen(true)}
          className="flex-1 bg-[var(--btn-secondary-bg)] hover:opacity-80 text-[var(--btn-secondary-text,white)] px-0.5 py-1 sm:py-2 rounded-lg sm:rounded-xl font-black uppercase tracking-widest text-[7px] sm:text-xs shadow-sm transition-transform hover:scale-105 flex flex-col items-center justify-center gap-0.5 overflow-hidden"
        >
          <Target className="w-3 h-3 sm:w-4 sm:h-4 shrink-0" /> <span className="truncate">Planificador</span>
        </button>
        <Link to="/emergency" className="flex-1 bg-[#EF4444] hover:bg-[#DC2626] text-white px-0.5 py-1 sm:py-2 rounded-lg sm:rounded-xl font-black uppercase tracking-widest text-[7px] sm:text-xs shadow-sm transition-transform hover:scale-105 flex flex-col items-center justify-center gap-0.5 overflow-hidden">
          <Zap className="w-3 h-3 sm:w-4 sm:h-4 shrink-0" /> <span className="truncate">Emergencia</span>
        </Link>
        <Link to="/site-map" className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white px-0.5 py-1 sm:py-2 rounded-lg sm:rounded-xl font-black uppercase tracking-widest text-[7px] sm:text-xs shadow-sm transition-transform hover:scale-105 flex flex-col items-center justify-center gap-0.5 overflow-hidden">
          <Map className="w-3 h-3 sm:w-4 sm:h-4 shrink-0" /> <span className="truncate">Mapa Vivo</span>
        </Link>
      </section>

      {/* 4. Real-Time Status Widget */}
      <RealTimeStatusWidget />

      {/* EPP Widget - Full Width & Compact */}
      <section className="w-full mt-1 sm:mt-0">
        <div className="bg-[#4ADE80] p-1.5 sm:p-4 rounded-xl sm:rounded-2xl shadow-sm relative border border-white/20 w-full flex flex-col justify-center items-center">
          <div className="absolute -top-2 bg-[#22C55E] text-white px-1.5 py-0.5 rounded-full text-[8px] sm:text-xs font-black uppercase tracking-widest shadow-sm flex items-center gap-1 border border-white/20 whitespace-nowrap z-10">
            EPP Requerido
          </div>
          
          <div className="flex items-center justify-center gap-1 sm:gap-4 w-full flex-1 mt-1.5 sm:mt-3">
            <div className="flex gap-1 sm:gap-3">
              <div className="bg-white p-1 sm:p-3 rounded-lg sm:rounded-xl shadow-sm text-center w-8 sm:w-16 border border-transparent transition-all">
                <div className="text-sm sm:text-2xl leading-none mb-0.5">👷</div>
                <div className="bg-black text-white text-[6px] sm:text-[10px] font-black py-0.5 rounded-sm uppercase leading-tight">Casco</div>
              </div>
              <div className="bg-white p-1 sm:p-3 rounded-lg sm:rounded-xl shadow-sm text-center w-8 sm:w-16 border border-transparent transition-all">
                <div className="text-sm sm:text-2xl leading-none mb-0.5">🧤</div>
                <div className="bg-black text-white text-[6px] sm:text-[10px] font-black py-0.5 rounded-sm uppercase leading-tight">Guantes</div>
              </div>
            </div>

            <div className="bg-white/40 backdrop-blur-sm rounded-xl sm:rounded-2xl p-1 sm:p-3 shadow-inner w-8 h-8 sm:w-16 sm:h-16 flex flex-col items-center justify-center border border-dashed border-white/60 shrink-0">
              <Shield className="w-3 h-3 sm:w-6 sm:h-6 text-emerald-800/40 mb-0.5" />
              <span className="text-emerald-800/40 text-[4px] sm:text-[8px] font-black uppercase tracking-widest text-center px-0.5 leading-tight">Praeventio</span>
            </div>

            <div className="flex gap-1 sm:gap-3">
              <div className="bg-white p-1 sm:p-3 rounded-lg sm:rounded-xl shadow-sm text-center w-8 sm:w-16 border border-transparent transition-all">
                <div className="text-sm sm:text-2xl leading-none mb-0.5">🥽</div>
                <div className="bg-black text-white text-[6px] sm:text-[10px] font-black py-0.5 rounded-sm uppercase leading-tight">Lentes</div>
              </div>
              <div className="bg-white p-1 sm:p-3 rounded-lg sm:rounded-xl shadow-sm text-center w-8 sm:w-16 border border-transparent transition-all">
                <div className="text-sm sm:text-2xl leading-none mb-0.5">🥾</div>
                <div className="bg-black text-white text-[6px] sm:text-[10px] font-black py-0.5 rounded-sm uppercase leading-tight">Zapatos</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 6. Modules - Scrollable Grid */}
      <section className="w-full min-w-0 mt-1 sm:mt-4 mb-2 overflow-hidden">
        <div className="flex items-center justify-between mb-1.5 sm:mb-4 px-1">
          <h2 className="text-xs sm:text-base font-black text-zinc-900 dark:text-white tracking-tight leading-none uppercase">Módulos</h2>
        </div>
        <div 
          className="relative w-full overflow-hidden"
          style={{ maskImage: 'linear-gradient(to right, transparent, black 5%, black 95%, transparent)', WebkitMaskImage: 'linear-gradient(to right, transparent, black 5%, black 95%, transparent)' }}
        >
          <div className="flex w-max animate-marquee hover:[animation-play-state:paused] gap-1.5 sm:gap-3 pb-2">
            {/* Double the modules array to create a seamless loop */}
            {[...moduleGroups, ...moduleGroups].map((group, i) => (
              <button 
                key={i}
                onClick={() => navigate(`/hub/${group.id}`)}
                className={`${group.color} shrink-0 w-[64px] sm:w-[120px] aspect-square rounded-xl sm:rounded-2xl p-1.5 sm:p-4 flex flex-col items-center justify-center gap-1 sm:gap-3 shadow-sm hover:shadow-md transition-all hover:-translate-y-1 border border-white/10 active:scale-95 group relative overflow-hidden`}
              >
                <div className="absolute inset-0 bg-white/0 group-hover:bg-white/10 transition-colors" />
                <group.icon className="w-4 h-4 sm:w-8 sm:h-8 shrink-0 relative z-10 text-white" />
                <h3 className="text-[6px] sm:text-xs font-black uppercase tracking-widest leading-tight text-center relative z-10 text-white">{group.title}</h3>
              </button>
            ))}
          </div>
        </div>
      </section>

      <FastCheckModal 
        isOpen={isFastCheckOpen} 
        onClose={() => setIsFastCheckOpen(false)} 
      />

      {/* Planner Modal */}
      <AnimatePresence>
        {isPlannerOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsPlannerOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-2xl w-full max-w-md p-4 sm:p-6 flex flex-col overflow-hidden group shadow-2xl max-h-[90vh]"
            >
              <button 
                onClick={() => setIsPlannerOpen(false)}
                className="absolute top-4 right-4 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white z-20"
              >
                <Plus className="w-6 h-6 rotate-45" />
              </button>

              <div className="absolute top-0 right-0 p-2 opacity-5 group-hover:scale-110 transition-transform pointer-events-none">
                <Target className="w-32 h-32 text-amber-500" />
              </div>
              
              <div className="relative z-10 flex flex-col h-full">
                <div className="flex items-center justify-between mb-6 shrink-0 pr-8">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-amber-100 dark:bg-amber-500/20 flex items-center justify-center text-amber-600 dark:text-amber-500 shrink-0">
                      <Zap className="w-6 h-6" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-lg font-black text-zinc-900 dark:text-white uppercase tracking-widest leading-none truncate">Planificador</h3>
                      <p className="text-xs text-zinc-500 font-bold uppercase tracking-widest mt-1 truncate">{industry}</p>
                    </div>
                  </div>
                </div>

                {/* Tabs */}
                <div className="flex gap-2 mb-6 bg-zinc-100 dark:bg-white/5 p-1.5 rounded-xl shrink-0">
                  {(['daily', 'weekly', 'monthly', 'annual'] as ChallengePeriod[]).map((period) => (
                    <button
                      key={period}
                      onClick={() => setActivePeriod(period)}
                      className={`flex-1 py-2 rounded-lg text-[10px] sm:text-xs font-black uppercase tracking-widest transition-all ${
                        activePeriod === period 
                          ? 'bg-amber-500 text-white shadow-sm shadow-amber-500/20' 
                          : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'
                      }`}
                    >
                      {period === 'daily' ? 'Día' : period === 'weekly' ? 'Sem' : period === 'monthly' ? 'Mes' : 'Año'}
                    </button>
                  ))}
                </div>

                <div className="flex-1 overflow-hidden flex flex-col">
                  <div className="flex items-center justify-between mb-3 shrink-0">
                    <p className="text-xs text-zinc-400 font-bold uppercase tracking-widest">
                      Objetivos ({getCompletedCount(activePeriod)}/{currentChallenges[activePeriod].length})
                    </p>
                    <button 
                      onClick={handleSyncCalendar}
                      className="p-1.5 bg-zinc-100 dark:bg-white/5 hover:bg-zinc-200 dark:hover:bg-white/10 rounded-lg text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-all flex items-center gap-1.5"
                    >
                      <Calendar className="w-4 h-4" />
                      <span className="text-[10px] font-black uppercase tracking-widest">Sync</span>
                    </button>
                  </div>
                  <div className="grid grid-cols-1 gap-2 overflow-y-auto custom-scrollbar pr-2 flex-1">
                    {currentChallenges[activePeriod].map((challenge, i) => {
                      const isCompleted = isChallengeCompleted(challenge, activePeriod);
                      
                      return (
                        <button
                          key={i}
                          disabled={isCompleted}
                          onClick={() => toggleObjective(challenge)}
                          className={`flex items-center justify-between p-4 rounded-xl border transition-all text-left ${
                            isCompleted 
                              ? 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/50 text-zinc-900 dark:text-white opacity-60' 
                              : 'bg-zinc-50 dark:bg-white/5 border-zinc-200 dark:border-white/5 text-zinc-600 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-white/10 hover:text-zinc-900 dark:hover:text-white'
                          }`}
                        >
                          <span className={`text-xs font-bold uppercase tracking-widest mr-3 ${isCompleted ? 'line-through' : ''}`}>{challenge}</span>
                          {isCompleted ? (
                            <CheckCircle2 className="w-5 h-5 text-amber-500 shrink-0" />
                          ) : (
                            <Plus className="w-5 h-5 text-zinc-400 dark:text-zinc-600 shrink-0" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-zinc-200 dark:border-white/5 flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded-full ${getCompletedCount(activePeriod) === currentChallenges[activePeriod].length ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'}`} />
                    <span className="text-xs font-black text-amber-500 uppercase tracking-widest">
                      {getCompletedCount(activePeriod) === currentChallenges[activePeriod].length ? 'Completado' : 'Pendiente'}
                    </span>
                  </div>
                  <Link to="/calendar" onClick={() => setIsPlannerOpen(false)} className="text-xs font-black text-zinc-900 dark:text-white uppercase tracking-widest hover:text-amber-500 transition-colors flex items-center gap-1.5">
                    Calendario <ChevronRight className="w-4 h-4" />
                  </Link>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AIInsightsModal
        isOpen={isAIInsightsOpen}
        onClose={() => setIsAIInsightsOpen(false)}
        insights={aiInsights}
      />
      <ComplianceModal 
        isOpen={isComplianceModalOpen} 
        onClose={() => setIsComplianceModalOpen(false)} 
        percentage={complianceData.percentage}
        projectName={complianceData.label}
      />
    </div>
  );
}
