// Praeventio Guard — Fase 5 B8: LOTO Digital page.
//
// Page `/loto`. The engine (lotoDigitalLight), the Firestore adapter, the
// write endpoints (loto.ts) and the `<LotoStatusPanel/>` all existed — the
// panel was orphaned (no page mounted it) and the write endpoints had no
// client. This wires them: list active LOTO applications, create one, apply
// lock points, verify zero-energy, and release — each backed by the audited
// server endpoints. The app RECORDS the human LOTO procedure; it never blocks
// machinery (founder directive).

import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock, Plus, Loader2, AlertTriangle, ShieldCheck } from 'lucide-react';

import { useFirebase } from '../contexts/FirebaseContext';
import { useProject } from '../contexts/ProjectContext';
import { LotoStatusPanel } from '../components/loto/LotoStatusPanel';
import {
  useLoto,
  createLotoApplication,
  applyLotoLock,
  verifyLotoZeroEnergy,
  releaseLoto,
} from '../hooks/useLoto';
import type { EnergyType } from '../services/criticalControls/controlRobustness';
import { logger } from '../utils/logger';

const ENERGY_LABELS: Record<EnergyType, string> = {
  gravity: 'Gravedad',
  electric: 'Eléctrica',
  mechanical: 'Mecánica',
  chemical: 'Química',
  thermal: 'Térmica',
  pressure: 'Presión',
  radiation: 'Radiación',
  biological: 'Biológica',
};
const ENERGY_TYPES = Object.keys(ENERGY_LABELS) as EnergyType[];

