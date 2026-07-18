// Praeventio Guard — Bloque 3 wire huérfanos (3.11) <EquipmentAdminPanel />.
//
// Vista admin del inventario de equipos:
//   • Lista equipos del sitio (filtrable por status).
//   • Botón "Generar QR nuevo" → abre un form mínimo → llama
//     `registerEquipmentQr` → muestra el QR generado.
//   • Cada equipo de la lista permite descargar su QR como PNG.
//
// Reutiliza `qrcode.react` (ya en uso en QrSignatureModal). La descarga PNG
// se hace serializando el SVG en un <canvas> off-screen.
//
// Paleta: teal #4db6ac primary. Modo light + dark con tokens semánticos.

import { randomId } from '../../utils/randomId';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { QRCodeSVG } from 'qrcode.react';
import {
  Wrench,
  PlusCircle,
  Download,
  Loader2,
  ScanLine,
  AlertTriangle,
  X,
} from 'lucide-react';
import {
  registerEquipmentQr,
  listEquipmentBySite,
  type RegisterEquipmentInput,
  type RegisterEquipmentResponse,
} from '../../hooks/useEquipmentQr';
import type {
  Equipment,
  EquipmentCriticality,
  EquipmentStatus,
} from '../../services/equipment/equipmentQrService';
import { humanErrorMessage } from '../../lib/humanError';


const TEAL = '#4db6ac';

export interface EquipmentAdminPanelProps {
  projectId: string;
}

const STATUS_TONES: Record<EquipmentStatus, string> = {
  operativo: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  restringido: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  fuera_servicio: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  en_mantencion: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  bloqueado_loto: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
};

const STATUSES: EquipmentStatus[] = [
  'operativo',
  'restringido',
  'fuera_servicio',
  'en_mantencion',
  'bloqueado_loto',
];

const CRITICALITY_OPTIONS: EquipmentCriticality[] = [
  'low',
  'medium',
  'high',
  'critical',
];

