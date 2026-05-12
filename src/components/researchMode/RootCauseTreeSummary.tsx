// Praeventio Guard — Wire UI #56: <RootCauseTreeSummary />
//
// Resumen visual del árbol de causa raíz: totales + categorías +
// profundidad + controles fallidos identificados.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Workflow, GitBranch, AlertCircle } from 'lucide-react';
import {
  summarizeTree,
  type RootCauseTree,
  type CauseCategory,
} from '../../services/researchMode/researchMode.js';

interface RootCauseTreeSummaryProps {
  tree: RootCauseTree;
}

const CATEGORIES: CauseCategory[] = [
  'people',
  'process',
  'environment',
  'equipment',
  'materials',
  'measurement',
  'management',
];

const CATEGORY_COLOR: Record<CauseCategory, string> = {
  people: 'bg-sky-500',
  process: 'bg-violet-500',
  environment: 'bg-emerald-500',
  equipment: 'bg-amber-500',
  materials: 'bg-orange-500',
  measurement: 'bg-fuchsia-500',
  management: 'bg-rose-500',
};

export function RootCauseTreeSummary({ tree }: RootCauseTreeSummaryProps) {
  const { t } = useTranslation();
  const summary = useMemo(() => summarizeTree(tree), [tree]);

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
      data-testid={`rct-summary-${tree.incidentId}`}
      aria-label={t('rootCause.treeAria', 'Resumen árbol causa raíz') as string}
    >
      <header className="flex items-center gap-2">
        <Workflow className="w-4 h-4 text-violet-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('rootCause.treeTitle', 'Árbol causa raíz')}
        </h2>
        <span className="ml-auto text-[10px] text-secondary-token tabular-nums">
          {tree.incidentId}
        </span>
      </header>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-surface-elevated rounded p-2" data-testid="rct-total">
          <p className="text-[10px] uppercase text-secondary-token">
            {t('rootCause.totalNodes', 'Nodos')}
          </p>
          <p className="text-xl font-black tabular-nums">{summary.totalNodes}</p>
        </div>
        <div className="bg-surface-elevated rounded p-2" data-testid="rct-roots">
          <p className="text-[10px] uppercase text-secondary-token">
            {t('rootCause.roots', 'Raíces')}
          </p>
          <p className="text-xl font-black tabular-nums">{summary.rootCount}</p>
        </div>
        <div className="bg-surface-elevated rounded p-2" data-testid="rct-depth">
          <p className="text-[10px] uppercase text-secondary-token">
            {t('rootCause.depth', 'Profundidad')}
          </p>
          <p className="text-xl font-black tabular-nums">{summary.maxDepth}</p>
        </div>
      </div>

      <div data-testid="rct-categories">
        <h3 className="text-[10px] uppercase font-bold text-secondary-token mb-2 flex items-center gap-1">
          <GitBranch className="w-3 h-3" aria-hidden="true" />
          {t('rootCause.byCategory', 'Por categoría 5M+1E')}
        </h3>
        <div className="space-y-1">
          {CATEGORIES.map((cat) => {
            const count = summary.byCategory[cat];
            const pct = summary.totalNodes > 0 ? (count / summary.totalNodes) * 100 : 0;
            return (
              <div key={cat} data-testid={`rct-cat-${cat}`}>
                <div className="flex justify-between text-[10px] mb-0.5">
                  <span className="uppercase font-bold">{cat}</span>
                  <span className="tabular-nums text-secondary-token">{count}</span>
                </div>
                <div className="h-1 bg-surface-elevated rounded overflow-hidden">
                  <div className={`h-full ${CATEGORY_COLOR[cat]}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {summary.failedControlsIdentified.length > 0 && (
        <div
          className="bg-rose-500/5 rounded p-2 space-y-1"
          data-testid="rct-failed-controls"
        >
          <h3 className="text-[10px] uppercase font-bold text-rose-700 dark:text-rose-300 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" aria-hidden="true" />
            {t('rootCause.failedControls', 'Controles fallidos identificados')}
          </h3>
          <ul className="space-y-0.5">
            {summary.failedControlsIdentified.map((cid, i) => (
              <li
                key={i}
                className="text-[11px] text-rose-700 dark:text-rose-300 font-mono"
                data-testid={`rct-failed-${i}`}
              >
                {cid}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
