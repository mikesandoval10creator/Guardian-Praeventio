import React, { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle, Activity, Map, Users, Radio, ShieldAlert,
  CheckCircle2, ArrowRight, Send, Loader2, UserCheck, UserX,
  Zap, Clock, RefreshCw, XCircle, Mic, MicOff,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useAcousticSOS } from "../hooks/useAcousticSOS";
import { Card } from "../components/shared/Card";
import { useProject } from "../contexts/ProjectContext";
import { useDeepLinkProjectSync } from "../hooks/useDeepLinkProjectSync";
import { useFirebase } from "../contexts/FirebaseContext";
import { useSeismicMonitor, Earthquake } from "../hooks/useSeismicMonitor";
import { useFirestoreCollection } from "../hooks/useFirestoreCollection";
import {
  db, serverTimestamp, collection, addDoc,
  doc, setDoc, onSnapshot, query, orderBy, limit, where,
} from "../services/firebase";
import { Worker } from "../types";
import { ConfirmDialog } from "../components/shared/ConfirmDialog";
import { Tooltip } from "../components/shared/Tooltip";
import { logger } from "../utils/logger";
import { EmergencyAuthorityCallPanel } from "../components/emergency/EmergencyAuthorityCallPanel";
import { humanErrorMessage } from '../lib/humanError';
import {
  submitEmergencyDelivery,
  subscribeEmergencyDelivery,
  type EmergencyDeliveryAttempt,
} from '../services/emergency/emergencyDeliveryOutbox';


interface EmergencyEvent {
  id: string;
  type: string;
  magnitude?: number | null;
  epicenter?: string | null;
  // `status` is the canonical lifecycle field shared with the SOS path
  // (EmergencyContext) and enforced by firestore.rules:emergency_events.
  // `active` is retained for backward-compatible display of legacy docs.
  status?: 'active' | 'pending' | 'resolved';
  triggeredBy?: string | null;
  triggeredByName?: string | null;
  startedBy: string;
  startedAt: any;
  resolvedAt?: any;
  resolvedBy?: string | null;
  active: boolean;
}

// B.3 (VIDA) — worker SOS alert row, as written by the SOS server route
// (src/server/routes/emergency.ts → tenants/{tenantId}/emergency_alerts).
interface SosAlert {
  id: string;
  type: string;
  uid: string;
  userEmail?: string | null;
  projectId: string;
  geo?: { lat: number; lng: number } | null;
  clientTimestamp?: string | null;
  createdAt?: { toMillis?: () => number } | null;
}

// Only surface SOS pings from the recent window — old alerts are history,
// not an actionable emergency.
const SOS_WINDOW_MS = 24 * 60 * 60 * 1000;

interface ChatMessage {
  id: string;
  text: string;
  sender: string;
  senderRole: string;
  isSystem?: boolean;
  createdAt: any;
}

