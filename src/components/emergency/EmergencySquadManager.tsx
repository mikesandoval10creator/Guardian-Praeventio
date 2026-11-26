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
import {
  classifyBreadcrumbLoad,
  describeGeneralCallOutcome,
  filterFreshPeers,
  formatElapsed,
  latestBreadcrumb,
  trainingState,
  type Breadcrumb,
} from './emergencySquadContracts';
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

/** Real training validity from `trainedAt` + `trainingValidYears` (no fabricated data).
 *  The rule now comes from `emergencySquadContracts.trainingState`, which uses the
 *  SAME 365-day year as `emergencyBrigadeService` — the UI and the coverage rule
 *  can no longer disagree about whether a capability is still valid. */

export function EmergencySquadManager() {
  const { user } = useFirebase();
  const { selectedProject } = useProject();
  const { triggerEmergency } = useEmergency();
  const { isSupported: bleSupported, isScanning: bleScanning, peerBreadcrumbs, startScanning, stopScanning } = useBluetoothMesh();

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
  // Ticket "Error de lectura GPS enmascarado como 'sin datos'": a read
  // failure must not look like "you have no GPS history".
  const [crumbsError, setCrumbsError] = useState<unknown>(null);
  const [calling, setCalling] = useState(false);
  // Ticket "Llamado General no reporta fallo de notificacion".
  const [callNotice, setCallNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const userUid = user?.uid;
  useEffect(() => {
    if (viewMode !== 'search' || !userUid) return;
    let active = true;
    setLoadingCrumbs(true);
    setCrumbsError(null);
    getBreadcrumbs(userUid, 20)
      .then(value => { if (active) setBreadcrumbs(value); })
      .catch((err) => { if (active) { setCrumbsError(err); setBreadcrumbs([]); } })
      .finally(() => { if (active) setLoadingCrumbs(false); });
    return () => { active = false; };
  }, [viewMode, userUid]);

  useEffect(() => {
    if (viewMode !== 'search' || !userUid || !bleSupported) return;
    void startScanning();
    return () => { void stopScanning(); };
  }, [viewMode, userUid, bleSupported, startScanning, stopScanning]);

  // "Llamado General" — real action: triggerEmergency enqueues the durable
  // emergency-delivery packet; the server persists it and fans out the brigade
  // push after the packet reaches the authoritative endpoint.
  const handleGeneralCall = async () => {
    if (!projectId || calling) return;
    setCalling(true);
    setCallNotice(null);
    try {
      await triggerEmergency('sos', projectId);
      // Ticket "Llamado General no reporta fallo de notificacion": the
      // success path now says something too, so the worker knows the brigade
      // was summoned.
      setCallNotice({ kind: 'ok', text: 'Llamado general enviado a la brigada.' });
    } catch (err) {
      logger.error('[EmergencySquadManager] llamado general falló', err);
      // The failure MUST be visible: the worker has to know the brigade was
      // NOT summoned and use another channel.
      const outcome = describeGeneralCallOutcome(err);
      setCallNotice({
        kind: 'error',
        text:
          outcome.kind === 'failed'
            ? `Llamado general NO enviado: ${outcome.message}`
            : 'Llamado general NO enviado.',
      });
    } finally {
      setCalling(false);
    }
  };

  // Ticket "Companeros BLE sin filtro de antiguedad (falsa presencia 'en
  // rango')": a peer seen hours ago is not a colleague within range.
  const PEER_FRESHNESS_MS = 5 * 60_000;
  const freshPeers = useMemo(
    () => filterFreshPeers(peerBreadcrumbs, PEER_FRESHNESS_MS),
    [peerBreadcrumbs],
  );

  // The breadcrumb load state: loading / failed / empty / loaded.
  const crumbState = useMemo(
    () => classifyBreadcrumbLoad({ loading: loadingCrumbs, error: crumbsError, breadcrumbs }),
    [loadingCrumbs, crumbsError, breadcrumbs],
  );

  const formatTime = (ts: number) => formatElapsed(ts);

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
        {callNotice && (
          <div
            role="status"
            data-testid="general-call-notice"
            className={`mb-4 rounded-xl border px-4 py-3 text-sm font-bold ${
              callNotice.kind === 'error'
                ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
            }`}
          >
            {callNotice.text}
          </div>
        )}
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

            {crumbState.status === 'loading' ? (
              <div className="text-center py-8 text-zinc-500 text-sm">Cargando rastro GPS...</div>
            ) : crumbState.status === 'failed' ? (
              <div className="text-center py-8 space-y-2" data-testid="crumbs-error">
                <AlertTriangle className="w-8 h-8 text-rose-500 mx-auto" />
                <p className="text-rose-400 text-sm font-bold">No se pudo leer el rastro GPS.</p>
                <p className="text-zinc-500 text-xs">{crumbState.message}</p>
                <p className="text-zinc-600 text-xs">
                  Esto NO significa que no tengas posiciones registradas: el rastro no se pudo leer.
                </p>
              </div>
            ) : crumbState.status === 'empty' ? (
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
              {breadcrumbs.length > 0 &&
                `${breadcrumbs.length} posición(es) registrada(s) • Última: ${new Date(
                  // Ticket "Contrato de orden de getBreadcrumbs no documentado":
                  // the UI assumes breadcrumbs[0] is the most recent. The
                  // contract is now explicit and enforced at the point of use.
                  latestBreadcrumb(breadcrumbs)?.timestamp ?? 0,
                ).toLocaleTimeString()}`}
            </p>

            {/* BLE Peer Breadcrumbs */}
            {bleSupported && (
              <div className="mt-4 border-t border-white/5 pt-4">
                <div className="flex items-center gap-2 mb-3">
                  <Radio className="w-4 h-4 text-blue-400" />
                  <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Compañeros detectados vía BLE</p>
                  {bleScanning && <span className="text-[10px] text-blue-400 animate-pulse">Escaneando...</span>}
                </div>
                {freshPeers.length === 0 ? (
                  <p className="text-xs text-zinc-600">
                    {peerBreadcrumbs.length > 0
                      ? 'Sin compañeros BLE recientes (los últimos registros superaron la ventana de 5 min).'
                      : 'Sin compañeros BLE detectados en rango.'}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {freshPeers.slice(0, 10).map(peer => (
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
