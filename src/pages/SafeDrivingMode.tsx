import React, { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Car, Phone, MapPin, Mic, ShieldAlert, MicOff, CheckCircle2, AlertTriangle, RotateCcw, Route } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useProject } from '../contexts/ProjectContext';
import { useEmergency } from '../contexts/EmergencyContext';
import { apiAuthHeader } from '../lib/apiAuth';
import { randomId } from '../utils/randomId';
import { logger } from '../utils/logger';
import { setActiveCommuteSession } from '../services/driving/commuteSession';
import { WeatherBulletin } from '../components/WeatherBulletin';

export function SafeDrivingMode() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { selectedProject } = useProject();
  const { triggerEmergency } = useEmergency();
  const [isEmergency, setIsEmergency] = useState(false);
  const [sosConfirmedAt, setSosConfirmedAt] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [dictatedText, setDictatedText] = useState('');
  const [reportSaved, setReportSaved] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  // Legal commute (trayecto) session — Ley 16.744 art.5. While a commute is
  // active, a fall/ManDown is tagged tipo:'trayecto' for SUSESO.
  const [commuteSessionId, setCommuteSessionId] = useState<string | null>(null);
  const [commuteBusy, setCommuteBusy] = useState(false);
  const [commuteError, setCommuteError] = useState<string | null>(null);
  // Web Speech API has no DOM lib types — same `any` suppression as the
  // SpeechRecognition ctor resolution below.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const dictatedTextRef = useRef('');
  // Idempotency key — persists across retries of the SAME dictated report so a
  // flaky-network re-tap replays the server's cached response instead of
  // duplicating the incident; regenerates after a successful send. Mirrors
  // SafeDriving.tsx.
  const idempotencyKeyRef = useRef(`drv-${randomId()}`);

  // The dictated voice note is persisted through the SAME audited server
  // endpoint SafeDriving.tsx uses (POST /api/sprint-k/:pid/driving/incidents).
  // Previously this wrote client-side with addDoc to `driving_reports`, a path
  // with NO firestore.rules block (default-deny) — every write was rejected and
  // the empty catch swallowed the error, so reports silently vanished. The
  // server stamps the reporter's identity from the verified token, writes the
  // audit_logs row and the RiskNetwork node. A hands-free dictation is a
  // non-acute on-route observation → kind 'Falla Mecánica' (vs. 'Accidente',
  // reserved for the explicit crash button in SafeDriving.tsx).
  const saveReport = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || !selectedProject) return;
    setIsSaving(true);
    setReportError(null);
    try {
      const authHeader = await apiAuthHeader();
      const res = await fetch(
        `/api/sprint-k/${selectedProject.id}/driving/incidents`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authHeader ? { Authorization: authHeader } : {}),
            'Idempotency-Key': idempotencyKeyRef.current,
          },
          body: JSON.stringify({
            type: 'Falla Mecánica',
            description: trimmed,
          }),
          // En zona sin señal el fetch puede colgarse indefinidamente y dejar al
          // conductor con isSaving=true para siempre. Un timeout de 15 s aborta
          // y cae al branch offline (reportErrorOffline) con su texto intacto.
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        logger.error('driving_dictation_report_failed', { status: res.status, error: body.error });
        setReportError(t(
          'safeDrivingMode.reportErrorServer',
          'No pudimos guardar el reporte. Tu texto sigue aquí — toca Reintentar.',
        ));
        return;
      }
      idempotencyKeyRef.current = `drv-${randomId()}`; // next report = fresh key
      setReportSaved(true);
      setTimeout(() => setReportSaved(false), 3000);
    } catch (err) {
      // Network failure or AbortSignal.timeout (sin señal en ruta) — NUNCA
      // descartar en silencio: el texto dictado permanece visible y el botón
      // Reintentar reenvía. El TimeoutError/AbortError del signal cae aquí y se
      // muestra como error offline (el destino no respondió a tiempo).
      logger.error('driving_dictation_report_failed', { error: err });
      setReportError(t(
        'safeDrivingMode.reportErrorOffline',
        'Sin conexión: el reporte NO fue enviado. Reintenta cuando recuperes señal — tu texto sigue aquí.',
      ));
    } finally {
      setIsSaving(false);
    }
  };

  const retrySaveReport = () => {
    void saveReport(dictatedTextRef.current);
  };

  const handleDictate = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type SpeechRecognitionCtor = new () => any;
    const SpeechRecognition: SpeechRecognitionCtor | undefined =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).SpeechRecognition ||
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }
    dictatedTextRef.current = '';
    setDictatedText('');
    setReportSaved(false);
    setReportError(null);
    const recognition = new SpeechRecognition();
    recognition.lang = 'es-CL';
    recognition.continuous = true;
    recognition.interimResults = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (e: any) => {
      const rows = e.results as ArrayLike<{ 0: { transcript: string } }>;
      const transcript = Array.from(rows).map((r) => r[0].transcript).join(' ');
      dictatedTextRef.current = transcript;
      setDictatedText(transcript);
    };
    recognition.onend = () => {
      setIsListening(false);
      void saveReport(dictatedTextRef.current);
    };
    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  };

  const handleEmergency = async () => {
    setIsEmergency(true);
    if ('vibrate' in navigator) {
      navigator.vibrate([200, 100, 200, 100, 500]);
    }
    await triggerEmergency('driving_sos', selectedProject?.id);
    setSosConfirmedAt(new Date().toLocaleTimeString('es-CL'));
  };

  // Start/stop a legal commute (trayecto, Ley 16.744 art.5). Persistence flows
  // through the audited /api/commute server route (server resolves tenantId +
  // Admin-SDK write — no client Firestore rule needed); setActiveCommuteSession
  // flips the in-memory hint so a fall during the commute is tagged
  // tipo:'trayecto' for SUSESO (useManDownDetection). A failure is surfaced —
  // never swallowed — because an untracked commute loses the legal classification.
  const handleToggleCommute = async () => {
    if (!selectedProject || commuteBusy) return;
    setCommuteBusy(true);
    setCommuteError(null);
    try {
      const authHeader = await apiAuthHeader();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(authHeader ? { Authorization: authHeader } : {}),
      };
      if (commuteSessionId) {
        const res = await fetch('/api/commute/end', {
          method: 'POST',
          headers,
          body: JSON.stringify({ sessionId: commuteSessionId }),
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          logger.error('commute_end_failed', { status: res.status, error: body.error });
          setCommuteError(t('safeDrivingMode.commuteError', 'No pudimos actualizar el trayecto. Reintenta.'));
          return;
        }
        setCommuteSessionId(null);
        setActiveCommuteSession(null);
      } else {
        const res = await fetch('/api/commute/start', {
          method: 'POST',
          headers,
          body: JSON.stringify({ projectId: selectedProject.id, type: 'home-to-site' }),
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          logger.error('commute_start_failed', { status: res.status, error: body.error });
          setCommuteError(t('safeDrivingMode.commuteError', 'No pudimos actualizar el trayecto. Reintenta.'));
          return;
        }
        const body = (await res.json()) as { sessionId?: string };
        if (!body.sessionId) {
          setCommuteError(t('safeDrivingMode.commuteError', 'No pudimos actualizar el trayecto. Reintenta.'));
          return;
        }
        setCommuteSessionId(body.sessionId);
        setActiveCommuteSession({ projectId: selectedProject.id, sessionId: body.sessionId });
      }
    } catch (err) {
      logger.error('commute_toggle_failed', { error: err });
      setCommuteError(t('safeDrivingMode.commuteError', 'No pudimos actualizar el trayecto. Reintenta.'));
    } finally {
      setCommuteBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col">
      {/* Top Bar */}
      <div className="flex items-center justify-between p-6 bg-zinc-900 border-b border-zinc-800">
        <div className="flex items-center gap-4">
          <Car className="w-10 h-10 text-emerald-500" />
          <div>
            <h1 className="text-2xl font-black text-white uppercase tracking-widest">{t('safeDrivingMode.title', 'Safe Driving')}</h1>
            <p className="text-emerald-500 font-bold uppercase tracking-widest text-xs">{t('safeDrivingMode.activeMode', 'Modo Activo')}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <WeatherBulletin compact className="w-48" />
          <button
            onClick={() => navigate(-1)}
            className="px-6 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-2xl text-white font-black uppercase tracking-widest text-sm transition-colors"
          >
            {t('safeDrivingMode.exit', 'Salir')}
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col p-6 gap-6">
        {/* Voice Assistant Button (Huge) */}
        <button
          onClick={handleDictate}
          className={`flex-1 rounded-[3rem] border-4 flex flex-col items-center justify-center gap-6 transition-all active:scale-95 ${
            isListening ? 'bg-indigo-900 border-indigo-500 animate-pulse' : 'bg-zinc-900 hover:bg-zinc-800 border-zinc-800'
          }`}
        >
          <div className={`w-32 h-32 rounded-full flex items-center justify-center ${isListening ? 'bg-indigo-500/40' : 'bg-indigo-500/20'}`}>
            {isListening ? <MicOff className="w-16 h-16 text-indigo-300" /> : <Mic className="w-16 h-16 text-indigo-500" />}
          </div>
          <span className="text-3xl font-black text-white uppercase tracking-widest">
            {isListening ? t('safeDrivingMode.stop', 'Detener') : t('safeDrivingMode.dictateReport', 'Dictar Reporte')}
          </span>
          {dictatedText && !isListening && (
            <span className="text-sm text-zinc-400 px-6 text-center max-w-xs">{dictatedText}</span>
          )}
          {reportSaved && (
            <div className="flex items-center gap-2 text-emerald-400 text-sm font-bold">
              <CheckCircle2 className="w-4 h-4" />
              {t('safeDrivingMode.reportSaved', 'Reporte guardado')}
            </div>
          )}
        </button>

        {/* Dictation persistence error — surfaced (never swallowed) with a
            one-tap retry. The dictated text stays in `dictatedText` above so
            nothing is lost. */}
        {reportError && !isListening && (
          <div
            role="alert"
            className="flex items-center justify-between gap-4 px-6 py-4 rounded-2xl bg-rose-500/10 border-2 border-rose-500/40"
          >
            <div className="flex items-center gap-3 text-rose-300 text-sm font-bold">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <span>{reportError}</span>
            </div>
            <button
              onClick={retrySaveReport}
              disabled={isSaving}
              className="flex items-center gap-2 px-5 py-3 rounded-xl bg-rose-500 hover:bg-rose-600 text-white font-black uppercase tracking-widest text-xs transition-colors disabled:opacity-50 shrink-0"
            >
              <RotateCcw className={`w-4 h-4 ${isSaving ? 'animate-spin' : ''}`} />
              {t('safeDrivingMode.reportRetry', 'Reintentar')}
            </button>
          </div>
        )}

        {/* Two large action buttons */}
        <div className="flex gap-6 h-64">
          <button
            onClick={() => navigate('/evacuation')}
            className="flex-1 bg-zinc-900 hover:bg-zinc-800 rounded-[3rem] border-4 border-zinc-800 flex flex-col items-center justify-center gap-4 transition-all active:scale-95"
          >
            <MapPin className="w-12 h-12 text-blue-500" />
            <span className="text-xl font-black text-white uppercase tracking-widest">{t('safeDrivingMode.route', 'Ruta')}</span>
          </button>
          {selectedProject?.phone ? (
            <a
              href={`tel:${selectedProject.phone}`}
              className="flex-1 bg-zinc-900 hover:bg-zinc-800 rounded-[3rem] border-4 border-zinc-800 flex flex-col items-center justify-center gap-4 transition-all active:scale-95"
            >
              <Phone className="w-12 h-12 text-emerald-500" />
              <span className="text-xl font-black text-white uppercase tracking-widest">Base</span>
            </a>
          ) : (
            <div
              title="Configure el número de base en los ajustes del proyecto"
              className="flex-1 bg-zinc-900 rounded-[3rem] border-4 border-zinc-800 flex flex-col items-center justify-center gap-4 opacity-40 cursor-not-allowed"
            >
              <Phone className="w-12 h-12 text-zinc-600" />
              <span className="text-xl font-black text-zinc-600 uppercase tracking-widest">Base</span>
            </div>
          )}
        </div>

        {/* Legal commute (trayecto) start/stop — Ley 16.744 art.5. Tagging a
            fall during the commute as tipo:'trayecto' for SUSESO needs an active
            session, which this toggle sets (audited server route + in-memory hint). */}
        <button
          onClick={() => void handleToggleCommute()}
          disabled={commuteBusy || !selectedProject}
          aria-pressed={!!commuteSessionId}
          aria-label={commuteSessionId ? 'Terminar trayecto' : 'Iniciar trayecto'}
          className={`rounded-[3rem] border-4 flex items-center justify-center gap-4 py-6 transition-all active:scale-95 disabled:opacity-40 ${
            commuteSessionId ? 'bg-amber-600 border-amber-500' : 'bg-zinc-900 hover:bg-zinc-800 border-zinc-800'
          }`}
        >
          <Route className={`w-10 h-10 ${commuteSessionId ? 'text-white' : 'text-amber-500'}`} aria-hidden="true" />
          <span className={`text-xl font-black uppercase tracking-widest ${commuteSessionId ? 'text-white' : 'text-amber-400'}`}>
            {commuteBusy
              ? t('safeDrivingMode.commuteBusy', 'Procesando…')
              : commuteSessionId
                ? t('safeDrivingMode.commuteEnd', 'Terminar Trayecto')
                : t('safeDrivingMode.commuteStart', 'Iniciar Trayecto')}
          </span>
        </button>
        {commuteError && (
          <p role="alert" className="text-amber-400 text-sm text-center font-bold -mt-2">{commuteError}</p>
        )}

        {/* Emergency Button (Massive) */}
        <button
          onClick={handleEmergency}
          role="button"
          aria-pressed={isEmergency}
          aria-label={isEmergency ? 'Emergencia activa — S.O.S. enviado' : 'Activar emergencia S.O.S.'}
          aria-live="polite"
          className={`h-48 rounded-[3rem] border-4 flex flex-col items-center justify-center gap-4 transition-all active:scale-95 ${
            isEmergency
              ? 'bg-rose-600 border-rose-500 animate-pulse'
              : 'bg-rose-500/10 border-rose-500/30 hover:bg-rose-500/20'
          }`}
        >
          <ShieldAlert className={`w-16 h-16 ${isEmergency ? 'text-white' : 'text-rose-500'}`} aria-hidden="true" />
          <span className={`text-3xl font-black uppercase tracking-widest ${isEmergency ? 'text-white' : 'text-rose-500'}`}>
            {isEmergency ? (sosConfirmedAt ? `S.O.S. ${sosConfirmedAt}` : t('safeDrivingMode.sending', 'Enviando...')) : t('safeDrivingMode.emergency', 'Emergencia')}
          </span>
        </button>
      </div>
    </div>
  );
}
