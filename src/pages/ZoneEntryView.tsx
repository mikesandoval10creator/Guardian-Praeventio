// Praeventio Guard — OLA 1 (VIDA visible): worker-facing Restricted Zones surface.
//
// Wires two orphan components that were fully built but never mounted on a
// worker route:
//   • <RestrictedZonesMapOverlay/> — shows WHERE the site's restricted zones
//     are (real polygons from /api/zones/by-site, self-fetched).
//   • <ZoneEntryGate/> — the informed-entry modal that lists missing
//     requirements and ALWAYS lets the worker acknowledge and enter
//     (founder directive: never block physical access — inform + record).
//
// The admin editor (`RestrictedZonesEditor`, /restricted-zones) lets
// supervisors DRAW zones. This page is the WORKER counterpart: see the zones
// of your faena and register an informed entry that your supervisor can
// follow up on.
//
// Honest data sourcing (no fabrication):
//   • workerActivePermitKinds — REAL, from `useWorkPermits(active)` mapped to
//     the permit kind the zone's `kind` implies (`mapZoneToPermitKind`).
//   • workerEppLabels / workerTrainings — worker SELF-ATTESTS against the
//     zone's own published requirements (a legitimate, recorded pre-entry
//     checklist, the same shape used by paper LOTO/permit flows). We never
//     invent that the worker holds — or lacks — a competency we cannot read.
//   • logZoneEntryEvent persists the acknowledgement with the worker snapshot
//     and the engine evaluation, even when requirements are missing.

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DoorOpen,
  ShieldAlert,
  CheckCircle2,
  AlertCircle,
  WifiOff,
  ClipboardCheck,
} from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { auth } from '../services/firebase';
import { useWorkPermits } from '../hooks/useWorkPermits';
import {
  listRestrictedZonesBySite,
  logZoneEntryEvent,
} from '../hooks/useRestrictedZones';
import { RestrictedZonesMapOverlay } from '../components/zones/RestrictedZonesMapOverlay';
import { ZoneEntryGate } from '../components/zones/ZoneEntryGate';
import {
  mapZoneToPermitKind,
  type RestrictedZone,
  type ZoneEntryCheckInput,
  type ZoneEntryResult,
} from '../services/zones/restrictedZonesEngine';
import { logger } from '../utils/logger';

type LogState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'ok'; zoneName: string }
  | { kind: 'error'; message: string };

