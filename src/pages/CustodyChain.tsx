// Praeventio Guard — Sprint 55 Fase F.24 page wrapper.
//
// Cadena de Custodia UI: time-line de eventos por evidencia
// (`evidenceChain/custodyChainService`). Cada evidence artifact tiene
// hash SHA-256 + audit log inmutable; esta página los expone como
// timeline navegable por hash.
//
// Estructura:
//   - Sidebar izquierdo: lista de artifacts con hash, kind, uploadedAt.
//   - Pane derecho: timeline del seleccionado (upload → access → export
//     → replacement → deletion_request), con badge por eventKind y
//     contexto (IP/userAgent/notes).
//
// Directiva: NO empujamos a APIs externas (SUSESO/SII/MINSAL etc.),
// sólo generamos la trazabilidad para que la empresa la firme+entregue.

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Shield,
  WifiOff,
  Upload,
  Eye,
  RefreshCw,
  Trash2,
  Download,
  Camera,
  Video,
  FileText,
  Mic,
  ClipboardCheck,
  Activity,
} from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import {
  summarizeChain,
  type CustodyEvent,
  type EvidenceArtifact,
  type EvidenceArtifactKind,
} from '../services/evidenceChain/custodyChainService';

const KIND_ICONS: Record<EvidenceArtifactKind, typeof Camera> = {
  photo: Camera,
  video: Video,
  document_pdf: FileText,
  audio: Mic,
  declaration: ClipboardCheck,
  measurement_data: Activity,
};

const EVENT_ICONS: Record<CustodyEvent['eventKind'], typeof Upload> = {
  upload: Upload,
  access: Eye,
  replacement: RefreshCw,
  deletion_request: Trash2,
  export: Download,
};

const EVENT_COLORS: Record<CustodyEvent['eventKind'], string> = {
  upload: 'text-teal-500 border-teal-500/30 bg-teal-500/5',
  access: 'text-blue-500 border-blue-500/30 bg-blue-500/5',
  replacement: 'text-amber-500 border-amber-500/30 bg-amber-500/5',
  deletion_request: 'text-rose-500 border-rose-500/30 bg-rose-500/5',
  export: 'text-violet-500 border-violet-500/30 bg-violet-500/5',
};

interface CustodyChainProps {
  artifacts?: EvidenceArtifact[];
  events?: CustodyEvent[];
}

