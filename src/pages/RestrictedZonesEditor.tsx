// Praeventio Guard — OLA 1: Restricted-zone editor (map-draw).
//
// Admin/supervisor surface to DEFINE restricted zones by drawing a polygon on
// the map. Without this, the geofence→SOS escalation (GeofenceAlert reads
// /api/zones/by-site) has no zones to read — this is the creation half of the
// chain. Posts to the AUDITED `/api/zones/define` route (server enforces the
// admin/prevencionista/supervisor write role + writes audit_logs).
//
// Founder directives: informational/preventive, never blocks physical access;
// life-safety surface (free on every tier — no tier-gating here).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  GoogleMap,
  useJsApiLoader,
  DrawingManager,
  Polygon,
} from '@react-google-maps/api';
import { MapPin, ShieldAlert, Loader2, Save, Eraser } from 'lucide-react';
import { getMapLoaderConfig } from '../components/maps/mapConfig';
import { useFirebase } from '../contexts/FirebaseContext';
import { useProject } from '../contexts/ProjectContext';
import {
  listRestrictedZonesBySite,
  defineRestrictedZone,
} from '../hooks/useRestrictedZones';
import {
  buildRestrictedZoneDraft,
  parseTokenList,
  ZONE_KINDS,
  type ZoneDraftError,
} from '../services/zones/zoneDraft';
import type { RestrictedZone, ZoneKind } from '../services/zones/restrictedZonesEngine';
import { randomId } from '../utils/randomId';
import { logger } from '../utils/logger';

const SANTIAGO_CENTER = { lat: -33.45, lng: -70.66 };
const containerStyle: React.CSSProperties = { width: '100%', height: '100%' };

// Inline ES labels for the kind dropdown (domain terms; mirrors Site25DPanel's
// inline TYPE_LABELS_ES precedent — not worth 8 i18n keys for a select).
const KIND_LABELS_ES: Record<ZoneKind, string> = {
  hot: 'Trabajo en caliente',
  confined: 'Espacio confinado',
  atex: 'Atmósfera explosiva (ATEX)',
  lifting: 'Izaje en curso',
  heavy_traffic: 'Tránsito pesado',
  exclusion: 'Exclusión total',
  high_voltage: 'Alta tensión',
  biohazard: 'Riesgo biológico',
};

const WRITE_ROLES = new Set(['admin', 'prevencionista', 'supervisor']);

function perimeterToPaths(perimeter?: Array<[number, number]>): Array<{ lat: number; lng: number }> {
  return (perimeter ?? []).map(([lng, lat]) => ({ lat, lng }));
}

/** datetime-local value ("YYYY-MM-DDTHH:mm") → ISO 8601, or '' passthrough. */
function localToIso(local: string): string {
  if (!local) return '';
  const ms = Date.parse(local);
  return Number.isNaN(ms) ? local : new Date(ms).toISOString();
}

