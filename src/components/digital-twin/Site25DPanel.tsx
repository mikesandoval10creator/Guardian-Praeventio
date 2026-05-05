// Sprint 13 — Digital Twin Phase A
// "Mapa 2.5D del sitio" — Google Maps tilted 45° (hybrid imagery) with
// GeoJSON polygons rendered by `SiteGeometryType`. Polygon editor uses the
// drawing-manager. No new npm packages — relies on the existing
// `@react-google-maps/api` already installed for SiteMap.tsx.
//
// All UI strings are Spanish-CL.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  GoogleMap,
  useJsApiLoader,
  Polygon,
  DrawingManager,
  Marker,
} from '@react-google-maps/api';
import { Map as MapIcon, PencilLine, Loader2 } from 'lucide-react';
import { auth, db, doc, getDoc } from '../../services/firebase';
import { useProject } from '../../contexts/ProjectContext';
import { useFirebase } from '../../contexts/FirebaseContext';
import { TwinAccessGuard } from './TwinAccessGuard';
import { isDemoProject } from '../../data/demoProject';
import {
  TYPE_COLORS,
  TYPE_LABELS_ES,
  ringCentroid,
  type SiteGeometryFeature,
  type SiteGeometryType,
} from '../../services/digitalTwin/siteGeometry';
import {
  subscribeSiteGeometry,
  savePolygon,
} from '../../services/digitalTwin/siteGeometryStore';
import { HazmatWindOverlay } from './HazmatWindOverlay';
import { RiskNodeMarkers } from './RiskNodeMarkers';
import { getMapLoaderConfig } from '../maps/mapConfig';
import { logger } from '../../utils/logger';

const SANTIAGO_CENTER = { lat: -33.45, lng: -70.66 };

const containerStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  minHeight: '480px',
};

interface DrawerOption {
  type: SiteGeometryType;
  label: string;
}

const DRAWER_OPTIONS: DrawerOption[] = [
  { type: 'boundary', label: TYPE_LABELS_ES.boundary },
  { type: 'hazard', label: TYPE_LABELS_ES.hazard },
  { type: 'evacuation', label: TYPE_LABELS_ES.evacuation },
  { type: 'parking', label: TYPE_LABELS_ES.parking },
  { type: 'building', label: TYPE_LABELS_ES.building },
];

/** Maps domain type → Google Maps polygon style (stroke/fill/opacity). */
function polygonOptions(type: SiteGeometryType): google.maps.PolygonOptions {
  const color = TYPE_COLORS[type];
  switch (type) {
    case 'boundary':
      return {
        strokeColor: color,
        strokeOpacity: 0.95,
        strokeWeight: 3,
        fillOpacity: 0,
        clickable: false,
      };
    case 'hazard':
      return {
        strokeColor: color,
        strokeOpacity: 0.9,
        strokeWeight: 2,
        fillColor: color,
        fillOpacity: 0.28,
      };
    case 'evacuation':
      return {
        strokeColor: color,
        strokeOpacity: 0.95,
        strokeWeight: 3,
        fillOpacity: 0.05,
      };
    case 'parking':
      return {
        strokeColor: color,
        strokeOpacity: 0.6,
        strokeWeight: 1,
        fillColor: color,
        fillOpacity: 0.2,
      };
    case 'building':
      // 3D-illusion: heavy stroke + amber fill simulating extruded volume.
      return {
        strokeColor: color,
        strokeOpacity: 1,
        strokeWeight: 4,
        fillColor: color,
        fillOpacity: 0.45,
      };
    default:
      return { strokeColor: color, fillColor: color, fillOpacity: 0.2 };
  }
}

/**
 * Sprint 26 Bucket YY.1 — Site25DPanel ahora se renderiza envuelto en
 * <TwinAccessGuard> (ADR 0011 triple-gate). El componente original que
 * renderiza el GoogleMap + polígonos vive como `Site25DPanelInner`. La
 * función exportada `Site25DPanel` resuelve los fakers de auth y arma el
 * guard alrededor.
 */