function truncateHash(hash: string): string {
  if (hash.length <= 12) return hash;
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`;
}

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('es-CL', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function CustodyChain({ artifacts = [], events = [] }: CustodyChainProps) {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const isOnline = useOnlineStatus();
  const [selectedHash, setSelectedHash] = useState<string | null>(
    artifacts[0]?.id ?? null,
  );

  const selected = useMemo(
    () => artifacts.find((a) => a.id === selectedHash) ?? null,
    [artifacts, selectedHash],
  );

  const selectedEvents = useMemo(() => {
    if (!selected) return [];
    return events
      .filter((e) => e.artifactHash === selected.id)
      .sort((a, b) => a.at.localeCompare(b.at));
  }, [events, selected]);

  const summary = useMemo(() => {
    if (!selected) return null;
    return summarizeChain(selected, selectedEvents);
  }, [selected, selectedEvents]);

  if (!selectedProject) {
    return (
      <div
        className="flex-1 w-full p-4 sm:p-6 max-w-5xl mx-auto"
        data-testid="custody-chain-page-empty"
      >
        <div className="rounded-2xl border border-default-token bg-surface p-8 text-center">
          <Shield
            className="w-12 h-12 mx-auto mb-4 text-secondary-token"
            aria-hidden="true"
          />
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('custodyChain.page.title', 'Cadena de Custodia')}
          </h1>
          <p className="mt-2 text-sm text-secondary-token">
            {t(
              'custodyChain.page.selectProject',
              'Selecciona un proyecto para ver la trazabilidad de evidencias.',
            )}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex-1 w-full p-4 sm:p-6 max-w-6xl mx-auto space-y-4"
      data-testid="custody-chain-page"
    >
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-violet-500/10 text-violet-500 flex items-center justify-center border border-violet-500/20">
          <Shield className="w-5 h-5" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('custodyChain.page.title', 'Cadena de Custodia')}
          </h1>
          <p className="text-xs text-secondary-token">
            {t(
              'custodyChain.page.subtitle',
              '{{count}} evidencia(s) registrada(s). Hash SHA-256 + audit log inmutable.',
              { count: artifacts.length },
            )}
          </p>
        </div>
        {!isOnline && (
          <span
            className="ml-auto flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400"
            data-testid="custody-chain-offline-chip"
          >
            <WifiOff className="w-3 h-3" aria-hidden="true" />
            {t('common.offline', 'Sin conexión')}
          </span>
        )}
      </header>

      {artifacts.length === 0 ? (
        <div
          className="rounded-2xl border border-default-token bg-surface p-8 text-center"
          data-testid="custody-chain-empty-state"
        >
          <p className="text-sm text-secondary-token">
            {t(
              'custodyChain.empty',
              'No hay evidencias registradas para este proyecto.',
            )}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Artifact list */}
          <aside
            className="lg:col-span-1 rounded-2xl border border-default-token bg-surface p-3 space-y-2 max-h-[600px] overflow-auto"
            data-testid="custody-chain-list"
          >
            <h2 className="text-xs font-black text-primary-token uppercase tracking-wider px-1 pb-2">
              {t('custodyChain.list.title', 'Evidencias')}
            </h2>
            {artifacts.map((a) => {
              const Icon = KIND_ICONS[a.kind] ?? FileText;
              const isSelected = a.id === selectedHash;
              return (
                <button
                  type="button"
                  key={a.id}
                  onClick={() => setSelectedHash(a.id)}
                  className={`w-full text-left flex items-start gap-2 rounded-xl p-2 transition border ${
                    isSelected
                      ? 'border-violet-500/40 bg-violet-500/10'
                      : 'border-transparent hover:bg-zinc-500/5'
                  }`}
                  data-testid={`custody-chain-item-${a.id}`}
                >
                  <Icon
                    className={`w-4 h-4 mt-0.5 ${
                      isSelected ? 'text-violet-500' : 'text-secondary-token'
                    }`}
                    aria-hidden="true"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-mono text-primary-token truncate">
                      {truncateHash(a.id)}
                    </p>
                    <p className="text-[11px] text-secondary-token">
                      {t(`custodyChain.kind.${a.kind}`, a.kind)} ·{' '}
                      {formatDateTime(a.uploadedAt)}
                    </p>
                    {a.replacedByHash && (
                      <span className="inline-block text-[10px] font-bold text-amber-600 dark:text-amber-400 mt-1">
                        {t('custodyChain.flag.replaced', 'Reemplazada')}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </aside>

          {/* Timeline */}
          <section
            className="lg:col-span-2 rounded-2xl border border-default-token bg-surface p-4 space-y-4"
            data-testid="custody-chain-timeline"
          >
            {!selected ? (
              <p className="text-sm text-secondary-token text-center py-8">
                {t('custodyChain.timeline.pick', 'Selecciona una evidencia.')}
              </p>
            ) : (
              <>
                <div className="space-y-1">
                  <p className="text-[11px] uppercase tracking-wider font-bold text-secondary-token">
                    {t('custodyChain.detail.hashFull', 'Hash SHA-256')}
                  </p>
                  <p
                    className="text-xs font-mono break-all text-primary-token"
                    data-testid="custody-chain-detail-hash"
                  >
                    {selected.id}
                  </p>
                </div>
                {summary && (
                  <div
                    className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs"
                    data-testid="custody-chain-summary"
                  >
                    <SummaryCell
                      label={t('custodyChain.summary.total', 'Eventos')}
                      value={String(summary.totalEvents)}
                    />
                    <SummaryCell
                      label={t('custodyChain.summary.access', 'Accesos')}
                      value={String(summary.accessCount)}
                    />
                    <SummaryCell
                      label={t('custodyChain.summary.exports', 'Exportaciones')}
                      value={String(summary.exportCount)}
                    />
                    <SummaryCell
                      label={t('custodyChain.summary.replaced', 'Reemplazada')}
                      value={summary.isReplaced ? t('common.yes', 'Sí') : t('common.no', 'No')}
                    />
                  </div>
                )}
                {selectedEvents.length === 0 ? (
                  <p
                    className="text-sm text-secondary-token text-center py-6"
                    data-testid="custody-chain-no-events"
                  >
                    {t('custodyChain.timeline.empty', 'Sin eventos registrados.')}
                  </p>
                ) : (
                  <ol
                    className="relative space-y-3 border-l-2 border-default-token pl-5"
                    data-testid="custody-chain-events"
                  >
                    {selectedEvents.map((e, idx) => {
                      const Icon = EVENT_ICONS[e.eventKind] ?? Activity;
                      return (
                        <li
                          key={`${e.at}:${idx}`}
                          className={`relative rounded-xl border p-3 ${EVENT_COLORS[e.eventKind]}`}
                          data-testid={`custody-chain-event-${idx}`}
                        >
                          <div className="absolute -left-[27px] top-3 w-4 h-4 rounded-full bg-surface border border-default-token flex items-center justify-center">
                            <Icon className="w-2.5 h-2.5" aria-hidden="true" />
                          </div>
                          <header className="flex items-center justify-between gap-2">
                            <strong className="text-xs uppercase tracking-wider">
                              {t(`custodyChain.event.${e.eventKind}`, e.eventKind)}
                            </strong>
                            <time className="text-[11px] text-secondary-token font-mono">
                              {formatDateTime(e.at)}
                            </time>
                          </header>
                          <p className="text-xs text-primary-token mt-1">
                            <span className="font-bold">{e.actorRole}</span>
                            {' · '}
                            <span className="font-mono">{e.actorUid}</span>
                          </p>
                          {e.notes && (
                            <p className="text-xs text-secondary-token mt-1">
                              {e.notes}
                            </p>
                          )}
                          {e.context?.userAgent && (
                            <p className="text-[10px] text-secondary-token mt-1 font-mono truncate">
                              UA: {e.context.userAgent}
                            </p>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function SummaryCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-default-token bg-surface px-2 py-1.5">
      <p className="text-[10px] uppercase tracking-wider text-secondary-token">{label}</p>
      <p className="text-sm font-black text-primary-token">{value}</p>
    </div>
  );
}

export default CustodyChain;
