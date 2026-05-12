// Praeventio Guard — Wire UI: <DocumentReadConfirmCard />
//
// Muestra documento que requiere confirmación de lectura + estado coverage.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, CheckCircle2, AlertTriangle, Clock } from 'lucide-react';
import {
  deriveStatus,
  summarizeReceipts,
  type DocumentForRead,
  type ReadReceipt,
} from '../../services/readReceipts/readReceiptService.js';

interface DocumentReadConfirmCardProps {
  doc: DocumentForRead;
  receipts: ReadReceipt[];
  /** UID del worker actual (para mostrar su estado + botón confirm). */
  currentWorkerUid?: string;
  onAcknowledge?: () => void;
  now?: Date;
}

export function DocumentReadConfirmCard({
  doc,
  receipts,
  currentWorkerUid,
  onAcknowledge,
  now,
}: DocumentReadConfirmCardProps) {
  const { t } = useTranslation();
  const summary = useMemo(
    () => summarizeReceipts(doc, receipts, now),
    [doc, receipts, now],
  );
  const myReceipt = useMemo(
    () =>
      currentWorkerUid
        ? receipts.find(
            (r) =>
              r.documentId === doc.id &&
              r.documentVersion === doc.version &&
              r.workerUid === currentWorkerUid,
          )
        : undefined,
    [receipts, doc.id, doc.version, currentWorkerUid],
  );
  const myStatus = useMemo(
    () => (myReceipt ? deriveStatus(myReceipt, now) : undefined),
    [myReceipt, now],
  );

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
      data-testid="read-receipt-card"
      aria-label={t('readReceipts.aria', 'Confirmación de lectura') as string}
    >
      <header className="flex items-center gap-2">
        <FileText className="w-4 h-4 text-sky-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('readReceipts.title', 'Lectura obligatoria')}
        </h2>
        <span className="ml-auto text-[10px] text-secondary-token">
          v{doc.version}
        </span>
      </header>

      <p
        className="text-xs text-primary-token font-semibold"
        data-testid="read-receipt-doc-title"
      >
        {doc.title}
      </p>

      <div
        className="grid grid-cols-4 gap-2 text-center"
        data-testid="read-receipt-summary"
      >
        <Stat
          testId="rr-total"
          label={t('readReceipts.audience', 'Audiencia')}
          value={summary.totalAudience}
        />
        <Stat
          testId="rr-ack"
          label={t('readReceipts.acknowledged', 'Confirmados')}
          value={summary.acknowledged}
          tone="ok"
        />
        <Stat
          testId="rr-pending"
          label={t('readReceipts.pending', 'Pendientes')}
          value={summary.pending}
          tone="warn"
        />
        <Stat
          testId="rr-overdue"
          label={t('readReceipts.overdue', 'Vencidos')}
          value={summary.overdue}
          tone="bad"
        />
      </div>

      <div
        className="text-[11px] text-secondary-token"
        data-testid="rr-coverage"
      >
        {t('readReceipts.coverage', 'Cobertura')}: {summary.coveragePercent}%
      </div>

      {myStatus && (
        <div
          className="flex items-center gap-2 text-xs"
          data-testid={`rr-self-status-${myStatus}`}
        >
          {myStatus === 'acknowledged' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-500" aria-hidden="true" />
          ) : myStatus === 'overdue' ? (
            <AlertTriangle className="w-4 h-4 text-rose-500" aria-hidden="true" />
          ) : (
            <Clock className="w-4 h-4 text-amber-500" aria-hidden="true" />
          )}
          <span>
            {myStatus === 'acknowledged'
              ? t('readReceipts.selfAck', 'Ya confirmaste lectura')
              : myStatus === 'overdue'
                ? t('readReceipts.selfOverdue', 'Lectura vencida')
                : t('readReceipts.selfPending', 'Lectura pendiente')}
          </span>
        </div>
      )}

      {myStatus && myStatus !== 'acknowledged' && onAcknowledge && (
        <button
          type="button"
          onClick={onAcknowledge}
          data-testid="rr-acknowledge"
          className="w-full inline-flex items-center justify-center gap-1 px-4 py-2 rounded-md bg-sky-500 text-white text-xs font-bold hover:bg-sky-600"
        >
          <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
          {t('readReceipts.confirm', 'Confirmar lectura')}
        </button>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  tone,
  testId,
}: {
  label: string;
  value: number;
  tone?: 'ok' | 'warn' | 'bad';
  testId: string;
}) {
  const toneCls =
    tone === 'ok'
      ? 'text-emerald-600 dark:text-emerald-300'
      : tone === 'warn'
        ? 'text-amber-600 dark:text-amber-300'
        : tone === 'bad'
          ? 'text-rose-600 dark:text-rose-300'
          : 'text-primary-token';
  return (
    <div data-testid={testId}>
      <p className="text-[10px] uppercase opacity-70">{label}</p>
      <p className={`text-base font-black ${toneCls}`}>{value}</p>
    </div>
  );
}