export function Loto() {
  const { t } = useTranslation();
  const { user } = useFirebase();
  const { selectedProject } = useProject();
  const projectId = selectedProject?.id ?? null;

  const { data, loading, refetch } = useLoto(projectId);
  const applications = useMemo(() => data?.applications ?? [], [data]);

  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Create-application form.
  const [equipmentId, setEquipmentId] = useState('');
  const [workDescription, setWorkDescription] = useState('');
  const [energies, setEnergies] = useState<Set<EnergyType>>(new Set());

  // Inline apply-lock form (open for a single application at a time).
  const [applyForAppId, setApplyForAppId] = useState<string | null>(null);
  const [lockPointId, setLockPointId] = useState('');
  const [lockDescription, setLockDescription] = useState('');
  const [lockEnergy, setLockEnergy] = useState<EnergyType>('electric');
  const [lockTagId, setLockTagId] = useState('');

  const toggleEnergy = useCallback((e: EnergyType) => {
    setEnergies((prev) => {
      const next = new Set(prev);
      if (next.has(e)) next.delete(e);
      else next.add(e);
      return next;
    });
  }, []);

  const handleCreate = useCallback(async () => {
    if (!projectId) return;
    if (equipmentId.trim().length === 0 || workDescription.trim().length < 3 || energies.size === 0) {
      setFeedback(t('loto.feedback.create_invalid', 'Indica equipo, descripción (≥3) y al menos una energía.'));
      return;
    }
    setBusy(true);
    try {
      await createLotoApplication(projectId, {
        equipmentId: equipmentId.trim(),
        workDescription: workDescription.trim(),
        energiesIdentified: [...energies],
      });
      setEquipmentId('');
      setWorkDescription('');
      setEnergies(new Set());
      setFeedback(t('loto.feedback.created', 'Aplicación LOTO creada.'));
      refetch();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('loto_create_failed', { err: msg });
      setFeedback(msg);
    } finally {
      setBusy(false);
    }
  }, [projectId, equipmentId, workDescription, energies, refetch, t]);

  const handleApplyLock = useCallback(async () => {
    if (!projectId || !applyForAppId) return;
    if (
      lockPointId.trim().length === 0 ||
      lockDescription.trim().length === 0 ||
      lockTagId.trim().length === 0
    ) {
      setFeedback(t('loto.feedback.lock_invalid', 'Completa punto, descripción y tag del candado.'));
      return;
    }
    setBusy(true);
    try {
      await applyLotoLock(projectId, applyForAppId, {
        pointId: lockPointId.trim(),
        description: lockDescription.trim(),
        energyType: lockEnergy,
        tagId: lockTagId.trim(),
      });
      setApplyForAppId(null);
      setLockPointId('');
      setLockDescription('');
      setLockTagId('');
      setFeedback(t('loto.feedback.lock_applied', 'Candado registrado.'));
      refetch();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn('loto_apply_lock_failed', { err: msg });
      setFeedback(msg);
    } finally {
      setBusy(false);
    }
  }, [projectId, applyForAppId, lockPointId, lockDescription, lockEnergy, lockTagId, refetch, t]);

  const handleVerify = useCallback(
    async (appId: string, pointId: string) => {
      if (!projectId) return;
      setBusy(true);
      try {
        await verifyLotoZeroEnergy(projectId, appId, pointId);
        setFeedback(t('loto.feedback.verified', 'Cero energía verificado.'));
        refetch();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn('loto_verify_failed', { err: msg });
        setFeedback(msg);
      } finally {
        setBusy(false);
      }
    },
    [projectId, refetch, t],
  );

  const handleRelease = useCallback(
    async (appId: string) => {
      if (!projectId) return;
      setBusy(true);
      try {
        await releaseLoto(projectId, appId);
        setFeedback(t('loto.feedback.released', 'LOTO liberado.'));
        refetch();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn('loto_release_failed', { err: msg });
        setFeedback(msg);
      } finally {
        setBusy(false);
      }
    },
    [projectId, refetch, t],
  );

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <header>
          <h1 className="text-2xl font-black text-zinc-900 dark:text-white tracking-tight flex items-center gap-2">
            <Lock className="w-6 h-6 text-rose-500" /> {t('loto.title', 'LOTO Digital')}
          </h1>
          <p className="text-xs text-zinc-500 mt-1 max-w-2xl">
            {t(
              'loto.subtitle',
              'Registro digital del bloqueo y etiquetado (Lock-Out / Tag-Out): energías aisladas, candados aplicados, verificación de cero energía y liberación. Complementa el procedimiento físico con trazabilidad legal — no sustituye al candado real.',
            )}
          </p>
        </header>

        {!projectId ? (
          <div className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900/60 p-6 text-center text-sm text-zinc-500">
            {t('loto.empty.select_project', 'Selecciona un proyecto para gestionar LOTO.')}
          </div>
        ) : (
          <>
            {feedback && (
              <div
                data-testid="loto-feedback"
                className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-3 text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2"
              >
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{feedback}</span>
              </div>
            )}

            {/* Create form. */}
            <section className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900/60 p-4 space-y-3">
              <h2 className="text-sm font-black text-zinc-700 dark:text-zinc-300 uppercase tracking-widest">
                {t('loto.create.heading', 'Nueva aplicación LOTO')}
              </h2>
              <div className="grid sm:grid-cols-2 gap-2">
                <input
                  type="text"
                  value={equipmentId}
                  onChange={(e) => setEquipmentId(e.target.value)}
                  placeholder={t('loto.create.equipment', 'ID del equipo (ej. CAEX-08)')}
                  data-testid="loto-create-equipment"
                  className="rounded-lg border border-zinc-300 dark:border-white/10 bg-white dark:bg-zinc-900 px-2 py-1.5 text-xs text-zinc-900 dark:text-white"
                />
                <input
                  type="text"
                  value={workDescription}
                  onChange={(e) => setWorkDescription(e.target.value)}
                  placeholder={t('loto.create.work', 'Descripción del trabajo')}
                  data-testid="loto-create-work"
                  className="rounded-lg border border-zinc-300 dark:border-white/10 bg-white dark:bg-zinc-900 px-2 py-1.5 text-xs text-zinc-900 dark:text-white"
                />
              </div>
              <div>
                <p className="text-[10px] uppercase opacity-70 mb-1">{t('loto.create.energies', 'Energías a aislar')}</p>
                <div className="flex flex-wrap gap-1.5">
                  {ENERGY_TYPES.map((e) => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => toggleEnergy(e)}
                      data-testid={`loto-energy-${e}`}
                      className={`px-2 py-1 rounded-md text-[11px] font-bold ${
                        energies.has(e)
                          ? 'bg-rose-600 text-white'
                          : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                      }`}
                    >
                      {ENERGY_LABELS[e]}
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={handleCreate}
                disabled={busy || !user}
                data-testid="loto-create-submit"
                className="rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white px-3 py-2 text-xs font-black uppercase tracking-widest flex items-center gap-2"
              >
                <Plus className="w-4 h-4" /> {t('loto.create.submit', 'Crear LOTO')}
              </button>
            </section>

            {/* Active applications. */}
            {loading ? (
              <div className="flex items-center justify-center py-16 text-zinc-500">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            ) : applications.length === 0 ? (
              <div className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900/60 p-6 text-center text-sm text-zinc-500 flex flex-col items-center gap-2">
                <ShieldCheck className="w-6 h-6 text-emerald-500" />
                {t('loto.empty.none_active', 'No hay aplicaciones LOTO activas.')}
              </div>
            ) : (
              <div className="space-y-4">
                {applications.map((app) => (
                  <div key={app.id} className="space-y-2">
                    <LotoStatusPanel
                      application={app}
                      onApplyLockPoint={() => {
                        setApplyForAppId((cur) => (cur === app.id ? null : app.id));
                      }}
                      onVerifyZeroEnergy={(pointId) => handleVerify(app.id, pointId)}
                      onRelease={() => handleRelease(app.id)}
                    />

                    {applyForAppId === app.id && (
                      <div
                        data-testid={`loto-applylock-form-${app.id}`}
                        className="rounded-xl border border-sky-200 dark:border-sky-800 bg-sky-50/50 dark:bg-sky-900/15 p-3 space-y-2"
                      >
                        <p className="text-[10px] uppercase opacity-70">{t('loto.lock.heading', 'Aplicar candado / tarjeta')}</p>
                        <div className="grid sm:grid-cols-2 gap-2">
                          <input
                            type="text"
                            value={lockPointId}
                            onChange={(e) => setLockPointId(e.target.value)}
                            placeholder={t('loto.lock.point', 'ID punto (ej. seccionador-A)')}
                            data-testid="loto-lock-point"
                            className="rounded-lg border border-zinc-300 dark:border-white/10 bg-white dark:bg-zinc-900 px-2 py-1.5 text-xs text-zinc-900 dark:text-white"
                          />
                          <input
                            type="text"
                            value={lockTagId}
                            onChange={(e) => setLockTagId(e.target.value)}
                            placeholder={t('loto.lock.tag', 'Tag del candado (ej. ROJO-12)')}
                            data-testid="loto-lock-tag"
                            className="rounded-lg border border-zinc-300 dark:border-white/10 bg-white dark:bg-zinc-900 px-2 py-1.5 text-xs text-zinc-900 dark:text-white"
                          />
                          <input
                            type="text"
                            value={lockDescription}
                            onChange={(e) => setLockDescription(e.target.value)}
                            placeholder={t('loto.lock.desc', 'Descripción del punto')}
                            data-testid="loto-lock-desc"
                            className="rounded-lg border border-zinc-300 dark:border-white/10 bg-white dark:bg-zinc-900 px-2 py-1.5 text-xs text-zinc-900 dark:text-white"
                          />
                          <select
                            value={lockEnergy}
                            onChange={(e) => setLockEnergy(e.target.value as EnergyType)}
                            data-testid="loto-lock-energy"
                            className="rounded-lg border border-zinc-300 dark:border-white/10 bg-white dark:bg-zinc-900 px-2 py-1.5 text-xs text-zinc-900 dark:text-white"
                          >
                            {ENERGY_TYPES.map((en) => (
                              <option key={en} value={en}>{ENERGY_LABELS[en]}</option>
                            ))}
                          </select>
                        </div>
                        <button
                          type="button"
                          onClick={handleApplyLock}
                          disabled={busy}
                          data-testid="loto-lock-submit"
                          className="px-3 py-1.5 rounded-lg text-xs font-bold bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white"
                        >
                          {t('loto.lock.submit', 'Registrar candado')}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default Loto;