export function RestrictedZonesEditor() {
  const { t } = useTranslation();
  const { user, isAdmin, userRole } = useFirebase();
  const { selectedProject } = useProject();
  const projectId = selectedProject?.id;
  const { isLoaded } = useJsApiLoader(getMapLoaderConfig());

  // UX hint only — the server (callerCanWriteZones) is the canonical gate.
  const canWrite = isAdmin || WRITE_ROLES.has(userRole);

  const [existingZones, setExistingZones] = useState<RestrictedZone[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [drawnPath, setDrawnPath] = useState<Array<{ lat: number; lng: number }> | null>(null);

  const [name, setName] = useState('');
  const [kind, setKind] = useState<ZoneKind>('hot');
  const [eppRaw, setEppRaw] = useState('');
  const [trainingsRaw, setTrainingsRaw] = useState('');
  const [requiresPermit, setRequiresPermit] = useState(false);
  const [responsibleUid, setResponsibleUid] = useState('');
  const [activeFrom, setActiveFrom] = useState('');
  const [activeUntil, setActiveUntil] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'error' | 'ok'; msg: string } | null>(null);

  // Default the responsible to the current user (the supervisor defining it).
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    if (user?.uid) {
      setResponsibleUid(user.uid);
      seededRef.current = true;
    }
  }, [user?.uid]);

  // Load existing zones for context (rendered read-only on the same map).
  useEffect(() => {
    if (!projectId) {
      setExistingZones([]);
      return undefined;
    }
    let cancelled = false;
    listRestrictedZonesBySite(projectId)
      .then((res) => {
        if (!cancelled) setExistingZones(res.zones ?? []);
      })
      .catch((err) => {
        if (cancelled) return;
        logger.warn('RestrictedZonesEditor: list failed', { err: String(err) });
        setExistingZones([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, refreshKey]);

  const errorLabel = useCallback(
    (e: ZoneDraftError): string => {
      const map: Record<ZoneDraftError, string> = {
        name_required: t('zone_editor.err_name', 'Ingresá un nombre para la zona.'),
        kind_invalid: t('zone_editor.err_kind', 'Tipo de zona inválido.'),
        perimeter_too_small: t(
          'zone_editor.err_perimeter',
          'Dibujá el perímetro de la zona en el mapa (mínimo 3 puntos).',
        ),
        responsible_required: t('zone_editor.err_responsible', 'Indicá el responsable de la zona.'),
        active_from_invalid: t('zone_editor.err_from', 'Fecha de inicio inválida.'),
        active_until_invalid: t('zone_editor.err_until', 'Fecha de término inválida.'),
        active_until_before_from: t(
          'zone_editor.err_window',
          'El término debe ser posterior al inicio.',
        ),
      };
      return map[e];
    },
    [t],
  );

  const handlePolygonComplete = useCallback((poly: google.maps.Polygon) => {
    const path = poly.getPath();
    const pts: Array<{ lat: number; lng: number }> = [];
    for (let i = 0; i < path.getLength(); i++) {
      const p = path.getAt(i);
      pts.push({ lat: p.lat(), lng: p.lng() });
    }
    // Remove the temporary drawn overlay; we render a controlled <Polygon>.
    poly.setMap(null);
    setDrawnPath(pts);
  }, []);

  const handleSave = useCallback(async () => {
    setFeedback(null);
    if (!projectId) return;
    const draft = buildRestrictedZoneDraft({
      id: `rz_${randomId()}`,
      name,
      kind,
      path: drawnPath ?? [],
      requiredEpp: parseTokenList(eppRaw),
      requiredTrainings: parseTokenList(trainingsRaw),
      requiresPermit,
      responsibleUid,
      activeFrom: localToIso(activeFrom) || new Date().toISOString(),
      activeUntil: activeUntil ? localToIso(activeUntil) : undefined,
    });
    if (!draft.ok) {
      setFeedback({ kind: 'error', msg: errorLabel(draft.error) });
      return;
    }
    setSaving(true);
    try {
      await defineRestrictedZone({ projectId, zone: draft.zone }, draft.zone.id);
      setFeedback({ kind: 'ok', msg: t('zone_editor.saved', 'Zona guardada.') });
      setDrawnPath(null);
      setName('');
      setEppRaw('');
      setTrainingsRaw('');
      setRequiresPermit(false);
      setActiveUntil('');
      setRefreshKey((k) => k + 1);
    } catch (err) {
      logger.warn('RestrictedZonesEditor: define failed', { err: String(err) });
      setFeedback({
        kind: 'error',
        msg: err instanceof Error ? err.message : t('zone_editor.err_save', 'No se pudo guardar la zona.'),
      });
    } finally {
      setSaving(false);
    }
  }, [
    projectId,
    name,
    kind,
    drawnPath,
    eppRaw,
    trainingsRaw,
    requiresPermit,
    responsibleUid,
    activeFrom,
    activeUntil,
    errorLabel,
    t,
  ]);

  const mapCenter = useMemo(() => {
    const withPerimeter = existingZones.find((z) => (z.perimeter?.length ?? 0) >= 3);
    if (withPerimeter?.perimeter && withPerimeter.perimeter.length > 0) {
      const [lng, lat] = withPerimeter.perimeter[0];
      return { lat, lng };
    }
    return SANTIAGO_CENTER;
  }, [existingZones]);

  return (
    <section className="p-4 space-y-4" data-testid="zoneEditor.page" aria-label={t('zone_editor.title', 'Editor de zonas restringidas')}>
      <header className="flex items-center gap-2">
        <ShieldAlert className="w-5 h-5 text-rose-600" aria-hidden="true" />
        <h1 className="text-lg font-bold">{t('zone_editor.title', 'Editor de zonas restringidas')}</h1>
      </header>

      {!projectId ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500 dark:border-white/10 dark:bg-zinc-900/60" data-testid="zoneEditor.noProject">
          {t('zone_editor.no_project', 'Seleccioná un proyecto para definir sus zonas restringidas.')}
        </div>
      ) : !canWrite ? (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200" data-testid="zoneEditor.noRole">
          {t('zone_editor.need_role', 'Solo admin, prevencionista o supervisor pueden definir zonas restringidas.')}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
          {/* Map */}
          <div className="rounded-2xl overflow-hidden border border-zinc-200 dark:border-white/10" style={{ minHeight: 460 }}>
            {!isLoaded ? (
              <div className="flex items-center justify-center h-full min-h-[460px] text-zinc-500" data-testid="zoneEditor.mapLoading">
                <Loader2 className="w-5 h-5 animate-spin mr-2" aria-hidden="true" />
                <span className="text-xs">{t('zone_editor.loading_map', 'Cargando mapa…')}</span>
              </div>
            ) : (
              <GoogleMap mapContainerStyle={containerStyle} center={mapCenter} zoom={15}>
                {/* Existing zones — read-only context. */}
                {existingZones.map((z) => (
                  <Polygon
                    key={z.id}
                    paths={perimeterToPaths(z.perimeter)}
                    options={{ strokeColor: '#71717a', fillColor: '#71717a', fillOpacity: 0.12, strokeWeight: 1, clickable: false }}
                  />
                ))}
                {/* The zone being drawn. */}
                {drawnPath && (
                  <Polygon
                    paths={drawnPath}
                    options={{ strokeColor: '#f43f5e', fillColor: '#f43f5e', fillOpacity: 0.25, strokeWeight: 2, clickable: false }}
                  />
                )}
                <DrawingManager
                  onPolygonComplete={handlePolygonComplete}
                  options={{
                    drawingControl: true,
                    drawingControlOptions: {
                      drawingModes: ['polygon' as google.maps.drawing.OverlayType],
                    },
                    polygonOptions: { fillColor: '#f43f5e', fillOpacity: 0.25, strokeWeight: 2 },
                  }}
                />
              </GoogleMap>
            )}
          </div>

          {/* Form */}
          <div className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-white/10 dark:bg-zinc-900/60">
            <p className="flex items-center gap-1.5 text-[11px] text-zinc-500">
              <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
              {drawnPath
                ? t('zone_editor.drawn', '{{n}} puntos dibujados.', { n: drawnPath.length })
                : t('zone_editor.draw_hint', 'Dibujá el perímetro en el mapa con la herramienta de polígono.')}
            </p>

            {feedback && (
              <div
                role="alert"
                data-testid="zoneEditor.feedback"
                className={`rounded-xl border p-2.5 text-xs ${
                  feedback.kind === 'error'
                    ? 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-700 dark:bg-rose-900/20 dark:text-rose-200'
                    : 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-200'
                }`}
              >
                {feedback.msg}
              </div>
            )}

            <label className="block text-xs font-bold text-zinc-600 dark:text-zinc-300">
              {t('zone_editor.name_label', 'Nombre')}
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                data-testid="zoneEditor.name"
                className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
              />
            </label>

            <label className="block text-xs font-bold text-zinc-600 dark:text-zinc-300">
              {t('zone_editor.kind_label', 'Tipo de zona')}
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as ZoneKind)}
                data-testid="zoneEditor.kind"
                className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
              >
                {ZONE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABELS_ES[k]}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-xs font-bold text-zinc-600 dark:text-zinc-300">
              {t('zone_editor.epp_label', 'EPP requerido (separado por comas)')}
              <input
                type="text"
                value={eppRaw}
                onChange={(e) => setEppRaw(e.target.value)}
                data-testid="zoneEditor.epp"
                className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
              />
            </label>

            <label className="block text-xs font-bold text-zinc-600 dark:text-zinc-300">
              {t('zone_editor.trainings_label', 'Capacitaciones requeridas (comas)')}
              <input
                type="text"
                value={trainingsRaw}
                onChange={(e) => setTrainingsRaw(e.target.value)}
                data-testid="zoneEditor.trainings"
                className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
              />
            </label>

            <label className="flex items-center gap-2 text-xs font-bold text-zinc-600 dark:text-zinc-300">
              <input
                type="checkbox"
                checked={requiresPermit}
                onChange={(e) => setRequiresPermit(e.target.checked)}
                data-testid="zoneEditor.requiresPermit"
              />
              {t('zone_editor.requires_permit', 'Requiere permiso de trabajo activo')}
            </label>

            <label className="block text-xs font-bold text-zinc-600 dark:text-zinc-300">
              {t('zone_editor.responsible_label', 'UID del responsable')}
              <input
                type="text"
                value={responsibleUid}
                onChange={(e) => setResponsibleUid(e.target.value)}
                data-testid="zoneEditor.responsible"
                className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
              />
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs font-bold text-zinc-600 dark:text-zinc-300">
                {t('zone_editor.active_from', 'Inicio')}
                <input
                  type="datetime-local"
                  value={activeFrom}
                  onChange={(e) => setActiveFrom(e.target.value)}
                  data-testid="zoneEditor.activeFrom"
                  className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-xs dark:border-zinc-600 dark:bg-zinc-800"
                />
              </label>
              <label className="block text-xs font-bold text-zinc-600 dark:text-zinc-300">
                {t('zone_editor.active_until', 'Término (opcional)')}
                <input
                  type="datetime-local"
                  value={activeUntil}
                  onChange={(e) => setActiveUntil(e.target.value)}
                  data-testid="zoneEditor.activeUntil"
                  className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-xs dark:border-zinc-600 dark:bg-zinc-800"
                />
              </label>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                data-testid="zoneEditor.save"
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-teal-600 px-3 py-2 text-xs font-black uppercase tracking-widest text-white hover:bg-teal-500 disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {t('zone_editor.save', 'Guardar zona')}
              </button>
              <button
                type="button"
                onClick={() => setDrawnPath(null)}
                disabled={!drawnPath}
                data-testid="zoneEditor.clear"
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-300 px-3 py-2 text-xs font-bold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300"
              >
                <Eraser className="w-4 h-4" />
                {t('zone_editor.clear', 'Limpiar')}
              </button>
            </div>

            <p className="text-[10px] text-zinc-400">
              {t('zone_editor.count', '{{n}} zonas definidas en este proyecto.', { n: existingZones.length })}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

export default RestrictedZonesEditor;
