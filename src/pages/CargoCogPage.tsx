// Praeventio Guard — Wire UI #80: CargoCogPage
//
// Superficie de cargo/estiba: monta el orphan CargoCogPanel con datos
// reales del servicio stowageOptimizer (packCargoFFD + COG + utilization).
// El usuario define un contenedor y carga ítems; la heurística FFD
// computa la colocación y el panel visualiza el centro de gravedad.

import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Truck, Plus, Trash2, Box, Play } from 'lucide-react';
import { randomId } from '../utils/randomId';
import {
  packCargoFFD,
  type CargoItem,
  type Container,
  type PlacedItem,
} from '../services/cargo/stowageOptimizer';
import { CargoCogPanel } from '../components/cargo/CargoCogPanel';

// ── default container: camión estándar 12×2.4×2.6m, 10t payload ─────
const DEFAULT_CONTAINER: Container = {
  dimensions: { x: 12, y: 2.4, z: 2.6 },
  maxPayloadKg: 10_000,
};

interface ItemDraft {
  id: string;
  dimX: string;
  dimY: string;
  dimZ: string;
  mass: string;
  fragile: boolean;
  cannotBeStacked: boolean;
}

function emptyDraft(): ItemDraft {
  return { id: randomId(), dimX: '', dimY: '', dimZ: '', mass: '', fragile: false, cannotBeStacked: false };
}

function parseDraft(d: ItemDraft): CargoItem | null {
  const x = parseFloat(d.dimX);
  const y = parseFloat(d.dimY);
  const z = parseFloat(d.dimZ);
  const m = parseFloat(d.mass);
  if ([x, y, z, m].some((v) => Number.isNaN(v) || v <= 0)) return null;
  return { id: d.id, dimensions: { x, y, z }, mass: m, fragile: d.fragile, cannotBeStacked: d.cannotBeStacked };
}

