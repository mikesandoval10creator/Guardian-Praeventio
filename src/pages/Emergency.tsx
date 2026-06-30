// Sprint 37 — Brecha B (SLM offline) audit decision:
// `Emergency.tsx` no realiza llamadas Gemini directamente. El botón
// "AI Generator" enlaza con `/emergency-generator` (página
// `EmergencyGenerator.tsx`) cuyo `generateEmergencyPlanJSON` devuelve
// JSON estructurado con schema fijo (resumen / brigada / procedimientos
// / evacuación / normativas). El SLM on-device produce texto libre, no
// JSON estructurado garantizado, por lo que un fallback ingenuo
// rompería el rendering tab-por-tab. El fallback semántico vive en
// `Evacuation.handleGenerateEmergencyPlan` (texto libre, ya cableado).
// Si el futuro adapter SLM incluye output JSON-schema-constrained,
// reabrimos este wire. Ver `docs/slm-offline.md`.
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileText,
  AlertTriangle,
  Phone,
  Shield,
  ShieldAlert,
  ChevronRight,
  BookOpen,
  Download,
  Search,
  CheckCircle2,
  Clock,
  Activity,
  Zap,
  Power,
  Loader2,
  WifiOff,
  X,
  User
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useProject } from '../contexts/ProjectContext';
import { useEmergency } from '../contexts/EmergencyContext';
import { useAppMode } from '../contexts/AppModeContext';
import { resolveEmergencyModeTransition } from '../services/emergency/emergencyModeSync';
import { useManDownDetection } from '../hooks/useManDownDetection';
import { useEmergencyMedicalCard, shareableCard } from '../hooks/useEmergencyMedicalCard';
import { useFirebase } from '../contexts/FirebaseContext';
import { DynamicEvacuationMap } from '../components/emergency/DynamicEvacuationMap';
import { EmergencyMedicalCardEditor } from '../components/emergency/EmergencyMedicalCardEditor';
import { TriageBeacon } from '../components/emergency/TriageBeacon';
import { EmergencyDashboard } from '../components/emergency/EmergencyDashboard';
import { Asesor } from '../components/emergency/Asesor';
import { db, doc, onSnapshot, setDoc, handleFirestoreError, OperationType } from '../services/firebase';
import { useFirestoreCollection } from '../hooks/useFirestoreCollection';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useWakeLock } from '../hooks/useWakeLock';
import { Worker } from '../types';
import { logger } from '../utils/logger';
import { awardPoints } from '../services/gamificationService';
import { ManDownSupervisorWidget } from '../components/dashboard/ManDownSupervisorWidget';

interface EmergencyProtocol {
  id: string;
  title: string;
  category: string;
  lastReview: string;
  status: 'active' | 'review' | 'draft';
}

