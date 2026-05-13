// Praeventio Guard — Sprint 42 F.15: <PermitChecklistRenderer />
//
// Renderiza el checklist canónico de un permit kind, permite check/uncheck
// y expone "Issue permit" cuando todos los items están checked.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckSquare, Square, FileSignature } from 'lucide-react';
import type {
  WorkPermitKind,
  WorkPermitChecklist,
} from '../../services/workPermits/workPermitEngine.js';
import {
  isChecklistReady,
  checklistCompletion,
} from '../../services/workPermits/permitLifecycleAdvisor.js';

interface PermitChecklistRendererProps {
  kind: WorkPermitKind;
  checklist: WorkPermitChecklist;
  onToggle: (itemId: string, next: boolean) => void;
  onIssue?: () => void;
  disabled?: boolean;
}

export function PermitChecklistRenderer({
  kind,
  checklist,
  onToggle,
  onIssue,
  disabled = false,
}: PermitChecklistRendererProps) {
  const { t } = useTranslation();
  const ready = useMemo(() => isChecklistReady(kind, checklist), [kind, checklist]);
  const progress = useMemo(() => checklistCompletion(checklist), [checklist]);

  return (
    <section
      data-testid="permit-checklist-renderer"
      className="rounded-2xl border border-default-token bg-surface p-4 space-y-3 shadow-mode"
      aria-label={t('permits.checklist.aria', 'Checklist de permiso') as string}
    >
      <header className="flex items-center gap-2">
        <h3 className="text-xs font-black text-primary-token uppercase tracking-wide">
          {t(`permits.kind.${kind}`, kind)} — {t('permits.checklist.title', 'Checklist previo')}
        </h3>
        <span
          className="ml-auto text-[10px] font-bold tabular-nums text-secondary-token"
          data-testid="permit-checklist-progress"
        >
          {Math.round(progress * 100)}%
        </span>
      </header>

      <ul className="space-y-1" data-testid="permit-checklist-items">
        {checklist.items.map((item) => {
          const Icon = item.checked ? CheckSquare : Square;
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onToggle(item.id, !item.checked)}
                disabled={disabled}
                data-testid={`permit-checklist-item-${item.id}`}
                aria-pressed={item.checked}
                className={`w-full flex items-center gap-2 text-left text-[12px] px-2 py-1.5 rounded transition ${
                  item.checked
                    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    : 'bg-surface-elevated text-secondary-token hover:bg-surface'
                } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span className="flex-1">{item.label}</span>
              </button>
            </li>
          );
        })}
      </ul>

      {onIssue && (
        <button
          type="button"
          onClick={onIssue}
          disabled={!ready || disabled}
          data-testid="permit-checklist-issue"
          className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded text-xs font-bold transition ${
            ready && !disabled
              ? 'bg-teal-500 text-white hover:bg-teal-600'
              : 'bg-surface-elevated text-secondary-token cursor-not-allowed'
          }`}
        >
          <FileSignature className="w-4 h-4" aria-hidden="true" />
          {t('permits.checklist.issue', 'Emitir permiso')}
        </button>
      )}
    </section>
  );
}
