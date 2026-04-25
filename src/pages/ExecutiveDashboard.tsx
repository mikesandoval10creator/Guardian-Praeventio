import React, { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  TrendingUp,
  TrendingDown,
  Briefcase,
  Users,
  AlertTriangle,
  ShieldCheck,
  Download,
  BrainCircuit,
  Loader2,
  BarChart3,
  Lock,
  ArrowRight,
  Activity,
  Leaf
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Legend
} from 'recharts';
import { useNavigate } from 'react-router-dom';
import { useUniversalKnowledge } from '../contexts/UniversalKnowledgeContext';
import { useProject } from '../contexts/ProjectContext';
import { useSubscription } from '../contexts/SubscriptionContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { NodeType } from '../types';
import { generateExecutiveSummary } from '../services/geminiService';
import { cacheAIResponse, getCachedAIResponse } from '../utils/pwa-offline';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

// Compliance calculation reused from Dashboard.tsx
function calculateCompliance(project: any, allNodes: any[]): number {
  if (!project) return 0;
  const projectNodes = allNodes.filter(n => n.projectId === project.id);

  const findings = projectNodes.filter(n => n.type === NodeType.FINDING);
  let findingsScore = 100;
  if (findings.length > 0) {
    const closed = findings.filter(n => {
      const s = (n.metadata?.status || n.metadata?.estado || '').toLowerCase();
      return s === 'cerrado' || s === 'cerrada' || s === 'completed' || s === 'completado' || s === 'completada';
    }).length;
    findingsScore = (closed / findings.length) * 100;
  }

  const tasks = projectNodes.filter(n => n.type === NodeType.TASK);
  let tasksScore = 100;
  if (tasks.length > 0) {
    const done = tasks.filter(n => {
      const s = (n.metadata?.status || n.metadata?.estado || '').toLowerCase();
      return s === 'completada' || s === 'completado' || s === 'completed' || s === 'cerrado' || s === 'cerrada';
    }).length;
    tasksScore = (done / tasks.length) * 100;
  }

  const trainings = projectNodes.filter(n => n.type === NodeType.TRAINING);
  let trainingsScore = 100;
  if (trainings.length > 0) {
    const done = trainings.filter(n => n.metadata?.status === 'completed' || n.metadata?.estado === 'Completada').length;
    trainingsScore = (done / trainings.length) * 100;
  }

  return Math.round((findingsScore + tasksScore + trainingsScore) / 3);
}

function UpgradeBlock() {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6">
      <div className="w-20 h-20 rounded-3xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mb-6">
        <Lock className="w-10 h-10 text-violet-500" />
      </div>
      <h2 className="text-2xl font-black text-zinc-900 dark:text-white uppercase tracking-tighter mb-2">Dashboard Ejecutivo</h2>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-sm mb-6">
        Disponible para planes <strong className="text-violet-500">Empresa</strong> y <strong className="text-violet-500">Corporativo</strong>.
        KPIs multi-proyecto, tendencias, exportación PDF y resúmenes IA para gerencia.
      </p>
      <button
        onClick={() => navigate('/pricing')}
        className="flex items-center gap-2 px-6 py-3 bg-violet-600 hover:bg-violet-500 text-white rounded-xl text-sm font-black uppercase tracking-widest transition-colors"
      >
        Ver Planes <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  );
}

const CHART_COLORS = ['#EF4444', '#F97316', '#EAB308', '#22C55E', '#3B82F6', '#8B5CF6', '#F43F5E', '#06B6D4'];