export function EmergenciaAvanzada() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  // [P1][VIDA] A push deep-link is not authorized merely because its
  // realignment request was issued. Bind listeners only after membership is
  // confirmed AND the ProjectContext has actually reached the target id.
  const { status: deepLinkStatus, targetProjectId } = useDeepLinkProjectSync();
  const deepLinkReady =
    deepLinkStatus === 'idle' ||
    (deepLinkStatus === 'aligned' &&
      (!targetProjectId || selectedProject?.id === targetProjectId));
  const projectForData = deepLinkReady ? selectedProject : null;
  const [searchParams] = useSearchParams();
  // The specific SOS this notification was about (deep link ?alertId=...).
  const focusedAlertId = searchParams.get('alertId');
  const focusedAlertRef = useRef<HTMLDivElement | null>(null);
  const { user, isAdmin } = useFirebase();
  const [activeTab, setActiveTab] = useState<"map" | "comms" | "resources">("map");
  const [chatInput, setChatInput] = useState("");
  const [sendingMsg, setSendingMsg] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [safetyStatuses, setSafetyStatuses] = useState<Record<string, 'safe' | 'unknown' | 'danger'>>({});
  const [showTriggerConfirm, setShowTriggerConfirm] = useState(false);
  const [showResolveConfirm, setShowResolveConfirm] = useState(false);
  const [pendingQuake, setPendingQuake] = useState<Earthquake | null>(null);
  // Audit 2026-07-02 §3.4 #1: both onSnapshot listeners below (chat +
  // emergency_safety) had no error callback — a Firestore permission
  // failure was silently indistinguishable from "no activity". These track
  // per-channel failure so the UI can render an honest error instead of a
  // permanently-empty list.
  const [chatError, setChatError] = useState<string | null>(null);
  const [safetyError, setSafetyError] = useState<string | null>(null);
  const [sosAlerts, setSosAlerts] = useState<SosAlert[]>([]);
  const [activationDelivery, setActivationDelivery] = useState<EmergencyDeliveryAttempt | null>(null);
  const activationUnsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => () => {
    activationUnsubscribeRef.current?.();
  }, []);

  const acousticSOS = useAcousticSOS({
    threshold: 75,
    requiredKnocks: 3,
    windowMs: 6000,
    onSOS: () => { setPendingQuake(null); setShowTriggerConfirm(true); },
  });
  const chatEndRef = useRef<HTMLDivElement>(null);

  const projectLat = projectForData?.coordinates?.lat;
  const projectLng = projectForData?.coordinates?.lng;

  // Audit 2026-07-02 §3.1 bug 10: consume the hook's loading/error signal
  // so this page can distinguish "still fetching" from "USGS is down" from
  // "no quakes today" — previously all three rendered the same eternal
  // "Cargando datos sísmicos..." because the hook swallowed errors.
  const {
    earthquakes,
    criticalAlert,
    loading: seismicLoading,
    error: seismicError,
  } = useSeismicMonitor(projectLat, projectLng);

  const { data: emergencyEvents } = useFirestoreCollection<EmergencyEvent>(
    projectForData ? `projects/${projectForData.id}/emergency_events` : null
  );
  const { data: workers } = useFirestoreCollection<Worker>(
    projectForData ? `projects/${projectForData.id}/workers` : null
  );

  // `status` is the source of truth when present (new docs + SOS path); fall
  // back to the legacy `active` flag for docs written before the rule alignment.
  const activeEmergency = emergencyEvents?.find(
    e => e.status === 'active' || (e.status == null && e.active),
  ) ?? null;

  // Real-time chat
  useEffect(() => {
    if (!projectForData) return undefined;
    setChatError(null);
    const q = query(
      collection(db, `projects/${projectForData.id}/emergency_chat`),
      orderBy('createdAt', 'asc'),
      limit(100)
    );
    return onSnapshot(
      q,
      snap => {
        setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() } as ChatMessage)));
        setChatError(null);
      },
      err => {
        logger.error('EmergenciaAvanzada: emergency_chat onSnapshot failed', err, {
          projectId: projectForData.id,
        });
        setChatError('No se pudo cargar el canal de emergencia. Verifica tu conexión o permisos.');
      },
    );
    // Subscribe by project id, not the selectedProject object: re-subscribing on
    // every context re-render (new object identity, same faena) would tear down
    // and rebuild the Firestore listener, briefly dropping the emergency channel.
    // id is the immutable identity of the faena, so the closure never goes stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectForData?.id]);

  // Real-time worker safety statuses
  useEffect(() => {
    if (!projectForData) return undefined;
    setSafetyError(null);
    const safetyQuery = query(
      collection(db, `projects/${projectForData.id}/emergency_safety`),
      limit(50),
    );
    return onSnapshot(
      safetyQuery,
      snap => {
        const statuses: Record<string, 'safe' | 'unknown' | 'danger'> = {};
        snap.docs.forEach(d => {
          const data = d.data();
          statuses[data.workerId] = data.status;
        });
        setSafetyStatuses(statuses);
        setSafetyError(null);
      },
      err => {
        logger.error('EmergenciaAvanzada: emergency_safety onSnapshot failed', err, {
          projectId: projectForData.id,
        });
        setSafetyError('No se pudo cargar el estado de seguridad del personal. Verifica tu conexión o permisos.');
      },
    );
    // Same faena-id subscription granularity as the chat effect above — depend on
    // the immutable id, not the object identity, so the worker-safety listener
    // isn't needlessly rebuilt on unrelated context updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectForData?.id]);

  // B.3 (VIDA) — worker SOS alerts. The SOS button posts to the server,
  // which writes tenants/{tenantId}/emergency_alerts (Admin SDK) with
  // tenantId = projects/{pid}.tenantId || pid — mirror that fallback here.
  // Before this subscription the alert reached Firestore but NO dashboard
  // ever showed it. Filter by projectId only (equality → no composite
  // index needed) and sort client-side.
  useEffect(() => {
    if (!projectForData) { setSosAlerts([]); return undefined; }
    const tenantId =
      (projectForData as { tenantId?: string }).tenantId ?? projectForData.id;
    const alertsQuery = query(
      collection(db, `tenants/${tenantId}/emergency_alerts`),
      where('projectId', '==', projectForData.id),
      limit(50),
    );
    return onSnapshot(
      alertsQuery,
      snap => {
        const now = Date.now();
        const alerts = snap.docs
          .map(d => ({ id: d.id, ...d.data() } as SosAlert))
          .filter(a => {
            const ms = a.createdAt?.toMillis?.();
            // Docs with a pending/absent server timestamp stay visible —
            // hiding a fresh SOS is the worse failure mode.
            return typeof ms !== 'number' || now - ms < SOS_WINDOW_MS;
          })
          .sort(
            (x, y) =>
              (y.createdAt?.toMillis?.() ?? now) - (x.createdAt?.toMillis?.() ?? now),
          );
        setSosAlerts(alerts);
      },
      err => {
        // A rules denial or offline error must never crash the dashboard.
        logger.error('EmergenciaAvanzada: emergency_alerts subscribe failed', { err });
      },
    );
    // id/tenantId are immutable per project, so subscribing by id keeps the SOS
    // listener bound to the current faena without rebuilding it on every context
    // re-render (a rebuild could briefly miss a fresh worker SOS).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectForData?.id]);

  useEffect(() => {
    if (deepLinkReady) return;
    setMessages([]);
    setSafetyStatuses({});
    setSosAlerts([]);
    setChatError(null);
    setSafetyError(null);
  }, [deepLinkReady]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // [P1][VIDA] Scroll the deep-linked SOS into view once it arrives in the
  // (async) alerts snapshot, so the supervisor lands directly on the person
  // who triggered it instead of scanning the list.
  useEffect(() => {
    if (!focusedAlertId) return;
    if (!sosAlerts.some((a) => a.id === focusedAlertId)) return;
    focusedAlertRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focusedAlertId, sosAlerts]);

  const triggerEmergency = () => {
    if (!projectForData || !user) return;
    const quake = pendingQuake;
    const type = quake ? `Sismo M${quake.magnitude.toFixed(1)}` : 'Emergencia General';
    const pid = projectForData.id;
    const localPending: EmergencyDeliveryAttempt = {
      clientEventId: 'activation-local',
      operation: 'activation',
      projectId: pid,
      status: 'pending',
      queued: true,
    };
    setActivationDelivery(localPending);
    setShowTriggerConfirm(false);
    setPendingQuake(null);
    // Do not hold the dashboard on the network. The outbox owns persistence,
    // retries and the server ACK; the page advances while it is pending.
    setActiveTab('resources');

    void submitEmergencyDelivery({
      operation: 'activation',
      projectId: pid,
      emergencyType: type,
      ...(quake ? { magnitude: quake.magnitude, epicenter: quake.place } : {}),
      occurredAt: new Date().toISOString(),
    })
      .then((attempt) => {
        setActivationDelivery(attempt);
        activationUnsubscribeRef.current?.();
        activationUnsubscribeRef.current = subscribeEmergencyDelivery(
          attempt.clientEventId,
          setActivationDelivery,
        );
      })
      .catch((err) => {
        setActivationDelivery({
          ...localPending,
          status: 'failed',
          failureKind: 'unknown',
          error: humanErrorMessage(err),
        });
        logger.error('EmergenciaAvanzada: emergency delivery enqueue failed', { err });
      });
  };

  const resolveEmergency = () => {
    if (!projectForData || !activeEmergency) return;
    const eventId = activeEmergency.id;
    const localPending: EmergencyDeliveryAttempt = {
      clientEventId: `resolution-local-${eventId}`,
      operation: 'resolution',
      projectId: projectForData.id,
      status: 'pending',
      queued: true,
    };
    setActivationDelivery(localPending);
    setShowResolveConfirm(false);
    void submitEmergencyDelivery({
      operation: 'resolution',
      projectId: projectForData.id,
      eventId,
      occurredAt: new Date().toISOString(),
    }, { clientEventId: `resolution-${eventId}` })
      .then((attempt) => {
        setActivationDelivery(attempt);
        activationUnsubscribeRef.current?.();
        activationUnsubscribeRef.current = subscribeEmergencyDelivery(
          attempt.clientEventId,
          setActivationDelivery,
        );
      })
      .catch((err) => {
        setActivationDelivery({
          ...localPending,
          status: 'failed',
          failureKind: 'unknown',
          error: humanErrorMessage(err),
        });
        logger.error('EmergenciaAvanzada: emergency resolution enqueue failed', { err });
      });
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
    } catch (err) {
      logger.error('EmergenciaAvanzada: emergency_chat send failed', { err });
    } finally {
      setSendingMsg(false);
    }
  };

  const markWorker = async (workerId: string, status: 'safe' | 'danger') => {
    if (!selectedProject) return;
    // A failed roll-call write must not throw out of the click handler.
    try {
      await setDoc(doc(db, `projects/${selectedProject.id}/emergency_safety`, workerId), {
        workerId,
        status,
        confirmedAt: serverTimestamp(),
      });
    } catch (err) {
      logger.error('EmergenciaAvanzada: markWorker failed', { workerId, err });
    }
  };

  const safeCount = Object.values(safetyStatuses).filter(s => s === 'safe').length;
  const dangerCount = Object.values(safetyStatuses).filter(s => s === 'danger').length;
  const unknownCount = (workers?.length ?? 0) - safeCount - dangerCount;

  const recentQuakes = earthquakes.slice(0, 5);

  const formatSosTime = (a: SosAlert): string => {
    const ms = a.createdAt?.toMillis?.();
    if (typeof ms === 'number') {
      return new Date(ms).toLocaleString('es-CL', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
      });
    }
    return a.clientTimestamp ?? '—';
  };

  const deliveryLabel = activationDelivery?.operation === 'resolution' ? 'Resolución' : 'Activación';

  if (!deepLinkReady) {
    const rejected = deepLinkStatus === 'not-member';
    return (
      <div role="alert" className="p-6 max-w-xl mx-auto mt-10 rounded-2xl border border-amber-500/40 bg-amber-500/10 text-amber-100">
        <h1 className="text-lg font-black uppercase tracking-tight">
          {rejected ? 'Proyecto no autorizado' : 'Realineando emergencia'}
        </h1>
        <p className="mt-2 text-sm">
          {rejected
            ? 'No tienes acceso a este proyecto de emergencia.'
            : 'Cargando el proyecto de la emergencia. No se mostrará información de otra faena hasta confirmar el acceso.'}
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-primary-token uppercase tracking-tighter leading-tight flex items-center gap-3">
            <Activity className="w-8 h-8 text-red-500" />
            {t('emergenciaAvanzada.title', 'Emergencia Avanzada')}
          </h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            {t('emergenciaAvanzada.subtitle', 'Orquestación del Caos Post-Evento Crítico')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {activeEmergency ? (
            <button
              onClick={() => setShowResolveConfirm(true)}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black uppercase rounded-xl flex items-center gap-2 transition-colors"
            >
              <CheckCircle2 className="w-4 h-4" />
              {t('emergenciaAvanzada.resolve', 'Resolver Emergencia')}
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => acousticSOS.isActive ? acousticSOS.stop() : acousticSOS.start()}
                title={acousticSOS.isActive ? 'Desactivar SOS acústico (3 golpes)' : 'Activar SOS acústico — 3 golpes en el micrófono disparan emergencia'}
                className={`p-2 rounded-xl text-xs font-black uppercase transition-all border flex items-center gap-1.5 min-w-[44px] min-h-[44px] justify-center ${
                  acousticSOS.isActive
                    ? 'bg-rose-500/20 border-rose-500/40 text-rose-400 animate-pulse'
                    : 'bg-zinc-800 border-white/10 text-zinc-400 hover:text-white'
                }`}
              >
                {acousticSOS.isActive ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>
              <button
                onClick={() => { setPendingQuake(null); setShowTriggerConfirm(true); }}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-black uppercase rounded-xl flex items-center gap-2 transition-colors"
              >
                <AlertTriangle className="w-4 h-4" />
                {t('emergenciaAvanzada.activate', 'Activar Emergencia')}
              </button>
            </div>
          )}
        </div>
      </div>

      {activationDelivery && (
        <div
          role="status"
          aria-live="assertive"
          data-testid="emergency-delivery-status"
          className={`p-3 rounded-xl border text-xs font-black uppercase tracking-wider ${
            activationDelivery.status === 'accepted'
              ? activationDelivery.ack?.delivered === false
                ? 'border-amber-500/50 bg-amber-500/10 text-amber-300'
                : 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300'
              : activationDelivery.status === 'failed'
                ? 'border-red-500/50 bg-red-500/10 text-red-300'
                : 'border-amber-500/50 bg-amber-500/10 text-amber-300'
          }`}
        >
          {activationDelivery.status === 'accepted'
            ? activationDelivery.ack?.delivered === false
              ? `${deliveryLabel} aceptada por servidor; entrega a supervisor no confirmada.`
              : `${deliveryLabel} confirmada por servidor.`
            : activationDelivery.status === 'failed'
              ? `${deliveryLabel} NO CONFIRMADA. ${humanErrorMessage(activationDelivery.error)}`
              : `${deliveryLabel} pendiente de confirmación del servidor.`}
        </div>
      )}


      <EmergencyAuthorityCallPanel
        regionCode={selectedProject?.country}
        coords={
          selectedProject?.coordinates
            ? { lat: selectedProject.coordinates.lat, lng: selectedProject.coordinates.lng }
            : undefined
        }
        workerCoords={
          focusedAlertId
            ? sosAlerts.find((a) => a.id === focusedAlertId)?.geo ?? null
            : null
        }
      />

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
              <span className="text-emerald-400">{safeCount} {t('emergenciaAvanzada.safe', 'Seguros')}</span>
              <span className="text-red-400">{dangerCount} {t('emergenciaAvanzada.danger', 'En Peligro')}</span>
              <span className="text-zinc-400">{unknownCount} {t('emergenciaAvanzada.unknown', 'Sin Confirmar')}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* B.3 (VIDA) — worker SOS alerts (server-written; subscription above) */}
      <AnimatePresence>
        {sosAlerts.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            data-testid="sos-alerts-banner"
            className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/50 space-y-3"
          >
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-rose-500/20 flex items-center justify-center shrink-0 animate-pulse">
                <ShieldAlert className="w-5 h-5 text-rose-500" />
              </div>
              <div className="flex-1">
                <h2 className="text-sm font-black text-rose-500 uppercase tracking-wider">
                  {t('emergenciaAvanzada.sos.title', 'SOS de trabajadores — últimas 24 h')}
                </h2>
                <p className="text-xs text-rose-400/80 mt-1">
                  {t('emergenciaAvanzada.sos.subtitle', 'Alertas enviadas con el botón SOS. Verifica el estado de cada persona ahora.')}
                </p>
              </div>
              <span data-testid="sos-alerts-count" className="text-2xl font-black text-rose-500 shrink-0">
                {sosAlerts.length}
              </span>
            </div>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {sosAlerts.map(a => {
                const isFocused = focusedAlertId === a.id;
                return (
                <div
                  key={a.id}
                  ref={isFocused ? focusedAlertRef : undefined}
                  data-testid="sos-alert-row"
                  data-focused={isFocused ? 'true' : undefined}
                  className={`p-2.5 rounded-lg bg-rose-500/5 border flex items-center justify-between gap-3 ${
                    isFocused
                      ? 'border-rose-500 ring-2 ring-rose-500/60'
                      : 'border-rose-500/20'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-primary-token truncate">
                      {a.userEmail ?? a.uid}
                    </p>
                    <p className="text-[10px] text-zinc-500 mt-0.5">{formatSosTime(a)}</p>
                  </div>
                  {a.geo && (
                    <a
                      href={`https://www.google.com/maps?q=${a.geo.lat},${a.geo.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] font-black uppercase px-2 py-1 rounded-lg bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 shrink-0"
                    >
                      {t('emergenciaAvanzada.sos.location', 'Ver ubicación')}
                    </a>
                  )}
                </div>
                );
              })}
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

          {/* Zone status — Audit 2026-07-02 §3.4 #3: the previous third
              entry ('Zona de Seguridad: ACTIVA') was an unconditional literal
              with no real source behind it — it claimed a real-world state
              that was never actually checked. Removed; the two entries below
              stay because they ARE derived from `activeEmergency`, the real
              Firestore-backed emergency lifecycle state. */}
          <Card className="p-4 border-white/5 space-y-3">
            <h3 className="text-xs font-bold text-muted-token uppercase tracking-widest flex items-center gap-2">
              <ShieldAlert className="w-4 h-4" />
              Estado de Zonas
            </h3>
            {[
              { name: 'Área de Trabajo', status: activeEmergency ? 'BLOQUEADO' : 'OPERATIVO', color: activeEmergency ? 'text-red-400 bg-red-500/10' : 'text-emerald-400 bg-emerald-500/10' },
              { name: 'Planta / Faena', status: activeEmergency ? 'EVACUANDO' : 'OPERATIVO', color: activeEmergency ? 'text-amber-400 bg-amber-500/10' : 'text-emerald-400 bg-emerald-500/10' },
            ].map(z => (
              <div key={z.name} className="flex items-center justify-between p-2.5 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-subtle-token">
                <span className="text-xs text-secondary-token">{z.name}</span>
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
                <h3 className="text-sm font-bold text-primary-token uppercase tracking-wider">
                  Actividad Sísmica — USGS (últimas 24h)
                </h3>
                <span className="text-[10px] text-zinc-400 flex items-center gap-1">
                  <RefreshCw className="w-3 h-3" /> Actualiza cada 2 min
                </span>
              </div>
              {seismicLoading ? (
                <div className="flex-1 flex flex-col items-center justify-center text-zinc-400">
                  <Activity className="w-10 h-10 mb-3 opacity-40 animate-pulse" />
                  <p className="text-sm">Cargando datos sísmicos...</p>
                </div>
              ) : seismicError === 'project_coordinates_unavailable' ? (
                <div className="flex-1 flex flex-col items-center justify-center text-amber-500" role="status">
                  <Map className="w-10 h-10 mb-3 opacity-60" />
                  <p className="text-sm font-bold">Coordenadas de la faena no disponibles.</p>
                  <p className="text-xs text-zinc-500 mt-1">Configura la ubicación del proyecto para activar el monitoreo sísmico por distancia.</p>
                </div>
              ) : seismicError ? (
                <div className="flex-1 flex flex-col items-center justify-center text-amber-500" role="alert">
                  <XCircle className="w-10 h-10 mb-3 opacity-60" />
                  <p className="text-sm font-bold">No se pudo conectar con la Red Sismológica (USGS).</p>
                  <p className="text-xs text-zinc-500 mt-1">Reintenta en unos minutos. La app sigue monitoreando en segundo plano.</p>
                </div>
              ) : recentQuakes.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-zinc-400">
                  <Activity className="w-10 h-10 mb-3 opacity-40" />
                  <p className="text-sm">Sin actividad sísmica registrada en las últimas 24h.</p>
                </div>
              ) : (
                <div className="space-y-2 overflow-y-auto flex-1">
                  {recentQuakes.map(q => (
                    <div key={q.id} className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-900 border border-subtle-token flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 font-black text-sm ${q.magnitude >= 5 ? 'bg-red-500/20 text-red-400' : q.magnitude >= 4 ? 'bg-amber-500/20 text-amber-400' : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-400'}`}>
                          {q.magnitude.toFixed(1)}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-primary-token truncate">{q.place}</p>
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
              <h3 className="text-sm font-bold text-primary-token uppercase tracking-wider shrink-0">
                Canal de Emergencia
                {activeEmergency && !chatError && <span className="ml-2 text-[10px] text-red-400 animate-pulse">● EN VIVO</span>}
              </h3>
              {chatError && (
                <div
                  role="alert"
                  className="shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-500 text-xs font-bold"
                >
                  <XCircle className="w-4 h-4 shrink-0" />
                  {humanErrorMessage(chatError)}
                </div>
              )}
              <div className="flex-1 bg-zinc-50 dark:bg-zinc-900 rounded-xl border border-subtle-token p-3 flex flex-col gap-2 overflow-y-auto min-h-0">
                {chatError ? null : messages.length === 0 ? (
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
                          <p className="text-xs text-primary-token">{msg.text}</p>
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
                  className="flex-1 px-3 py-2 text-xs rounded-xl border border-default-token bg-surface text-primary-token placeholder-zinc-400 disabled:opacity-40 focus:outline-none focus:border-red-500/50"
                />
                <button
                  onClick={sendMessage}
                  aria-label="Enviar mensaje"
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
              <h3 className="text-sm font-bold text-primary-token uppercase tracking-wider shrink-0">
                Estado de Personal
              </h3>
              {safetyError && (
                <div
                  role="alert"
                  className="shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-500 text-xs font-bold"
                >
                  <XCircle className="w-4 h-4 shrink-0" />
                  {humanErrorMessage(safetyError)}
                </div>
              )}
              {safetyError ? null : !workers || workers.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-zinc-400">
                  <Users className="w-10 h-10 mb-3 opacity-40" />
                  <p className="text-sm">No hay trabajadores registrados en este proyecto.</p>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto space-y-2">
                  {workers.map(w => {
                    const status = safetyStatuses[w.id] ?? 'unknown';
                    return (
                      <div key={w.id} className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-900 border border-subtle-token flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-black ${status === 'safe' ? 'bg-emerald-500/20 text-emerald-400' : status === 'danger' ? 'bg-red-500/20 text-red-400' : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-400'}`}>
                            {w.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-primary-token truncate">{w.name}</p>
                            <p className="text-[10px] text-zinc-500">{w.role}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {activeEmergency ? (
                            <>
                              {/* Sprint 20 19th-wave (Bucket C): native title= â†’ Tooltip primitive (WCAG 2.1 AA 1.4.13). aria-label provides SR semantic. */}
                              <Tooltip content="Marcar seguro">
                                <button
                                  onClick={() => markWorker(w.id, 'safe')}
                                  aria-label={`Marcar a ${w.name} como seguro`}
                                  className={`p-1.5 rounded-lg transition-colors ${status === 'safe' ? 'bg-emerald-500 text-white' : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400'}`}
                                >
                                  <UserCheck className="w-3.5 h-3.5" aria-hidden="true" />
                                </button>
                              </Tooltip>
                              <Tooltip content="Marcar en peligro">
                                <button
                                  onClick={() => markWorker(w.id, 'danger')}
                                  aria-label={`Marcar a ${w.name} en peligro`}
                                  className={`p-1.5 rounded-lg transition-colors ${status === 'danger' ? 'bg-red-500 text-white' : 'bg-red-500/10 hover:bg-red-500/20 text-red-400'}`}
                                >
                                  <UserX className="w-3.5 h-3.5" aria-hidden="true" />
                                </button>
                              </Tooltip>
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
