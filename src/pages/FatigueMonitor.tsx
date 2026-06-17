// Praeventio Guard — Sprint K vidas críticas: Wire UI FatigueMonitor.
//
// 2026-05-21: cierra el gap detectado en TODO §2.27 audit Tier 1 —
// `FatigueAssessmentCard.tsx` existía como componente pero NO estaba
// wireado a ninguna página/route. Esta page lo expone como `/fatigue`
// para que workers/supervisores puedan ver evaluación de fatiga real.
//
// UX intent usuario 2026-05-21 (Instagram-style):
//   - Anonymous puede navegar, registrar turnos (idb-keyval local).
//   - Login es opcional — al loggearse, los turnos persisten al user
//     namespaced en idb-keyval (no se pierden al limpiar cookies).
//   - Banner discreto invita a crear cuenta para sincronizar entre
//     dispositivos. Sin pressure, conversión orgánica al SAVE moment.
//
// Tracking client-only por design (privacy + offline-first):
//   - DS 594 art. 102 (jornada continua máx 12h/24h)
//   - Código del Trabajo art. 38 (mín 11h descanso entre turnos)
//   - MINSAL protocolo turnos nocturnos (máx 5/semana)
//
// Banking-grade: NO se envía data sensible al servidor para esta page.
// Solo cuando el supervisor invita al worker a un proyecto (futuro
// Sprint), los turnos pueden subir a Firestore con scope project.members.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Moon, Sun, Trash2, AlertTriangle } from 'lucide-react';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import { Link } from 'react-router-dom';

import { useFirebase } from '../contexts/FirebaseContext';
import { FatigueAssessmentCard } from '../components/fatigue/FatigueAssessmentCard';
import { AlertnessGuard } from '../components/circadian/AlertnessGuard';
import {
  countTrailingConsecutiveNightShifts,
  type WorkSession,
} from '../services/fatigue/fatigueMonitor';

const STORAGE_KEY = (uid: string) => `praeventio:fatigue:sessions:${uid}`;
const ANONYMOUS_OWNER = 'anonymous';

interface ShiftButtonConfig {
  hours: number;
  isNight: boolean;
  labelKey: string;
  fallback: string;
  toneClasses: string;
  icon: typeof Sun;
}

const SHIFT_PRESETS: ShiftButtonConfig[] = [
  {
    hours: 8,
    isNight: false,
    labelKey: 'fatigue.shift.diurno_8h',
    fallback: 'Diurno 8h',
    toneClasses: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-300',
    icon: Sun,
  },
  {
    hours: 10,
    isNight: false,
    labelKey: 'fatigue.shift.diurno_10h',
    fallback: 'Diurno 10h',
    toneClasses: 'bg-amber-500/10 border-amber-500/20 text-amber-700 dark:text-amber-300',
    icon: Sun,
  },
  {
    hours: 12,
    isNight: false,
    labelKey: 'fatigue.shift.diurno_12h',
    fallback: 'Diurno 12h',
    toneClasses: 'bg-orange-500/10 border-orange-500/20 text-orange-700 dark:text-orange-300',
    icon: Sun,
  },
  {
    hours: 8,
    isNight: true,
    labelKey: 'fatigue.shift.nocturno_8h',
    fallback: 'Nocturno 8h',
    toneClasses: 'bg-violet-500/10 border-violet-500/20 text-violet-700 dark:text-violet-300',
    icon: Moon,
  },
];

