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
  Network
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useProject } from '../contexts/ProjectContext';
import { useZettelkasten } from '../hooks/useZettelkasten';
import { useUniversalKnowledge } from '../contexts/UniversalKnowledgeContext';
import { FastCheckModal } from '../components/FastCheckModal';
import { AIInsightsModal } from '../components/dashboard/AIInsightsModal';
import { ComplianceModal } from '../components/dashboard/ComplianceModal';
import { RealTimeStatusWidget } from '../components/dashboard/RealTimeStatusWidget';
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
  const { nodes } = useZettelkasten();

  useEffect(() => {
    const fetchInsights = async () => {
      if (nodes.length === 0) return;
      setLoadingInsights(true);
      try {
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
      } catch (error) {
        console.error('Error fetching AI insights:', error);
      } finally {
        setLoadingInsights(false);
      }
    };

    fetchInsights();
  }, [nodes.length, weather, seismic]);

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

  const modules = [
    { title: 'Pizarra', icon: Network, color: 'bg-[#10B981]', path: '/zettelkasten' },
    { title: 'Proyectos', icon: Briefcase, color: 'bg-[#A855F7]', path: '/projects' },
    { title: 'Hallazgos', icon: AlertTriangle, color: 'bg-[#F59E0B]', path: '/findings' },
    { title: 'Auditorías', icon: ClipboardList, color: 'bg-[#10B981]', path: '/audits' },
    { title: 'Asistencia', icon: UserCheck, color: 'bg-[#3B82F6]', path: '/attendance' },
    { title: 'Capacitaciones', icon: BookOpen, color: 'bg-[#A855F7]', path: '/training' },
    { title: 'Calendario', icon: Calendar, color: 'bg-[#A855F7]', path: '/calendar' },
    { title: 'Documentos', icon: Folder, color: 'bg-[#A855F7]', path: '/documents' },
    { title: 'EPP', icon: Shield, color: 'bg-[#A855F7]', path: '/epp' },
    { title: 'Riesgos', icon: AlertOctagon, color: 'bg-[#A855F7]', path: '/risks' },
    { title: 'Matriz', icon: Grid, color: 'bg-[#A855F7]', path: '/matrix' },
    { title: 'Trabajadores', icon: Users, color: 'bg-[#A855F7]', path: '/workers' },
    { title: 'PTS', icon: FileText, color: 'bg-[#A855F7]', path: '/pts' },
    { title: 'Bio-Análisis', icon: Activity, color: 'bg-[#A855F7]', path: '/bio-analysis' },
    { title: 'Normativas', icon: Book, color: 'bg-[#A855F7]', path: '/normatives' },
    { title: 'Emergencia', icon: AlertTriangle, color: 'bg-[#A855F7]', path: '/emergency' },
    { title: 'Evacuación', icon: Map, color: 'bg-[#A855F7]', path: '/evacuation' },
    { title: 'Higiene', icon: Droplets, color: 'bg-[#A855F7]', path: '/hygiene' },
    { title: 'Medicina', icon: HeartPulse, color: 'bg-[#A855F7]', path: '/medicine' },
    { title: 'Ergonomía', icon: UserCheck, color: 'bg-[#A855F7]', path: '/ergonomics' },
    { title: 'Historia', icon: Clock, color: 'bg-[#A855F7]', path: '/history' },
    { title: 'AI Hub', icon: Zap, color: 'bg-[#A855F7]', path: '/ai-hub' },
    { title: 'Entrenamiento IA', icon: Zap, color: 'bg-[#10B981]', path: '/knowledge-ingestion' },
    { title: 'Muro', icon: Users, color: 'bg-[#10B981]', path: '/safety-feed' },
    { title: 'Telemetría', icon: Activity, color: 'bg-[#A855F7]', path: '/telemetry' },
    { title: 'Gamificación', icon: Award, color: 'bg-[#A855F7]', path: '/gamification' },
  ];

  const duplicatedModules = [...modules, ...modules, ...modules];

  const formatTime = (isoString: string) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="flex-1 flex flex-col justify-start gap-2 sm:gap-4 pb-20 sm:pb-4 pt-2 sm:pt-4 px-3 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full min-h-[calc(100vh-4rem)]">
      {/* 1. Boletín Climático - Denser */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 sm:gap-3 mt-2 sm:mt-0">
        <section className="bg-[#bbf7d0] dark:bg-emerald-900/20 rounded-xl p-2 shadow-sm relative overflow-hidden border border-emerald-500/10">
          <div className="flex flex-col sm:flex-row justify-between gap-2 relative z-10">
            <div className="flex-1">
              <div className="flex justify-between items-start mb-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-[10px] font-black text-zinc-900 dark:text-emerald-50 tracking-tight leading-none uppercase">Boletín climático</h2>
                  <p className="text-[8px] text-zinc-600 dark:text-emerald-200/70 flex items-center gap-1">
                    <Map className="w-2.5 h-2.5" /> Santiago
                  </p>
                </div>
                <RefreshCw 
                  className={`w-3 h-3 text-zinc-500 dark:text-emerald-400 cursor-pointer ${loadingWeather ? 'animate-spin' : ''}`} 
                />
              </div>

              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-emerald-100 dark:bg-emerald-800/50 rounded-full flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
                  {weather && weather.sunrise && weather.sunset && (new Date().getTime() > weather.sunrise && new Date().getTime() < weather.sunset) ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                </div>
                
                {weather ? (
                  <div className="grid grid-cols-4 sm:grid-cols-5 gap-x-1 gap-y-1 flex-1 w-full">
                    <div className="flex flex-col bg-white/40 dark:bg-black/20 p-1 rounded-lg">
                      <span className="text-[6px] font-bold text-zinc-500 uppercase tracking-wider">Temp</span>
                      <span className="text-[10px] font-black text-zinc-900 dark:text-emerald-50 leading-none">{Math.round(weather.temp)}°C</span>
                    </div>
                    <div className="flex flex-col bg-white/40 dark:bg-black/20 p-1 rounded-lg">
                      <span className="text-[6px] font-bold text-zinc-500 uppercase tracking-wider">Condición</span>
                      <span className="text-[10px] font-black text-zinc-900 dark:text-emerald-50 leading-none truncate" title={weather.condition}>{weather.condition}</span>
                    </div>
                    <div className="flex flex-col bg-white/40 dark:bg-black/20 p-1 rounded-lg">
                      <span className="text-[6px] font-bold text-zinc-500 uppercase tracking-wider">Viento</span>
                      <span className="text-[10px] font-black text-zinc-900 dark:text-emerald-50 leading-none">{Math.round(weather.windSpeed || 0)} <span className="text-[7px]">km/h</span></span>
                    </div>
                    <div className="flex flex-col bg-white/40 dark:bg-black/20 p-1 rounded-lg">
                      <span className="text-[6px] font-bold text-zinc-500 uppercase tracking-wider">Humedad</span>
                      <span className="text-[10px] font-black text-zinc-900 dark:text-emerald-50 leading-none">{weather.humidity}%</span>
                    </div>
                    <div className="flex flex-col bg-white/40 dark:bg-black/20 p-1 rounded-lg">
                      <span className="text-[6px] font-bold text-zinc-500 uppercase tracking-wider">UV Max</span>
                      <span className="text-[10px] font-black text-amber-600 dark:text-amber-400 leading-none">{weather.uv}</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-[10px] text-zinc-500">Cargando...</p>
                )}
              </div>
              
              <div className="flex flex-wrap gap-1 mt-1.5">
                {weather?.windSpeed && weather.windSpeed > 40 && (
                  <span className="flex items-center gap-0.5 bg-rose-500 text-white px-1 py-0.5 rounded text-[7px] font-bold uppercase tracking-widest shadow-sm">
                    <Wind className="w-2 h-2" /> Alerta Viento
                  </span>
                )}
                {weather?.temp && weather.temp > 30 && (
                  <span className="flex items-center gap-0.5 bg-rose-500 text-white px-1 py-0.5 rounded text-[7px] font-bold uppercase tracking-widest shadow-sm">
                    <AlertTriangle className="w-2 h-2" /> Estrés Térmico
                  </span>
                )}
                {weather?.condition?.toLowerCase().includes('lluvia') && (
                  <span className="flex items-center gap-0.5 bg-blue-500 text-white px-1 py-0.5 rounded text-[7px] font-bold uppercase tracking-widest shadow-sm">
                    <Droplets className="w-2 h-2" /> Lluvia
                  </span>
                )}
                {weather?.temp && weather.temp <= 30 && (!weather.windSpeed || weather.windSpeed <= 40) && (!weather.condition?.toLowerCase().includes('lluvia')) && (
                  <span className="flex items-center gap-0.5 bg-emerald-500 text-white px-1 py-0.5 rounded text-[7px] font-bold uppercase tracking-widest shadow-sm">
                    <CheckCircle2 className="w-2 h-2" /> Óptimo
                  </span>
                )}
              </div>
            </div>

            <div className="w-full sm:w-[80px] shrink-0 sm:border-l border-t sm:border-t-0 border-emerald-500/10 pt-1.5 sm:pt-0 sm:pl-2 flex flex-col justify-center relative">
              <div className="flex justify-between text-[7px] font-bold text-zinc-500 dark:text-emerald-400/70 mb-0.5">
                <span>{weather?.sunrise ? new Date(weather.sunrise).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) : '07:00'}</span>
                <span>{weather?.sunset ? new Date(weather.sunset).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) : '19:00'}</span>
              </div>
              <div className="relative w-full h-4 overflow-visible mt-0.5">
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
                      r="4" 
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
          className="rounded-xl p-2 shadow-sm relative overflow-hidden border bg-zinc-100 dark:bg-zinc-900/50 border-zinc-500/10 cursor-pointer hover:border-emerald-500/30 transition-colors group"
        >
          <div className="absolute -right-4 -bottom-4 opacity-5 group-hover:scale-110 transition-transform">
            <Target className="w-20 h-20 text-emerald-500" />
          </div>
          <div className="flex flex-col justify-between h-full relative z-10">
            <div className="flex justify-between items-start mb-1">
              <div className="flex items-center gap-2">
                <h2 className="text-[10px] font-black text-zinc-900 dark:text-white tracking-tight leading-none uppercase">Cumplimiento</h2>
                <p className="text-[8px] text-zinc-600 dark:text-zinc-400 flex items-center gap-1 truncate max-w-[120px]">
                  <Briefcase className="w-2.5 h-2.5" /> {complianceData.label}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative flex flex-col items-center justify-center w-8 h-8 shrink-0">
                <svg className="w-full h-full transform -rotate-90">
                  <circle
                    cx="50%"
                    cy="50%"
                    r="40%"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    fill="transparent"
                    className="text-zinc-200 dark:text-zinc-800"
                  />
                  <circle
                    cx="50%"
                    cy="50%"
                    r="40%"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    fill="transparent"
                    strokeDasharray={100.5}
                    strokeDashoffset={100.5 * (1 - (complianceData.percentage / 100))}
                    className="text-emerald-500"
                  />
                </svg>
                <span className="absolute text-[8px] font-black text-zinc-900 dark:text-white">
                  {complianceData.percentage}%
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[9px] font-bold text-zinc-900 dark:text-white leading-tight truncate">
                  {complianceData.percentage >= 90 ? 'Nivel Óptimo' : complianceData.percentage >= 70 ? 'Nivel Aceptable' : 'Requiere Atención'}
                </p>
                <div className="flex items-center gap-1 mt-0.5">
                  <div className="text-[7px] font-medium text-zinc-500 dark:text-zinc-400 truncate">
                    Falta {100 - complianceData.percentage}%
                  </div>
                </div>
              </div>
            </div>
            
            <div className="mt-1 flex items-center gap-1 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 rounded text-[7px] font-bold uppercase tracking-widest shadow-sm w-fit">
              <TrendingUp className="w-2 h-2" /> Optimizar
            </div>
          </div>
        </section>
      </div>

      {/* 3. Quick Actions - Smaller */}
      <section className="grid grid-cols-2 sm:flex sm:flex-row items-stretch sm:items-center justify-center gap-1 w-full">
        <button 
          onClick={() => setIsFastCheckOpen(true)}
          className="flex-1 bg-[#22C55E] hover:bg-[#16A34A] text-white px-1 py-1 rounded-md font-black uppercase tracking-widest text-[8px] shadow-sm transition-transform hover:scale-105 flex flex-col sm:flex-row items-center justify-center gap-1 overflow-hidden"
        >
          <Eye className="w-3 h-3 shrink-0" /> <span className="truncate">Fast Check</span>
        </button>
        <button 
          onClick={() => setIsPlannerOpen(true)}
          className="flex-1 bg-amber-500 hover:bg-amber-600 text-white px-1 py-1 rounded-md font-black uppercase tracking-widest text-[8px] shadow-sm transition-transform hover:scale-105 flex flex-col sm:flex-row items-center justify-center gap-1 overflow-hidden"
        >
          <Target className="w-3 h-3 shrink-0" /> <span className="truncate">Planificador</span>
        </button>
        <Link to="/emergency" className="flex-1 bg-[#EF4444] hover:bg-[#DC2626] text-white px-1 py-1 rounded-md font-black uppercase tracking-widest text-[8px] shadow-sm transition-transform hover:scale-105 flex flex-col sm:flex-row items-center justify-center gap-1 overflow-hidden">
          <Zap className="w-3 h-3 shrink-0" /> <span className="truncate">Emergencia</span>
        </Link>
        <Link to="/site-map" className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white px-1 py-1 rounded-md font-black uppercase tracking-widest text-[8px] shadow-sm transition-transform hover:scale-105 flex flex-col sm:flex-row items-center justify-center gap-1 overflow-hidden">
          <Map className="w-3 h-3 shrink-0" /> <span className="truncate">Mapa Vivo</span>
        </Link>
      </section>

      {/* 4. Real-Time Status Widget */}
      <RealTimeStatusWidget />

      {/* EPP Widget - Full Width & Compact */}
      <section className="w-full">
        <div className="bg-[#4ADE80] p-2 rounded-xl shadow-sm relative border border-white/20 w-full flex flex-col justify-center items-center">
          <div className="absolute -top-2 bg-[#22C55E] text-white px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest shadow-sm flex items-center gap-1 border border-white/20 whitespace-nowrap z-10">
            EPP Requerido
          </div>
          
          <div className="flex items-center justify-center gap-2 w-full flex-1 mt-1">
            <div className="flex gap-1.5">
              <div className="bg-white p-1 rounded-lg shadow-sm text-center w-10 border border-transparent hover:border-black cursor-pointer transition-all">
                <div className="text-base leading-none mb-0.5">👷</div>
                <div className="bg-black text-white text-[7px] font-black py-0.5 rounded-sm uppercase leading-tight">Casco</div>
              </div>
              <div className="bg-white p-1 rounded-lg shadow-sm text-center w-10 border border-transparent hover:border-black cursor-pointer transition-all">
                <div className="text-base leading-none mb-0.5">🧤</div>
                <div className="bg-black text-white text-[7px] font-black py-0.5 rounded-sm uppercase leading-tight">Guantes</div>
              </div>
            </div>

            <div className="bg-white/40 backdrop-blur-sm rounded-xl p-1.5 shadow-inner w-10 h-10 flex flex-col items-center justify-center border border-dashed border-white/60 shrink-0 group hover:border-white transition-all">
              <Shield className="w-4 h-4 text-emerald-800/40 group-hover:text-emerald-800/60 transition-colors mb-0.5" />
              <span className="text-emerald-800/40 text-[6px] font-black uppercase tracking-widest text-center px-0.5 leading-tight group-hover:text-emerald-800/60 transition-colors">Praeventio</span>
            </div>

            <div className="flex gap-1.5">
              <div className="bg-white p-1 rounded-lg shadow-sm text-center w-10 border border-transparent hover:border-black cursor-pointer transition-all">
                <div className="text-base leading-none mb-0.5">🥽</div>
                <div className="bg-black text-white text-[7px] font-black py-0.5 rounded-sm uppercase leading-tight">Lentes</div>
              </div>
              <div className="bg-white p-1 rounded-lg shadow-sm text-center w-10 border border-transparent hover:border-black cursor-pointer transition-all">
                <div className="text-base leading-none mb-0.5">🥾</div>
                <div className="bg-black text-white text-[7px] font-black py-0.5 rounded-sm uppercase leading-tight">Zapatos</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 6. Module Carousel - Compact and Fixed at Bottom */}
      <section className="fixed sm:sticky bottom-0 left-0 right-0 z-40 bg-white dark:bg-zinc-950 border-t border-zinc-100 dark:border-zinc-800 pt-2 sm:pt-1 pb-2 sm:pb-1 overflow-hidden">
        <div className="flex gap-2 sm:gap-1.5 animate-marquee hover:[animation-play-state:paused] w-max px-2 sm:px-0">
          {[...modules, ...modules].map((module, i) => (
            <div
              key={i}
              className="flex-shrink-0"
            >
              <Link 
                to={module.path}
                className={`${module.color} w-[120px] sm:w-[90px] h-[36px] sm:h-[28px] rounded-lg p-2 sm:p-1 flex items-center justify-center gap-2 sm:gap-1 shadow-sm cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-md border border-white/10 active:scale-95`}
              >
                <module.icon className="w-4 h-4 sm:w-3.5 sm:h-3.5 text-white shrink-0" />
                <h3 className="text-white text-xs sm:text-[9px] font-black uppercase tracking-widest leading-tight text-center truncate">{module.title}</h3>
              </Link>
            </div>
          ))}
        </div>
      </section>

      <FastCheckModal 
        isOpen={isFastCheckOpen} 
        onClose={() => setIsFastCheckOpen(false)} 
      />

      {/* Planner Modal */}
      <AnimatePresence>
        {isPlannerOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-zinc-900 border border-white/10 rounded-2xl w-full max-w-md p-4 sm:p-6 flex flex-col relative overflow-hidden group shadow-2xl"
            >
              <button 
                onClick={() => setIsPlannerOpen(false)}
                className="absolute top-4 right-4 text-zinc-400 hover:text-white z-20"
              >
                <Plus className="w-6 h-6 rotate-45" />
              </button>

              <div className="absolute top-0 right-0 p-2 opacity-5 group-hover:scale-110 transition-transform pointer-events-none">
                <Target className="w-32 h-32 text-amber-500" />
              </div>
              
              <div className="relative z-10 flex flex-col h-full">
                <div className="flex items-center justify-between mb-6 shrink-0 pr-8">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-amber-500/20 flex items-center justify-center text-amber-500">
                      <Zap className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="text-lg font-black text-white uppercase tracking-widest leading-none">Planificador</h3>
                      <p className="text-xs text-zinc-500 font-bold uppercase tracking-widest mt-1">{industry}</p>
                    </div>
                  </div>
                </div>

                {/* Tabs */}
                <div className="flex gap-2 mb-6 bg-white/5 p-1.5 rounded-xl shrink-0">
                  {(['daily', 'weekly', 'monthly', 'annual'] as ChallengePeriod[]).map((period) => (
                    <button
                      key={period}
                      onClick={() => setActivePeriod(period)}
                      className={`flex-1 py-2 rounded-lg text-[10px] sm:text-xs font-black uppercase tracking-widest transition-all ${
                        activePeriod === period 
                          ? 'bg-amber-500 text-white shadow-sm shadow-amber-500/20' 
                          : 'text-zinc-500 hover:text-zinc-300'
                      }`}
                    >
                      {period === 'daily' ? 'Día' : period === 'weekly' ? 'Sem' : period === 'monthly' ? 'Mes' : 'Año'}
                    </button>
                  ))}
                </div>

                <div className="flex-1">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs text-zinc-400 font-bold uppercase tracking-widest">
                      Objetivos ({getCompletedCount(activePeriod)}/{currentChallenges[activePeriod].length})
                    </p>
                    <button 
                      onClick={handleSyncCalendar}
                      className="p-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-zinc-400 hover:text-white transition-all flex items-center gap-1.5"
                    >
                      <Calendar className="w-4 h-4" />
                      <span className="text-[10px] font-black uppercase tracking-widest">Sync</span>
                    </button>
                  </div>
                  <div className="grid grid-cols-1 gap-2 max-h-[40vh] overflow-y-auto custom-scrollbar pr-2">
                    {currentChallenges[activePeriod].map((challenge, i) => {
                      const isCompleted = isChallengeCompleted(challenge, activePeriod);
                      
                      return (
                        <button
                          key={i}
                          disabled={isCompleted}
                          onClick={() => toggleObjective(challenge)}
                          className={`flex items-center justify-between p-4 rounded-xl border transition-all text-left ${
                            isCompleted 
                              ? 'bg-amber-500/10 border-amber-500/50 text-white opacity-60' 
                              : 'bg-white/5 border-white/5 text-zinc-400 hover:border-white/10 hover:text-white'
                          }`}
                        >
                          <span className={`text-xs font-bold uppercase tracking-widest mr-3 ${isCompleted ? 'line-through' : ''}`}>{challenge}</span>
                          {isCompleted ? (
                            <CheckCircle2 className="w-5 h-5 text-amber-500 shrink-0" />
                          ) : (
                            <Plus className="w-5 h-5 text-zinc-600 shrink-0" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-white/5 flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded-full ${getCompletedCount(activePeriod) === currentChallenges[activePeriod].length ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'}`} />
                    <span className="text-xs font-black text-amber-500 uppercase tracking-widest">
                      {getCompletedCount(activePeriod) === currentChallenges[activePeriod].length ? 'Completado' : 'Pendiente'}
                    </span>
                  </div>
                  <Link to="/calendar" onClick={() => setIsPlannerOpen(false)} className="text-xs font-black text-white uppercase tracking-widest hover:text-amber-500 transition-colors flex items-center gap-1.5">
                    Calendario <ChevronRight className="w-4 h-4" />
                  </Link>
                </div>
              </div>
            </motion.div>
          </motion.div>
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