export function ExecutiveDashboard() {
  const { nodes, loading } = useUniversalKnowledge();
  const { projects } = useProject();
  const { canAccessExecutiveDashboard, plan } = useSubscription();
  const isOnline = useOnlineStatus();
  const navigate = useNavigate();
  const reportRef = useRef<HTMLDivElement>(null);

  const [executiveSummary, setExecutiveSummary] = useState<any>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  if (!canAccessExecutiveDashboard) {
    return <UpgradeBlock />;
  }

  // ---- KPI calculations ----
  const allIncidents = nodes.filter(n => n.type === NodeType.INCIDENT);
  const allRisks = nodes.filter(n => n.type === NodeType.RISK);

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const recentIncidents = allIncidents.filter(n => new Date(n.createdAt) >= thirtyDaysAgo);

  const totalWorkers = projects.reduce((acc, p) => acc + (p.workerCount ?? 0), 0);
  const avgCompliance = projects.length > 0
    ? Math.round(projects.reduce((acc, p) => acc + calculateCompliance(p, nodes), 0) / projects.length)
    : 0;

  // ---- Chart data ----

  // Incident trend (last 6 months)
  const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const now = new Date();
  const incidentTrend = Array.from({ length: 6 }, (_, i) => {
    const monthIndex = (now.getMonth() - (5 - i) + 12) % 12;
    const count = allIncidents.filter(n => new Date(n.createdAt).getMonth() === monthIndex).length;
    return { month: months[monthIndex], incidentes: count };
  });

  // Risks per project (top 5)
  const risksByProject = projects
    .map(p => ({ name: p.name.substring(0, 18), riesgos: nodes.filter(n => n.type === NodeType.RISK && n.projectId === p.id).length }))
    .sort((a, b) => b.riesgos - a.riesgos)
    .slice(0, 5);

  // Risk level distribution
  const riskLevelData = [
    { name: 'Crítico', value: allRisks.filter(r => r.metadata?.level === 'Crítico').length, color: '#EF4444' },
    { name: 'Alto',    value: allRisks.filter(r => r.metadata?.level === 'Alto').length,    color: '#F97316' },
    { name: 'Medio',   value: allRisks.filter(r => r.metadata?.level === 'Medio').length,   color: '#EAB308' },
    { name: 'Bajo',    value: allRisks.filter(r => r.metadata?.level === 'Bajo').length,    color: '#22C55E' },
  ].filter(d => d.value > 0);

  // ESG Score calculation
  const trainedWorkers = nodes.filter(n => n.type === NodeType.TRAINING && n.metadata?.status === 'completed').length;
  const esgEnvironmental = Math.min(100, 50 + nodes.filter(n => n.type === NodeType.INSPECTION).length * 3);
  const esgSocial = totalWorkers > 0 ? Math.min(100, Math.round((trainedWorkers / Math.max(totalWorkers, 1)) * 100 + 30)) : 40;
  const esgGovernance = avgCompliance;
  const esgTotal = Math.round((esgEnvironmental + esgSocial + esgGovernance) / 3);
  const esgData = [
    { subject: 'Ambiente', A: esgEnvironmental },
    { subject: 'Social',   A: esgSocial },
    { subject: 'Gobierno', A: esgGovernance },
    { subject: 'Capacitación', A: Math.min(100, trainedWorkers * 5 + 40) },
    { subject: 'Incidentes', A: Math.max(0, 100 - recentIncidents.length * 15) },
  ];

  // ISO 45001 radar
  const isoData = [
    { subject: 'EPP',      A: Math.min(100, nodes.filter(n => n.type === NodeType.EPP).length * 10 || 70) },
    { subject: 'Normativa', A: 78 },
    { subject: 'Conducta',  A: 88 },
    { subject: 'Procesos',  A: Math.min(100, nodes.filter(n => n.type === NodeType.TASK).length * 5 || 70) },
    { subject: 'Entorno',   A: Math.min(100, 60 + nodes.filter(n => n.type === NodeType.INSPECTION).length * 2) },
  ];

  // Project table
  const projectRows = projects.map(p => {
    const pIncidents = nodes.filter(n => n.type === NodeType.INCIDENT && n.projectId === p.id && new Date(n.createdAt) >= thirtyDaysAgo).length;
    return { id: p.id, name: p.name, compliance: calculateCompliance(p, nodes), incidents: pIncidents, updatedAt: p.updatedAt };
  });

  // ---- AI Summary ----
  const stats = { totalProjects: projects.length, totalWorkers, recentIncidents: recentIncidents.length, avgCompliance };

  const handleGenerateSummary = async () => {
    if (!isOnline) {
      const cached = await getCachedAIResponse('executive-summary');
      if (cached) setExecutiveSummary(cached);
      return;
    }
    setIsGenerating(true);
    try {
      const summary = await generateExecutiveSummary(stats, nodes);
      setExecutiveSummary(summary);
      await cacheAIResponse('executive-summary', summary);
    } catch {
      const cached = await getCachedAIResponse('executive-summary');
      if (cached) setExecutiveSummary(cached);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleExportPDF = async () => {
    if (!reportRef.current) return;
    setIsExporting(true);
    try {
      const canvas = await html2canvas(reportRef.current, { scale: 2, useCORS: true, logging: false });
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`Dashboard_Ejecutivo_${new Date().toISOString().split('T')[0]}.pdf`);
    } catch (err) {
      console.error('PDF export error:', err);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-violet-500/10 flex items-center justify-center border border-violet-500/20">
            <BarChart3 className="w-6 h-6 text-violet-500" />
          </div>
          <div>
            <h1 className="text-2xl font-black uppercase tracking-tighter text-zinc-900 dark:text-white">Dashboard Ejecutivo</h1>
            <p className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">KPIs Cross-Proyecto · Plan {plan.charAt(0).toUpperCase() + plan.slice(1)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleGenerateSummary}
            disabled={isGenerating}
            className="flex items-center gap-2 px-4 py-2 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors disabled:opacity-50"
          >
            {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <BrainCircuit className="w-4 h-4 text-emerald-400 dark:text-emerald-600" />}
            {isOnline ? 'Resumen IA' : 'Cargar Resumen'}
          </button>
          <button
            onClick={handleExportPDF}
            disabled={isExporting}
            className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-50"
          >
            {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Exportar PDF
          </button>
        </div>
      </div>

      {/* Report container (captured for PDF) */}
      <div ref={reportRef} className="space-y-6">

        {/* AI Summary */}
        {executiveSummary && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="bg-gradient-to-br from-violet-500/5 to-blue-500/5 border border-violet-500/20 rounded-2xl p-6">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-violet-500 mb-3 flex items-center gap-2">
              <BrainCircuit className="w-3 h-3" /> Resumen Ejecutivo IA
            </h3>
            <div className="text-sm text-zinc-700 dark:text-zinc-300 space-y-2">
              {typeof executiveSummary === 'string'
                ? executiveSummary.split('\n').filter(Boolean).map((line, i) => <p key={i}>{line}</p>)
                : <pre className="whitespace-pre-wrap text-xs">{JSON.stringify(executiveSummary, null, 2)}</pre>}
            </div>
          </motion.div>
        )}

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Proyectos Activos', value: projects.length, icon: Briefcase, color: 'text-blue-500', bg: 'bg-blue-500/10 border-blue-500/20', trend: null },
            { label: 'Trabajadores', value: totalWorkers || projects.length, icon: Users, color: 'text-emerald-500', bg: 'bg-emerald-500/10 border-emerald-500/20', trend: null },
            { label: 'Incidentes (30 días)', value: recentIncidents.length, icon: AlertTriangle, color: 'text-rose-500', bg: 'bg-rose-500/10 border-rose-500/20', trend: recentIncidents.length > 0 ? 'up' : 'down' },
            { label: 'Cumplimiento Prom.', value: `${avgCompliance}%`, icon: ShieldCheck, color: 'text-violet-500', bg: 'bg-violet-500/10 border-violet-500/20', trend: avgCompliance >= 70 ? 'down' : 'up' },
          ].map((kpi, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
              className="bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/5 rounded-2xl p-5"
            >
              <div className="flex items-center justify-between mb-3">
                <div className={`w-9 h-9 rounded-xl ${kpi.bg} flex items-center justify-center border`}>
                  <kpi.icon className={`w-4 h-4 ${kpi.color}`} />
                </div>
                {kpi.trend && (
                  kpi.trend === 'up'
                    ? <TrendingUp className="w-4 h-4 text-rose-500" />
                    : <TrendingDown className="w-4 h-4 text-emerald-500" />
                )}
              </div>
              <p className={`text-2xl font-black ${kpi.color}`}>{kpi.value}</p>
              <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 mt-1">{kpi.label}</p>
            </motion.div>
          ))}
        </div>

        {/* Charts row 1 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Incident trend */}
          <div className="bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/5 rounded-2xl p-5">
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-4 flex items-center gap-2">
              <Activity className="w-3 h-3" /> Tendencia de Incidentes (6 meses)
            </p>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={incidentTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#71717a' }} />
                <YAxis tick={{ fontSize: 10, fill: '#71717a' }} allowDecimals={false} />
                <Tooltip contentStyle={{ background: '#18181b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: 11 }} />
                <Line type="monotone" dataKey="incidentes" stroke="#EF4444" strokeWidth={2} dot={{ fill: '#EF4444', r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Risks by project */}
          <div className="bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/5 rounded-2xl p-5">
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-4 flex items-center gap-2">
              <AlertTriangle className="w-3 h-3" /> Riesgos por Proyecto (Top 5)
            </p>
            {risksByProject.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={risksByProject} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis type="number" tick={{ fontSize: 10, fill: '#71717a' }} allowDecimals={false} />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: '#71717a' }} width={100} />
                  <Tooltip contentStyle={{ background: '#18181b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: 11 }} />
                  <Bar dataKey="riesgos" fill="#3B82F6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[200px] flex items-center justify-center text-zinc-500 text-xs">Sin datos de riesgos</div>
            )}
          </div>
        </div>

        {/* Charts row 2 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Risk level pie */}
          <div className="bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/5 rounded-2xl p-5">
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-4">Distribución de Riesgos por Nivel</p>
            {riskLevelData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={riskLevelData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" label={({ name, value }) => `${name}: ${value}`} labelLine={false}>
                    {riskLevelData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: '#18181b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: 11 }} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[200px] flex items-center justify-center text-zinc-500 text-xs">Sin riesgos registrados</div>
            )}
          </div>

          {/* ISO 45001 radar */}
          <div className="bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/5 rounded-2xl p-5">
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-4">Índice ISO 45001</p>
            <ResponsiveContainer width="100%" height={200}>
              <RadarChart data={isoData}>
                <PolarGrid stroke="rgba(255,255,255,0.1)" />
                <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10, fill: '#71717a' }} />
                <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 8, fill: '#71717a' }} />
                <Radar name="Índice" dataKey="A" stroke="#8B5CF6" fill="#8B5CF6" fillOpacity={0.2} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Project table */}
        <div className="bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/5 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-200 dark:border-white/5">
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Estado por Proyecto</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-[9px] font-black uppercase tracking-widest text-zinc-500">
                  <th className="text-left px-6 py-3">Proyecto</th>
                  <th className="text-center px-4 py-3">Cumplimiento</th>
                  <th className="text-center px-4 py-3">Incidentes (30d)</th>
                  <th className="text-right px-6 py-3">Actualización</th>
                </tr>
              </thead>
              <tbody>
                {projectRows.length === 0 ? (
                  <tr><td colSpan={4} className="text-center py-8 text-xs text-zinc-500">Sin proyectos</td></tr>
                ) : (
                  projectRows.map((row, i) => (
                    <tr key={row.id} className={`border-t border-zinc-100 dark:border-white/5 hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors ${i % 2 === 0 ? '' : 'bg-zinc-50/50 dark:bg-white/[0.02]'}`}>
                      <td className="px-6 py-4">
                        <p className="text-sm font-bold text-zinc-900 dark:text-white truncate max-w-[200px]">{row.name}</p>
                      </td>
                      <td className="px-4 py-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <div className="w-16 h-1.5 bg-zinc-200 dark:bg-white/10 rounded-full overflow-hidden">
                            <div className="h-full rounded-full transition-all" style={{ width: `${row.compliance}%`, backgroundColor: row.compliance >= 70 ? '#22C55E' : row.compliance >= 40 ? '#EAB308' : '#EF4444' }} />
                          </div>
                          <span className={`text-xs font-black ${row.compliance >= 70 ? 'text-emerald-500' : row.compliance >= 40 ? 'text-yellow-500' : 'text-red-500'}`}>{row.compliance}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-center">
                        <span className={`text-xs font-black ${row.incidents > 0 ? 'text-rose-500' : 'text-emerald-500'}`}>{row.incidents}</span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <span className="text-[10px] text-zinc-500">{row.updatedAt ? new Date(row.updatedAt).toLocaleDateString('es-CL') : '—'}</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ESG Score Panel */}
        <div className="bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/5 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-500/10 rounded-xl">
                <Leaf className="w-5 h-5 text-emerald-500" />
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Score ESG</p>
                <p className="text-xs text-zinc-400">Ambiental · Social · Gobernanza</p>
              </div>
            </div>
            <div className="text-right">
              <p className={`text-4xl font-black ${esgTotal >= 70 ? 'text-emerald-500' : esgTotal >= 45 ? 'text-amber-500' : 'text-rose-500'}`}>{esgTotal}</p>
              <p className="text-[10px] text-zinc-500 uppercase tracking-widest">/100</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 mb-6">
            {[
              { label: 'E — Ambiental', value: esgEnvironmental, color: 'text-emerald-500' },
              { label: 'S — Social',    value: esgSocial,        color: 'text-sky-500' },
              { label: 'G — Gobierno',  value: esgGovernance,    color: 'text-violet-500' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-zinc-50 dark:bg-black/30 rounded-xl p-3 text-center border border-zinc-100 dark:border-white/5">
                <p className={`text-2xl font-black ${color}`}>{value}</p>
                <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest mt-1">{label}</p>
              </div>
            ))}
          </div>

          <ResponsiveContainer width="100%" height={180}>
            <RadarChart data={esgData}>
              <PolarGrid stroke="rgba(255,255,255,0.08)" />
              <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10, fill: '#71717a' }} />
              <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 8, fill: '#71717a' }} />
              <Radar name="ESG" dataKey="A" stroke="#10b981" fill="#10b981" fillOpacity={0.18} />
            </RadarChart>
          </ResponsiveContainer>
        </div>

      </div>
    </div>
  );
}