export function CargoCogPage() {
  const { t } = useTranslation();

  // ── container config ──
  const [contX, setContX] = useState(String(DEFAULT_CONTAINER.dimensions.x));
  const [contY, setContY] = useState(String(DEFAULT_CONTAINER.dimensions.y));
  const [contZ, setContZ] = useState(String(DEFAULT_CONTAINER.dimensions.z));
  const [contPayload, setContPayload] = useState(String(DEFAULT_CONTAINER.maxPayloadKg));

  // ── cargo items ──
  const [drafts, setDrafts] = useState<ItemDraft[]>([emptyDraft()]);
  const [placedItems, setPlacedItems] = useState<PlacedItem[]>([]);
  const [unplaced, setUnplaced] = useState<CargoItem[]>([]);
  const [hasPacked, setHasPacked] = useState(false);

  const container: Container | null = useMemo(() => {
    const x = parseFloat(contX);
    const y = parseFloat(contY);
    const z = parseFloat(contZ);
    const p = parseFloat(contPayload);
    if ([x, y, z, p].some((v) => Number.isNaN(v) || v <= 0)) return null;
    return { dimensions: { x, y, z }, maxPayloadKg: p };
  }, [contX, contY, contZ, contPayload]);

  const addDraft = useCallback(() => setDrafts((d) => [...d, emptyDraft()]), []);
  const removeDraft = useCallback((id: string) => setDrafts((d) => d.filter((x) => x.id !== id)), []);
  const updateDraft = useCallback((id: string, field: keyof ItemDraft, value: string | boolean) => {
    setDrafts((d) => d.map((x) => (x.id === id ? { ...x, [field]: value } : x)));
  }, []);

  const handlePack = useCallback(() => {
    if (!container) return;
    const items = drafts.map(parseDraft).filter((x): x is CargoItem => x !== null);
    if (items.length === 0) return;
    const result = packCargoFFD(items, container);
    setPlacedItems(result.placed);
    setUnplaced(result.unplaced);
    setHasPacked(true);
  }, [container, drafts]);

  const validDraftCount = useMemo(() => drafts.filter((d) => parseDraft(d) !== null).length, [drafts]);

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-6">
      {/* Header */}
      <header className="flex items-center gap-3">
        <Truck className="w-6 h-6 text-violet-500" aria-hidden="true" />
        <h1 className="text-xl font-black uppercase tracking-wide text-primary-token">
          {t('cargo.page_title', 'Cargo y Estiba — Centro de Gravedad')}
        </h1>
      </header>

      {/* Container config */}
      <section className="rounded-2xl border border-default p-4 space-y-3" data-testid="cargo-container-config">
        <h2 className="text-sm font-bold uppercase text-secondary-token">
          {t('cargo.container_config', 'Contenedor')}
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-secondary-token">{t('cargo.dim_x', 'Largo (m)')}</span>
            <input type="number" step="0.1" min="0.1" value={contX} onChange={(e) => setContX(e.target.value)}
              className="rounded border border-default bg-surface px-2 py-1 text-sm" data-testid="cargo-cont-x" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-secondary-token">{t('cargo.dim_y', 'Ancho (m)')}</span>
            <input type="number" step="0.1" min="0.1" value={contY} onChange={(e) => setContY(e.target.value)}
              className="rounded border border-default bg-surface px-2 py-1 text-sm" data-testid="cargo-cont-y" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-secondary-token">{t('cargo.dim_z', 'Alto (m)')}</span>
            <input type="number" step="0.1" min="0.1" value={contZ} onChange={(e) => setContZ(e.target.value)}
              className="rounded border border-default bg-surface px-2 py-1 text-sm" data-testid="cargo-cont-z" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-secondary-token">{t('cargo.max_payload', 'Payload máx (kg)')}</span>
            <input type="number" step="100" min="1" value={contPayload} onChange={(e) => setContPayload(e.target.value)}
              className="rounded border border-default bg-surface px-2 py-1 text-sm" data-testid="cargo-cont-payload" />
          </label>
        </div>
      </section>

      {/* Items editor */}
      <section className="rounded-2xl border border-default p-4 space-y-3" data-testid="cargo-items-editor">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase text-secondary-token">
            {t('cargo.items', 'Ítems de carga')}
          </h2>
          <button onClick={addDraft}
            className="flex items-center gap-1 text-xs text-violet-600 dark:text-violet-400 hover:underline"
            data-testid="cargo-add-item">
            <Plus className="w-3 h-3" /> {t('cargo.add_item', 'Agregar ítem')}
          </button>
        </div>

        {drafts.map((d, idx) => (
          <div key={d.id} className="grid grid-cols-7 gap-2 items-end" data-testid={`cargo-item-row-${idx}`}>
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] text-secondary-token">X (m)</span>
              <input type="number" step="0.1" min="0.1" value={d.dimX}
                onChange={(e) => updateDraft(d.id, 'dimX', e.target.value)}
                className="rounded border border-default bg-surface px-2 py-1 text-sm" />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] text-secondary-token">Y (m)</span>
              <input type="number" step="0.1" min="0.1" value={d.dimY}
                onChange={(e) => updateDraft(d.id, 'dimY', e.target.value)}
                className="rounded border border-default bg-surface px-2 py-1 text-sm" />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] text-secondary-token">Z (m)</span>
              <input type="number" step="0.1" min="0.1" value={d.dimZ}
                onChange={(e) => updateDraft(d.id, 'dimZ', e.target.value)}
                className="rounded border border-default bg-surface px-2 py-1 text-sm" />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] text-secondary-token">{t('cargo.mass_kg', 'Masa (kg)')}</span>
              <input type="number" step="10" min="1" value={d.mass}
                onChange={(e) => updateDraft(d.id, 'mass', e.target.value)}
                className="rounded border border-default bg-surface px-2 py-1 text-sm" />
            </label>
            <label className="flex items-center gap-1 pb-1">
              <input type="checkbox" checked={d.fragile}
                onChange={(e) => updateDraft(d.id, 'fragile', e.target.checked)} />
              <span className="text-[10px] text-secondary-token">{t('cargo.fragile', 'Frágil')}</span>
            </label>
            <label className="flex items-center gap-1 pb-1">
              <input type="checkbox" checked={d.cannotBeStacked}
                onChange={(e) => updateDraft(d.id, 'cannotBeStacked', e.target.checked)} />
              <span className="text-[10px] text-secondary-token">{t('cargo.no_stack', 'No apilar')}</span>
            </label>
            {drafts.length > 1 && (
              <button onClick={() => removeDraft(d.id)}
                className="text-rose-500 hover:text-rose-700 pb-1" data-testid={`cargo-remove-${idx}`}>
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        ))}

        <button onClick={handlePack}
          disabled={!container || validDraftCount === 0}
          className="flex items-center gap-2 rounded-xl bg-violet-600 text-white px-4 py-2 text-sm font-bold
            hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed"
          data-testid="cargo-pack-btn">
          <Play className="w-4 h-4" />
          {t('cargo.compute', 'Calcular estiba y COG')}
        </button>
      </section>

      {/* COG Panel — mounted orphan CargoCogPanel */}
      {hasPacked && container && placedItems.length > 0 && (
        <CargoCogPanel container={container} placedItems={placedItems} />
      )}

      {/* Unplaced items warning */}
      {hasPacked && unplaced.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 space-y-1"
          data-testid="cargo-unplaced">
          <p className="text-xs font-bold text-amber-700 dark:text-amber-300">
            {t('cargo.unplaced_title', 'Ítems que no entraron en el contenedor:')}
          </p>
          <ul className="text-xs text-amber-600 dark:text-amber-400">
            {unplaced.map((u) => (
              <li key={u.id} className="flex items-center gap-1">
                <Box className="w-3 h-3" aria-hidden="true" />
                {u.id} — {u.dimensions.x}×{u.dimensions.y}×{u.dimensions.z}m, {u.mass}kg
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Empty state */}
      {hasPacked && placedItems.length === 0 && (
        <p className="text-sm text-secondary-token text-center py-6" data-testid="cargo-empty">
          {t('cargo.no_items_placed', 'Ningún ítem pudo colocarse. Verifica las dimensiones del contenedor.')}
        </p>
      )}
    </div>
  );
}
