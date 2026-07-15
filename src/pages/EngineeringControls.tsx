// Praeventio Guard — §42-44 page wrapper.
//
// Inventario de Controles de Ingeniería + Jerarquía ISO 31000 / 45001.
//
// La página deja navegable el servicio determinístico
// `engineeringControlsInventory` (intacto) sumándole un layer de
// persistencia + verificación periódica:
//
//   - Lista controles del proyecto, agrupados por nivel de la jerarquía:
//     elimination > substitution > engineering > administrative > epp.
//   - Filtra por nivel y por categoría de riesgo.
//   - Visualiza el diagrama de la jerarquía (5 niveles apilados, color
//     verde→rojo de mejor a peor según ISO 31000 / 45001 §8.1.2).
//   - Cada control muestra estado de verificación derivado del
//     `lastVerifiedAt + verificationFrequencyDays`:
//       verde  → vigente (próxima vence > 25% del intervalo)
//       ámbar  → próximo a vencer (≤ 25% del intervalo)
//       rojo   → vencido o nunca verificado
//   - "Nuevo control" abre un form inline con selector de nivel +
//     explicador de la jerarquía para que el usuario entienda por qué
//     un control de eliminación es preferible a EPP.
//   - La fila de verificación expone los tres resultados que acepta
//     el endpoint — pass (OK), observation, fail — más un panel inline
//     de evidencia opcional (≤4000 chars). El verifierUid lo deriva el
//     servidor del caller autenticado, así que la UI nunca lo manda.

import { randomId } from '../utils/randomId';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Layers, WifiOff, Plus, X, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { auth } from '../services/firebase';
import {
  useEngineeringControls,
  createEngineeringControl,
  verifyControl,
  type EngineeringControlAPI,
  type EngineeringControlLevelAPI,
} from '../hooks/useEngineeringControls';
import { logger } from '../utils/logger';
import { EngineeringInventoryCard } from '../components/engineeringControls/EngineeringInventoryCard';
import type { EngineeringControl } from '../services/engineeringControls/engineeringControlsInventory';

// ────────────────────────────────────────────────────────────────────────
// Hierarchy metadata (ISO 31000 / 45001 §8.1.2)
// ────────────────────────────────────────────────────────────────────────
//
// `colorClasses` is intentionally semantic — green at the top (most
// effective control = eliminate the hazard at the source) and red at
// the bottom (EPP = last line of defense). The user-facing diagram and
// the per-control badge both read from this map so labels and colors
// never drift apart.
interface HierarchyMeta {
  level: EngineeringControlLevelAPI;
  labelKey: string;
  labelFallback: string;
  hintKey: string;
  hintFallback: string;
  badgeClass: string;
  bandClass: string;
}

const HIERARCHY: ReadonlyArray<HierarchyMeta> = [
  {
    level: 'elimination',
    labelKey: 'engCtrl.level.elimination',
    labelFallback: 'Eliminación',
    hintKey: 'engCtrl.hint.elimination',
    hintFallback: 'Quitar el peligro de raíz (rediseño, cambio de proceso).',
    badgeClass: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
    bandClass: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/40',
  },
  {
    level: 'substitution',
    labelKey: 'engCtrl.level.substitution',
    labelFallback: 'Sustitución',
    hintKey: 'engCtrl.hint.substitution',
    hintFallback: 'Reemplazar por un material/proceso menos peligroso.',
    badgeClass: 'bg-teal-500/15 text-teal-700 dark:text-teal-400 border-teal-500/30',
    bandClass: 'bg-teal-500/20 text-teal-700 dark:text-teal-300 border-teal-500/40',
  },
  {
    level: 'engineering',
    labelKey: 'engCtrl.level.engineering',
    labelFallback: 'Ingeniería',
    hintKey: 'engCtrl.hint.engineering',
    hintFallback: 'Barreras físicas, ventilación, interlocks, sensores.',
    badgeClass: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-400 border-cyan-500/30',
    bandClass: 'bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border-cyan-500/40',
  },
  {
    level: 'administrative',
    labelKey: 'engCtrl.level.administrative',
    labelFallback: 'Administrativo',
    hintKey: 'engCtrl.hint.administrative',
    hintFallback: 'Procedimientos, capacitación, rotación, señalética.',
    badgeClass: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30',
    bandClass: 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/40',
  },
  {
    level: 'epp',
    labelKey: 'engCtrl.level.epp',
    labelFallback: 'EPP',
    hintKey: 'engCtrl.hint.epp',
    hintFallback: 'Última línea de defensa. Recurrir SOLO si lo anterior no aplica.',
    badgeClass: 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30',
    bandClass: 'bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-500/40',
  },
];

