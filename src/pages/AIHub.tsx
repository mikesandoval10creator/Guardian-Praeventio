import React from 'react';
import { Link } from 'react-router-dom';
import { Brain, Zap, Shield, Database, Network, Cpu, TrendingUp, Loader2, Share2, WifiOff } from 'lucide-react';
import { VisionAnalyzer } from '../components/ai/VisionAnalyzer';
import { PredictiveAnalysis } from '../components/ai/PredictiveAnalysis';
import { EthicsGuardian } from '../components/ai/EthicsGuardian';
import { ReportGenerator } from '../components/ai/ReportGenerator';
import { EmergencyPlanGenerator } from '../components/ai/EmergencyPlanGenerator';
import { IncidentInvestigation } from '../components/emergency/IncidentInvestigation';
import { ComplianceAuditor } from '../components/ai/ComplianceAuditor';
import { RiskNetworkExplorer } from '../components/risk-network/RiskNetworkExplorer';
import { RiskNetworkManager } from '../components/risk-network/RiskNetworkManager';
import { RiskNetworkHealth } from '../components/risk-network/RiskNetworkHealth';
import { SafetyForecast } from '../components/ai/SafetyForecast';
import { EmergencySimulator } from '../components/ai/EmergencySimulator';
import { useUniversalKnowledge } from '../contexts/UniversalKnowledgeContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { motion } from 'framer-motion';

import { PremiumFeatureGuard } from '../components/shared/PremiumFeatureGuard';
import { BlueprintViewer } from '../components/blueprints/BlueprintViewer';
import { StructuralCalculator } from '../components/engineering/StructuralCalculator';
import { HazmatStorageDesigner } from '../components/engineering/HazmatStorageDesigner';

