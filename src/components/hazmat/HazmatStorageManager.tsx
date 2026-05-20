// Praeventio Guard — Wire UI hazmat: <HazmatStorageManager />.
//
// CRUD de sustancias peligrosas con filtros + búsqueda + co-localización
// incompat banner. Cumple DS 43/2016 (Almacenamiento Sustancias Peligrosas,
// Chile): el inventario expuesto por la UI es el que requiere la norma —
// nombre, CAS, cantidad, ubicación, fecha vencimiento.
//
// Wiring: utiliza el motor `services/hazmat/hazmatInventory.ts` para el
// audit de compatibilidad en vivo y el hook `useHazmatInventory.ts` para
// los mutadores remotos. La persistencia (Firestore/IDB) la decide el
// caller a través de `onChange` — este componente solo orquesta UI.

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FlaskConical,
  AlertTriangle,
  Plus,
  Search,
  Trash2,
  Edit3,
  MapPin,
  CalendarClock,
  X,
  Check,
  Filter,
} from 'lucide-react';
import {
  auditStorageLocation,
  type HazmatItem,
  type HazmatClass,
} from '../../services/hazmat/hazmatInventory.js';
import { HazmatCompatibilityAlert } from './HazmatCompatibilityAlert.js';

interface HazmatStorageManagerProps {
  /** Inventario actual del sitio. */
  items: HazmatItem[];
  /** Disparado cuando el usuario agrega / actualiza / elimina. */
  onChange: (next: HazmatItem[]) => void;
  /** Ubicación seleccionada para filtrar (opcional). */
  defaultLocationId?: string;
  /** Lista de ubicaciones conocidas para el dropdown. */
  knownLocations?: string[];
  /** Modo lectura (sin botones CRUD). */
  readOnly?: boolean;
}

const HAZARD_CLASSES: HazmatClass[] = [
  'oxidizer',
  'flammable',
  'corrosive',
  'toxic',
  'reactive_water',
  'compressed_gas',
  'explosive',
  'radioactive',
  'biohazard',
  'other',
];

const HAZARD_CLASS_LABEL: Record<HazmatClass, string> = {
  oxidizer: 'Oxidante (5.1)',
  flammable: 'Inflamable (3)',
  corrosive: 'Corrosivo (8)',
  toxic: 'Tóxico (6.1)',
  reactive_water: 'Reactivo agua (4.3)',
  compressed_gas: 'Gas comprimido (2)',
  explosive: 'Explosivo (1)',
  radioactive: 'Radiactivo (7)',
  biohazard: 'Biohazard (6.2)',
  other: 'Otro',
};

