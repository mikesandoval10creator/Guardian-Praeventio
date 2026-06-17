import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users, UserCheck, Radio, ShieldAlert, MapPin, AlertTriangle, CheckCircle2,
  Search, Clock, Award, Flame, HeartPulse, Megaphone, Loader2,
} from 'lucide-react';
import { Card, Button } from '../shared/Card';
import { useFirebase } from '../../contexts/FirebaseContext';
import { useProject } from '../../contexts/ProjectContext';
import { useEmergency } from '../../contexts/EmergencyContext';
import { useEmergencyBrigade } from '../../hooks/useEmergencyBrigade';
import { useFirestoreCollection } from '../../hooks/useFirestoreCollection';
import { where } from 'firebase/firestore';
import { getBreadcrumbs } from '../../utils/offlineStorage';
import { SkillTree } from './SkillTree';
import {
  aggregateCrewMedallaStats,
  type CrewStatDoc,
  type ProcessStatDoc,
} from '../../services/gamification/crewMedallaStats';
import { useBluetoothMesh } from '../../hooks/useBluetoothMesh';
import { logger } from '../../utils/logger';
import type { Worker } from '../../types';
import type { BrigadeRole } from '../../services/emergencyBrigade/emergencyBrigadeService';

// Display labels for the canonical brigade roles (Ley 16.744 / DS 44 brigada).
const ROLE_LABEL: Record<BrigadeRole, string> = {
  brigade_chief: 'Jefe de Brigada',
  first_aid: 'Primeros Auxilios',
  fire_response: 'Respuesta a Incendios',
  evacuation_coordinator: 'Coordinador de Evacuación',
  communications: 'Comunicaciones',
};

function roleIcon(role: BrigadeRole) {
  switch (role) {
    case 'brigade_chief': return <ShieldAlert className="w-5 h-5" />;
    case 'first_aid': return <HeartPulse className="w-5 h-5" />;
    case 'fire_response': return <Flame className="w-5 h-5" />;
    case 'evacuation_coordinator': return <UserCheck className="w-5 h-5" />;
    case 'communications': return <Radio className="w-5 h-5" />;
    default: return <Users className="w-5 h-5" />;
  }
}

type Tone = 'emerald' | 'amber' | 'rose' | 'zinc';
const TONE_CLASS: Record<Tone, string> = {
  emerald: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20',
  amber: 'text-amber-500 bg-amber-500/10 border-amber-500/20',
  rose: 'text-rose-500 bg-rose-500/10 border-rose-500/20',
  zinc: 'text-zinc-500 bg-zinc-500/10 border-zinc-500/20',
};

/** Real training validity from `trainedAt` + `trainingValidYears` (no fabricated data). */
function trainingState(trainedAt: string, validYears: number): { label: string; tone: Tone } {
  const trained = new Date(trainedAt);
  if (Number.isNaN(trained.getTime())) return { label: 'Capacitación sin fecha registrada', tone: 'amber' };
  const expires = new Date(trained);
  expires.setFullYear(expires.getFullYear() + (validYears || 0));
  const fmt = expires.toLocaleDateString('es-CL');
  return expires.getTime() > Date.now()
    ? { label: `Capacitación vigente hasta ${fmt}`, tone: 'emerald' }
    : { label: `Capacitación vencida (${fmt})`, tone: 'rose' };
}

interface Breadcrumb {
  lat: number;
  lng: number;
  timestamp: number;
}

