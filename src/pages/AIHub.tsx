import React from 'react';
import { Brain, Zap, Shield, Database, Network, Cpu, TrendingUp, Loader2 } from 'lucide-react';
import { VisionAnalyzer } from '../components/ai/VisionAnalyzer';
import { PredictiveAnalysis } from '../components/ai/PredictiveAnalysis';
import { EthicsGuardian } from '../components/ai/EthicsGuardian';
import { ReportGenerator } from '../components/ai/ReportGenerator';
import { EmergencyPlanGenerator } from '../components/ai/EmergencyPlanGenerator';
import { IncidentInvestigation } from '../components/emergency/IncidentInvestigation';
import { ComplianceAuditor } from '../components/ai/ComplianceAuditor';
import { useUniversalKnowledge } from '../contexts/UniversalKnowledgeContext';
import { motion } from 'framer-motion';

export function AIHub() {
  const { nodes, stats, loading: nodesLoading } = useUniversalKnowledge();

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-12">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-500 border border-emerald-500/20">
              <Shield className="w-5 h-5" />
            </div>
            <h1 className="text-4xl font-black text-white uppercase tracking-tighter">AI Hub: El Guardián</h1>
          </div>
          <p className="text-zinc-500 font-medium text-lg">Conciencia Situacional Automatizada y Análisis Predictivo</p>
        </div>
        <div className="flex items-center gap-4 bg-zinc-900/50 border border-white/5 rounded-2xl p-4">
          <div className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
          <span className="text-[10px] font-black text-emerald-500 uppercase tracking-widest">Guardian Praeventio: Online</span>
        </div>
      </header>

      {/* Global Knowledge Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
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
            className="bg-zinc-900/50 border border-white/10 rounded-3xl p-6 shadow-xl"
          >
            <div className="flex items-center gap-4 mb-4">
              <div className={`w-12 h-12 ${stat.bg} rounded-2xl flex items-center justify-center border border-white/5`}>
                <stat.icon className={`w-6 h-6 ${stat.color}`} />
              </div>
              <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">{stat.label}</span>
            </div>
            <div className="text-4xl font-black text-white tracking-tighter">
              {nodesLoading ? <Loader2 className="w-6 h-6 animate-spin text-zinc-700" /> : stat.value}
            </div>
          </motion.div>
        ))}
      </div>

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
          <section className="bg-zinc-900/50 border border-white/10 rounded-3xl p-8 space-y-6">
            <h3 className="text-xl font-bold text-white flex items-center gap-3">
              <Zap className="w-5 h-5 text-yellow-500" />
              Capacidades Activas
            </h3>
            <div className="space-y-4">
              {[
                { title: 'Zettelkasten Semántico', desc: 'Conexión automática de riesgos y normas.', icon: Brain, color: 'text-blue-500' },
                { title: 'Visión Artificial', desc: 'Detección de EPP en tiempo real.', icon: Shield, color: 'text-emerald-500' },
                { title: 'Análisis Predictivo', desc: 'Predicción de incidentes a 48h.', icon: Zap, color: 'text-yellow-500' },
                { title: 'Asistente de Voz', desc: 'Interacción manos libres en terreno.', icon: Brain, color: 'text-purple-500' },
              ].map((cap, i) => (
                <div key={i} className="flex items-start gap-4 p-4 rounded-2xl bg-white/5 border border-white/5 hover:border-white/10 transition-colors">
                  <cap.icon className={`w-5 h-5 mt-1 ${cap.color}`} />
                  <div>
                    <h4 className="text-sm font-bold text-white">{cap.title}</h4>
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
  );
}