export function AIHub() {
  const { nodes, stats, loading: nodesLoading } = useUniversalKnowledge();
  const isOnline = useOnlineStatus();

  return (
    <PremiumFeatureGuard featureName="AI Hub Predictivo" description="Accede a la inteligencia artificial avanzada para predecir accidentes, analizar imágenes en tiempo real y generar planes de emergencia automáticamente.">
      <div className="p-4 sm:p-8 max-w-7xl mx-auto space-y-8 sm:space-y-12">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 sm:gap-6">
        <div className="space-y-1.5 sm:space-y-2">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-500 border border-emerald-500/20 shrink-0">
              <Shield className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <h1 className="text-xl sm:text-4xl font-black text-zinc-900 dark:text-white uppercase tracking-tighter leading-tight">AI Hub: El Guardián</h1>
          </div>
          <p className="text-zinc-500 font-medium text-[10px] sm:text-lg">Conciencia Situacional Automatizada y Análisis Predictivo</p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4 mt-2 sm:mt-0">
          <Link 
            to={isOnline ? "/knowledge-ingestion" : "#"} 
            onClick={(e) => { if (!isOnline) e.preventDefault(); }}
            className={`px-4 py-2.5 sm:py-2 rounded-xl font-bold text-xs sm:text-sm transition-all flex items-center justify-center gap-2 ${
              !isOnline 
                ? 'bg-zinc-800/50 text-zinc-500 cursor-not-allowed' 
                : 'bg-emerald-500 hover:bg-emerald-600 text-white'
            }`}
            title={!isOnline ? 'Requiere conexión a internet' : ''}
          >
            {!isOnline ? <WifiOff className="w-4 h-4" /> : <Database className="w-4 h-4" />}
            {!isOnline ? 'Requiere Conexión' : 'Entrenar IA'}
          </Link>
          <div className="flex items-center justify-center gap-3 sm:gap-4 bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/5 rounded-xl sm:rounded-2xl p-3 sm:p-4">
            <div className={`w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full ${isOnline ? 'bg-emerald-500 animate-pulse shadow-[0_0_10px_rgba(16,185,129,0.5)]' : 'bg-rose-500'} shrink-0`} />
            <span className={`text-[8px] sm:text-[10px] font-black ${isOnline ? 'text-emerald-600 dark:text-emerald-500' : 'text-rose-600 dark:text-rose-500'} uppercase tracking-widest truncate`}>
              Guardian Praeventio: {isOnline ? 'Online' : 'Offline'}
            </span>
          </div>
        </div>
      </header>

      {/* Global Knowledge Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6">
        {[
          { label: 'Nodos Globales', value: nodes.length, icon: Database, color: 'text-blue-500', bg: 'bg-blue-500/10' },
          { label: 'Conexiones (Sinapsis)', value: stats.totalConnections, icon: Network, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
          { label: 'Proyectos Conectados', value: stats.projectCount, icon: Cpu, color: 'text-indigo-500', bg: 'bg-indigo-500/10' },
          { label: 'Densidad de Red', value: `${stats.avgConnections}/n`, icon: TrendingUp, color: 'text-amber-500', bg: 'bg-amber-500/10' },
        ].map((stat, i) => (
          <motion.div 
            key={i}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 rounded-3xl p-6 shadow-xl"
          >
            <div className="flex items-center gap-4 mb-4">
              <div className={`w-12 h-12 ${stat.bg} rounded-2xl flex items-center justify-center border border-white/5`}>
                <stat.icon className={`w-6 h-6 ${stat.color}`} />
              </div>
              <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">{stat.label}</span>
            </div>
            <div className="text-4xl font-black text-zinc-900 dark:text-white tracking-tighter">
              {nodesLoading ? <Loader2 className="w-6 h-6 animate-spin text-zinc-400 dark:text-zinc-700" /> : stat.value}
            </div>
          </motion.div>
        ))}
      </div>

      {/* Predictive Forecast Section */}
      <section className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center text-indigo-500 border border-indigo-500/20">
            <TrendingUp className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl sm:text-2xl font-black text-zinc-900 dark:text-white uppercase tracking-tight">Pronóstico de Seguridad</h2>
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Análisis Predictivo a 7 Días</p>
          </div>
        </div>
        <SafetyForecast />
      </section>

      {/* Emergency Simulation Section */}
      <section className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-rose-500/10 flex items-center justify-center text-rose-500 border border-rose-500/20">
            <Zap className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl sm:text-2xl font-black text-zinc-900 dark:text-white uppercase tracking-tight">Simulacros de Emergencia IA</h2>
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Entrenamiento Dinámico Basado en Riesgos</p>
          </div>
        </div>
        <EmergencySimulator />
      </section>

      {/* Risk Network Explorer Section */}
      <section className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-500 border border-blue-500/20">
              <Network className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl sm:text-2xl font-black text-zinc-900 dark:text-white uppercase tracking-tight">Red de Conocimiento Universal</h2>
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Visualización de Inteligencia Colectiva</p>
            </div>
          </div>
          <button className="flex items-center gap-2 bg-zinc-100 dark:bg-white/5 hover:bg-zinc-200 dark:hover:bg-white/10 text-zinc-900 dark:text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border border-zinc-200 dark:border-white/5">
            <Share2 className="w-4 h-4" />
            Exportar Grafo
          </button>
        </div>
        <RiskNetworkExplorer />
      </section>

      {/* Risk Network Health Section */}
      <RiskNetworkHealth />

      {/* Risk Network Manager Section */}
      <section className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center text-indigo-500 border border-indigo-500/20">
            <Database className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl sm:text-2xl font-black text-zinc-900 dark:text-white uppercase tracking-tight">Gestión de Sinapsis</h2>
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Conexión Manual de Inteligencia Operativa</p>
          </div>
        </div>
        <RiskNetworkManager />
      </section>

      {/* Engineering and Design Section */}
      <section className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center text-orange-500 border border-orange-500/20">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl sm:text-2xl font-black text-zinc-900 dark:text-white uppercase tracking-tight">Ingeniería y Diseño Seguro</h2>
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Cálculos Estructurales y Normativa OGUC/DS43</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-8">
          <BlueprintViewer />
          <PremiumFeatureGuard featureName="Herramientas de Ingeniería" description="Actualiza a Premium para acceder a la Calculadora Estructural y Diseño de Bodegas Hazmat.">
            <div className="grid grid-cols-1 gap-8">
              <StructuralCalculator />
              <HazmatStorageDesigner />
            </div>
          </PremiumFeatureGuard>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <EmergencyPlanGenerator />
          <ComplianceAuditor />
          <IncidentInvestigation />
          <ReportGenerator />
          <EthicsGuardian />
          <PredictiveAnalysis />
          <VisionAnalyzer />
        </div>

        <div className="space-y-8">
          <section className="bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 rounded-3xl p-8 space-y-6">
            <h3 className="text-xl font-bold text-zinc-900 dark:text-white flex items-center gap-3">
              <Zap className="w-5 h-5 text-yellow-500" />
              Capacidades Activas
            </h3>
            <div className="space-y-4">
              {[
                { title: 'Red Neuronal Semántica', desc: 'Conexión automática de riesgos y normas.', icon: Brain, color: 'text-blue-500' },
                { title: 'Visión Artificial', desc: 'Detección de EPP en tiempo real.', icon: Shield, color: 'text-emerald-500' },
                { title: 'Análisis Predictivo', desc: 'Predicción de incidentes a 48h.', icon: Zap, color: 'text-yellow-500' },
                { title: 'Asistente de Voz', desc: 'Interacción manos libres en terreno.', icon: Brain, color: 'text-purple-500' },
              ].map((cap, i) => (
                <div key={i} className="flex items-start gap-4 p-4 rounded-2xl bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/5 hover:border-zinc-300 dark:hover:border-white/10 transition-colors">
                  <cap.icon className={`w-5 h-5 mt-1 ${cap.color}`} />
                  <div>
                    <h4 className="text-sm font-bold text-zinc-900 dark:text-white">{cap.title}</h4>
                    <p className="text-xs text-zinc-500 leading-relaxed">{cap.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-3xl p-8 text-white relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-20">
              <Brain className="w-24 h-24" />
            </div>
            <div className="relative z-10 space-y-4">
              <h3 className="text-xl font-black uppercase tracking-tight">Próxima Evolución</h3>
              <p className="text-blue-100 text-sm leading-relaxed">
                Estamos entrenando al Guardián para generar Planes de Emergencia dinámicos basados en la ubicación exacta del trabajador.
              </p>
              <div className="pt-4">
                <div className="w-full h-2 bg-white/20 rounded-full overflow-hidden">
                  <div className="w-[65%] h-full bg-white animate-pulse" />
                </div>
                <p className="text-[10px] font-bold mt-2 uppercase tracking-widest opacity-70">Entrenamiento: 65% completado</p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
    </PremiumFeatureGuard>
  );
}