export function ZoneEntryView() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const isOnline = useOnlineStatus();
  const projectId = selectedProject?.id ?? null;
  const workerUid = auth.currentUser?.uid ?? null;

  const [zones, setZones] = useState<RestrictedZone[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Self-attestation state for the currently-selected zone.
  const [selectedZone, setSelectedZone] = useState<RestrictedZone | null>(null);
  const [confirmedEpp, setConfirmedEpp] = useState<Set<string>>(new Set());
  const [confirmedTrainings, setConfirmedTrainings] = useState<Set<string>>(
    new Set(),
  );

  // The fully-built engine input handed to <ZoneEntryGate/>; captured once on
  // "Continuar" so `now` and the worker arrays stay stable while the modal is
  // open.
  const [gateInput, setGateInput] = useState<ZoneEntryCheckInput | null>(null);
  const [logState, setLogState] = useState<LogState>({ kind: 'idle' });

  // REAL active permits for this worker on this project.
  const permitsResp = useWorkPermits(projectId, { status: 'active' });
  const activePermitKinds = useMemo(
    () => (permitsResp.data?.permits ?? []).map((p) => p.kind as string),
    [permitsResp.data],
  );

  useEffect(() => {
    if (!projectId) {
      setZones([]);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    listRestrictedZonesBySite(projectId)
      .then((resp) => {
        if (cancelled) return;
        setZones(resp.zones);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        logger.error('zone_entry_view zones fetch failed', {
          err: String(err),
        });
        setLoadError(err.message);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  function openPrepare(zone: RestrictedZone) {
    setSelectedZone(zone);
    setConfirmedEpp(new Set());
    setConfirmedTrainings(new Set());
    setGateInput(null);
    setLogState({ kind: 'idle' });
  }

  function toggle(set: Set<string>, value: string): Set<string> {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  }

  function continueToGate() {
    if (!selectedZone || !workerUid) return;
    setGateInput({
      workerUid,
      workerEppLabels: [...confirmedEpp],
      workerTrainings: [...confirmedTrainings],
      workerActivePermitKinds: activePermitKinds,
      zone: selectedZone,
      now: new Date(),
    });
  }

  async function onAcknowledge(evaluation: ZoneEntryResult) {
    // Freeze the exact input that produced `evaluation` so the audit record's
    // worker snapshot can NEVER diverge from what the engine actually judged
    // (a divergent snapshot would be a fabricated record). Everything logged
    // is read from `frozen`, never from live React state.
    const frozen = gateInput;
    if (!frozen || !projectId) return;
    setGateInput(null);
    setLogState({ kind: 'saving' });
    try {
      await logZoneEntryEvent({
        projectId,
        zoneId: frozen.zone.id,
        workerUid: frozen.workerUid,
        evaluation,
        zoneSnapshot: frozen.zone,
        workerSnapshot: {
          workerEppLabels: frozen.workerEppLabels,
          workerTrainings: frozen.workerTrainings,
          workerActivePermitKinds: frozen.workerActivePermitKinds,
        },
        acknowledgedAt: new Date().toISOString(),
      });
      setLogState({ kind: 'ok', zoneName: frozen.zone.name });
      setSelectedZone(null);
      setConfirmedEpp(new Set());
      setConfirmedTrainings(new Set());
    } catch (err) {
      logger.error('zone_entry_view log failed', { err: String(err) });
      setLogState({
        kind: 'error',
        message: isOnline
          ? t('zoneEntry.logError', 'No pudimos registrar el ingreso. Intenta nuevamente.')
          : t('zoneEntry.logOffline', 'Sin conexión: tu ingreso NO quedó registrado (no hay reintento automático). Tu acceso no está bloqueado; vuelve a registrarlo al reconectar.'),
      });
    }
  }

  const permitKindForSelected = selectedZone
    ? mapZoneToPermitKind(selectedZone.kind)
    : null;
  const hasActivePermit =
    !!permitKindForSelected && activePermitKinds.includes(permitKindForSelected);

  if (!projectId) {
    return (
      <div className="p-4 max-w-3xl mx-auto">
        <h1 className="text-lg font-black text-primary-token mb-2">
          {t('zoneEntry.title', 'Ingreso a Zonas Restringidas')}
        </h1>
        <p className="text-sm text-muted-token">
          {t('zoneEntry.noProject', 'Selecciona un proyecto para ver sus zonas.')}
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 max-w-3xl mx-auto space-y-4" data-testid="zone-entry-view">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-lg font-black text-primary-token">
          <ShieldAlert className="w-5 h-5 text-rose-500" aria-hidden="true" />
          {t('zoneEntry.title', 'Ingreso a Zonas Restringidas')}
        </h1>
        <p className="text-xs text-muted-token leading-snug">
          {t(
            'zoneEntry.intro',
            'Consulta las zonas restringidas de tu faena y registra tu ingreso informado. Esta vista nunca bloquea tu acceso: te informa y deja constancia para que tu supervisor te acompañe.',
          )}
        </p>
        {!isOnline && (
          <p className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
            <WifiOff className="w-3 h-3" aria-hidden="true" />
            {t('zoneEntry.offline', 'Sin conexión — el registro de ingreso no se envía automáticamente; reintenta al reconectar.')}
          </p>
        )}
      </header>

      {/* Spatial view (orphan overlay, now mounted). */}
      <div className="rounded-2xl overflow-hidden border border-default-token h-[360px]">
        <RestrictedZonesMapOverlay
          projectId={projectId}
          onZoneClick={openPrepare}
          minHeight="360px"
        />
      </div>

      {/* Result banner. */}
      {logState.kind === 'ok' && (
        <div
          className="flex items-center gap-2 rounded-xl bg-teal-500/10 border border-teal-500/30 p-3 text-sm text-teal-700 dark:text-teal-300"
          data-testid="zone-entry-log-ok"
          role="status"
        >
          <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
          {t('zoneEntry.logged', 'Ingreso registrado')}: {logState.zoneName}
        </div>
      )}
      {logState.kind === 'error' && (
        <div
          className="flex items-center gap-2 rounded-xl bg-rose-500/10 border border-rose-500/30 p-3 text-sm text-rose-700 dark:text-rose-300"
          data-testid="zone-entry-log-error"
          role="alert"
        >
          <AlertCircle className="w-4 h-4" aria-hidden="true" />
          {logState.message}
        </div>
      )}

      {/* Zone list. */}
      <section>
        <h2 className="text-[11px] uppercase font-bold tracking-widest text-muted-token mb-2">
          {t('zoneEntry.listTitle', 'Zonas de la faena')}
        </h2>
        {loading && (
          <p className="text-xs text-muted-token">
            {t('zoneEntry.loading', 'Cargando zonas…')}
          </p>
        )}
        {loadError && (
          <p className="text-xs text-rose-500 font-bold" data-testid="zone-entry-load-error">
            {loadError}
          </p>
        )}
        {!loading && !loadError && zones.length === 0 && (
          <p className="text-xs text-muted-token">
            {t('zoneEntry.empty', 'Aún no hay zonas restringidas definidas para este sitio.')}
          </p>
        )}
        <ul className="space-y-2">
          {zones.map((zone) => (
            <li
              key={zone.id}
              className="rounded-xl border border-default-token p-3"
              data-testid={`zone-row-${zone.id}`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-primary-token truncate">
                    {zone.name}
                  </p>
                  <p className="text-[10px] uppercase tracking-widest text-muted-token">
                    {zone.kind}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => openPrepare(zone)}
                  data-testid={`zone-prepare-${zone.id}`}
                  className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:opacity-90"
                >
                  <DoorOpen className="w-3.5 h-3.5" aria-hidden="true" />
                  {t('zoneEntry.prepare', 'Preparar ingreso')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* Self-attestation panel for the selected zone. */}
      {selectedZone && (
        <section
          className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-3"
          data-testid="zone-prepare-panel"
        >
          <h2 className="flex items-center gap-2 text-sm font-black text-primary-token">
            <ClipboardCheck className="w-4 h-4 text-amber-500" aria-hidden="true" />
            {t('zoneEntry.confirmTitle', 'Confirma tu preparación')}: {selectedZone.name}
          </h2>

          {selectedZone.rules.requiredEpp.length > 0 && (
            <fieldset>
              <legend className="text-[10px] uppercase font-bold text-secondary-token mb-1">
                {t('zoneEntry.confirmEpp', 'Marca el EPP que portas ahora')}
              </legend>
              <div className="space-y-1">
                {selectedZone.rules.requiredEpp.map((epp) => (
                  <label
                    key={epp}
                    className="flex items-center gap-2 text-xs text-secondary-token"
                  >
                    <input
                      type="checkbox"
                      checked={confirmedEpp.has(epp)}
                      onChange={() => setConfirmedEpp((s) => toggle(s, epp))}
                      data-testid={`zone-epp-${epp}`}
                    />
                    {epp}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {selectedZone.rules.requiredTrainings.length > 0 && (
            <fieldset>
              <legend className="text-[10px] uppercase font-bold text-secondary-token mb-1">
                {t('zoneEntry.confirmTrainings', 'Marca las capacitaciones que tienes')}
              </legend>
              <div className="space-y-1">
                {selectedZone.rules.requiredTrainings.map((tr) => (
                  <label
                    key={tr}
                    className="flex items-center gap-2 text-xs text-secondary-token"
                  >
                    <input
                      type="checkbox"
                      checked={confirmedTrainings.has(tr)}
                      onChange={() => setConfirmedTrainings((s) => toggle(s, tr))}
                      data-testid={`zone-training-${tr}`}
                    />
                    {tr}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {selectedZone.rules.requiresPermit && (
            <p
              className={`text-xs font-semibold ${
                hasActivePermit
                  ? 'text-teal-600 dark:text-teal-400'
                  : 'text-amber-600 dark:text-amber-400'
              }`}
              data-testid="zone-permit-status"
            >
              {!permitKindForSelected
                ? // Zone requires a permit but its kind has no mapped permit
                  // type — never silently treat that as satisfied.
                  `⚠ ${t('zoneEntry.permitUnmapped', 'Esta zona exige permiso, pero su tipo no tiene permiso configurado. Confírmalo con tu supervisor antes de entrar.')}`
                : hasActivePermit
                  ? `✓ ${t('zoneEntry.permitActive', 'Permiso activo detectado')}: ${permitKindForSelected}`
                  : `✗ ${t('zoneEntry.permitMissing', 'Sin permiso activo de este tipo')}: ${permitKindForSelected}`}
            </p>
          )}

          {/* Permit fetch state — a worker must not be judged on stale/empty
              permits. Surface loading/error and block continue until resolved. */}
          {permitsResp.loading && (
            <p className="text-xs text-muted-token" data-testid="zone-permits-loading">
              {t('zoneEntry.permitsLoading', 'Verificando tus permisos activos…')}
            </p>
          )}
          {permitsResp.error && (
            <p className="text-xs text-rose-500" data-testid="zone-permits-error">
              {t('zoneEntry.permitsError', 'No pudimos verificar tus permisos activos. Reconecta antes de continuar.')}
            </p>
          )}

          <button
            type="button"
            onClick={continueToGate}
            disabled={!workerUid || permitsResp.loading || !!permitsResp.error}
            data-testid="zone-continue"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold bg-teal-600 hover:bg-teal-700 text-white disabled:opacity-50"
          >
            <DoorOpen className="w-4 h-4" aria-hidden="true" />
            {t('zoneEntry.continue', 'Continuar al registro')}
          </button>
          {!workerUid && (
            <p className="text-[11px] text-rose-500">
              {t('zoneEntry.needSignIn', 'Inicia sesión para registrar tu ingreso.')}
            </p>
          )}
        </section>
      )}

      {/* Informed-entry modal (orphan gate, now mounted). Always ackable. */}
      <ZoneEntryGate
        open={gateInput !== null}
        input={gateInput ?? PLACEHOLDER_INPUT}
        onAcknowledge={onAcknowledge}
        onCancel={() => setGateInput(null)}
      />
    </div>
  );
}

// <ZoneEntryGate/> returns null when `open=false` BEFORE it reads `input`
// (that early return is load-bearing for this placeholder's correctness), but
// the prop is required by the type — this stable, benign placeholder keeps the
// render path total without an extra conditional mount. `heavy_traffic` maps
// to no permit and carries no rules, so even if the guard ever regressed the
// evaluation would be inert rather than a spurious exclusion-zone verdict.
const PLACEHOLDER_INPUT: ZoneEntryCheckInput = {
  workerUid: '',
  workerEppLabels: [],
  workerTrainings: [],
  workerActivePermitKinds: [],
  zone: {
    id: '__placeholder__',
    kind: 'heavy_traffic',
    name: '',
    rules: { requiredEpp: [], requiredTrainings: [], responsibleUid: '' },
    activeFrom: '1970-01-01T00:00:00.000Z',
  },
  now: new Date(0),
};

export default ZoneEntryView;
