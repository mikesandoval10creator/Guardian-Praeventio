import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldCheck, AlertTriangle, CheckCircle2, Loader2, RefreshCw, ChevronDown, ChevronUp, Zap } from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { auth, db } from '../services/firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { apiAuthHeader } from '../lib/apiAuth';

interface HealthResult {
  complianceScore?: number;
  findings?: string[];
  recommendations?: string[];
  summary?: string;
  compliance?: { complianceScore?: number; criticalGaps?: string[]; recommendations?: string[] };
  timestamp?: any;
}

function ScoreRing({ score }: { score: number }) {
  const r = 28;
  const circ = 2 * Math.PI * r;
  const filled = (score / 100) * circ;
  const color = score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : '#ef4444';

  return (
    <svg width="72" height="72" className="-rotate-90">
      <circle cx="36" cy="36" r={r} fill="none" stroke="currentColor" strokeWidth="6" className="text-zinc-200 dark:text-zinc-700" />
      <motion.circle
        cx="36" cy="36" r={r} fill="none"
        stroke={color} strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={`${circ}`}
        initial={{ strokeDashoffset: circ }}
        animate={{ strokeDashoffset: circ - filled }}
        transition={{ duration: 1.2, ease: 'easeOut' }}
      />
      <text x="36" y="36" textAnchor="middle" dominantBaseline="middle" className="rotate-90 origin-center"
        fill={color} fontSize="14" fontWeight="bold" style={{ transform: 'rotate(90deg)', transformOrigin: '36px 36px' }}>
        {score}
      </text>
    </svg>
  );
}

export function ProjectHealthCheck() {
  const { selectedProject } = useProject();
  const [running, setRunning] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [result, setResult] = useState<HealthResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Listen to the cached latest result from Firestore in real-time
  useEffect(() => {
    if (!selectedProject?.id) return undefined;
    const ref = doc(db, `projects/${selectedProject.id}/health_checks/latest`);
    const unsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) setResult(snap.data() as HealthResult);
    });
    return unsub;
  }, [selectedProject?.id]);

  const runCheck = async () => {
    if (!selectedProject?.id) return;
    setRunning(true);
    setError(null);
    try {
      // §2.20 (2026-05-23) — apiAuthHeader unified.
      const authHeader = await apiAuthHeader();
      const res = await fetch(`/api/projects/${selectedProject.id}/health-check`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authHeader ? { Authorization: authHeader } : {}),
        },
      });
      if (!res.ok) throw new Error(await res.text());
      // Result arrives via Firestore onSnapshot above
    } catch (e: any) {
      setError(e.message || 'Error al ejecutar diagnóstico');
    } finally {
      setRunning(false);
    }
  };

  const score = result?.compliance?.complianceScore ?? result?.complianceScore;
  const scoreColor = score == null ? 'text-zinc-400' : score >= 80 ? 'text-emerald-500' : score >= 60 ? 'text-amber-500' : 'text-red-500';
  const scoreBg = score == null ? 'bg-zinc-100 dark:bg-zinc-800' : score >= 80 ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-700' : score >= 60 ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700' : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700';

  const findings = result?.compliance?.criticalGaps ?? result?.findings ?? [];
  const recommendations = result?.compliance?.recommendations ?? result?.recommendations ?? [];
  const summary = result?.summary;

  return (
    <div className={`rounded-2xl border p-4 transition-all duration-300 ${scoreBg}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className={`w-5 h-5 ${scoreColor}`} />
          <span className="font-semibold text-sm text-zinc-800 dark:text-white">Diagnóstico de Seguridad</span>
        </div>
        <button
          onClick={runCheck}
          disabled={running || !selectedProject}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white transition-colors"
        >
          {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          {running ? 'Analizando…' : 'Ejecutar'}
        </button>
      </div>

      {error && (
        <p className="text-xs text-red-500 mb-2 flex items-center gap-1">
          <AlertTriangle className="w-3 h-3 shrink-0" /> {error}
        </p>
      )}

      {result ? (
        <>
          {/* Score row */}
          <div className="flex items-center gap-4 mb-3">
            {score != null && <ScoreRing score={score} />}
            <div>
              {score != null && (
                <p className={`text-2xl font-black ${scoreColor}`}>{score}<span className="text-sm font-normal opacity-60">/100</span></p>
              )}
              <p className="text-xs opacity-60">
                {score == null ? 'Sin puntaje' : score >= 80 ? 'Cumplimiento sólido' : score >= 60 ? 'Requiere atención' : 'Brechas críticas detectadas'}
              </p>
              {result.timestamp?.toDate && (
                <p className="text-[10px] opacity-40 mt-0.5">
                  Último análisis: {new Date(result.timestamp.toDate()).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </p>
              )}
            </div>
          </div>

          {summary && (
            <p className="text-xs opacity-70 mb-3 leading-relaxed">{summary}</p>
          )}

          {/* Expand/collapse details */}
          {(findings.length > 0 || recommendations.length > 0) && (
            <>
              <button
                onClick={() => setExpanded(v => !v)}
                className="flex items-center gap-1 text-xs opacity-60 hover:opacity-90 transition-opacity"
              >
                {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                {expanded ? 'Ocultar detalles' : `Ver ${findings.length + recommendations.length} observaciones`}
              </button>

              <AnimatePresence>
                {expanded && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden mt-3 space-y-3"
                  >
                    {findings.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-red-500 mb-1 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" /> Brechas críticas
                        </p>
                        <ul className="space-y-1">
                          {findings.slice(0, 4).map((f, i) => (
                            <li key={i} className="text-xs opacity-70 flex items-start gap-1.5">
                              <span className="mt-0.5 shrink-0 text-red-400">•</span> {f}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {recommendations.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 mb-1 flex items-center gap-1">
                          <Zap className="w-3 h-3" /> Recomendaciones
                        </p>
                        <ul className="space-y-1">
                          {recommendations.slice(0, 4).map((r, i) => (
                            <li key={i} className="text-xs opacity-70 flex items-start gap-1.5">
                              <CheckCircle2 className="w-3 h-3 mt-0.5 shrink-0 text-emerald-500" /> {r}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          )}
        </>
      ) : (
        <p className="text-xs opacity-50 py-2">
          Ejecuta el diagnóstico para analizar el estado de seguridad del proyecto con IA.
        </p>
      )}
    </div>
  );
}