export function EmergencySquadManager() {
  const { user } = useFirebase();
  const { selectedProject } = useProject();
  const { triggerEmergency } = useEmergency();
  const { isSupported: bleSupported, isScanning: bleScanning, peerBreadcrumbs, startScanning } = useBluetoothMesh();

  const projectId = selectedProject?.id ?? null;
  // Real brigade roster (server snapshot) + the project workers to resolve names.
  const { data: brigade, loading: brigadeLoading, error: brigadeError, refetch } = useEmergencyBrigade(projectId);
  const { data: workers } = useFirestoreCollection<Worker>(
    projectId ? `projects/${projectId}/workers` : null,
  );

  // Real crew achievement stats for the SkillTree (was rendered with no props →
  // ZERO_STATS → no medalla ever unlocked). Aggregate the project's crews +
  // processes (member-readable) into a project-level MedallaStats; untracked
  // stats stay honest 0 (their medallas remain locked, never fabricated).
  const crewWhere = useMemo(
    () => (projectId ? [where('projectId', '==', projectId)] : []),
    [projectId],
  );
  const { data: crews } = useFirestoreCollection<CrewStatDoc>(
    projectId ? 'crews' : null,
    crewWhere,
  );
  const { data: processes } = useFirestoreCollection<ProcessStatDoc>(
    projectId ? 'processes' : null,
    crewWhere,
  );
  const crewStats = useMemo(
    () => aggregateCrewMedallaStats(crews ?? [], processes ?? []),
    [crews, processes],
  );

  // Join brigade members (workerUid + role + training) with the real worker
  // record (name, certifications). No live status/distance is fabricated —
  // those simply are not part of the brigade roster.
  const roster = useMemo(() => {
    const members = brigade?.members ?? [];
    const byId = new Map((workers ?? []).map((w) => [w.id, w]));
    return members.map((m) => {
      const w = byId.get(m.workerUid);
      return {
        workerUid: m.workerUid,
        name: w?.name ?? `Trabajador ${m.workerUid.slice(0, 6)}`,
        role: m.role,
        active: m.active,
        training: trainingState(m.trainedAt, m.trainingValidYears),
        certifications: w?.certifications ?? [],
      };
    });
  }, [brigade?.members, workers]);

  const [activeUid, setActiveUid] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'squad' | 'search' | 'skills'>('squad');
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([]);
  const [loadingCrumbs, setLoadingCrumbs] = useState(false);
  const [calling, setCalling] = useState(false);

  useEffect(() => {
    if (viewMode !== 'search' || !user) return;
    setLoadingCrumbs(true);
    getBreadcrumbs(user.uid, 20)
      .then(setBreadcrumbs)
      .catch(() => setBreadcrumbs([]))
      .finally(() => setLoadingCrumbs(false));
    // Also trigger BLE scan to detect nearby peers and record their breadcrumbs
    if (bleSupported) startScanning();
  }, [viewMode, user, bleSupported]);

  // "Llamado General" — real action: fan out the brigade emergency push
  // (triggerEmergency → /api/emergency/notify-brigada) for the active project.
  const handleGeneralCall = async () => {
    if (!projectId || calling) return;
    setCalling(true);
    try {
      await triggerEmergency('sos', projectId);
    } catch (err) {
      logger.error('[EmergencySquadManager] llamado general falló', err);
    } finally {
      setCalling(false);
    }
  };

  const formatTime = (ts: number) => {
    const diff = Math.floor((Date.now() - ts) / 60000);
    if (diff < 1) return 'Hace menos de 1 min';
    if (diff === 1) return 'Hace 1 min';
    return `Hace ${diff} min`;
  };

  return (
    <Card className="p-6 border-rose-500/20 bg-zinc-900/50">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-rose-500/20 rounded-lg">
            <Users className="w-6 h-6 text-rose-500" />
          </div>
          <div>
            <h2 className="text-xl font-black text-white uppercase tracking-tight">Escuadrón de Emergencia</h2>
            <p className="text-sm text-zinc-400 font-medium">Brigada del proyecto</p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {(['squad', 'search', 'skills'] as const).map(mode => (
            <Button
              key={mode}
              variant="outline"
              className={`border-zinc-700 text-zinc-300 hover:bg-zinc-800 ${viewMode === mode ? 'border-amber-500/50 text-amber-400 bg-amber-500/10' : ''}`}
              onClick={() => setViewMode(mode)}
            >
              {mode === 'squad' && <><Users className="w-4 h-4 mr-2" />Brigada</>}
              {mode === 'search' && <><Search className="w-4 h-4 mr-2" />Búsqueda</>}
              {mode === 'skills' && <><Award className="w-4 h-4 mr-2" />Habilidades</>}
            </Button>
          ))}
          <Button
            variant="outline"
            className="border-rose-500/50 text-rose-500 hover:bg-rose-500/10 disabled:opacity-50"
            onClick={handleGeneralCall}
            disabled={calling || !projectId}
          >
            {calling ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Megaphone className="w-4 h-4 mr-2" />}
            Llamado General
          </Button>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {viewMode === 'skills' ? (
          <motion.div key="skills" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
            <SkillTree crewStats={crewStats} />
          </motion.div>
        ) : viewMode === 'search' ? (
          <motion.div
            key="search"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-4"
          >
            <div className="flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl">
              <MapPin className="w-4 h-4 text-amber-500 shrink-0" />
              <p className="text-xs text-amber-400 font-bold">
                Última ruta conocida (migas de pan GPS). Muestra tus posiciones registradas offline.
              </p>
            </div>

            {loadingCrumbs ? (
              <div className="text-center py-8 text-zinc-500 text-sm">Cargando rastro GPS...</div>
            ) : breadcrumbs.length === 0 ? (
              <div className="text-center py-8 space-y-2">
                <MapPin className="w-8 h-8 text-zinc-700 mx-auto" />
                <p className="text-zinc-500 text-sm">Sin rastro GPS disponible.</p>
                <p className="text-zinc-600 text-xs">Las migas se registran automáticamente cada minuto cuando hay señal GPS.</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {breadcrumbs.map((crumb, idx) => (
                  <div key={idx} className="flex items-center gap-3 p-3 bg-black/40 border border-white/5 rounded-xl">
                    <div className={`w-3 h-3 rounded-full shrink-0 ${idx === 0 ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.8)]' : 'bg-zinc-600'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-mono text-zinc-300 truncate">
                        {crumb.lat.toFixed(5)}, {crumb.lng.toFixed(5)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 text-zinc-500 shrink-0">
                      <Clock className="w-3 h-3" />
                      <span className="text-[10px]">{formatTime(crumb.timestamp)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <p className="text-[10px] text-zinc-600 text-center">
              {breadcrumbs.length > 0 && `${breadcrumbs.length} posición(es) registrada(s) • Última: ${new Date(breadcrumbs[0]?.timestamp).toLocaleTimeString()}`}
            </p>

            {/* BLE Peer Breadcrumbs */}
            {bleSupported && (
              <div className="mt-4 border-t border-white/5 pt-4">
                <div className="flex items-center gap-2 mb-3">
                  <Radio className="w-4 h-4 text-blue-400" />
                  <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Compañeros detectados vía BLE</p>
                  {bleScanning && <span className="text-[10px] text-blue-400 animate-pulse">Escaneando...</span>}
                </div>
                {peerBreadcrumbs.length === 0 ? (
                  <p className="text-xs text-zinc-600">Sin compañeros BLE detectados en rango.</p>
                ) : (
                  <div className="space-y-2">
                    {peerBreadcrumbs.slice(0, 10).map(peer => (
                      <div key={peer.peerId} className="flex items-center gap-3 p-2 bg-blue-500/10 border border-blue-500/20 rounded-xl">
                        <div className="w-3 h-3 rounded-full bg-blue-400 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-blue-300 truncate">{peer.peerName}</p>
                          <p className="text-[10px] text-zinc-500 font-mono truncate">{peer.peerId.slice(0, 12)}…</p>
                        </div>
                        <div className="flex items-center gap-1 text-zinc-500 shrink-0">
                          <Clock className="w-3 h-3" />
                          <span className="text-[10px]">{formatTime(peer.timestamp)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </motion.div>
        ) : viewMode === 'squad' ? (
          <motion.div
            key="squad"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {brigadeLoading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-zinc-500 text-sm">
                <Loader2 className="w-4 h-4 animate-spin" /> Cargando brigada...
              </div>
            ) : brigadeError ? (
              <div className="text-center py-10 space-y-3">
                <AlertTriangle className="w-8 h-8 text-rose-500 mx-auto" />
                <p className="text-sm text-zinc-400">No se pudo cargar la brigada.</p>
                <Button variant="outline" className="border-zinc-700 text-zinc-300 hover:bg-zinc-800 min-h-11" onClick={refetch}>
                  Reintentar
                </Button>
              </div>
            ) : roster.length === 0 ? (
              <div className="text-center py-10 space-y-2">
                <Users className="w-8 h-8 text-zinc-700 mx-auto" />
                <p className="text-zinc-400 text-sm font-bold">Aún no hay brigada configurada en este proyecto.</p>
                <p className="text-zinc-600 text-xs max-w-md mx-auto">
                  Asigna miembros (con su rol y capacitación) desde la gestión de brigada de emergencia. Los integrantes aparecerán aquí con su rol y vigencia de capacitación.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <AnimatePresence>
                  {roster.map((member) => (
                    <motion.div
                      key={member.workerUid}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`p-4 rounded-xl border ${activeUid === member.workerUid ? 'border-rose-500 bg-rose-500/5' : 'border-zinc-800 bg-black/40'} transition-all cursor-pointer`}
                      onClick={() => setActiveUid(activeUid === member.workerUid ? null : member.workerUid)}
                    >
                      <div className="flex justify-between items-start mb-3">
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-lg ${member.active ? TONE_CLASS.emerald : TONE_CLASS.zinc}`}>
                            {roleIcon(member.role)}
                          </div>
                          <div>
                            <h3 className="text-white font-bold">{member.name}</h3>
                            <p className="text-xs text-zinc-400 uppercase tracking-wider">{ROLE_LABEL[member.role] ?? member.role}</p>
                          </div>
                        </div>
                        <div className={`px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest border ${member.active ? TONE_CLASS.emerald : TONE_CLASS.zinc}`}>
                          {member.active ? 'Activo' : 'Inactivo'}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 text-xs mt-4">
                        <CheckCircle2 className={`w-3 h-3 shrink-0 ${member.training.tone === 'emerald' ? 'text-emerald-500' : member.training.tone === 'rose' ? 'text-rose-500' : 'text-amber-500'}`} />
                        <span className={member.training.tone === 'rose' ? 'text-rose-400' : member.training.tone === 'amber' ? 'text-amber-400' : 'text-zinc-400'}>
                          {member.training.label}
                        </span>
                      </div>

                      {activeUid === member.workerUid && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          className="mt-4 pt-4 border-t border-zinc-800"
                        >
                          <p className="text-xs text-zinc-400 mb-2 font-bold uppercase tracking-wider">Certificaciones registradas:</p>
                          {member.certifications.length === 0 ? (
                            <p className="text-[10px] text-zinc-500 italic">Sin certificaciones registradas para este trabajador.</p>
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              {member.certifications.map((cert, idx) => (
                                <span key={idx} className="px-2 py-1 rounded bg-zinc-800 text-zinc-300 text-[10px] font-medium">
                                  {cert}
                                </span>
                              ))}
                            </div>
                          )}
                        </motion.div>
                      )}
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </Card>
  );
}
