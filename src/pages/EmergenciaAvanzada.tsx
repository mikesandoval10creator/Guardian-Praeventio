import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle, Activity, Map, Users, Radio, ShieldAlert,
  CheckCircle2, ArrowRight, Send, Loader2, UserCheck, UserX,
  Zap, Clock, RefreshCw, XCircle,
} from "lucide-react";
import { Card } from "../components/shared/Card";
import { useProject } from "../contexts/ProjectContext";
import { useFirebase } from "../contexts/FirebaseContext";
import { useSeismicMonitor, Earthquake } from "../hooks/useSeismicMonitor";
import { useFirestoreCollection } from "../hooks/useFirestoreCollection";
import {
  db, serverTimestamp, collection, addDoc, updateDoc,
  doc, setDoc, onSnapshot, query, orderBy, limit,
} from "../services/firebase";
import { Worker } from "../types";
import { ConfirmDialog } from "../components/shared/ConfirmDialog";

interface EmergencyEvent {
  id: string;
  type: string;
  magnitude?: number | null;
  epicenter?: string | null;
  startedBy: string;
  startedAt: any;
  resolvedAt?: any;
  active: boolean;
}

interface ChatMessage {
  id: string;
  text: string;
  sender: string;
  senderRole: string;
  isSystem?: boolean;
  createdAt: any;
}

