// Praeventio Guard — Wire UI #78: <CustodyChainTimelineCard />
//
// Cadena de custodia de evidencia: artefacto + timeline de eventos
// + hash SHA-256 + accesos + exportaciones. Pieza forense crítica.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ShieldCheck,
  Eye,
  Upload,
  Download,
  Replace,
  Trash2,
} from 'lucide-react';
import {
  summarizeChain,
  type EvidenceArtifact,
  type CustodyEvent,
} from '../../services/evidenceChain/custodyChainService.js';

interface CustodyChainTimelineCardProps {
  artifact: EvidenceArtifact;
  events: CustodyEvent[];
}

const EVENT_ICON: Record<CustodyEvent['eventKind'], typeof Eye> = {
  upload: Upload,
  access: Eye,
  replacement: Replace,
  export: Download,
  deletion_request: Trash2,
};

const EVENT_COLOR: Record<CustodyEvent['eventKind'], string> = {
  upload: 'text-sky-500',
  access: 'text-emerald-500',
  replacement: 'text-amber-500',
  export: 'text-violet-500',
  deletion_request: 'text-rose-500',
};

function shortHash(hash: string): string {
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

export function CustodyChainTimelineCard({
  artifact,
  events,
}: CustodyChainTimelineCardProps) {
  const { t } = useTranslation();
  const summary = useMemo(() => summarizeChain(artifact, events), [artifact, events]);
  const ownEvents = useMemo(
    () =>
      events
        .filter((e) => e.artifactHash === artifact.id)
        .sort((a, b) => a.at.localeCompare(b.at)),
    [artifact.id, events],
  );

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
      data-testid={`custody-chain-${artifact.id}`}
      aria-label={t('custody.aria', 'Cadena de custodia') as string}
    >
      <header className="flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-sky-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('custody.title', 'Cadena de custodia')}
        </h2>
        <span
          className="ml-auto text-[9px] uppercase font-mono text-secondary-token"
          data-testid={`custody-hash-${artifact.id}`}
        >
          {shortHash(artifact.id)}
        </span>
      </header>

      <div className="grid grid-cols-2 gap-2 text-[10px]">
        <div className="bg-surface-elevated rounded p-1.5">
          <p className="uppercase text-secondary-token">{t('custody.kind', 'Tipo')}</p>
          <p className="font-bold uppercase">{artifact.kind}</p>
        </div>
        <div className="bg-surface-elevated rounded p-1.5">
          <p className="uppercase text-secondary-token">{t('custody.size', 'Tamaño')}</p>
          <p className="font-bold tabular-nums">
            {(artifact.byteSize / 1024).toFixed(1)} KB
          </p>
        </div>
        <div className="bg-surface-elevated rounded p-1.5">
          <p className="uppercase text-secondary-token">{t('custody.accesses', 'Accesos')}</p>
          <p className="font-bold tabular-nums">{summary.accessCount}</p>
        </div>
        <div className="bg-surface-elevated rounded p-1.5">
          <p className="uppercase text-secondary-token">
            {t('custody.exports', 'Exportaciones')}
          </p>
          <p className="font-bold tabular-nums">{summary.exportCount}</p>
        </div>
      </div>

      {summary.isReplaced && (
        <p
          className="text-[11px] bg-amber-500/10 text-amber-700 dark:text-amber-300 p-2 rounded"
          data-testid={`custody-replaced-${artifact.id}`}
        >
          {t('custody.replaced', 'Reemplazado por otra evidencia')}
          {artifact.replacedByHash ? ` → ${shortHash(artifact.replacedByHash)}` : ''}
        </p>
      )}

      <div data-testid={`custody-timeline-${artifact.id}`}>
        <h3 className="text-[10px] uppercase font-bold text-secondary-token mb-1">
          {t('custody.timeline', 'Timeline eventos')} ({ownEvents.length})
        </h3>
        <ol className="space-y-1">
          {ownEvents.map((e, i) => {
            const Icon = EVENT_ICON[e.eventKind];
            return (
              <li
                key={i}
                data-testid={`custody-event-${artifact.id}-${i}`}
                className="flex items-start gap-2 text-[11px] bg-surface-elevated rounded p-1.5"
              >
                <Icon
                  className={`w-3 h-3 mt-0.5 shrink-0 ${EVENT_COLOR[e.eventKind]}`}
                  aria-hidden="true"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between gap-2">
                    <span className="uppercase font-bold">{e.eventKind}</span>
                    <span className="text-[10px] text-secondary-token tabular-nums">
                      {e.at.slice(0, 16).replace('T', ' ')}
                    </span>
                  </div>
                  <p className="text-[10px] text-secondary-token truncate">
                    {e.actorUid} ({e.actorRole})
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