function metaFor(level: EngineeringControlLevelAPI): HierarchyMeta {
  return HIERARCHY.find((h) => h.level === level) ?? HIERARCHY[2];
}

// ────────────────────────────────────────────────────────────────────────
// Verification status (verde / ámbar / rojo)
// ────────────────────────────────────────────────────────────────────────
//
// `lastVerifiedAt + verificationFrequencyDays` → next due date.
// Buckets:
//   - rojo  → vencido o nunca verificado
//   - ámbar → quedan ≤ 25% del intervalo (próximo a vencer)
//   - verde → vigente
type VerificationStatus = 'green' | 'amber' | 'red';

interface VerificationView {
  status: VerificationStatus;
  nextAtIso: string | null;
  daysToNext: number | null;
}

function computeVerificationView(
  control: EngineeringControlAPI,
  now: number = Date.now(),
): VerificationView {
  if (!control.lastVerifiedAt) {
    return { status: 'red', nextAtIso: null, daysToNext: null };
  }
  const lastMs = Date.parse(control.lastVerifiedAt);
  if (!Number.isFinite(lastMs)) {
    return { status: 'red', nextAtIso: null, daysToNext: null };
  }
  const freqMs = control.verificationFrequencyDays * 86_400_000;
  const nextMs = lastMs + freqMs;
  const remainingMs = nextMs - now;
  const daysToNext = Math.round(remainingMs / 86_400_000);
  const nextAtIso = new Date(nextMs).toISOString();
  if (remainingMs <= 0) return { status: 'red', nextAtIso, daysToNext };
  // ≤25% of the interval remaining → ámbar.
  if (remainingMs <= freqMs * 0.25) return { status: 'amber', nextAtIso, daysToNext };
  return { status: 'green', nextAtIso, daysToNext };
}

const STATUS_CLASSES: Record<VerificationStatus, string> = {
  green:
    'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
  amber:
    'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30',
  red: 'bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30',
};

// ────────────────────────────────────────────────────────────────────────
// Page
// ────────────────────────────────────────────────────────────────────────

type LevelFilter = 'all' | 'engineering' | 'admin' | 'epp';

const LEVEL_FILTERS: ReadonlyArray<{
  filter: LevelFilter;
  labelKey: string;
  labelFallback: string;
}> = [
  { filter: 'all', labelKey: 'engCtrl.filter.all', labelFallback: 'Todos' },
  { filter: 'engineering', labelKey: 'engCtrl.filter.engineering', labelFallback: 'Ingeniería' },
  { filter: 'admin', labelKey: 'engCtrl.filter.admin', labelFallback: 'Administrativo' },
  { filter: 'epp', labelKey: 'engCtrl.filter.epp', labelFallback: 'EPP' },
];