export function Site25DPanel(): React.ReactElement {
  const { user } = useFirebase();
  const { selectedProject } = useProject();

  if (!selectedProject) {
    return (
      <div className="flex items-center justify-center h-full min-h-[480px] text-zinc-500 text-xs">
        Selecciona un proyecto para ver el mapa 2.5D.
      </div>
    );
  }

  return (
    <TwinAccessGuard
      projectId={selectedProject.id}
      hookOptions={{
        fakers: {
          getCurrentUser: () =>
            user
              ? {
                  uid: user.uid,
                  email: user.email ?? '',
                  emailVerified: user.emailVerified,
                }
              : null,
          isProjectMember: async (uid, projectId) => {
            try {
              const snap = await getDoc(doc(db, 'projects', projectId));
              if (!snap.exists()) return false;
              const data = snap.data() as
                | { members?: unknown; createdBy?: unknown }
                | undefined;
              const inMembers =
                Array.isArray(data?.members) && data!.members.includes(uid);
              const isCreator =
                typeof data?.createdBy === 'string' && data!.createdBy === uid;
              return inMembers || isCreator;
            } catch {
              return false;
            }
          },
          isDemoProject,
          runBiometric: async () => {
            // Sprint 26 wire: lazy-load Capacitor biometric plugin (cuando
            // el plugin nativo no está, retornamos `unavailable` para que
            // el lock-screen ofrezca la salida apropiada).
            try {
              const mod: any = await import(
                /* @vite-ignore */ '@aparajita/capacitor-biometric-auth'
              );
              const result = await mod.BiometricAuth.authenticate({
                reason:
                  'Verifica tu identidad para acceder al Digital Twin',
                cancelTitle: 'Cancelar',
              });
              return {
                ok: result?.isAuthenticated ?? true,
                method: 'fingerprint' as const,
              };
            } catch {
              return { ok: false, method: 'unavailable' as const };
            }
          },
        },
      }}
    >
      <Site25DPanelInner />
    </TwinAccessGuard>
  );
}

