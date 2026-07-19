import React, { useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { GoogleMap, useJsApiLoader, Marker } from '@react-google-maps/api';
import { getMapLoaderConfig } from '../components/maps/mapConfig';
import { Car, Phone, MapPin, Mic, ShieldAlert, MicOff, CheckCircle2, AlertTriangle, RotateCcw, Route, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useProject } from '../contexts/ProjectContext';
import { useEmergency } from '../contexts/EmergencyContext';
import { apiAuthHeader } from '../lib/apiAuth';
import { randomId } from '../utils/randomId';
import { logger } from '../utils/logger';
import { setActiveCommuteSession } from '../services/driving/commuteSession';
import { WeatherBulletin } from '../components/WeatherBulletin';
import { humanErrorMessage } from '../lib/humanError';


// Mapa vivo del modo conducción hands-free. Mismo patrón de carga que
// SafeDriving.tsx (un solo loader compartido vía getMapLoaderConfig) — el mapa
// es el protagonista de la pantalla; el control de voz pasa a flotante.
const mapContainerStyle = {
  width: '100%',
  height: '100%',
  borderRadius: '1.5rem',
  overflow: 'hidden',
  boxSizing: 'border-box' as const,
};

// Santiago de Chile — fallback cuando el proyecto no trae coordenadas.
const SANTIAGO_CENTER = { lat: -33.4489, lng: -70.6693 };

// Estilo de mapa nocturno/alto contraste (idéntico a SafeDriving.tsx) — pensado
// para visibilidad de un conductor sin tener que enfocar la vista.
const NIGHT_MAP_STYLES = [
  { featureType: "all", elementType: "labels.text.fill", stylers: [{ color: "#ffffff" }] },
  { featureType: "all", elementType: "labels.text.stroke", stylers: [{ color: "#000000" }, { lightness: 13 }] },
  { featureType: "administrative", elementType: "geometry.fill", stylers: [{ color: "#000000" }] },
  { featureType: "administrative", elementType: "geometry.stroke", stylers: [{ color: "#144b53" }, { lightness: 14 }, { weight: 1.4 }] },
  { featureType: "landscape", elementType: "all", stylers: [{ color: "#08304b" }] },
  { featureType: "poi", elementType: "geometry", stylers: [{ color: "#0c4152" }, { lightness: 5 }] },
  { featureType: "road.highway", elementType: "geometry.fill", stylers: [{ color: "#000000" }] },
  { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#0b434f" }, { lightness: 25 }] },
  { featureType: "road.arterial", elementType: "geometry.fill", stylers: [{ color: "#000000" }] },
  { featureType: "road.arterial", elementType: "geometry.stroke", stylers: [{ color: "#0b3d51" }, { lightness: 16 }] },
  { featureType: "road.local", elementType: "geometry", stylers: [{ color: "#000000" }] },
  { featureType: "transit", elementType: "all", stylers: [{ color: "#146474" }] },
  { featureType: "water", elementType: "all", stylers: [{ color: "#021019" }] },
];

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

  // Live map — shared loader config (one Maps JS load for the whole bundle).
  // If VITE_GOOGLE_MAPS_API_KEY is absent the key resolves to '' and `isLoaded`
  // never flips → we render an elegant fallback instead of breaking the screen.
  const { isLoaded: isMapLoaded } = useJsApiLoader(getMapLoaderConfig());
  const [map, setMap] = useState<google.maps.Map | null>(null);
  // Centrar en las coordenadas del proyecto (faena) si existen; si no, Santiago.
  const mapCenter = selectedProject?.coordinates ?? SANTIAGO_CENTER;
  const onMapLoad = useCallback((m: google.maps.Map) => { setMap(m); }, []);
  const onMapUnmount = useCallback(() => { setMap(null); }, []);
  // `map` se referencia para evitar el unused-var del setter de onLoad.
  void map;

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
        {/* Live map — PROTAGONISTA de la pantalla. El conductor ve su trayecto
            faena-a-faena / casa-trabajo en vivo. El control de voz pasó de un
            botón gigante (w-32 h-32) a un control flotante (w-20 h-20) sobre el
            mapa: sigue siendo táctil sin mirar (hands-free) pero NO tapa el mapa. */}
        <div className="relative flex-1 min-h-0 w-full rounded-[1.5rem] overflow-hidden border-4 border-zinc-800 bg-[#08304b]">
          {isMapLoaded ? (
            <GoogleMap
              mapContainerStyle={mapContainerStyle}
              center={mapCenter}
              zoom={13}
              onLoad={onMapLoad}
              onUnmount={onMapUnmount}
              options={{
                disableDefaultUI: false,
                zoomControl: true,
                mapTypeControl: false,
                streetViewControl: false,
                fullscreenControl: false,
                gestureHandling: 'greedy',
                styles: NIGHT_MAP_STYLES,
              }}
            >
              <Marker
                position={mapCenter}
                icon={{ url: 'https://maps.google.com/mapfiles/ms/icons/truck.png' }}
              />
            </GoogleMap>
          ) : (
            // Fallback elegante: sin VITE_GOOGLE_MAPS_API_KEY el mapa no carga,
            // pero la pantalla NO se rompe — el modo conducción sigue operativo.
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-zinc-400">
              {import.meta.env.VITE_GOOGLE_MAPS_API_KEY ? (
                <>
                  <Loader2 className="w-10 h-10 animate-spin text-indigo-400" />
                  <span className="text-xs font-black uppercase tracking-widest">
                    {'Cargando Mapa...'}
                  </span>
                </>
              ) : (
                <>
                  <MapPin className="w-12 h-12 text-indigo-500" />
                  <span className="text-sm font-black uppercase tracking-widest text-white">
                    {'Mapa No Disponible'}
                  </span>
                  <span className="text-xs text-zinc-500 px-8 text-center max-w-xs">
                    {'El modo conducción sigue activo. Voz, emergencia y trayecto operan con normalidad.'}
                  </span>
                </>
              )}
            </div>
          )}

          {/* Floating voice control — hands-free, gran target táctil pero ya no
              domina la pantalla. Conserva el estado listening/Mic/MicOff y toda
              la lógica de dictado (SpeechRecognition → saveReport). */}
          <button
            onClick={handleDictate}
            aria-pressed={isListening}
            aria-label={isListening ? 'Detener dictado' : 'Dictar reporte por voz'}
            className={`absolute bottom-4 right-4 z-10 w-20 h-20 rounded-full border-4 flex items-center justify-center shadow-2xl transition-all active:scale-95 ${
              isListening
                ? 'bg-indigo-600 border-indigo-300 animate-pulse'
                : 'bg-zinc-900/90 hover:bg-zinc-800 border-indigo-500/60'
            }`}
          >
            {isListening ? (
              <MicOff className="w-9 h-9 text-indigo-100" aria-hidden="true" />
            ) : (
              <Mic className="w-9 h-9 text-indigo-400" aria-hidden="true" />
            )}
          </button>

          {/* Estado del dictado (texto + confirmación) — flota abajo-izquierda,
              alto contraste, sin tapar el mapa. */}
          {((dictatedText && !isListening) || isListening || reportSaved) && (
            <div className="absolute bottom-4 left-4 right-28 z-10 flex flex-col gap-2 pointer-events-none">
              {isListening && (
                <span className="self-start px-3 py-1.5 rounded-xl bg-indigo-900/90 text-indigo-100 text-xs font-black uppercase tracking-widest">
                  {'Escuchando…'}
                </span>
              )}
              {dictatedText && !isListening && (
                <span className="px-3 py-2 rounded-xl bg-zinc-900/90 text-zinc-200 text-sm max-w-full truncate">
                  {dictatedText}
                </span>
              )}
              {reportSaved && (
                <span className="self-start flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-900/90 text-emerald-300 text-xs font-bold">
                  <CheckCircle2 className="w-4 h-4" />
                  {t('safeDrivingMode.reportSaved', 'Reporte guardado')}
                </span>
              )}
            </div>
          )}
        </div>

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
              <span>{humanErrorMessage(reportError)}</span>
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
          <p role="alert" className="text-amber-400 text-sm text-center font-bold -mt-2">{humanErrorMessage(commuteError)}</p>
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