export function EquipmentAdminPanel({
  projectId,
}: EquipmentAdminPanelProps) {
  const { t } = useTranslation();
  const [statusFilter, setStatusFilter] = useState<EquipmentStatus>('operativo');
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [showRegisterForm, setShowRegisterForm] = useState(false);
  const [downloadFor, setDownloadFor] = useState<Equipment | null>(null);
  const [registered, setRegistered] = useState<RegisterEquipmentResponse | null>(null);
  const [refetchTick, setRefetchTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setListError(null);
    (async () => {
      try {
        const res = await listEquipmentBySite(projectId, { status: statusFilter });
        if (!cancelled) setEquipment(res.equipment);
      } catch (err) {
        if (!cancelled) setListError(humanErrorMessage((err as Error).message ?? 'list_failed'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, statusFilter, refetchTick]);

  function handleRegistered(res: RegisterEquipmentResponse) {
    setRegistered(res);
    setShowRegisterForm(false);
    setRefetchTick((n) => n + 1);
  }

  return (
    <section
      className="space-y-4"
      data-testid="equipment-admin-panel"
      aria-label={t('equipmentAdmin.aria', 'Panel de equipos') as string}
    >
      <header className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-2">
          <Wrench className="w-5 h-5" style={{ color: TEAL }} aria-hidden="true" />
          <h1 className="text-base font-black uppercase tracking-tight text-primary-token">
            {t('equipmentAdmin.title', 'Inventario de equipos')}
          </h1>
        </div>
        <button
          type="button"
          onClick={() => setShowRegisterForm(true)}
          data-testid="equipment-admin-register-btn"
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold transition-colors"
          style={{ backgroundColor: TEAL, color: 'rgb(9 9 11)' }}
        >
          <PlusCircle className="w-4 h-4" aria-hidden="true" />
          {t('equipmentAdmin.register', 'Generar QR nuevo')}
        </button>
      </header>

      <div className="flex gap-2 flex-wrap" role="tablist" aria-label="status">
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={statusFilter === s}
            onClick={() => setStatusFilter(s)}
            data-testid={`equipment-admin-filter-${s}`}
            className={
              'px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-widest transition-colors ' +
              (statusFilter === s
                ? STATUS_TONES[s] + ' ring-2 ring-current'
                : 'bg-surface-elevated text-secondary-token hover:bg-surface')
            }
          >
            {s}
          </button>
        ))}
      </div>

      {loading && (
        <div
          className="flex items-center justify-center py-12 gap-3 text-secondary-token"
          data-testid="equipment-admin-loading"
        >
          <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
          <span className="text-sm">
            {t('common.loading', 'Cargando…')}
          </span>
        </div>
      )}

      {listError && !loading && (
        <div
          className="p-4 rounded-2xl bg-rose-500/15 border border-rose-500/40 text-rose-700 dark:text-rose-200 flex items-start gap-3"
          data-testid="equipment-admin-list-error"
        >
          <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="space-y-2 flex-1">
            <p className="text-sm font-bold">
              {t('equipmentAdmin.listError', 'No se pudo cargar el inventario')}
            </p>
            <p className="text-xs opacity-80">{humanErrorMessage(listError)}</p>
            <button
              type="button"
              onClick={() => setRefetchTick((n) => n + 1)}
              className="text-xs underline"
            >
              {t('common.retry', 'Reintentar')}
            </button>
          </div>
        </div>
      )}

      {!loading && !listError && equipment.length === 0 && (
        <div
          className="p-6 rounded-2xl border border-default-token bg-surface text-center text-secondary-token text-sm"
          data-testid="equipment-admin-empty"
        >
          {t(
            'equipmentAdmin.empty',
            'No hay equipos registrados en este estado.',
          )}
        </div>
      )}

      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {equipment.map((eq) => (
          <li
            key={eq.id}
            className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-2"
            data-testid={`equipment-admin-item-${eq.id}`}
          >
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-black text-primary-token truncate">
                  {eq.code}
                </h2>
                <p className="text-[10px] text-secondary-token truncate">
                  {eq.type}
                  {eq.brand ? ` · ${eq.brand}` : ''}
                  {eq.model ? ` ${eq.model}` : ''}
                </p>
              </div>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded ${STATUS_TONES[eq.status]}`}
              >
                {eq.status.toUpperCase()}
              </span>
            </div>
            <dl className="grid grid-cols-2 gap-1.5 text-[10px]">
              <div>
                <dt className="uppercase text-secondary-token">
                  {t('equipmentAdmin.criticality', 'Criticidad')}
                </dt>
                <dd className="font-bold uppercase">{eq.criticality}</dd>
              </div>
              <div>
                <dt className="uppercase text-secondary-token">
                  {t('equipmentAdmin.preUse', 'Pre-uso')}
                </dt>
                <dd className="font-bold uppercase">
                  {eq.requiresPreUseChecklist
                    ? t('common.yes', 'Sí')
                    : t('common.no', 'No')}
                </dd>
              </div>
            </dl>
            <button
              type="button"
              onClick={() => setDownloadFor(eq)}
              data-testid={`equipment-admin-qr-${eq.id}`}
              className="w-full flex items-center justify-center gap-1 px-3 py-1.5 rounded-md bg-sky-500 text-white text-xs font-bold hover:bg-sky-600"
            >
              <Download className="w-3 h-3" aria-hidden="true" />
              {t('equipmentAdmin.downloadQr', 'Descargar QR')}
            </button>
          </li>
        ))}
      </ul>

      {showRegisterForm && (
        <RegisterFormModal
          projectId={projectId}
          onCancel={() => setShowRegisterForm(false)}
          onRegistered={handleRegistered}
        />
      )}

      {registered && (
        <RegisteredQrModal
          response={registered}
          onClose={() => setRegistered(null)}
        />
      )}

      {downloadFor && (
        <DownloadQrModal
          equipment={downloadFor}
          onClose={() => setDownloadFor(null)}
        />
      )}
    </section>
  );
}

// ── Register form modal ───────────────────────────────────────────────

interface RegisterFormModalProps {
  projectId: string;
  onCancel: () => void;
  onRegistered: (res: RegisterEquipmentResponse) => void;
}

function RegisterFormModal({
  projectId,
  onCancel,
  onRegistered,
}: RegisterFormModalProps) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [type, setType] = useState('gruahorquilla');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [criticality, setCriticality] = useState<EquipmentCriticality>('high');
  const [requiresPreUse, setRequiresPreUse] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (code.trim().length === 0 || type.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const input: RegisterEquipmentInput = {
        code: code.trim(),
        type: type.trim(),
        brand: brand.trim() || undefined,
        model: model.trim() || undefined,
        criticality,
        requiresPreUseChecklist: requiresPreUse,
      };
      const idemKey = `register-${Date.now()}-${randomId()}`;
      const res = await registerEquipmentQr(projectId, input, idemKey);
      onRegistered(res);
    } catch (err) {
      setError(humanErrorMessage((err as Error).message ?? 'register_failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      data-testid="equipment-admin-register-modal"
    >
      <div className="relative w-full max-w-md rounded-3xl bg-surface border border-default-token shadow-2xl p-6 space-y-3">
        <header className="flex items-center justify-between">
          <h2 className="text-base font-black uppercase tracking-tight">
            {t('equipmentAdmin.registerTitle', 'Registrar equipo')}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className="p-1 rounded-lg text-secondary-token hover:bg-surface-elevated"
            aria-label={t('common.cancel', 'Cancelar') as string}
            data-testid="equipment-admin-register-cancel"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <label className="block">
          <span className="text-[10px] uppercase tracking-widest text-secondary-token">
            {t('equipmentAdmin.code', 'Código inventario')}
          </span>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            data-testid="equipment-admin-code"
            maxLength={200}
            className="mt-1 w-full px-3 py-2 rounded-lg bg-surface-elevated text-primary-token text-sm border border-default-token focus:outline-none"
            style={{ borderColor: `${TEAL}55` }}
            placeholder="GH-001"
          />
        </label>

        <label className="block">
          <span className="text-[10px] uppercase tracking-widest text-secondary-token">
            {t('equipmentAdmin.type', 'Tipo')}
          </span>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            data-testid="equipment-admin-type"
            className="mt-1 w-full px-3 py-2 rounded-lg bg-surface-elevated text-primary-token text-sm border border-default-token focus:outline-none"
          >
            <option value="gruahorquilla">gruahorquilla</option>
            <option value="maquina_soldar">maquina_soldar</option>
            <option value="andamio">andamio</option>
            <option value="compresor">compresor</option>
          </select>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-[10px] uppercase tracking-widest text-secondary-token">
              {t('equipmentAdmin.brand', 'Marca')}
            </span>
            <input
              type="text"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              data-testid="equipment-admin-brand"
              maxLength={200}
              className="mt-1 w-full px-3 py-2 rounded-lg bg-surface-elevated text-primary-token text-sm border border-default-token focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-widest text-secondary-token">
              {t('equipmentAdmin.model', 'Modelo')}
            </span>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              data-testid="equipment-admin-model"
              maxLength={200}
              className="mt-1 w-full px-3 py-2 rounded-lg bg-surface-elevated text-primary-token text-sm border border-default-token focus:outline-none"
            />
          </label>
        </div>

        <label className="block">
          <span className="text-[10px] uppercase tracking-widest text-secondary-token">
            {t('equipmentAdmin.criticality', 'Criticidad')}
          </span>
          <div className="mt-1 flex gap-2 flex-wrap">
            {CRITICALITY_OPTIONS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCriticality(c)}
                data-testid={`equipment-admin-criticality-${c}`}
                aria-pressed={criticality === c}
                className={
                  'px-3 py-1 rounded-lg text-[11px] font-bold uppercase tracking-widest transition-colors ' +
                  (criticality === c
                    ? 'bg-teal-500 text-zinc-950'
                    : 'bg-surface-elevated text-secondary-token hover:bg-surface')
                }
              >
                {c}
              </button>
            ))}
          </div>
        </label>

        <label className="flex items-center gap-2 text-xs text-primary-token">
          <input
            type="checkbox"
            checked={requiresPreUse}
            onChange={(e) => setRequiresPreUse(e.target.checked)}
            data-testid="equipment-admin-requires-preuse"
            className="accent-teal-500"
          />
          {t(
            'equipmentAdmin.requiresPreUse',
            'Exige checklist pre-uso antes de operar',
          )}
        </label>

        {error && (
          <div
            className="text-xs text-rose-500"
            data-testid="equipment-admin-register-error"
          >
            {humanErrorMessage(error)}
          </div>
        )}

        <button
          type="button"
          onClick={handleSubmit}
          disabled={code.trim().length === 0 || busy}
          data-testid="equipment-admin-register-submit"
          className={
            'w-full py-3 rounded-2xl font-black text-sm uppercase tracking-widest transition-colors flex items-center justify-center gap-2 ' +
            (code.trim().length === 0 || busy
              ? 'bg-surface-elevated text-secondary-token cursor-not-allowed'
              : 'bg-teal-500 text-zinc-950 hover:bg-teal-400')
          }
        >
          {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
          {!busy && <PlusCircle className="w-4 h-4" aria-hidden="true" />}
          {t('equipmentAdmin.registerSubmit', 'Registrar + generar QR')}
        </button>
      </div>
    </div>
  );
}

// ── Registered confirmation modal ─────────────────────────────────────

function RegisteredQrModal({
  response,
  onClose,
}: {
  response: RegisterEquipmentResponse;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      data-testid={`equipment-admin-registered-${response.equipment.id}`}
    >
      <div className="relative w-full max-w-md rounded-3xl bg-surface border border-default-token shadow-2xl p-6 space-y-4 text-center">
        <header className="flex items-center justify-center gap-2">
          <ScanLine className="w-5 h-5" style={{ color: TEAL }} aria-hidden="true" />
          <h2 className="text-base font-black uppercase tracking-tight">
            {t('equipmentAdmin.registeredTitle', 'QR generado')}
          </h2>
        </header>
        <p className="text-sm text-primary-token">{response.equipment.code}</p>
        <div className="flex justify-center bg-white p-4 rounded-2xl mx-auto w-fit">
          <QRCodeSVG
            value={response.qrPayload}
            size={192}
            data-testid="equipment-admin-registered-qr"
          />
        </div>
        <p className="text-[10px] text-secondary-token font-mono break-all">
          {response.qrPayload}
        </p>
        <DownloadQrButtons
          payload={response.qrPayload}
          filename={`${response.equipment.code}.png`}
          testIdPrefix="equipment-admin-registered"
        />
        <button
          type="button"
          onClick={onClose}
          data-testid="equipment-admin-registered-close"
          className="w-full py-2.5 rounded-2xl bg-surface-elevated text-primary-token text-sm font-bold uppercase tracking-widest hover:bg-surface"
        >
          {t('common.done', 'Listo')}
        </button>
      </div>
    </div>
  );
}

// ── Download QR modal ─────────────────────────────────────────────────

function DownloadQrModal({
  equipment,
  onClose,
}: {
  equipment: Equipment;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const payload = `equipment:${equipment.id}`;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      data-testid={`equipment-admin-download-${equipment.id}`}
    >
      <div className="relative w-full max-w-md rounded-3xl bg-surface border border-default-token shadow-2xl p-6 space-y-4 text-center">
        <header className="flex items-center justify-between">
          <h2 className="text-base font-black uppercase tracking-tight">
            {t('equipmentAdmin.downloadTitle', 'QR del equipo')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-secondary-token hover:bg-surface-elevated"
            aria-label={t('common.close', 'Cerrar') as string}
            data-testid={`equipment-admin-download-close-${equipment.id}`}
          >
            <X className="w-4 h-4" />
          </button>
        </header>
        <p className="text-sm text-primary-token">{equipment.code}</p>
        <div className="flex justify-center bg-white p-4 rounded-2xl mx-auto w-fit">
          <QRCodeSVG
            value={payload}
            size={192}
            data-testid={`equipment-admin-download-qr-${equipment.id}`}
          />
        </div>
        <p className="text-[10px] text-secondary-token font-mono break-all">
          {payload}
        </p>
        <DownloadQrButtons
          payload={payload}
          filename={`${equipment.code}.png`}
          testIdPrefix={`equipment-admin-download-${equipment.id}`}
        />
      </div>
    </div>
  );
}

// Off-screen render → PNG download. Uses the actual SVG node rendered by
// qrcode.react when present; falls back to building a fresh SVG when the
// caller is outside React render context.
function DownloadQrButtons({
  payload,
  filename,
  testIdPrefix,
}: {
  payload: string;
  filename: string;
  testIdPrefix: string;
}) {
  const { t } = useTranslation();
  const hiddenSvgRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);

  // Hidden SVG node we own and convert to PNG on click. Rendering it
  // again here (in addition to the visible one) means we don't have to
  // walk parent DOM to find the qrcode.react root.
  async function handleDownload() {
    if (!hiddenSvgRef.current) return;
    setDownloading(true);
    try {
      const svg = hiddenSvgRef.current.querySelector('svg');
      if (!svg) throw new Error('qr_svg_not_found');
      const serializer = new XMLSerializer();
      const svgString = serializer.serializeToString(svg);
      const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      try {
        const img = new Image();
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = reject;
          img.src = url;
        });
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('canvas_2d_unavailable');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const pngUrl = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = pngUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } finally {
        URL.revokeObjectURL(url);
      }
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="space-y-2">
      <div ref={hiddenSvgRef} className="hidden">
        <QRCodeSVG value={payload} size={512} />
      </div>
      <button
        type="button"
        onClick={handleDownload}
        disabled={downloading}
        data-testid={`${testIdPrefix}-png`}
        className={
          'w-full py-2.5 rounded-2xl text-sm font-bold uppercase tracking-widest transition-colors flex items-center justify-center gap-2 ' +
          (downloading
            ? 'bg-surface-elevated text-secondary-token cursor-not-allowed'
            : 'bg-sky-500 text-white hover:bg-sky-600')
        }
      >
        {downloading ? (
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
        ) : (
          <Download className="w-4 h-4" aria-hidden="true" />
        )}
        {t('equipmentAdmin.downloadPng', 'Descargar PNG')}
      </button>
    </div>
  );
}