function Site25DPanelInner(): React.ReactElement {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const tenantId = auth.currentUser?.tenantId ?? 'default';
  const projectId = selectedProject?.id ?? null;

  const { isLoaded } = useJsApiLoader(getMapLoaderConfig());

  const [features, setFeatures] = useState<SiteGeometryFeature[]>([]);
  const [drawingType, setDrawingType] = useState<SiteGeometryType | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const center = useMemo(
    () => selectedProject?.coordinates ?? SANTIAGO_CENTER,
    [selectedProject?.coordinates],
  );

  // Live Firestore subscription per (tenant, project).
  useEffect(() => {
    if (!projectId) return;
    const unsub = subscribeSiteGeometry(
      tenantId,
      projectId,
      (next) => setFeatures(next),
      (err) => logger.error('site_geometry subscription failed', { err: String(err) }),
    );
    return unsub;
  }, [tenantId, projectId]);

  const handlePolygonComplete = useCallback(
    async (poly: google.maps.Polygon) => {
      if (!projectId || !drawingType) {
        poly.setMap(null);
        return;
      }
      const path = poly.getPath();
      const ring: [number, number][] = [];
      for (let i = 0; i < path.getLength(); i++) {
        const p = path.getAt(i);
        ring.push([p.lng(), p.lat()]);
      }
      // Drawing manager keeps the editable polygon — we'll let Firestore
      // re-render the persisted version, so remove the temporary one.
      poly.setMap(null);

      try {
        await savePolygon(
          tenantId,
          projectId,
          {
            id: `geom_${Date.now().toString(36)}`,
            label: TYPE_LABELS_ES[drawingType],
            type: drawingType,
            heightM: drawingType === 'building' ? 6 : 0,
          },
          ring,
        );
        setSaveError(null);
        setDrawingType(null);
      } catch (err) {
        logger.error('savePolygon failed', { err: String(err) });
        setSaveError(t('site_25d.save_polygon_failed', 'No se pudo guardar el polígono. Reintenta.'));
      }
    },
    [projectId, tenantId, drawingType],
  );

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center h-full min-h-[480px] text-zinc-500">
        <Loader2 className="w-5 h-5 animate-spin mr-2" aria-hidden="true" />
        <span className="text-xs">{t('site_25d.loading_map', 'Cargando mapa…')}</span>
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-[480px] w-full" data-testid="site-25d-panel">
      <GoogleMap
        mapContainerStyle={containerStyle}
        center={center}
        zoom={17}
        tilt={45}
        mapTypeId="hybrid"
        options={{
          mapTypeControl: true,
          streetViewControl: false,
          fullscreenControl: false,
          tilt: 45,
        }}
      >
        {/* Persisted polygons by type */}
        {features.map((f) => {
          const ring = f.geometry.coordinates[0];
          const path = ring.map(([lng, lat]) => ({ lat, lng }));
          return (
            <Polygon
              key={f.id}
              paths={path}
              options={polygonOptions(f.properties.type)}
            />
          );
        })}

        {/* Evacuation arrow markers — anchored at centroid */}
        {features
          .filter((f) => f.properties.type === 'evacuation')
          .map((f) => {
            const [lng, lat] = ringCentroid(f.geometry.coordinates[0]);
            return (
              <Marker
                key={`evac-${f.id}`}
                position={{ lat, lng }}
                icon={{
                  path: 'M 0,-8 L 6,6 L 0,2 L -6,6 Z',
                  scale: 1.2,
                  fillColor: TYPE_COLORS.evacuation,
                  fillOpacity: 0.9,
                  strokeColor: '#064e3b',
                  strokeWeight: 1,
                }}
                title={f.properties.label}
              />
            );
          })}

        {/* Hazmat wind suction overlay (subscribes to UniversalKnowledge) */}
        <HazmatWindOverlay features={features} />

        {/* Risk node markers (zettelkasten subscription) */}
        {projectId && (
          <RiskNodeMarkers tenantId={tenantId} projectId={projectId} />
        )}

        {/* Drawing manager — only mounted while user picked a type */}
        {drawingType && (
          <DrawingManager
            onPolygonComplete={handlePolygonComplete}
            options={{
              drawingMode: google.maps.drawing.OverlayType.POLYGON,
              drawingControl: false,
              polygonOptions: {
                ...polygonOptions(drawingType),
                editable: true,
                draggable: false,
              },
            }}
          />
        )}
      </GoogleMap>

      {/* Toolbar: drawing controls */}
      <div className="absolute top-3 left-3 bg-black/75 backdrop-blur-md rounded-xl p-3 border border-white/10 max-w-[220px]">
        <div className="flex items-center gap-2 mb-2">
          <MapIcon className="w-3.5 h-3.5 text-cyan-400" aria-hidden="true" />
          <p className="text-[10px] font-black text-zinc-200 uppercase tracking-widest">
            {t('site_25d.map_title', 'Mapa 2.5D del sitio')}
          </p>
        </div>
        <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1.5">
          {t('site_25d.draw_perimeter', 'Dibujar perímetro')}
        </p>
        <div className="grid grid-cols-1 gap-1">
          {DRAWER_OPTIONS.map((opt) => {
            const active = drawingType === opt.type;
            return (
              <button
                key={opt.type}
                type="button"
                aria-pressed={active}
                onClick={() => setDrawingType(active ? null : opt.type)}
                className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider transition-colors ${
                  active
                    ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-500/50'
                    : 'bg-zinc-800/60 text-zinc-300 border border-white/5 hover:bg-zinc-700/70'
                }`}
              >
                <span
                  className="inline-block w-2.5 h-2.5 rounded-sm"
                  style={{ backgroundColor: TYPE_COLORS[opt.type] }}
                  aria-hidden="true"
                />
                {opt.label}
                {active && <PencilLine className="w-3 h-3 ml-auto" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
        {drawingType && (
          <p className="mt-2 text-[10px] text-cyan-300/80 leading-snug">
            {t('site_25d.draw_instructions', 'Click en el mapa para marcar vértices. Doble click para cerrar.')}
          </p>
        )}
        {saveError && (
          <p className="mt-2 text-[10px] text-rose-400 font-bold">{saveError}</p>
        )}
        {!projectId && (
          <p className="mt-2 text-[10px] text-amber-400 font-bold">
            {t('site_25d.select_project', 'Selecciona un proyecto para dibujar.')}
          </p>
        )}
      </div>

      {/* Legend */}
      <div className="absolute bottom-3 left-3 bg-black/75 backdrop-blur-md rounded-xl p-3 border border-white/10">
        <p className="text-[9px] font-black text-zinc-400 uppercase tracking-widest mb-1.5">
          {t('site_25d.legend', 'Leyenda')}
        </p>
        <div className="space-y-1">
          {DRAWER_OPTIONS.map((opt) => (
            <div key={opt.type} className="flex items-center gap-2 text-[10px] text-zinc-300">
              <span
                className="inline-block w-2.5 h-2.5 rounded-sm"
                style={{ backgroundColor: TYPE_COLORS[opt.type] }}
                aria-hidden="true"
              />
              {opt.label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default Site25DPanel;