export function FatigueMonitor() {
  const { t } = useTranslation();
  const { user } = useFirebase();
  const ownerUid = user?.uid ?? ANONYMOUS_OWNER;
  const [sessions, setSessions] = useState<WorkSession[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Circadian alertness inputs. Sleep is NOT derivable from shift logs (a
  // rest-gap ≠ sleep), so it is worker-supplied — never fabricated. Defaults
  // are neutral (7 h / no mental-load penalty per the NIOSH model).
  const [sleepHours, setSleepHours] = useState(7);
  const [mentalLoad, setMentalLoad] = useState<number | undefined>(undefined);

  // Real circadian input: local clock + worker-supplied sleep + the worker's
  // trailing consecutive night shifts derived from their actual session logs.
  const circadianInput = useMemo(
    () => ({
      localHour: new Date().getHours(),
      sleepHoursLast24h: sleepHours,
      consecutiveNightShifts: countTrailingConsecutiveNightShifts(sessions, ownerUid),
      mentalLoadRating: mentalLoad,
    }),
    [sleepHours, mentalLoad, sessions, ownerUid],
  );

  // Load sessions from idb-keyval (namespaced by uid or 'anonymous').
  // Migración soft: si el user se loguea y ya había sessions anónimas,
  // las copiamos a su namespace. (Solo en la primera carga post-login).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const stored = await idbGet(STORAGE_KEY(ownerUid));
        if (cancelled) return;
        if (Array.isArray(stored)) {
          setSessions(stored as WorkSession[]);
        } else if (ownerUid !== ANONYMOUS_OWNER) {
          // Soft migration: si no hay data en el namespace del user pero
          // sí hay del anonymous, las traemos.
          const anonStored = await idbGet(STORAGE_KEY(ANONYMOUS_OWNER));
          if (cancelled) return;
          if (Array.isArray(anonStored) && anonStored.length > 0) {
            const migrated = (anonStored as WorkSession[]).map((s) => ({
              ...s,
              workerUid: ownerUid,
            }));
            setSessions(migrated);
            await idbSet(STORAGE_KEY(ownerUid), migrated);
            await idbSet(STORAGE_KEY(ANONYMOUS_OWNER), []);
          }
        }
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ownerUid]);

  const addShift = useCallback(
    async (hours: number, isNight: boolean) => {
      const now = new Date();
      const endedAt = now.toISOString();
      const startedAt = new Date(now.getTime() - hours * 3_600_000).toISOString();
      const newSession: WorkSession = {
        workerUid: ownerUid,
        startedAt,
        endedAt,
        isNight,
        hadCriticalTasks: false,
      };
      const updated = [...sessions, newSession];
      setSessions(updated);
      await idbSet(STORAGE_KEY(ownerUid), updated);
    },
    [ownerUid, sessions],
  );

  const clearShifts = useCallback(async () => {
    if (sessions.length === 0) return;
    if (typeof window !== 'undefined') {
      // Confirmación leve — los datos son del propio user, no destructivo
      // hacia otros, pero queremos evitar clicks accidentales.
      const ok = window.confirm(
        t(
          'fatigue.clear_confirm',
          '¿Borrar todos los turnos registrados? Esta acción no se puede deshacer.',
        ) as string,
      );
      if (!ok) return;
    }
    setSessions([]);
    await idbSet(STORAGE_KEY(ownerUid), []);
  }, [ownerUid, sessions.length, t]);

  return (
    <main
      className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6"
      aria-labelledby="fatigue-heading"
    >
      <header className="space-y-2">
        <h1
          id="fatigue-heading"
          className="text-2xl sm:text-3xl font-black tracking-tighter"
        >
          {t('fatigue.heading', 'Monitor de Fatiga Laboral')}
        </h1>
        <p className="text-sm text-muted-token">
          {t(
            'fatigue.subheading',
            'Evaluación según DS 594 art. 102 (jornada máx 12h/24h), Código del Trabajo art. 38 (descanso mín 11h entre turnos) y MINSAL (protocolo turnos nocturnos).',
          )}
        </p>
        {!user && (
          <div
            className="mt-4 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-sm flex gap-3 items-start"
            role="note"
          >
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
            <p>
              {t(
                'fatigue.guest_banner',
                'Estás navegando como invitado — tus turnos se guardan localmente en este dispositivo. ',
              )}
              <Link
                to="/login"
                className="font-bold underline hover:text-amber-600 transition-colors"
              >
                {t('fatigue.guest_cta', 'Crea una cuenta gratis')}
              </Link>
              {t('fatigue.guest_sync', ' para sincronizar entre dispositivos.')}
            </p>
          </div>
        )}
      </header>

      {/* Assessment card — siempre visible, se actualiza con sessions */}
      <FatigueAssessmentCard workerUid={ownerUid} sessions={sessions} />

      {/* Circadian alertness — NIOSH-based, orientative. Recommendation-only:
          never blocks machinery (blockingCriticalOperation omitted; ADR 0012/0021). */}
      <section
        className="rounded-2xl border border-default-token p-4 sm:p-6 space-y-4 bg-elevated"
        aria-labelledby="circadian-heading"
      >
        <h2 id="circadian-heading" className="text-lg font-bold">
          {t('circadian.heading', 'Estado de alerta circadiana')}
        </h2>
        <p className="text-xs text-muted-token">
          {t(
            'circadian.help',
            'Estimación orientativa basada en NIOSH (hora local, sueño y turnos de noche consecutivos). Es una recomendación — nunca bloquea la operación de equipos.',
          )}
        </p>
        <label className="block text-sm space-y-1">
          <span className="font-medium">
            {t('circadian.sleep_label', 'Horas dormidas (últimas 24 h)')}: {sleepHours} h
          </span>
          <input
            type="range"
            min={0}
            max={12}
            step={0.5}
            value={sleepHours}
            onChange={(e) => setSleepHours(Number(e.target.value))}
            className="w-full"
            aria-label={t('circadian.sleep_label', 'Horas dormidas (últimas 24 h)')}
          />
        </label>
        <label className="block text-sm space-y-1">
          <span className="font-medium">
            {t('circadian.mentalload_label', 'Carga mental (1-10, opcional)')}: {mentalLoad ?? '—'}
          </span>
          <input
            type="range"
            min={1}
            max={10}
            step={1}
            value={mentalLoad ?? 1}
            onChange={(e) => setMentalLoad(Number(e.target.value))}
            className="w-full"
            aria-label={t('circadian.mentalload_label', 'Carga mental (1-10, opcional)')}
          />
        </label>
        <AlertnessGuard input={circadianInput} />
      </section>

      {/* Shift logging */}
      <section
        className="rounded-2xl border border-default-token p-4 sm:p-6 space-y-4 bg-elevated"
        aria-labelledby="fatigue-log-heading"
      >
        <h2 id="fatigue-log-heading" className="text-lg font-bold">
          {t('fatigue.log_heading', 'Registrar turno terminado')}
        </h2>
        <p className="text-xs text-muted-token">
          {t(
            'fatigue.log_help',
            'Usamos la hora actual como fin del turno. El inicio se calcula restando las horas seleccionadas.',
          )}
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {SHIFT_PRESETS.map((preset) => {
            const Icon = preset.icon;
            return (
              <button
                key={`${preset.hours}-${preset.isNight}`}
                type="button"
                onClick={() => void addShift(preset.hours, preset.isNight)}
                className={`flex items-center justify-center gap-2 px-3 py-3 rounded-xl border text-sm font-bold transition-all hover:scale-[1.02] active:scale-95 ${preset.toneClasses}`}
              >
                <Icon className="w-4 h-4" aria-hidden="true" />
                {t(preset.labelKey, preset.fallback)}
              </button>
            );
          })}
        </div>
        {loaded && sessions.length > 0 && (
          <div className="flex items-center justify-between pt-2 border-t border-default-token">
            <span className="text-xs text-muted-token">
              {t('fatigue.count', '{{count}} turnos registrados', { count: sessions.length })}
            </span>
            <button
              type="button"
              onClick={() => void clearShifts()}
              className="inline-flex items-center gap-1.5 text-xs text-muted-token hover:text-rose-500 transition-colors"
              aria-label={t('fatigue.clear_aria', 'Borrar todos los turnos') as string}
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              {t('fatigue.clear', 'Borrar historial')}
            </button>
          </div>
        )}
      </section>

      {/* Help / context */}
      <section
        className="rounded-2xl border border-default-token p-4 sm:p-6 text-xs text-muted-token space-y-2"
        aria-labelledby="fatigue-context-heading"
      >
        <h2 id="fatigue-context-heading" className="text-sm font-bold text-primary-token">
          {t('fatigue.context_heading', 'Marco normativo')}
        </h2>
        <ul className="space-y-1 list-disc list-inside">
          <li>
            <strong>DS 594/1999</strong> art. 102 — jornada continua máxima de 12 horas.
          </li>
          <li>
            <strong>Código del Trabajo</strong> art. 38 — descanso mínimo de 11 horas entre turnos.
          </li>
          <li>
            <strong>MINSAL Protocolo Turnos Nocturnos</strong> — máximo 5 turnos nocturnos/semana.
          </li>
        </ul>
        <p className="pt-2">
          {t(
            'fatigue.context_disclaimer',
            'Esta herramienta es orientativa: el supervisor debe siempre validar con criterio profesional. NO bloquea operación — solo recomienda.',
          )}
        </p>
      </section>
    </main>
  );
}

export default FatigueMonitor;