export function Emergency() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const { triggerEmergency } = useEmergency();
  const { mode, setMode } = useAppMode();
  const { user } = useFirebase();
  const { card: medicalCard } = useEmergencyMedicalCard();
  const [showTriageBeacon, setShowTriageBeacon] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [isCrisisMode, setIsCrisisMode] = useState(false);
  const [isContactsOpen, setIsContactsOpen] = useState(false);
  const [isDownloadingPlan, setIsDownloadingPlan] = useState(false);
  // B1 — on a confirmed man-down, fan out the FCM push to project responders
  // (triggerEmergency → /api/emergency/notify-brigada) AND switch to emergency
  // mode. Previously the hook wrote mandown_events + sounded the local alarm but
  // NEVER pushed, so a supervisor only saw it if they happened to be in the app.
  const { isActive, isAlerting, countdown, startDetection, stopDetection, cancelCountdown, acknowledgeAlert } =
    useManDownDetection({
      onManDownConfirmed: () => {
        // A confirmed man-down = an unresponsive worker. Raise the TriageBeacon
        // (the green/yellow/red triage signal arriving responders read off the
        // screen + QR) AND fan out the emergency push. Default severity GRAVE:
        // "unresponsive, status unknown" — conservative, never understated. The
        // blood type / allergies only appear if the worker opted in (consent).
        setShowTriageBeacon(true);
        if (selectedProject?.id) void triggerEmergency('fall', selectedProject.id);
      },
    });
  const isOnline = useOnlineStatus();
  const { isSupported: isWakeLockSupported, isLocked: isWakeLocked, requestWakeLock, releaseWakeLock } = useWakeLock();

  const [showContactsModal, setShowContactsModal] = useState(false);
  const [downloadingPDF, setDownloadingPDF] = useState(false);

  const { data: protocolsData, loading: loadingProtocols } = useFirestoreCollection<EmergencyProtocol>(
    selectedProject ? `projects/${selectedProject.id}/emergency_protocols` : null
  );

  const { data: workers } = useFirestoreCollection<Worker>(
    selectedProject ? `projects/${selectedProject.id}/workers` : null
  );

  const handleDownloadPDF = async () => {
    if (!selectedProject?.id) return;
    setDownloadingPDF(true);
    try {
      const res = await fetch('/api/reports/generate-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: selectedProject.id, type: 'emergency_plan' }),
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Plan_Emergencia_${selectedProject.name || selectedProject.id}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      logger.error('Error downloading emergency plan PDF', { error: err });
    } finally {
      setDownloadingPDF(false);
    }
  };

  React.useEffect(() => {
    if (!selectedProject?.id) return undefined;
    const projectRef = doc(db, 'projects', selectedProject.id);
    const unsubscribe = onSnapshot(projectRef, (docSnap) => {
      if (docSnap.exists()) {
        const active = docSnap.data().isEmergencyActive || false;
        setIsCrisisMode(active);
        if (active) {
          requestWakeLock();
        } else {
          releaseWakeLock();
        }
      }
    });
    return () => {
      unsubscribe();
      releaseWakeLock();
    };
  }, [selectedProject?.id, requestWakeLock, releaseWakeLock]);

  // BUG FIX (OLA 1): the worker-facing SOS button (RootLayout, global) renders
  // ONLY when AppMode === 'emergency' (SOSButton returns null otherwise). A
  // DECLARED project emergency previously drove only the local `isCrisisMode`
  // banner + wake-lock — it never flipped AppMode — so the SOS button stayed
  // INVISIBLE during a real emergency on this screen. Mirror the declared
  // emergency into AppMode so the button appears. resolveEmergencyModeTransition
  // only toggles emergency↔normal (never clobbers 'driving'); runtime setMode is
  // safe — the AppMode persist layer never resurrects 'emergency' on reload.
  React.useEffect(() => {
    const next = resolveEmergencyModeTransition(isCrisisMode, mode);
    if (next) setMode(next);
  }, [isCrisisMode, mode, setMode]);

  // a11y: the emergency-contacts dialog must be dismissable by keyboard (Esc)
  // and lock background scroll while open (mirrors ReasonModal.tsx). Without
  // this a keyboard/AT user could not close the modal.
  React.useEffect(() => {
    if (!isContactsOpen) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsContactsOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [isContactsOpen]);

  const toggleCrisisMode = async () => {
    if (!selectedProject?.id) return;
    try {
      const projectRef = doc(db, 'projects', selectedProject.id);
      const newStatus = !isCrisisMode;
      const updateData: any = { isEmergencyActive: newStatus };
      
      if (newStatus) {
        updateData.emergencyStartTime = new Date().toISOString();
        updateData.activeEmergencyProtocol = 'Emergencia General';
      } else {
        updateData.emergencyStartTime = null;
        updateData.activeEmergencyProtocol = null;
      }
      
      await setDoc(projectRef, updateData, { merge: true });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `projects/${selectedProject.id}`);
    }
  };

  // Fallback to default protocols if none exist in Firestore
  const defaultProtocols: EmergencyProtocol[] = [
    { id: 'P1', title: t('emergency_page.default_protocols.fire_title'), category: t('emergency_page.default_protocols.fire_category'), lastReview: '2024-01-15', status: 'active' },
    { id: 'P2', title: t('emergency_page.default_protocols.quake_title'), category: t('emergency_page.default_protocols.quake_category'), lastReview: '2024-02-10', status: 'active' },
    { id: 'P3', title: t('emergency_page.default_protocols.spill_title'), category: t('emergency_page.default_protocols.spill_category'), lastReview: '2023-11-20', status: 'review' },
    { id: 'P4', title: t('emergency_page.default_protocols.first_aid_title'), category: t('emergency_page.default_protocols.first_aid_category'), lastReview: '2024-03-05', status: 'active' },
  ];

  const protocols = protocolsData && protocolsData.length > 0 ? protocolsData : defaultProtocols;

  const filteredProtocols = protocols.filter(p =>
    (p.title || '').toLowerCase().includes(String(searchTerm || '').toLowerCase()) ||
    (p.category || '').toLowerCase().includes(String(searchTerm || '').toLowerCase())
  );

  // Round 22 audit fix DT-11: handler para Descargar Plan Completo. Genera
  // un PDF con la lista de protocolos vigentes usando jsPDF + autoTable
  // (deps ya presentes via Pricing/Reports). Best-effort: si falla,
  // log + noop, no rompe la UI.
  const handleDownloadPlan = async () => {
    if (!selectedProject || protocols.length === 0) return;
    setIsDownloadingPlan(true);
    try {
      const { jsPDF } = await import('jspdf');
      const autoTableModule = await import('jspdf-autotable');
      const autoTable = (autoTableModule as any).default ?? (autoTableModule as any).autoTable;
      const doc = new jsPDF();
      doc.setFontSize(18);
      doc.text(`Plan de Emergencia — ${selectedProject.name}`, 14, 22);
      doc.setFontSize(11);
      doc.text(`Generado: ${new Date().toLocaleDateString('es-CL')}`, 14, 32);
      autoTable(doc, {
        startY: 40,
        head: [['#', 'Protocolo', 'Categoría', 'Última Revisión', 'Estado']],
        body: protocols.map((p, i) => [
          String(i + 1),
          p.title ?? '—',
          p.category ?? '—',
          p.lastReview ?? '—',
          p.status === 'active' ? 'Vigente' : 'En Revisión',
        ]),
      });
      const safeName = selectedProject.name.replace(/[^a-zA-Z0-9_-]+/g, '_');
      doc.save(`Plan_Emergencia_${safeName}.pdf`);
    } catch (err) {
      logger.error('Error generando PDF plan emergencia', err);
    } finally {
      setIsDownloadingPlan(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto w-full overflow-hidden box-border">
      {/* TriageBeacon — raised on a confirmed man-down (#2). Full-screen
          color-coded beacon (GRAVE by default) + QR with the worker's medical
          card, but only the fields they consented to share. */}
      {showTriageBeacon && user && (
        <TriageBeacon
          workerId={user.uid}
          workerName={user.displayName || undefined}
          bloodType={shareableCard(medicalCard)?.bloodType}
          allergies={shareableCard(medicalCard)?.allergies}
          severity="GRAVE"
          onDismiss={() => setShowTriageBeacon(false)}
        />
      )}

      {/* Man Down Alert Overlay */}
      <AnimatePresence>
        {isAlerting && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-rose-600/90 backdrop-blur-xl p-6"
          >
            <div className="max-w-md w-full text-center space-y-8">
              <motion.div
                animate={{ scale: [1, 1.1, 1] }}
                transition={{ repeat: Infinity, duration: 1 }}
                className="w-32 h-32 bg-white rounded-full flex items-center justify-center mx-auto shadow-2xl shadow-white/20"
              >
                <AlertTriangle className="w-16 h-16 text-rose-600" />
              </motion.div>
              <div className="space-y-2">
                <h2 className="text-4xl font-black text-white uppercase tracking-tighter">{t('emergency_page.man_down.alert_title')}</h2>
                <p className="text-white/80 font-bold uppercase tracking-widest text-xs">{t('emergency_page.man_down.alert_subtitle')}</p>
              </div>
              <div className="text-8xl font-black text-white tabular-nums">
                {countdown}
              </div>
              <p className="text-white/60 text-sm font-medium">
                {t('emergency_page.man_down.countdown_warning', { countdown })}
              </p>
              {/* B8: Primary "Estoy bien" CTA — large, glove-operable, only during countdown. */}
              {countdown != null && countdown > 0 && (
                <button
                  onClick={cancelCountdown}
                  aria-label={t('emergency_page.man_down.cancel_aria')}
                  className="w-full min-h-[96px] bg-white text-rose-600 py-8 px-6 rounded-3xl font-black uppercase tracking-widest shadow-2xl active:scale-95 transition-all text-2xl sm:text-3xl"
                >
                  {t('emergency_page.man_down.im_ok', { countdown })}
                </button>
              )}
              {/* B9: Supervisor acknowledgement — secondary, only while the alarm is sounding (countdown finished). */}
              {countdown === 0 && (
                <button
                  onClick={() => { awardPoints('mandown_acknowledged'); acknowledgeAlert(); }}
                  aria-label={t('emergency_page.man_down.rescue_coming')}
                  className="w-full bg-white/10 border border-white/40 text-white py-4 rounded-2xl font-bold uppercase tracking-widest shadow-lg active:scale-95 transition-all text-xs sm:text-sm"
                >
                  {t('emergency_page.man_down.rescue_coming')}
                </button>
              )}
              <button
                onClick={stopDetection}
                className="w-full bg-white/0 border border-white/30 text-white/80 py-3 rounded-2xl font-bold uppercase tracking-widest active:scale-95 transition-all text-[10px] sm:text-xs"
              >
                {t('emergency_page.man_down.cancel_alert')}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 sm:mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-primary-token uppercase tracking-tighter leading-tight">{t('emergency_page.title')}</h1>
          <p className="text-[10px] sm:text-xs font-bold text-zinc-500 uppercase tracking-widest mt-1">
            {selectedProject 
              ? t('emergency_page.subtitle_with_project', { name: selectedProject.name })
              : t('emergency_page.subtitle_default')}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
          <div className="flex gap-2 w-full sm:w-auto">
            {/* Sprint 33 wire W4 — Reportar near-miss. Wire al endpoint
                canónico POST /api/incidents/report. Cultura POSITIVA:
                reportar SIEMPRE suma XP, nunca penaliza. */}
            <Link
              to="/incidents/report"
              className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-teal-50 dark:bg-teal-500/10 border border-teal-200 dark:border-teal-500/30 text-teal-700 dark:text-teal-300 hover:bg-teal-500 hover:text-white dark:hover:bg-teal-500 dark:hover:text-white px-3 sm:px-4 py-3 sm:py-2 rounded-xl font-black uppercase tracking-widest text-[10px] transition-all shadow-sm"
            >
              <ShieldAlert className="w-4 h-4" />
              <span>Reportar near miss</span>
            </Link>
            {isOnline ? (
              <Link
                to="/emergency-generator"
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 text-rose-600 dark:text-rose-500 hover:bg-rose-500 hover:text-white dark:hover:bg-rose-500 dark:hover:text-white px-3 sm:px-4 py-3 sm:py-2 rounded-xl font-black uppercase tracking-widest text-[10px] transition-all shadow-sm"
              >
                <Zap className="w-4 h-4" />
                <span>{t('emergency_page.btn.ai_generator')}</span>
              </Link>
            ) : (
              <button
                disabled
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-elevated/50 border border-zinc-200 dark:border-zinc-700/50 text-muted-token px-3 sm:px-4 py-3 sm:py-2 rounded-xl font-black uppercase tracking-widest text-[10px] cursor-not-allowed shadow-sm"
                title={t('emergency_page.requires_internet')}
              >
                <WifiOff className="w-4 h-4" />
                <span>{t('emergency_page.btn.requires_connection')}</span>
              </button>
            )}
            <button 
              onClick={toggleCrisisMode}
              disabled={!isOnline}
              title={!isOnline ? t('emergency_page.requires_internet') : ""}
              className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 sm:px-4 py-3 sm:py-2 rounded-xl font-black uppercase tracking-widest text-[10px] transition-all shadow-sm ${
                !isOnline
                  ? 'bg-elevated/50 text-muted-token border border-zinc-200 dark:border-zinc-700/50 cursor-not-allowed'
                  : isCrisisMode 
                    ? 'bg-rose-500 text-white shadow-lg shadow-rose-500/20' 
                    : 'bg-elevated text-muted-token hover:text-zinc-900 dark:hover:text-white border border-zinc-200 dark:border-transparent'
              }`}
            >
              {!isOnline ? (
                <WifiOff className="w-4 h-4" />
              ) : (
                <Zap className={`w-4 h-4 ${isCrisisMode ? 'animate-pulse' : ''}`} />
              )}
              <span>{!isOnline ? t('emergency_page.btn.requires_connection') : isCrisisMode ? t('emergency_page.btn.crisis_active') : t('emergency_page.btn.crisis_mode')}</span>
            </button>
          </div>
          <button
            onClick={handleDownloadPlan}
            disabled={isDownloadingPlan || protocols.length === 0}
            className="w-full sm:w-auto flex items-center justify-center gap-2 bg-surface border border-default-token text-secondary-token hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-3 sm:py-2 rounded-xl font-black uppercase tracking-widest text-[10px] transition-all shadow-sm"
          >
            {isDownloadingPlan ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            <span>{isDownloadingPlan ? t('emergency_page.btn.generating') : t('emergency_page.btn.download_plan')}</span>
          </button>
          <button
            onClick={() => setIsContactsOpen(true)}
            className="w-full sm:w-auto flex items-center justify-center gap-2 accent-bg hover:opacity-90 accent-on-primary-text px-4 py-3 sm:py-2 rounded-xl font-black uppercase tracking-widest text-[10px] transition-all shadow-lg shadow-[#4db6ac]/20 active:scale-95"
          >
            <Phone className="w-4 h-4" />
            <span>{t('emergency_page.btn.emergency_contacts')}</span>
          </button>
        </div>
      </div>

      {/* Modal contactos de emergencia */}
      {isContactsOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setIsContactsOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="emergency-contacts-title"
            className="bg-surface rounded-2xl max-w-md w-full p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="emergency-contacts-title" className="text-lg font-black uppercase tracking-widest mb-4 flex items-center gap-2">
              <Phone className="w-5 h-5 text-emerald-500" />
              {t('emergency_page.btn.emergency_contacts')}
            </h3>
            <ul className="space-y-3 text-sm" data-testid="emergency-contacts-list">
              <li className="flex justify-between items-center"><span>SAMU</span><a href="tel:131" className="font-mono font-black text-emerald-500">131</a></li>
              <li className="flex justify-between items-center"><span>Bomberos</span><a href="tel:132" className="font-mono font-black text-emerald-500">132</a></li>
              <li className="flex justify-between items-center"><span>Carabineros</span><a href="tel:133" className="font-mono font-black text-emerald-500">133</a></li>
              <li className="flex justify-between items-center"><span>ONEMI</span><a href="tel:1349" className="font-mono font-black text-emerald-500">1349</a></li>
              <li className="flex justify-between items-center"><span>Mutual de Seguridad</span><a href="tel:6006002247" className="font-mono font-black text-emerald-500">600 600 2247</a></li>
              <li className="flex justify-between items-center"><span>ACHS</span><a href="tel:6006002247" className="font-mono font-black text-emerald-500">600 600 2247</a></li>
              <li className="flex justify-between items-center"><span>Información Toxicológica (CITUC)</span><a href="tel:226353800" className="font-mono font-black text-emerald-500">22 635 3800</a></li>
            </ul>
            <button onClick={() => setIsContactsOpen(false)} className="mt-6 w-full bg-elevated hover:bg-zinc-200 dark:hover:bg-zinc-700 text-primary-token px-4 py-2 rounded-xl font-bold text-sm">
              {t('common.close')}
            </button>
          </div>
        </div>
      )}

      <AnimatePresence mode="wait">
        {isCrisisMode ? (
          <motion.div
            key="crisis-dashboard"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            <EmergencyDashboard />
          </motion.div>
        ) : (
          <motion.div
            key="standard-emergency"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="grid grid-cols-1 lg:grid-cols-3 gap-8"
          >
            {/* Protocols List */}
            <div className="lg:col-span-2 space-y-6">
              <ManDownSupervisorWidget />
              {/* #2 step 1 — the worker's on-device emergency medical card
                  (blood type + allergies + opt-in consent). The TriageBeacon
                  (step 2) reads it to pre-warn responders. */}
              <EmergencyMedicalCardEditor />
              <DynamicEvacuationMap />
              
              {/* Man Down Control Panel */}
              <div className={`p-4 sm:p-6 rounded-2xl sm:rounded-3xl border transition-all shadow-sm ${
                isActive ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30' : 'bg-surface border-default-token'
              }`}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4 sm:mb-6">
                  <div className="flex items-center gap-3 sm:gap-4">
                    <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl flex items-center justify-center transition-all shrink-0 ${
                      isActive ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20' : 'bg-elevated text-muted-token'
                    }`}>
                      <Activity className="w-5 h-5 sm:w-6 sm:h-6" />
                    </div>
                    <div>
                      <h3 className="text-base sm:text-lg font-bold text-primary-token leading-tight">{t('emergency_page.man_down.panel_title')}</h3>
                      <p className="text-[10px] sm:text-xs text-zinc-500 font-medium uppercase tracking-widest mt-0.5">
                        {isActive ? t('emergency_page.man_down.monitoring_active') : t('emergency_page.man_down.system_off')}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={isActive ? stopDetection : startDetection}
                    className={`w-full sm:w-14 h-12 sm:h-14 rounded-xl sm:rounded-full flex items-center justify-center gap-2 transition-all active:scale-95 ${
                      isActive ? 'bg-rose-500 text-white shadow-lg shadow-rose-500/20' : 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20'
                    }`}
                  >
                    <Power className="w-5 h-5 sm:w-6 sm:h-6" />
                    <span className="sm:hidden font-bold uppercase tracking-widest text-xs">
                      {isActive ? t('emergency_page.btn.deactivate') : t('emergency_page.btn.activate')}
                    </span>
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:gap-4">
                  <div className="p-3 sm:p-4 bg-zinc-50 dark:bg-black/20 rounded-xl sm:rounded-2xl border border-subtle-token">
                    <p className="text-[9px] sm:text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">{t('emergency_page.man_down.sensors_status')}</p>
                    <div className="flex items-center gap-2">
                      <div className={`w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-700'}`} />
                      <span className="text-[10px] sm:text-xs font-bold text-primary-token uppercase">{isActive ? t('emergency_page.man_down.connected') : t('emergency_page.man_down.inactive')}</span>
                    </div>
                  </div>
                  <div className="p-3 sm:p-4 bg-zinc-50 dark:bg-black/20 rounded-xl sm:rounded-2xl border border-subtle-token">
                    <p className="text-[9px] sm:text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">{t('emergency_page.man_down.last_motion')}</p>
                    <div className="flex items-center gap-2">
                      <Clock className="w-3 h-3 text-muted-token" />
                      <span className="text-[10px] sm:text-xs font-bold text-primary-token uppercase">{isActive ? t('emergency_page.man_down.one_sec_ago') : '--:--'}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="relative">
                <Search className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 w-4 h-4 sm:w-5 sm:h-5 text-muted-token" />
                <input
                  type="text"
                  placeholder={t('emergency_page.search_placeholder')}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-surface border border-default-token rounded-xl sm:rounded-2xl py-3 sm:py-4 pl-10 sm:pl-12 pr-4 text-sm text-primary-token placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all shadow-sm"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                {filteredProtocols.map((protocol, index) => (
                  <motion.div
                    key={protocol.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className="bg-surface border border-default-token rounded-xl sm:rounded-2xl p-4 sm:p-5 hover:border-emerald-500/30 dark:hover:border-emerald-500/30 transition-all group cursor-pointer flex flex-col shadow-sm"
                  >
                    <div className="flex items-start justify-between mb-3 sm:mb-4">
                      <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-elevated flex items-center justify-center text-emerald-600 dark:text-emerald-500 border border-subtle-token shrink-0">
                        <FileText className="w-4 h-4 sm:w-5 sm:h-5" />
                      </div>
                      <span className={`px-2 py-0.5 rounded text-[7px] sm:text-[8px] font-black uppercase tracking-widest ${
                        protocol.status === 'active' ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-500' : 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-500'
                      }`}>
                        {protocol.status === 'active' ? t('emergency_page.protocol.active') : t('emergency_page.protocol.review')}
                      </span>
                    </div>
                    <h3 className="font-bold text-primary-token text-base sm:text-lg group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors leading-tight flex-1">{protocol.title}</h3>
                    <p className="text-zinc-500 text-[10px] sm:text-xs font-medium mt-1 uppercase tracking-wider">{protocol.category}</p>
                    <div className="flex items-center justify-between mt-4 sm:mt-6 pt-3 sm:pt-4 border-t border-subtle-token">
                      <div className="flex items-center gap-1.5 text-zinc-500 text-[9px] sm:text-[10px] font-bold uppercase tracking-wider">
                        <Clock className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                        <span>{t('emergency_page.protocol.review_label', { date: protocol.lastReview })}</span>
                      </div>
                      <ChevronRight className="w-3 h-3 sm:w-4 sm:h-4 text-zinc-400 dark:text-zinc-600 group-hover:text-emerald-500 transition-colors" />
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>

            {/* Sidebar Info */}
            <div className="space-y-4 sm:space-y-6">
              <div className="bg-surface border border-default-token rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-sm">
                <h3 className="text-base sm:text-lg font-bold text-primary-token mb-3 sm:mb-4 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5 text-amber-500" />
                  {t('emergency_page.recent_alerts')}
                </h3>
                <div className="space-y-3 sm:space-y-4">
                  {[
                    { title: t('emergency_page.alerts.drill_title'), date: t('emergency_page.alerts.drill_date'), type: 'info' },
                    { title: t('emergency_page.alerts.extinguisher_title'), date: t('emergency_page.alerts.extinguisher_date'), type: 'warning' },
                  ].map((alert, i) => (
                    <div key={i} className="flex gap-2 sm:gap-3 p-2.5 sm:p-3 rounded-xl bg-elevated/50 border border-subtle-token">
                      <div className={`w-1 sm:w-1.5 rounded-full shrink-0 ${alert.type === 'info' ? 'bg-blue-500' : 'bg-amber-500'}`} />
                      <div>
                        <h4 className="text-xs sm:text-sm font-bold text-primary-token">{alert.title}</h4>
                        <p className="text-[9px] sm:text-[10px] text-zinc-500 font-medium uppercase tracking-wider mt-0.5">{alert.date}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-surface border border-default-token rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-sm">
                <h3 className="text-base sm:text-lg font-bold text-primary-token mb-3 sm:mb-4 flex items-center gap-2">
                  <Shield className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-500" />
                  {t('emergency_page.compliance_status')}
                </h3>
                <div className="space-y-3 sm:space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs sm:text-sm text-secondary-token">{t('emergency_page.compliance.plan')}</span>
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs sm:text-sm text-secondary-token">{t('emergency_page.compliance.brigade')}</span>
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs sm:text-sm text-secondary-token">{t('emergency_page.compliance.signage')}</span>
                    <div className="w-4 h-4 rounded-full border-2 border-zinc-300 dark:border-zinc-700" />
                  </div>
                </div>
              </div>

              {/* Tactical Advisor */}
              <Asesor />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Emergency Contacts Modal */}
      <AnimatePresence>
        {showContactsModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
            onClick={() => setShowContactsModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-surface rounded-[2rem] p-6 w-full max-w-md shadow-2xl border border-default-token max-h-[80vh] flex flex-col"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-emerald-500/10 rounded-xl">
                    <Phone className="w-5 h-5 text-emerald-500" />
                  </div>
                  <h2 className="text-lg font-black text-primary-token uppercase tracking-tight">{t('emergency_page.btn.emergency_contacts')}</h2>
                </div>
                <button onClick={() => setShowContactsModal(false)} aria-label="Cerrar" className="text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="overflow-y-auto flex-1 space-y-3 pr-1">
                {(!workers || workers.length === 0) && (
                  <p className="text-sm text-zinc-500 text-center py-8">{t('emergency_page.no_workers')}</p>
                )}
                {workers?.filter(w => w.status === 'active').map(worker => (
                  <div key={worker.id} className="flex items-center gap-4 p-4 bg-elevated rounded-2xl">
                    <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center shrink-0 overflow-hidden">
                      {worker.photoUrl
                        ? <img src={worker.photoUrl} alt={worker.name} className="w-full h-full object-cover" />
                        : <User className="w-5 h-5 text-emerald-500" />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-primary-token truncate">{worker.name}</p>
                      <p className="text-[10px] text-zinc-500 uppercase tracking-wider">{worker.role}</p>
                    </div>
                    {worker.phone ? (
                      <a
                        href={`tel:${worker.phone}`}
                        className="flex items-center gap-2 px-3 py-2 accent-bg hover:opacity-90 accent-on-primary-text rounded-xl text-xs font-black uppercase tracking-wider transition-colors shrink-0"
                      >
                        <Phone className="w-3 h-3" />
                        {worker.phone}
                      </a>
                    ) : (
                      <span className="text-[10px] text-zinc-400 italic shrink-0">{t('emergency_page.no_phone')}</span>
                    )}
                  </div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
