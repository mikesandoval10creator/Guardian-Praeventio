import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { 
  ShieldAlert, 
  TrendingUp, 
  AlertTriangle, 
  CheckCircle2, 
  Zap, 
  Brain, 
  Activity,
  Calendar,
  ArrowRight,
  Info
} from 'lucide-react';
import { Card, Button } from '../components/shared/Card';
import { useProject } from '../contexts/ProjectContext';
import { useZettelkasten } from '../hooks/useZettelkasten';
import { useUniversalKnowledge } from '../contexts/UniversalKnowledgeContext';
import { generatePredictiveForecast } from '../services/geminiService';
import { NodeType } from '../types';

export function PredictiveGuard() {
  const { selectedProject } = useProject();
  const { nodes } = useZettelkasten();
  const { environment } = useUniversalKnowledge();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [forecast, setForecast] = useState<any>(null);

  const generateForecast = async () => {
    if (!selectedProject) return;
    setIsAnalyzing(true);

    try {
      // Get relevant context from Zettelkasten
      const projectNodes = nodes.filter(n => n.projectId === selectedProject.id);
      const context = projectNodes.map(n => `- [${n.type}] ${n.title}: ${n.description}`).join('\n');
      
      const weatherContext = environment.weather ? 
        `Temperatura: ${environment.weather.temp}°C, Viento: ${environment.weather.windSpeed || 0}km/h, Condición: ${environment.weather.condition}` : 
        'Sin datos climáticos.';

      const data = await generatePredictiveForecast(selectedProject.name, context, weatherContext);
      setForecast(data);
    } catch (error) {
      console.error('Error generating forecast:', error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  useEffect(() => {
    if (selectedProject && !forecast) {
      generateForecast();
    }
  }, [selectedProject]);

  const getRiskColor = (level: string) => {
    switch (level) {
      case 'Crítico': return 'text-rose-500 bg-rose-500/10 border-rose-500/20';
      case 'Alto': return 'text-orange-500 bg-orange-500/10 border-orange-500/20';
      case 'Medio': return 'text-amber-500 bg-amber-500/10 border-amber-500/20';
      default: return 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20';
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-white uppercase tracking-tighter flex items-center gap-3">
            <ShieldAlert className="w-8 h-8 text-rose-500" />
            Guardián Predictivo
          </h1>
          <p className="text-zinc-400 text-sm font-medium mt-1">
            Análisis de datos en tiempo real para prevenir incidentes antes de que ocurran.
          </p>
        </div>
        <Button 
          onClick={generateForecast} 
          disabled={isAnalyzing}
          className="bg-zinc-900 border-white/10 hover:bg-zinc-800 text-white font-black text-[10px] uppercase tracking-widest px-8 py-4 rounded-2xl flex items-center gap-2"
        >
          <Zap className={`w-4 h-4 ${isAnalyzing ? 'animate-pulse text-amber-500' : 'text-amber-500'}`} />
          {isAnalyzing ? 'Analizando...' : 'Actualizar Pronóstico'}
        </Button>
      </div>

      {!selectedProject ? (
        <Card className="p-12 flex flex-col items-center justify-center text-center bg-zinc-900/50 border-dashed border-white/10">
          <div className="w-16 h-16 rounded-3xl bg-zinc-800 flex items-center justify-center mb-4">
            <Info className="w-8 h-8 text-zinc-500" />
          </div>
          <h2 className="text-xl font-black text-white uppercase tracking-tighter mb-2">Selecciona un Proyecto</h2>
          <p className="text-zinc-500 text-sm max-w-md">Para generar un pronóstico predictivo, primero debes seleccionar un proyecto activo.</p>
        </Card>
      ) : isAnalyzing ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-64 bg-zinc-900/50 rounded-[32px] animate-pulse border border-white/5" />
          ))}
        </div>
      ) : forecast ? (
        <div className="space-y-6">
          {/* Main Risk Score */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-1 p-8 bg-zinc-900 border-none relative overflow-hidden flex flex-col items-center justify-center text-center">
              <div className="absolute top-0 right-0 p-8 opacity-5">
                <TrendingUp className="w-32 h-32 text-white" />
              </div>
              <div className={`mb-6 px-4 py-1.5 rounded-full border text-[10px] font-black uppercase tracking-widest ${getRiskColor(forecast.riskLevel)}`}>
                Riesgo {forecast.riskLevel}
              </div>
              <div className="relative">
                <svg className="w-48 h-48 transform -rotate-90">
                  <circle
                    cx="96"
                    cy="96"
                    r="80"
                    stroke="currentColor"
                    strokeWidth="12"
                    fill="transparent"
                    className="text-zinc-800"
                  />
                  <circle
                    cx="96"
                    cy="96"
                    r="80"
                    stroke="currentColor"
                    strokeWidth="12"
                    fill="transparent"
                    strokeDasharray={502.4}
                    strokeDashoffset={502.4 - (502.4 * forecast.score) / 100}
                    className={forecast.score > 70 ? 'text-rose-500' : forecast.score > 40 ? 'text-amber-500' : 'text-emerald-500'}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-5xl font-black text-white tracking-tighter">{forecast.score}%</span>
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Probabilidad</span>
                </div>
              </div>
            </Card>

            <Card className="lg:col-span-2 p-8 bg-zinc-900 border-none space-y-6">
              <div className="flex items-center gap-3">
                <Brain className="w-6 h-6 text-emerald-500" />
                <h3 className="text-xl font-black text-white uppercase tracking-tighter">AI Insight</h3>
              </div>
              <p className="text-zinc-400 text-lg font-medium leading-relaxed italic">
                "{forecast.aiInsight}"
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
                {forecast.recommendations.map((rec: string, i: number) => (
                  <div key={i} className="flex items-start gap-3 p-4 rounded-2xl bg-white/5 border border-white/5">
                    <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                    <span className="text-sm text-zinc-300 font-medium">{rec}</span>
                  </div>
                ))}
              </div>

              {forecast.empatheticActions && forecast.empatheticActions.length > 0 && (
                <div className="mt-6 p-6 rounded-3xl bg-indigo-500/10 border border-indigo-500/20">
                  <div className="flex items-center gap-2 mb-4">
                    <Brain className="w-5 h-5 text-indigo-400" />
                    <h4 className="text-sm font-black text-indigo-400 uppercase tracking-widest">Prevención Empática (Cuidado Activo)</h4>
                  </div>
                  <div className="space-y-3">
                    {forecast.empatheticActions.map((action: string, i: number) => (
                      <div key={i} className="flex items-start gap-3">
                        <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-2 shrink-0" />
                        <p className="text-sm text-indigo-200 leading-relaxed">{action}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          </div>

          {/* Top Risks Table */}
          <div className="space-y-4">
            <h2 className="text-lg font-black text-white uppercase tracking-tighter px-2">Principales Amenazas Detectadas</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {forecast.topRisks.map((risk: any, i: number) => (
                <Card key={i} className="p-6 bg-zinc-900 border-none hover:bg-zinc-800/50 transition-all group">
                  <div className="flex justify-between items-start mb-4">
                    <div className="w-10 h-10 rounded-xl bg-rose-500/20 flex items-center justify-center text-rose-500">
                      <AlertTriangle className="w-5 h-5" />
                    </div>
                    <span className="text-[10px] font-black text-rose-500 uppercase tracking-widest">{risk.probability}% Prob.</span>
                  </div>
                  <h4 className="text-lg font-black text-white uppercase tracking-tight mb-2">{risk.title}</h4>
                  <div className="space-y-4">
                    <div>
                      <span className="text-[8px] font-bold text-zinc-500 uppercase tracking-widest block mb-1">Impacto Potencial</span>
                      <p className="text-sm text-zinc-300 font-medium">{risk.impact}</p>
                    </div>
                    <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20">
                      <span className="text-[8px] font-bold text-emerald-500 uppercase tracking-widest block mb-1">Mitigación Recomendada</span>
                      <p className="text-xs text-emerald-400 font-bold">{risk.mitigation}</p>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