export function EngineeringControls() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const isOnline = useOnlineStatus();
  const projectId = selectedProject?.id ?? null;

  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all');
  const [riskFilter, setRiskFilter] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formLevel, setFormLevel] = useState<EngineeringControlLevelAPI>('engineering');
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formRisk, setFormRisk] = useState('');
  const [formResponsible, setFormResponsible] = useState('');
  const [formFreq, setFormFreq] = useState(30);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Codex P2 (PR #319, round 2): per-control verification panel state.
  // `verifyPanelOpen` is the id of the control whose evidence input is
  // expanded; `verifyEvidence` is the in-progress text. We keep these
  // scoped to the page (not per-card) because only one verification
  // panel can be open at a time, which avoids leaking stale evidence
  // text between unrelated controls.
  const [verifyPanelOpen, setVerifyPanelOpen] = useState<string | null>(null);
  const [verifyEvidence, setVerifyEvidence] = useState('');
  const [verifySubmitting, setVerifySubmitting] = useState<string | null>(null);

  const resp = useEngineeringControls(projectId, {
    level: levelFilter,
    riskCategory: riskFilter ?? undefined,
  });

  const loading = resp.loading;
  const error = resp.error;
  const rawControls = useMemo<EngineeringControlAPI[]>(
    () => resp.data?.controls ?? [],
    [resp.data],
  );

  // Codex P2 (PR #319): controls tagged with the `general` risk
  // category are cross-cutting (they mitigate every risk, not a
  // specific one — e.g. site-wide signage, general housekeeping).
  // They must remain visible regardless of the active `riskFilter`,
  // otherwise a user filtering by "altura" would hide a general
  // control that *also* applies to altura. We post-filter client-side:
  // when a specific `riskFilter` is set, keep matching controls *plus*
  // any `general` ones. The server still applies its own filter for
  // bandwidth, but we never hide `general` rows in the rendered list.
  const controls = useMemo<EngineeringControlAPI[]>(() => {
    if (!riskFilter) return rawControls;
    return rawControls.filter(
      (c) => c.riskCategory === riskFilter || c.riskCategory === 'general',
    );
  }, [rawControls, riskFilter]);

  // Codex P2 (PR #319): surface a degraded-data banner when the
  // server's read of the engineering-controls collection threw. The
  // server returns 200 + `warning: 'partial_read_failure'` so the page
  // still renders, but we must tell the user the list may be incomplete.
  const partialReadFailure = resp.data?.warning === 'partial_read_failure';

  const inventoryControls = useMemo<EngineeringControl[]>(
    () =>
      controls.map((c) => ({
        id: c.id,
        kind: 'physical_barrier' as const,
        label: c.name,
        mitigatesRiskCategory: c.riskCategory,
        location: c.description,
        status: (() => {
          if (!c.lastVerifiedAt) return 'fuera_servicio' as const;
          const view = computeVerificationView(c);
          if (view.status === 'red') return 'fuera_servicio' as const;
          if (view.status === 'amber') return 'mantenimiento_pendiente' as const;
          return 'operativo' as const;
        })(),
        lastCheckedAt: c.lastVerifiedAt ?? undefined,
        maintainedByUid: c.responsibleUid,
      })),
    [controls],
  );

  // Risk categories surfaced from the loaded controls. We keep the
  // filter chip-list dynamic so a project doesn't see categories it
  // doesn't actually use. Sorted alphabetically for stability.
  //
  // Codex P2 (PR #319): derive categories from the *raw* (unfiltered)
  // controls — using the post-filter `controls` would shrink the chip
  // list as the user narrows the filter, making it impossible to switch
  // back to other categories without first clearing the filter.
  const riskCategories = useMemo(() => {
    const set = new Set<string>();
    for (const c of rawControls) set.add(c.riskCategory);
    return Array.from(set).sort();
  }, [rawControls]);

  const handleCreate = async () => {
    if (!projectId) return;
    if (formName.trim().length < 3) {
      setFormError(
        t('engCtrl.form.errorName', 'El nombre debe tener al menos 3 caracteres.') as string,
      );
      return;
    }
    if (formDescription.trim().length < 3) {
      setFormError(
        t(
          'engCtrl.form.errorDescription',
          'La descripción debe tener al menos 3 caracteres.',
        ) as string,
      );
      return;
    }
    if (formRisk.trim().length < 1) {
      setFormError(
        t('engCtrl.form.errorRisk', 'Indica la categoría de riesgo que mitiga.') as string,
      );
      return;
    }
    const currentUid = auth.currentUser?.uid ?? null;
    const responsibleUid = formResponsible.trim() || currentUid;
    if (!responsibleUid) {
      setFormError(
        t(
          'engCtrl.form.errorResponsible',
          'Indica un responsable o inicia sesión.',
        ) as string,
      );
      return;
    }
    if (!(formFreq > 0)) {
      setFormError(
        t(
          'engCtrl.form.errorFreq',
          'La frecuencia de verificación debe ser positiva (días).',
        ) as string,
      );
      return;
    }
    setFormSubmitting(true);
    setFormError(null);
    try {
      const id = `engctrl_${Date.now()}_${randomId()}`;
      await createEngineeringControl(projectId, {
        id,
        level: formLevel,
        riskCategory: formRisk.trim(),
        name: formName.trim(),
        description: formDescription.trim(),
        responsibleUid,
        verificationFrequencyDays: Math.round(formFreq),
      });
      logger.info('engineeringControls.created', { id, level: formLevel });
      setShowCreateForm(false);
      setFormName('');
      setFormDescription('');
      setFormRisk('');
      setFormResponsible('');
      setFormFreq(30);
      resp.refetch?.();
    } catch (err) {
      logger.error('engineeringControls.create.failed', err);
      setFormError(
        (err as Error).message ||
          (t('engCtrl.form.errorCreate', 'No se pudo crear el control.') as string),
      );
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleVerify = async (
    control: EngineeringControlAPI,
    result: 'pass' | 'observation' | 'fail' = 'pass',
    evidence?: string,
  ) => {
    if (!projectId) return;
    // Codex P1 (PR #319): the server now derives the verifier identity
    // from `req.user!.uid`, so we no longer pass `verifierUid` from the
    // client. We still guard against an unauthenticated state for the
    // log line and to short-circuit before the network call.
    const currentUid = auth.currentUser?.uid ?? null;
    if (!currentUid) {
      logger.warn('engineeringControls.verify.noUser', { id: control.id });
      return;
    }
    setVerifySubmitting(control.id);
    try {
      // Codex P2 (PR #319, round 2): forward `evidence` so non-OK
      // outcomes (observation/fail) carry the inspector's note. The
      // server schema accepts an optional `evidence` string up to 4000
      // chars; we trim and drop empty strings so we never send `""`.
      const trimmed = evidence?.trim();
      await verifyControl(projectId, control.id, {
        result,
        ...(trimmed ? { evidence: trimmed } : {}),
      });
      logger.info('engineeringControls.verified', {
        id: control.id,
        result,
        hasEvidence: Boolean(trimmed),
      });
      // Close the expanded panel + clear the staging text on success.
      setVerifyPanelOpen(null);
      setVerifyEvidence('');
      resp.refetch?.();
    } catch (err) {
      logger.error('engineeringControls.verify.failed', err);
    } finally {
      setVerifySubmitting(null);
    }
  };

  if (!selectedProject) {
    return (
      <div
        className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto"
        data-testid="engineering-controls-page-empty"
      >
        <div className="rounded-2xl border border-default-token bg-surface p-8 text-center">
          <Layers className="w-12 h-12 mx-auto mb-4 text-secondary-token" aria-hidden="true" />
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('engCtrl.page.title', 'Controles de Ingeniería')}
          </h1>
          <p className="mt-2 text-sm text-secondary-token">
            {t(
              'engCtrl.page.selectProject',
              'Selecciona un proyecto para ver los controles aplicados.',
            )}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto space-y-4"
      data-testid="engineering-controls-page"
    >
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-violet-500/10 text-violet-500 flex items-center justify-center border border-violet-500/20">
          <Layers className="w-5 h-5" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('engCtrl.page.title', 'Controles de Ingeniería')}
          </h1>
          <p className="text-xs text-secondary-token">
            {t(
              'engCtrl.page.subtitle',
              'Jerarquía ISO 31000 / 45001 §8.1.2 — {{count}} controles inventariados.',
              { count: controls.length },
            )}
          </p>
        </div>
        {!isOnline && (
          <span
            className="ml-auto flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400"
            data-testid="engineering-controls-offline-chip"
          >
            <WifiOff className="w-3 h-3" aria-hidden="true" />
            {t('common.offline', 'Sin conexión')}
          </span>
        )}
      </header>

      <EngineeringInventoryCard
        controls={inventoryControls}
        projectRiskCategories={riskCategories}
      />

      {/* Hierarchy diagram — 5 stacked levels, semantic colors */}
      <section
        className="rounded-2xl border border-default-token bg-surface p-4 space-y-2"
        aria-labelledby="engCtrl-hierarchy-title"
        data-testid="engineering-controls-hierarchy"
      >
        <h2
          id="engCtrl-hierarchy-title"
          className="text-xs font-bold uppercase tracking-wider text-secondary-token"
        >
          {t('engCtrl.hierarchy.title', 'Jerarquía de controles')}
        </h2>
        <ol className="space-y-1.5">
          {HIERARCHY.map((h, idx) => (
            <li
              key={h.level}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg border ${h.bandClass}`}
              data-testid={`engineering-controls-hierarchy-${h.level}`}
            >
              <span className="font-mono text-xs font-bold opacity-70 w-4 text-right">
                {idx + 1}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold">
                  {t(h.labelKey, h.labelFallback)}
                </p>
                <p className="text-xs opacity-80">
                  {t(h.hintKey, h.hintFallback)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Filters */}
      <section
        className="rounded-2xl border border-default-token bg-surface p-4 space-y-3"
        aria-labelledby="engCtrl-filters-title"
      >
        <h2
          id="engCtrl-filters-title"
          className="text-xs font-bold uppercase tracking-wider text-secondary-token"
        >
          {t('engCtrl.filters.title', 'Filtros')}
        </h2>
        <div className="flex flex-wrap gap-2" data-testid="engineering-controls-level-filters">
          {LEVEL_FILTERS.map((opt) => {
            const active = levelFilter === opt.filter;
            return (
              <button
                key={opt.filter}
                type="button"
                onClick={() => setLevelFilter(opt.filter)}
                className={`px-3 py-1.5 rounded-full text-xs font-bold border transition ${
                  active
                    ? 'bg-violet-500 text-white border-violet-500'
                    : 'bg-transparent text-secondary-token border-default-token hover:border-violet-500/50'
                }`}
                data-testid={`engineering-controls-level-${opt.filter}`}
                aria-pressed={active}
              >
                {t(opt.labelKey, opt.labelFallback)}
              </button>
            );
          })}
        </div>
        {/* Codex P2 (PR #319): keep this chip row mounted whenever there
            are categories *or* when `riskFilter` is set, so a user who
            filters into a now-empty category can still clear the filter
            with the "Todos los riesgos" button. Previously the row was
            hidden whenever the derived list was empty, stranding the
            stale filter until the user reloaded the page. */}
        {(riskCategories.length > 0 || riskFilter !== null) && (
          <div
            className="flex flex-wrap gap-2"
            data-testid="engineering-controls-risk-filters"
          >
            <button
              type="button"
              onClick={() => setRiskFilter(null)}
              className={`px-3 py-1 rounded-full text-[11px] font-bold border ${
                riskFilter === null
                  ? 'bg-teal-500 text-white border-teal-500'
                  : 'bg-transparent text-secondary-token border-default-token hover:border-teal-500/50'
              }`}
              aria-pressed={riskFilter === null}
              data-testid="engineering-controls-risk-clear"
            >
              {t('engCtrl.filter.allRisks', 'Todos los riesgos')}
            </button>
            {riskCategories.map((cat) => {
              const active = riskFilter === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setRiskFilter(active ? null : cat)}
                  className={`px-3 py-1 rounded-full text-[11px] font-bold border ${
                    active
                      ? 'bg-teal-500 text-white border-teal-500'
                      : 'bg-transparent text-secondary-token border-default-token hover:border-teal-500/50'
                  }`}
                  aria-pressed={active}
                >
                  {cat}
                </button>
              );
            })}
          </div>
        )}
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={() => setShowCreateForm((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-violet-500 text-white hover:bg-violet-600 transition"
            data-testid="engineering-controls-new-btn"
          >
            {showCreateForm ? (
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            ) : (
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            {showCreateForm
              ? t('engCtrl.form.cancel', 'Cancelar')
              : t('engCtrl.form.new', 'Nuevo control')}
          </button>
        </div>
      </section>

      {/* Create form */}
      {showCreateForm && (
        <section
          className="rounded-2xl border border-violet-500/30 bg-violet-500/5 p-4 space-y-3"
          aria-labelledby="engCtrl-form-title"
          data-testid="engineering-controls-form"
        >
          <h2
            id="engCtrl-form-title"
            className="text-sm font-bold text-primary-token"
          >
            {t('engCtrl.form.title', 'Nuevo control')}
          </h2>
          <p className="text-xs text-secondary-token">
            {t(
              'engCtrl.form.hierarchyExplainer',
              'Prefiere niveles altos de la jerarquía (eliminación → sustitución → ingeniería) antes que administrativo o EPP. ISO 31000 / 45001 §8.1.2.',
            )}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-xs font-bold text-secondary-token uppercase tracking-wide">
              {t('engCtrl.form.level', 'Nivel')}
              <select
                value={formLevel}
                onChange={(e) =>
                  setFormLevel(e.target.value as EngineeringControlLevelAPI)
                }
                className="mt-1 block w-full rounded-lg border border-default-token bg-surface px-3 py-2 text-sm text-primary-token"
                data-testid="engineering-controls-form-level"
              >
                {HIERARCHY.map((h) => (
                  <option key={h.level} value={h.level}>
                    {t(h.labelKey, h.labelFallback)}
                  </option>
                ))}
              </select>
              <span className="block mt-1 text-[11px] text-secondary-token normal-case font-normal">
                {t(metaFor(formLevel).hintKey, metaFor(formLevel).hintFallback)}
              </span>
            </label>
            <label className="text-xs font-bold text-secondary-token uppercase tracking-wide">
              {t('engCtrl.form.risk', 'Categoría de riesgo')}
              <input
                type="text"
                value={formRisk}
                onChange={(e) => setFormRisk(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-default-token bg-surface px-3 py-2 text-sm text-primary-token"
                placeholder={t('engCtrl.form.riskPh', 'altura, eléctrico, ruido…') as string}
                data-testid="engineering-controls-form-risk"
              />
            </label>
            <label className="text-xs font-bold text-secondary-token uppercase tracking-wide sm:col-span-2">
              {t('engCtrl.form.name', 'Nombre')}
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-default-token bg-surface px-3 py-2 text-sm text-primary-token"
                placeholder={t('engCtrl.form.namePh', 'Baranda perimetral nivel 2') as string}
                data-testid="engineering-controls-form-name"
              />
            </label>
            <label className="text-xs font-bold text-secondary-token uppercase tracking-wide sm:col-span-2">
              {t('engCtrl.form.description', 'Descripción')}
              <textarea
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-default-token bg-surface px-3 py-2 text-sm text-primary-token"
                rows={3}
                data-testid="engineering-controls-form-description"
              />
            </label>
            <label className="text-xs font-bold text-secondary-token uppercase tracking-wide">
              {t('engCtrl.form.responsible', 'Responsable (UID)')}
              <input
                type="text"
                value={formResponsible}
                onChange={(e) => setFormResponsible(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-default-token bg-surface px-3 py-2 text-sm text-primary-token"
                placeholder={t('engCtrl.form.responsiblePh', 'UID del responsable') as string}
                data-testid="engineering-controls-form-responsible"
              />
              <span className="block mt-1 text-[11px] text-secondary-token normal-case font-normal">
                {t(
                  'engCtrl.form.responsibleHint',
                  'Si lo dejas vacío, se asigna a tu usuario.',
                )}
              </span>
            </label>
            <label className="text-xs font-bold text-secondary-token uppercase tracking-wide">
              {t('engCtrl.form.freq', 'Frecuencia de verificación (días)')}
              <input
                type="number"
                min={1}
                max={3650}
                value={formFreq}
                onChange={(e) => setFormFreq(Number(e.target.value))}
                className="mt-1 block w-full rounded-lg border border-default-token bg-surface px-3 py-2 text-sm text-primary-token"
                data-testid="engineering-controls-form-freq"
              />
            </label>
          </div>
          {formError && (
            <p
              className="text-xs text-rose-600 dark:text-rose-400"
              role="alert"
              data-testid="engineering-controls-form-error"
            >
              {formError}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowCreateForm(false)}
              className="px-3 py-1.5 rounded-lg text-xs font-bold border border-default-token text-secondary-token hover:bg-surface-elevated transition"
            >
              {t('engCtrl.form.cancel', 'Cancelar')}
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={formSubmitting}
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-violet-500 text-white hover:bg-violet-600 disabled:opacity-50 transition"
              data-testid="engineering-controls-form-submit"
            >
              {formSubmitting
                ? t('common.saving', 'Guardando…')
                : t('engCtrl.form.save', 'Guardar control')}
            </button>
          </div>
        </section>
      )}

      {loading && (
        <div
          className="rounded-2xl border border-default-token bg-surface p-6 text-center text-sm text-secondary-token"
          data-testid="engineering-controls-loading"
        >
          {t('common.loading', 'Cargando…')}
        </div>
      )}

      {error && (
        <div
          className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-600 dark:text-rose-400"
          data-testid="engineering-controls-error"
          role="alert"
        >
          {t('engCtrl.page.error', 'No se pudieron cargar los controles: {{msg}}', {
            msg: error.message,
          })}
        </div>
      )}

      {/* Codex P2 (PR #319): degraded-data banner. The server returned
          200 with `warning: 'partial_read_failure'` — the list may be
          incomplete because Firestore threw on the inventory read. We
          surface this prominently so users don't act on a stale or
          empty compliance picture. */}
      {!error && partialReadFailure && (
        <div
          className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-700 dark:text-amber-300"
          data-testid="engineering-controls-warning"
          role="status"
        >
          {t(
            'engCtrl.page.partialRead',
            'Lectura parcial: el inventario puede estar incompleto. Intenta recargar.',
          )}
        </div>
      )}

      {!loading && !error && controls.length === 0 && (
        <div
          className="rounded-2xl border border-default-token bg-surface p-6 text-center text-sm text-secondary-token"
          data-testid="engineering-controls-empty-list"
        >
          {t(
            'engCtrl.list.empty',
            'No hay controles registrados para los filtros seleccionados.',
          )}
        </div>
      )}

      {!loading && !error && controls.length > 0 && (
        <ul className="space-y-3" data-testid="engineering-controls-list">
          {controls.map((c) => {
            const view = computeVerificationView(c);
            const m = metaFor(c.level);
            return (
              <li
                key={c.id}
                className="rounded-2xl border border-default-token bg-surface p-4 space-y-2"
                data-testid={`engineering-controls-card-${c.id}`}
              >
                <header className="flex flex-wrap items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-bold text-primary-token">
                      {c.name}
                    </h3>
                    <p className="text-xs text-secondary-token mt-0.5">
                      {c.description}
                    </p>
                  </div>
                  <span
                    className={`inline-flex items-center text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${m.badgeClass}`}
                    data-testid={`engineering-controls-level-badge-${c.id}`}
                  >
                    {t(m.labelKey, m.labelFallback)}
                  </span>
                </header>
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-secondary-token">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-surface-elevated border border-default-token">
                    {t('engCtrl.card.risk', 'Riesgo')}: <strong className="ml-1">{c.riskCategory}</strong>
                  </span>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full border ${STATUS_CLASSES[view.status]}`}
                    data-testid={`engineering-controls-status-${c.id}`}
                  >
                    {view.status === 'green' &&
                      t('engCtrl.status.green', 'Vigente')}
                    {view.status === 'amber' &&
                      t('engCtrl.status.amber', 'Próximo a vencer')}
                    {view.status === 'red' &&
                      (c.lastVerifiedAt
                        ? t('engCtrl.status.red', 'Verificación vencida')
                        : t('engCtrl.status.never', 'Nunca verificado'))}
                  </span>
                  {view.nextAtIso && (
                    <span>
                      {t('engCtrl.card.next', 'Próxima verificación')}:{' '}
                      <time dateTime={view.nextAtIso}>
                        {view.nextAtIso.slice(0, 10)}
                      </time>
                    </span>
                  )}
                  <span>
                    {t('engCtrl.card.freq', 'Cada {{n}} días', { n: c.verificationFrequencyDays })}
                  </span>
                </div>
                {/* Codex P2 (PR #319, round 2): the verification UI now
                    exposes all three outcomes the endpoint accepts —
                    `pass`, `observation`, `fail` — plus an optional
                    evidence note. Previously only `pass` was wired, so
                    an inspector who found a defective control could
                    either skip recording the check (losing the audit
                    trail) or submit a false OK (corrupting history and
                    advancing `lastVerifiedAt` for a failed control).
                    Now: tap "Observación" or "Falla" to open the
                    evidence panel inline; both record the result with
                    the optional note. Only `pass` advances
                    `lastVerifiedAt` server-side (see sprintK.ts), so a
                    fail does NOT make the control appear "Vigente". */}
                <div className="space-y-2">
                  <div className="flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => handleVerify(c, 'pass')}
                      disabled={verifySubmitting === c.id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 transition"
                      data-testid={`engineering-controls-verify-${c.id}`}
                      aria-label={
                        t('engCtrl.card.verifyAria', 'Registrar verificación OK') as string
                      }
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                      {t('engCtrl.card.verify', 'Verificar (OK)')}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setVerifyPanelOpen((cur) =>
                          cur === `${c.id}::observation` ? null : `${c.id}::observation`,
                        )
                      }
                      disabled={verifySubmitting === c.id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/40 hover:bg-amber-500/25 disabled:opacity-50 transition"
                      data-testid={`engineering-controls-observation-${c.id}`}
                      aria-expanded={verifyPanelOpen === `${c.id}::observation`}
                    >
                      <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
                      {t('engCtrl.card.observation', 'Observación')}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setVerifyPanelOpen((cur) =>
                          cur === `${c.id}::fail` ? null : `${c.id}::fail`,
                        )
                      }
                      disabled={verifySubmitting === c.id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/40 hover:bg-rose-500/25 disabled:opacity-50 transition"
                      data-testid={`engineering-controls-fail-${c.id}`}
                      aria-expanded={verifyPanelOpen === `${c.id}::fail`}
                    >
                      <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
                      {t('engCtrl.card.fail', 'Falla')}
                    </button>
                  </div>
                  {(verifyPanelOpen === `${c.id}::observation` ||
                    verifyPanelOpen === `${c.id}::fail`) && (
                    <div
                      className="rounded-lg border border-default-token bg-surface-elevated p-3 space-y-2"
                      data-testid={`engineering-controls-evidence-panel-${c.id}`}
                    >
                      <label className="block text-[11px] font-bold text-secondary-token uppercase tracking-wide">
                        {t('engCtrl.card.evidenceLabel', 'Evidencia (opcional)')}
                        <textarea
                          value={verifyEvidence}
                          onChange={(e) => setVerifyEvidence(e.target.value)}
                          rows={2}
                          maxLength={4000}
                          placeholder={
                            t(
                              'engCtrl.card.evidencePh',
                              'Describe el hallazgo o adjunta una referencia.',
                            ) as string
                          }
                          className="mt-1 block w-full rounded-lg border border-default-token bg-surface px-3 py-2 text-xs text-primary-token normal-case font-normal"
                          data-testid={`engineering-controls-evidence-input-${c.id}`}
                        />
                      </label>
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setVerifyPanelOpen(null);
                            setVerifyEvidence('');
                          }}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold border border-default-token text-secondary-token hover:bg-surface transition"
                        >
                          {t('common.cancel', 'Cancelar')}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const result =
                              verifyPanelOpen === `${c.id}::fail` ? 'fail' : 'observation';
                            void handleVerify(c, result, verifyEvidence);
                          }}
                          disabled={verifySubmitting === c.id}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold text-white disabled:opacity-50 transition ${
                            verifyPanelOpen === `${c.id}::fail`
                              ? 'bg-rose-500 hover:bg-rose-600'
                              : 'bg-amber-500 hover:bg-amber-600'
                          }`}
                          data-testid={`engineering-controls-evidence-submit-${c.id}`}
                        >
                          {verifySubmitting === c.id
                            ? t('common.saving', 'Guardando…')
                            : t('engCtrl.card.recordCheck', 'Registrar verificación')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default EngineeringControls;