function newItemId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `hzm_${crypto.randomUUID()}`;
  }
  return `hzm_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

interface DraftItem {
  id: string;
  name: string;
  cas: string;
  unNumber: string;
  hazardClasses: HazmatClass[];
  stockQty: number;
  stockUnit: 'L' | 'kg' | 'unit';
  locationId: string;
  expiresAt: string;
  requiredEpp: string;
  sdsUrl: string;
}

function blankDraft(defaults: { locationId?: string } = {}): DraftItem {
  return {
    id: '',
    name: '',
    cas: '',
    unNumber: '',
    hazardClasses: [],
    stockQty: 0,
    stockUnit: 'L',
    locationId: defaults.locationId ?? '',
    expiresAt: '',
    requiredEpp: '',
    sdsUrl: '',
  };
}

function draftFromItem(it: HazmatItem): DraftItem {
  return {
    id: it.id,
    name: it.name,
    cas: it.cas ?? '',
    unNumber: it.unNumber ?? '',
    hazardClasses: it.hazardClasses,
    stockQty: it.stockQty,
    stockUnit: it.stockUnit,
    locationId: it.locationId,
    expiresAt: it.expiresAt ?? '',
    requiredEpp: it.requiredEpp.join(', '),
    sdsUrl: it.sdsUrl ?? '',
  };
}

function draftToItem(d: DraftItem): HazmatItem | { error: string } {
  if (!d.name.trim()) return { error: 'Nombre requerido' };
  if (!d.locationId.trim()) return { error: 'Ubicación requerida' };
  if (d.hazardClasses.length === 0) return { error: 'Selecciona al menos una clase' };
  if (d.stockQty < 0) return { error: 'Stock no puede ser negativo' };
  return {
    id: d.id || newItemId(),
    name: d.name.trim(),
    cas: d.cas.trim() || undefined,
    unNumber: d.unNumber.trim() || undefined,
    hazardClasses: d.hazardClasses,
    stockQty: Number(d.stockQty),
    stockUnit: d.stockUnit,
    locationId: d.locationId.trim(),
    expiresAt: d.expiresAt.trim() || undefined,
    requiredEpp: d.requiredEpp
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    sdsUrl: d.sdsUrl.trim() || undefined,
  };
}

export function HazmatStorageManager({
  items,
  onChange,
  defaultLocationId,
  knownLocations,
  readOnly = false,
}: HazmatStorageManagerProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState<HazmatClass | ''>('');
  const [locationFilter, setLocationFilter] = useState<string>(defaultLocationId ?? '');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftItem | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const locations = useMemo(() => {
    const set = new Set<string>(knownLocations ?? []);
    for (const it of items) set.add(it.locationId);
    return Array.from(set).sort();
  }, [knownLocations, items]);

  const filtered = useMemo(() => {
    return items.filter((it) => {
      if (classFilter && !it.hazardClasses.includes(classFilter)) return false;
      if (locationFilter && it.locationId !== locationFilter) return false;
      if (search) {
        const needle = search.toLowerCase();
        const matches =
          it.name.toLowerCase().includes(needle) ||
          (it.cas ?? '').toLowerCase().includes(needle) ||
          (it.unNumber ?? '').toLowerCase().includes(needle);
        if (!matches) return false;
      }
      return true;
    });
  }, [items, search, classFilter, locationFilter]);

  const issues = useMemo(() => auditStorageLocation(items), [items]);

  function openAdd() {
    setEditingId(null);
    setDraft(blankDraft({ locationId: locationFilter || defaultLocationId }));
    setFormError(null);
  }

  function openEdit(it: HazmatItem) {
    setEditingId(it.id);
    setDraft(draftFromItem(it));
    setFormError(null);
  }

  function closeForm() {
    setDraft(null);
    setEditingId(null);
    setFormError(null);
  }

  function submitForm() {
    if (!draft) return;
    const parsed = draftToItem(draft);
    if ('error' in parsed) {
      setFormError(parsed.error);
      return;
    }
    if (editingId) {
      onChange(items.map((it) => (it.id === editingId ? parsed : it)));
    } else {
      if (items.some((it) => it.id === parsed.id)) {
        setFormError('El ID de sustancia ya existe');
        return;
      }
      onChange([...items, parsed]);
    }
    closeForm();
  }

  function handleDelete(id: string) {
    onChange(items.filter((it) => it.id !== id));
  }

  function toggleClass(cls: HazmatClass) {
    if (!draft) return;
    const has = draft.hazardClasses.includes(cls);
    setDraft({
      ...draft,
      hazardClasses: has
        ? draft.hazardClasses.filter((c) => c !== cls)
        : [...draft.hazardClasses, cls],
    });
  }

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-4"
      data-testid="hazmat-storage-manager"
      aria-label={t('hazmat.managerAria', 'Gestor de sustancias peligrosas') as string}
    >
      <header className="flex flex-wrap items-center gap-2">
        <FlaskConical className="w-5 h-5 text-teal-600 dark:text-teal-400" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('hazmat.managerTitle', 'Sustancias peligrosas — Inventario DS 43')}
        </h2>
        <span className="ml-auto text-[10px] text-secondary-token tabular-nums" data-testid="hazmat-count">
          {filtered.length} / {items.length}
        </span>
      </header>

      {issues.length > 0 && (
        <HazmatCompatibilityAlert issues={issues} items={items} />
      )}

      <div className="flex flex-wrap gap-2">
        <div className="flex-1 min-w-[180px] relative">
          <Search className="w-4 h-4 absolute left-2 top-2.5 text-secondary-token" aria-hidden="true" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('hazmat.searchPh', 'Buscar nombre / CAS / UN') as string}
            data-testid="hazmat-search"
            className="w-full pl-8 pr-2 py-2 text-xs rounded-lg border border-default-token bg-surface-elevated text-primary-token placeholder:text-secondary-token focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>
        <div className="relative">
          <Filter className="w-3.5 h-3.5 absolute left-2 top-2.5 text-secondary-token" aria-hidden="true" />
          <select
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value as HazmatClass | '')}
            data-testid="hazmat-class-filter"
            className="pl-7 pr-6 py-2 text-xs rounded-lg border border-default-token bg-surface-elevated text-primary-token focus:outline-none focus:ring-2 focus:ring-teal-500"
          >
            <option value="">{t('hazmat.allClasses', 'Todas las clases')}</option>
            {HAZARD_CLASSES.map((c) => (
              <option key={c} value={c}>
                {HAZARD_CLASS_LABEL[c]}
              </option>
            ))}
          </select>
        </div>
        <div className="relative">
          <MapPin className="w-3.5 h-3.5 absolute left-2 top-2.5 text-secondary-token" aria-hidden="true" />
          <select
            value={locationFilter}
            onChange={(e) => setLocationFilter(e.target.value)}
            data-testid="hazmat-location-filter"
            className="pl-7 pr-6 py-2 text-xs rounded-lg border border-default-token bg-surface-elevated text-primary-token focus:outline-none focus:ring-2 focus:ring-teal-500"
          >
            <option value="">{t('hazmat.allLocations', 'Todas las ubicaciones')}</option>
            {locations.map((loc) => (
              <option key={loc} value={loc}>
                {loc}
              </option>
            ))}
          </select>
        </div>
        {!readOnly && (
          <button
            type="button"
            onClick={openAdd}
            data-testid="hazmat-add-button"
            className="flex items-center gap-1 px-3 py-2 text-xs font-bold rounded-lg bg-teal-600 hover:bg-teal-700 text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            {t('hazmat.addBtn', 'Agregar sustancia')}
          </button>
        )}
      </div>

      <div className="overflow-x-auto" data-testid="hazmat-table-wrapper">
        <table className="w-full text-[11px] border-collapse">
          <thead>
            <tr className="border-b border-default-token text-secondary-token uppercase text-[9px]">
              <th className="py-2 px-2 text-left">{t('hazmat.col.name', 'Nombre')}</th>
              <th className="py-2 px-2 text-left">{t('hazmat.col.cas', 'CAS')}</th>
              <th className="py-2 px-2 text-left">{t('hazmat.col.class', 'Clases')}</th>
              <th className="py-2 px-2 text-right">{t('hazmat.col.qty', 'Cantidad')}</th>
              <th className="py-2 px-2 text-left">{t('hazmat.col.loc', 'Ubicación')}</th>
              <th className="py-2 px-2 text-left">{t('hazmat.col.exp', 'Vencimiento')}</th>
              {!readOnly && <th className="py-2 px-2"></th>}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={readOnly ? 6 : 7}
                  className="py-6 text-center text-secondary-token italic"
                  data-testid="hazmat-empty"
                >
                  {items.length === 0
                    ? t('hazmat.empty', 'Sin sustancias registradas.')
                    : t('hazmat.emptyFiltered', 'Sin resultados para los filtros aplicados.')}
                </td>
              </tr>
            ) : (
              filtered.map((it) => (
                <tr
                  key={it.id}
                  data-testid={`hazmat-row-${it.id}`}
                  className="border-b border-default-token/50 hover:bg-surface-elevated"
                >
                  <td className="py-2 px-2 font-bold text-primary-token">{it.name}</td>
                  <td className="py-2 px-2 text-secondary-token tabular-nums">
                    {it.cas ?? '—'}
                  </td>
                  <td className="py-2 px-2">
                    <div className="flex flex-wrap gap-1">
                      {it.hazardClasses.map((c) => (
                        <span
                          key={c}
                          className="px-1.5 py-0.5 text-[9px] rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 font-bold"
                        >
                          {HAZARD_CLASS_LABEL[c]}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums text-primary-token">
                    {it.stockQty} {it.stockUnit}
                  </td>
                  <td className="py-2 px-2 text-secondary-token">{it.locationId}</td>
                  <td className="py-2 px-2 text-secondary-token tabular-nums">
                    {it.expiresAt ? (
                      <span className="inline-flex items-center gap-1">
                        <CalendarClock className="w-3 h-3" aria-hidden="true" />
                        {it.expiresAt.slice(0, 10)}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  {!readOnly && (
                    <td className="py-2 px-2 text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(it)}
                          data-testid={`hazmat-edit-${it.id}`}
                          aria-label={t('hazmat.editAria', 'Editar sustancia') as string}
                          className="p-1 rounded hover:bg-teal-500/15 text-teal-600 dark:text-teal-400"
                        >
                          <Edit3 className="w-3 h-3" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(it.id)}
                          data-testid={`hazmat-delete-${it.id}`}
                          aria-label={t('hazmat.deleteAria', 'Eliminar sustancia') as string}
                          className="p-1 rounded hover:bg-rose-500/15 text-rose-600 dark:text-rose-400"
                        >
                          <Trash2 className="w-3 h-3" aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Edit / Add modal */}
      {draft && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          data-testid="hazmat-form-modal"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-surface rounded-2xl border border-default-token p-5 space-y-4 shadow-2xl">
            <header className="flex items-center gap-2">
              <FlaskConical className="w-4 h-4 text-teal-600" aria-hidden="true" />
              <h3 className="text-sm font-black text-primary-token uppercase tracking-wide">
                {editingId
                  ? t('hazmat.editTitle', 'Editar sustancia')
                  : t('hazmat.addTitle', 'Agregar sustancia')}
              </h3>
              <button
                type="button"
                onClick={closeForm}
                data-testid="hazmat-form-cancel"
                className="ml-auto p-1 rounded hover:bg-rose-500/15 text-secondary-token"
                aria-label={t('common.close', 'Cerrar') as string}
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </header>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <label className="col-span-2 space-y-1">
                <span className="text-secondary-token font-bold uppercase text-[10px]">
                  {t('hazmat.fld.name', 'Nombre comercial *')}
                </span>
                <input
                  type="text"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  data-testid="hazmat-fld-name"
                  className="w-full px-2 py-1.5 rounded border border-default-token bg-surface-elevated text-primary-token focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </label>
              <label className="space-y-1">
                <span className="text-secondary-token font-bold uppercase text-[10px]">CAS</span>
                <input
                  type="text"
                  value={draft.cas}
                  onChange={(e) => setDraft({ ...draft, cas: e.target.value })}
                  data-testid="hazmat-fld-cas"
                  placeholder="67-64-1"
                  className="w-full px-2 py-1.5 rounded border border-default-token bg-surface-elevated text-primary-token focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </label>
              <label className="space-y-1">
                <span className="text-secondary-token font-bold uppercase text-[10px]">UN</span>
                <input
                  type="text"
                  value={draft.unNumber}
                  onChange={(e) => setDraft({ ...draft, unNumber: e.target.value })}
                  data-testid="hazmat-fld-un"
                  placeholder="1090"
                  className="w-full px-2 py-1.5 rounded border border-default-token bg-surface-elevated text-primary-token focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </label>
              <label className="space-y-1">
                <span className="text-secondary-token font-bold uppercase text-[10px]">
                  {t('hazmat.fld.qty', 'Cantidad *')}
                </span>
                <input
                  type="number"
                  min={0}
                  value={draft.stockQty}
                  onChange={(e) =>
                    setDraft({ ...draft, stockQty: Number(e.target.value) || 0 })
                  }
                  data-testid="hazmat-fld-qty"
                  className="w-full px-2 py-1.5 rounded border border-default-token bg-surface-elevated text-primary-token focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </label>
              <label className="space-y-1">
                <span className="text-secondary-token font-bold uppercase text-[10px]">
                  {t('hazmat.fld.unit', 'Unidad')}
                </span>
                <select
                  value={draft.stockUnit}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      stockUnit: e.target.value as 'L' | 'kg' | 'unit',
                    })
                  }
                  data-testid="hazmat-fld-unit"
                  className="w-full px-2 py-1.5 rounded border border-default-token bg-surface-elevated text-primary-token focus:outline-none focus:ring-2 focus:ring-teal-500"
                >
                  <option value="L">L</option>
                  <option value="kg">kg</option>
                  <option value="unit">unidad</option>
                </select>
              </label>
              <label className="col-span-2 space-y-1">
                <span className="text-secondary-token font-bold uppercase text-[10px]">
                  {t('hazmat.fld.loc', 'Ubicación *')}
                </span>
                <input
                  type="text"
                  value={draft.locationId}
                  onChange={(e) => setDraft({ ...draft, locationId: e.target.value })}
                  data-testid="hazmat-fld-loc"
                  list="hazmat-location-list"
                  placeholder="ej. Bodega Norte estante 3"
                  className="w-full px-2 py-1.5 rounded border border-default-token bg-surface-elevated text-primary-token focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
                <datalist id="hazmat-location-list">
                  {locations.map((loc) => (
                    <option key={loc} value={loc} />
                  ))}
                </datalist>
              </label>
              <label className="col-span-2 space-y-1">
                <span className="text-secondary-token font-bold uppercase text-[10px]">
                  {t('hazmat.fld.exp', 'Fecha de vencimiento')}
                </span>
                <input
                  type="date"
                  value={draft.expiresAt.slice(0, 10)}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      expiresAt: e.target.value ? `${e.target.value}T00:00:00Z` : '',
                    })
                  }
                  data-testid="hazmat-fld-exp"
                  className="w-full px-2 py-1.5 rounded border border-default-token bg-surface-elevated text-primary-token focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </label>
              <label className="col-span-2 space-y-1">
                <span className="text-secondary-token font-bold uppercase text-[10px]">
                  {t('hazmat.fld.epp', 'EPP requerido (separar por coma)')}
                </span>
                <input
                  type="text"
                  value={draft.requiredEpp}
                  onChange={(e) => setDraft({ ...draft, requiredEpp: e.target.value })}
                  data-testid="hazmat-fld-epp"
                  placeholder="guantes nitrilo, antiparras, respirador"
                  className="w-full px-2 py-1.5 rounded border border-default-token bg-surface-elevated text-primary-token focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </label>
              <label className="col-span-2 space-y-1">
                <span className="text-secondary-token font-bold uppercase text-[10px]">
                  {t('hazmat.fld.sds', 'URL hoja de seguridad (SDS)')}
                </span>
                <input
                  type="url"
                  value={draft.sdsUrl}
                  onChange={(e) => setDraft({ ...draft, sdsUrl: e.target.value })}
                  data-testid="hazmat-fld-sds"
                  placeholder="https://..."
                  className="w-full px-2 py-1.5 rounded border border-default-token bg-surface-elevated text-primary-token focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </label>
              <fieldset className="col-span-2 space-y-1">
                <legend className="text-secondary-token font-bold uppercase text-[10px]">
                  {t('hazmat.fld.classes', 'Clases de peligro *')}
                </legend>
                <div className="flex flex-wrap gap-1.5">
                  {HAZARD_CLASSES.map((c) => {
                    const active = draft.hazardClasses.includes(c);
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => toggleClass(c)}
                        data-testid={`hazmat-cls-${c}`}
                        aria-pressed={active}
                        className={`px-2 py-1 text-[10px] rounded font-bold border transition ${
                          active
                            ? 'bg-teal-600 text-white border-teal-700'
                            : 'bg-surface-elevated text-secondary-token border-default-token hover:bg-teal-500/10'
                        }`}
                      >
                        {HAZARD_CLASS_LABEL[c]}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            </div>

            {formError && (
              <p
                className="text-xs text-rose-600 dark:text-rose-300 bg-rose-500/10 px-2 py-1 rounded flex items-center gap-1"
                data-testid="hazmat-form-error"
                role="alert"
              >
                <AlertTriangle className="w-3 h-3" aria-hidden="true" />
                {formError}
              </p>
            )}

            <footer className="flex gap-2 justify-end pt-2 border-t border-default-token">
              <button
                type="button"
                onClick={closeForm}
                className="px-3 py-2 text-xs font-bold rounded-lg border border-default-token text-secondary-token hover:bg-surface-elevated"
              >
                {t('common.cancel', 'Cancelar')}
              </button>
              <button
                type="button"
                onClick={submitForm}
                data-testid="hazmat-form-submit"
                className="px-3 py-2 text-xs font-bold rounded-lg bg-teal-600 hover:bg-teal-700 text-white flex items-center gap-1"
              >
                <Check className="w-3.5 h-3.5" aria-hidden="true" />
                {editingId ? t('common.save', 'Guardar') : t('common.add', 'Agregar')}
              </button>
            </footer>
          </div>
        </div>
      )}
    </section>
  );
}