export function EmergenciaAvanzada() {
  const { selectedProject } = useProject();
  const { user, isAdmin } = useFirebase();
  const [activeTab, setActiveTab] = useState<"map" | "comms" | "resources">("map");
  const [chatInput, setChatInput] = useState("");
  const [sendingMsg, setSendingMsg] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [safetyStatuses, setSafetyStatuses] = useState<Record<string, 'safe' | 'unknown' | 'danger'>>({});
  const [showTriggerConfirm, setShowTriggerConfirm] = useState(false);
  const [showResolveConfirm, setShowResolveConfirm] = useState(false);
  const [pendingQuake, setPendingQuake] = useState<Earthquake | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const projectLat = (selectedProject as any)?.lat ?? (selectedProject as any)?.coordinates?.lat ?? -33.4489;
  const projectLng = (selectedProject as any)?.lng ?? (selectedProject as any)?.coordinates?.lng ?? -70.6693;

  const { earthquakes, criticalAlert } = useSeismicMonitor(projectLat, projectLng);

  const { data: emergencyEvents } = useFirestoreCollection<EmergencyEvent>(
    selectedProject ? `projects/${selectedProject.id}/emergency_events` : null
  );
  const { data: workers } = useFirestoreCollection<Worker>(
    selectedProject ? `projects/${selectedProject.id}/workers` : null
  );

  const activeEmergency = emergencyEvents?.find(e => e.active) ?? null;

  // Real-time chat
  useEffect(() => {
    if (!selectedProject) return;
    const q = query(
      collection(db, `projects/${selectedProject.id}/emergency_chat`),
      orderBy('createdAt', 'asc'),
      limit(100)
    );
    return onSnapshot(q, snap => {
      setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() } as ChatMessage)));
    });
  }, [selectedProject?.id]);

  // Real-time worker safety statuses
  useEffect(() => {
    if (!selectedProject) return;
    return onSnapshot(
      collection(db, `projects/${selectedProject.id}/emergency_safety`),
      snap => {
        const statuses: Record<string, 'safe' | 'unknown' | 'danger'> = {};
        snap.docs.forEach(d => {
          const data = d.data();
          statuses[data.workerId] = data.status;
        });
        setSafetyStatuses(statuses);
      }
    );
  }, [selectedProject?.id]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const triggerEmergency = async () => {
    if (!selectedProject || !user) return;
    const quake = pendingQuake;
    const type = quake ? `Sismo M${quake.magnitude.toFixed(1)}` : 'Emergencia General';

    await addDoc(collection(db, `projects/${selectedProject.id}/emergency_events`), {
      type,
      magnitude: quake?.magnitude ?? null,
      epicenter: quake?.place ?? null,
      startedBy: user.displayName ?? user.email ?? 'Usuario',
      startedAt: serverTimestamp(),
      active: true,
    });

    await addDoc(collection(db, `projects/${selectedProject.id}/emergency_chat`), {
      text: `🚨 EMERGENCIA ACTIVADA: ${type}.${quake ? ` Epicentro: ${quake.place}. Profundidad: ${quake.coordinates[2]}km.` : ''} Todos los trabajadores deben confirmar su estado de seguridad.`,
      sender: 'Sistema',
      senderRole: 'system',
      isSystem: true,
      createdAt: serverTimestamp(),
    });

    for (const w of (workers ?? [])) {
      await setDoc(doc(db, `projects/${selectedProject.id}/emergency_safety`, w.id), {
        workerId: w.id,
        status: 'unknown',
        confirmedAt: null,
      });
    }

    setShowTriggerConfirm(false);
    setPendingQuake(null);
    setActiveTab('resources');
  };

  const resolveEmergency = async () => {
    if (!selectedProject || !activeEmergency) return;
    await updateDoc(doc(db, `projects/${selectedProject.id}/emergency_events`, activeEmergency.id), {
      active: false,
      resolvedAt: serverTimestamp(),
    });
    await addDoc(collection(db, `projects/${selectedProject.id}/emergency_chat`), {
      text: '✅ Emergencia resuelta. Todos los sistemas vuelven a operación normal.',
      sender: 'Sistema',
      senderRole: 'system',
      isSystem: true,
      createdAt: serverTimestamp(),
    });
    setShowResolveConfirm(false);
  };

  const sendMessage = async () => {
    if (!chatInput.trim() || !selectedProject || !user) return;
    setSendingMsg(true);
    try {
      await addDoc(collection(db, `projects/${selectedProject.id}/emergency_chat`), {
        text: chatInput.trim(),
        sender: user.displayName ?? user.email ?? 'Usuario',
        senderRole: isAdmin ? 'Administrador' : 'Trabajador',
        createdAt: serverTimestamp(),
      });
      setChatInput('');
    } finally {
      setSendingMsg(false);
    }
  };

  const markWorker = async (workerId: string, status: 'safe' | 'danger') => {
    if (!selectedProject) return;
    await setDoc(doc(db, `projects/${selectedProject.id}/emergency_safety`, workerId), {
      workerId,
      status,
      confirmedAt: serverTimestamp(),
    });
  };

  const safeCount = Object.values(safetyStatuses).filter(s => s === 'safe').length;
  const dangerCount = Object.values(safetyStatuses).filter(s => s === 'danger').length;
  const unknownCount = (workers?.length ?? 0) - safeCount - dangerCount;

  const recentQuakes = earthquakes.slice(0, 5);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-zinc-900 dark:text-white uppercase tracking-tighter leading-tight flex items-center gap-3">
            <Activity className="w-8 h-8 text-red-500" />
            Emergencia Avanzada
          </h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            Orquestación del Caos Post-Evento Crítico
          </p>
        </div>
        <div className="flex items-center gap-3">
          {activeEmergency ? (
            <button
              onClick={() => setShowResolveConfirm(true)}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black uppercase rounded-xl flex items-center gap-2 transition-colors"
            >
              <CheckCircle2 className="w-4 h-4" />
              Resolver Emergencia
            </button>
          ) : (
            <button
              onClick={() => { setPendingQuake(null); setShowTriggerConfirm(true); }}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-black uppercase rounded-xl flex items-center gap-2 transition-colors"
            >
              <AlertTriangle className="w-4 h-4" />
              Activar Emergencia
            </button>
          )}
        </div>
      </div>

      {/* Active emergency banner */}
      <AnimatePresence>
        {activeEmergency && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="p-4 rounded-xl bg-red-500/10 border border-red-500/50 flex items-start gap-4"
          >
            <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center shrink-0 animate-pulse">
              <AlertTriangle className="w-5 h-5 text-red-500" />
            </div>
            <div className="flex-1">
              <h2 className="text-sm font-black text-red-500 uppercase tracking-wider">
                {activeEmergency.type} — EN CURSO
              </h2>
              <p className="text-xs text-red-400/80 mt-1">
                Activado por {activeEmergency.startedBy}
                {activeEmergency.epicenter ? ` · Epicentro: ${activeEmergency.epicenter}` : ''}
                {activeEmergency.magnitude ? ` · Magnitud: ${activeEmergency.magnitude}` : ''}
              </p>
            </div>
            <div className="flex gap-4 text-xs font-bold shrink-0">
              <span className="text-emerald-400">{safeCount} Seguros</span>
              <span className="text-red-400">{dangerCount} En Peligro</span>
              <span className="text-zinc-400">{unknownCount} Sin Confirmar</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Critical seismic alert */}
      <AnimatePresence>
        {criticalAlert && !activeEmergency && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/50 flex items-center gap-4"
          >
            <Zap className="w-5 h-5 text-amber-400 shrink-0" />
            <div className="flex-1">
              <p className="text-xs font-bold text-amber-400">
                ALERTA SÍSMICA CERCANA — M{criticalAlert.magnitude.toFixed(1)} · {criticalAlert.place}
              </p>
            </div>
            <button
              onClick={() => { setPendingQuake(criticalAlert); setShowTriggerConfirm(true); }}
              className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-black text-xs font-black uppercase rounded-lg transition-colors shrink-0"
            >
              Activar Protocolo
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column */}
        <div className="space-y-4">
          <Card className="p-4 border-white/5">
            <div className="flex flex-col space-y-2">
              {[
                { id: 'map' as const, icon: Map, label: 'Sismos en Tiempo Real' },
                { id: 'comms' as const, icon: Radio, label: 'Canal de Emergencia' },
                { id: 'resources' as const, icon: Users, label: 'Brigadas y Recursos' },
              ].map(({ id, icon: Icon, label }) => (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  className={`flex items-center justify-between p-3 rounded-lg transition-colors ${activeTab === id ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900'}`}
                >
                  <div className="flex items-center gap-3">
                    <Icon className="w-4 h-4" />
                    <span className="font-bold uppercase text-xs">{label}</span>
                  </div>
                  {id === 'comms' && activeEmergency && (
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
                  )}
                  {id !== 'comms' && <ArrowRight className="w-3 h-3" />}
                </button>
              ))}
            </div>
          </Card>

          {/* Zone status */}
          <Card className="p-4 border-white/5 space-y-3">
            <h3 className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest flex items-center gap-2">
              <ShieldAlert className="w-4 h-4" />
              Estado de Zonas
            </h3>
            {[
              { name: 'Área de Trabajo', status: activeEmergency ? 'BLOQUEADO' : 'OPERATIVO', color: activeEmergency ? 'text-red-400 bg-red-500/10' : 'text-emerald-400 bg-emerald-500/10' },
              { name: 'Planta / Faena', status: activeEmergency ? 'EVACUANDO' : 'OPERATIVO', color: activeEmergency ? 'text-amber-400 bg-amber-500/10' : 'text-emerald-400 bg-emerald-500/10' },
              { name: 'Zona de Seguridad', status: 'ACTIVA', color: 'text-emerald-400 bg-emerald-500/10' },
            ].map(z => (
              <div key={z.name} className="flex items-center justify-between p-2.5 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-white/5">
                <span className="text-xs text-zinc-700 dark:text-zinc-300">{z.name}</span>
                <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${z.color}`}>{z.status}</span>
              </div>
            ))}
          </Card>

          {/* Worker summary */}
          {activeEmergency && (
            <Card className="p-4 border-red-500/30 bg-red-500/5 space-y-2">
              <h3 className="text-xs font-bold text-red-400 uppercase tracking-widest">Conteo de Personal</h3>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="p-2 rounded-lg bg-emerald-500/10">
                  <p className="text-lg font-black text-emerald-400">{safeCount}</p>
                  <p className="text-[10px] text-emerald-400/70">Seguros</p>
                </div>
                <div className="p-2 rounded-lg bg-red-500/10">
                  <p className="text-lg font-black text-red-400">{dangerCount}</p>
                  <p className="text-[10px] text-red-400/70">Peligro</p>
                </div>
                <div className="p-2 rounded-lg bg-zinc-500/10">
                  <p className="text-lg font-black text-zinc-400">{unknownCount}</p>
                  <p className="text-[10px] text-zinc-400/70">Sin confirmar</p>
                </div>
              </div>
            </Card>
          )}
        </div>

        {/* Right Column */}
        <Card className="p-4 sm:p-6 border-white/5 lg:col-span-2 min-h-[500px] flex flex-col">
          {activeTab === "map" && (
            <div className="flex-1 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-wider">
                  Actividad Sísmica — USGS (últimas 24h)
                </h3>
                <span className="text-[10px] text-zinc-400 flex items-center gap-1">
                  <RefreshCw className="w-3 h-3" /> Actualiza cada 2 min
                </span>
              </div>
              {recentQuakes.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-zinc-400">
                  <Activity className="w-10 h-10 mb-3 opacity-40" />
                  <p className="text-sm">Cargando datos sísmicos...</p>
                </div>
              ) : (
                <div className="space-y-2 overflow-y-auto flex-1">
                  {recentQuakes.map(q => (
                    <div key={q.id} className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-white/5 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 font-black text-sm ${q.magnitude >= 5 ? 'bg-red-500/20 text-red-400' : q.magnitude >= 4 ? 'bg-amber-500/20 text-amber-400' : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-400'}`}>
                          {q.magnitude.toFixed(1)}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-zinc-900 dark:text-white truncate">{q.place}</p>
                          <p className="text-[10px] text-zinc-500 flex items-center gap-1 mt-0.5">
                            <Clock className="w-3 h-3" />
                            {new Date(q.time).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                      </div>
                      {!activeEmergency && isAdmin && (
                        <button
                          onClick={() => { setPendingQuake(q); setShowTriggerConfirm(true); }}
                          className="px-2.5 py-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-[10px] font-black uppercase rounded-lg transition-colors shrink-0"
                        >
                          Activar
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === "comms" && (
            <div className="flex-1 flex flex-col gap-3 min-h-0">
              <h3 className="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-wider shrink-0">
                Canal de Emergencia
                {activeEmergency && <span className="ml-2 text-[10px] text-red-400 animate-pulse">● EN VIVO</span>}
              </h3>
              <div className="flex-1 bg-zinc-50 dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-white/5 p-3 flex flex-col gap-2 overflow-y-auto min-h-0">
                {messages.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-zinc-400 my-auto">
                    <Radio className="w-10 h-10 mb-3 opacity-40" />
                    <p className="text-sm">Canal en silencio.</p>
                    <p className="text-xs mt-1 opacity-60">Los mensajes aparecerán aquí en tiempo real.</p>
                  </div>
                ) : (
                  messages.map(msg => (
                    <div key={msg.id} className={`flex ${msg.isSystem ? 'justify-center' : msg.sender === (user?.displayName ?? user?.email) ? 'justify-end' : 'justify-start'}`}>
                      {msg.isSystem ? (
                        <div className="px-3 py-1.5 rounded-full bg-red-500/10 border border-red-500/20 text-[11px] text-red-400 max-w-[90%] text-center">
                          {msg.text}
                        </div>
                      ) : (
                        <div className={`max-w-[80%] px-3 py-2 rounded-xl ${msg.sender === (user?.displayName ?? user?.email) ? 'bg-blue-600/20 border border-blue-500/30 rounded-tr-none' : 'bg-zinc-200 dark:bg-zinc-800 rounded-tl-none'}`}>
                          <p className="text-[10px] text-zinc-500 mb-1">{msg.sender} · {msg.senderRole}</p>
                          <p className="text-xs text-zinc-900 dark:text-white">{msg.text}</p>
                        </div>
                      )}
                    </div>
                  ))
                )}
                <div ref={chatEndRef} />
              </div>
              <div className="flex gap-2 shrink-0">
                <input
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                  placeholder={activeEmergency ? 'Mensaje de emergencia...' : 'Activa una emergencia para habilitar el canal'}
                  disabled={!activeEmergency}
                  className="flex-1 px-3 py-2 text-xs rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white placeholder-zinc-400 disabled:opacity-40 focus:outline-none focus:border-red-500/50"
                />
                <button
                  onClick={sendMessage}
                  disabled={!chatInput.trim() || !activeEmergency || sendingMsg}
                  className="p-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl disabled:opacity-40 transition-colors"
                >
                  {sendingMsg ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </div>
            </div>
          )}

          {activeTab === "resources" && (
            <div className="flex-1 flex flex-col gap-4 min-h-0">
              <h3 className="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-wider shrink-0">
                Estado de Personal
              </h3>
              {!workers || workers.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-zinc-400">
                  <Users className="w-10 h-10 mb-3 opacity-40" />
                  <p className="text-sm">No hay trabajadores registrados en este proyecto.</p>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto space-y-2">
                  {workers.map(w => {
                    const status = safetyStatuses[w.id] ?? 'unknown';
                    return (
                      <div key={w.id} className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-white/5 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-black ${status === 'safe' ? 'bg-emerald-500/20 text-emerald-400' : status === 'danger' ? 'bg-red-500/20 text-red-400' : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-400'}`}>
                            {w.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-zinc-900 dark:text-white truncate">{w.name}</p>
                            <p className="text-[10px] text-zinc-500">{w.role}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {activeEmergency ? (
                            <>
                              <button
                                onClick={() => markWorker(w.id, 'safe')}
                                className={`p-1.5 rounded-lg transition-colors ${status === 'safe' ? 'bg-emerald-500 text-white' : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400'}`}
                                title="Marcar seguro"
                              >
                                <UserCheck className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => markWorker(w.id, 'danger')}
                                className={`p-1.5 rounded-lg transition-colors ${status === 'danger' ? 'bg-red-500 text-white' : 'bg-red-500/10 hover:bg-red-500/20 text-red-400'}`}
                                title="Marcar en peligro"
                              >
                                <UserX className="w-3.5 h-3.5" />
                              </button>
                            </>
                          ) : (
                            <span className="text-[10px] text-zinc-400 italic">Sin emergencia activa</span>
                          )}
                          <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${status === 'safe' ? 'bg-emerald-500/10 text-emerald-400' : status === 'danger' ? 'bg-red-500/10 text-red-400' : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-400'}`}>
                            {status === 'safe' ? 'SEGURO' : status === 'danger' ? 'PELIGRO' : 'DESCONOCIDO'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      <ConfirmDialog
        isOpen={showTriggerConfirm}
        title={pendingQuake ? `Activar Protocolo para Sismo M${pendingQuake.magnitude.toFixed(1)}` : 'Activar Emergencia General'}
        message={pendingQuake
          ? `Se activará protocolo de emergencia por sismo en: ${pendingQuake.place}. Todos los trabajadores serán notificados y deberán confirmar su estado.`
          : 'Se activará un protocolo de emergencia general. Todos los trabajadores serán notificados y deberán confirmar su estado de seguridad.'}
        confirmLabel="Activar Ahora"
        danger
        onConfirm={triggerEmergency}
        onCancel={() => { setShowTriggerConfirm(false); setPendingQuake(null); }}
      />

      <ConfirmDialog
        isOpen={showResolveConfirm}
        title="Resolver Emergencia"
        message="¿Confirmas que la emergencia ha sido controlada y todos los trabajadores están seguros?"
        confirmLabel="Sí, resolver"
        onConfirm={resolveEmergency}
        onCancel={() => setShowResolveConfirm(false)}
      />
    </div>
  );
}
