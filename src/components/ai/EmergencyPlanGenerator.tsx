import { useState } from 'react';
import { generateEmergencyPlan } from '../../services/geminiService';
import { useUniversalKnowledge } from '../../contexts/UniversalKnowledgeContext';
import { useProject } from '../../contexts/ProjectContext';
import { useZettelkasten } from '../../hooks/useZettelkasten';
import { NodeType } from '../../types';
import { FileText, Loader2, Zap, Shield, CheckCircle2, Save, Download, X } from 'lucide-react';
import { Button } from '../shared/Card';
import ReactMarkdown from 'react-markdown';

export function EmergencyPlanGenerator() {
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const { nodes } = useUniversalKnowledge();
  const { selectedProject } = useProject();
  const { addNode } = useZettelkasten();

  const handleGenerate = async () => {
    if (!selectedProject) return;
    setLoading(true);
    setPlan(null);
    setSaved(false);
    try {
      const context = nodes
        .filter(n => n.projectId === selectedProject.id)
        .map(n => `- [${n.type}] ${n.title}: ${n.description}`)
        .join('\n');

      const result = await generateEmergencyPlan(selectedProject.name, context);
      setPlan(result);
    } catch (error) {
      console.error('Error generating emergency plan:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!plan || !selectedProject) return;
    setLoading(true);
    try {
      await addNode({
        type: NodeType.NORMATIVE,
        title: `Plan de Emergencia IA: ${selectedProject.name}`,
        description: plan,
        tags: ['PE', 'IA', 'Emergencia', selectedProject.name],
        projectId: selectedProject.id,
        connections: [],
        metadata: {
          generatedBy: 'El Guardián AI',
          type: 'Emergency Plan',
          timestamp: new Date().toISOString()
        }
      });
      setSaved(true);
    } catch (error) {
      console.error('Error saving emergency plan:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="bg-zinc-900/50 border border-white/10 rounded-3xl p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-rose-500/10 rounded-2xl flex items-center justify-center text-rose-500 border border-rose-500/20">
            <Shield className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-xl font-black text-white uppercase tracking-tight">Generador de Planes de Emergencia</h3>
            <p className="text-xs text-zinc-500 font-medium uppercase tracking-widest">Generación automática basada en el Zettelkasten</p>
          </div>
        </div>
        {!plan ? (
          <Button
            onClick={handleGenerate}
            disabled={loading || !selectedProject}
            className="bg-rose-600 hover:bg-rose-700 text-white px-6 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all flex items-center gap-2 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            Generar Plan
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            <Button
              onClick={handleSave}
              disabled={loading || saved}
              className={`px-4 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center gap-2 transition-all ${
                saved ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' : 'bg-zinc-800 text-white hover:bg-zinc-700'
              }`}
            >
              {saved ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
              {saved ? 'Guardado' : 'Guardar'}
            </Button>
            <Button
              onClick={() => setPlan(null)}
              variant="outline"
              className="p-2 rounded-xl border-white/10 text-zinc-500 hover:text-white"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>

      {!selectedProject && (
        <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-center gap-3 text-amber-500">
          <AlertCircle className="w-5 h-5" />
          <p className="text-xs font-bold uppercase tracking-widest">Selecciona un proyecto para generar su plan de emergencia.</p>
        </div>
      )}

      {plan && (
        <div className="mt-6 p-8 bg-black/40 rounded-[32px] border border-white/5 max-h-[500px] overflow-y-auto custom-scrollbar">
          <div className="markdown-body prose prose-invert max-w-none">
            <ReactMarkdown>
              {plan}
            </ReactMarkdown>
          </div>
        </div>
      )}
    </section>
  );
}

function AlertCircle(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}
