// Praeventio Guard — Sprint K §171-179: Orden de Compra Sugerida.
//
// Sub-page del Pricing Calculator. Muestra:
//   - Lista de items EPP recomendados para la industria seleccionada.
//   - Cantidad requerida por trabajador × tamaño de empresa.
//   - Total CLP estimado.
//   - Export CSV (descarga client-side).
//
// La página es self-contained: lee la industria + headcount desde los
// `URLSearchParams` (?industry=GP-MIN&workers=120) y cae a defaults.

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams, Link } from 'react-router-dom';
import {
  ShoppingCart,
  Download,
  Users,
  Building2,
  ArrowLeft,
} from 'lucide-react';
import {
  getEppCatalogForIndustry,
  estimateMonthlyEppBudgetClp,
  SUPPORTED_INDUSTRY_OPTIONS,
  type EppCatalogItem,
} from '../services/pricing/eppIndustryCatalog';
import { formatCurrency } from '../services/pricing/tiers';

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

interface OcLine extends EppCatalogItem {
  totalQuantity: number;
  totalCostClp: number;
}

/** Construye las líneas para un head-count dado. */
function buildLines(catalog: EppCatalogItem[], workers: number): OcLine[] {
  return catalog.map((item) => {
    const totalQuantity = Math.max(0, Math.ceil(item.perWorker * workers));
    const totalCostClp = totalQuantity * item.unitCostClp;
    return { ...item, totalQuantity, totalCostClp };
  });
}

function csvEscape(value: string | number): string {
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function linesToCsv(lines: OcLine[]): string {
  const header = [
    'kind',
    'label',
    'unitCostClp',
    'perWorker',
    'expectedLifeMonths',
    'totalQuantity',
    'totalCostClp',
  ];
  const rows = lines.map((l) =>
    [
      l.kind,
      l.label,
      l.unitCostClp,
      l.perWorker,
      l.expectedLifeMonths,
      l.totalQuantity,
      l.totalCostClp,
    ]
      .map(csvEscape)
      .join(','),
  );
  return [header.join(','), ...rows].join('\n');
}

function downloadCsv(filename: string, csv: string): void {
  // BOM para que Excel detecte UTF-8 con acentos.
  const blob = new Blob(['', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ────────────────────────────────────────────────────────────────────────
// Page
// ────────────────────────────────────────────────────────────────────────

export const OcSugerida: React.FC = () => {
  const { t } = useTranslation();
  const [search, setSearch] = useSearchParams();

  const initialIndustry = search.get('industry') ?? 'GP-CONS';
  const initialWorkers = Number(search.get('workers') ?? '50');
  const [industryPrefix, setIndustryPrefix] = useState<string>(initialIndustry);
  const [workers, setWorkers] = useState<number>(
    Number.isFinite(initialWorkers) && initialWorkers > 0 ? initialWorkers : 50,
  );

  const lines = useMemo(
    () => buildLines(getEppCatalogForIndustry(industryPrefix), workers),
    [industryPrefix, workers],
  );

  const totalClp = useMemo(
    () => lines.reduce((acc, l) => acc + l.totalCostClp, 0),
    [lines],
  );

  const monthlyBudget = useMemo(
    () => estimateMonthlyEppBudgetClp(industryPrefix, workers),
    [industryPrefix, workers],
  );

  const industryLabel =
    SUPPORTED_INDUSTRY_OPTIONS.find((opt) => opt.prefix === industryPrefix)?.label ??
    industryPrefix;

  const onIndustryChange = (next: string) => {
    setIndustryPrefix(next);
    const params = new URLSearchParams(search);
    params.set('industry', next);
    setSearch(params, { replace: true });
  };

  const onWorkersChange = (next: number) => {
    setWorkers(next);
    const params = new URLSearchParams(search);
    params.set('workers', String(next));
    setSearch(params, { replace: true });
  };

  const onExportCsv = () => {
    const csv = linesToCsv(lines);
    downloadCsv(`oc-sugerida-${industryPrefix}-${Date.now()}.csv`, csv);
  };

  return (
    <div
      data-testid="oc-sugerida-page"
      className="p-6 space-y-6 max-w-7xl mx-auto"
    >
      <header className="space-y-1">
        <div className="flex items-center gap-3">
          <ShoppingCart className="w-7 h-7 text-[#4db6ac]" />
          <h1 className="text-2xl font-black text-slate-900 dark:text-white">
            {t('oc.header.title', 'Orden de Compra Sugerida')}
          </h1>
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t(
            'oc.header.subtitle',
            'EPP recomendado por industria con cantidad y costo total CLP.',
          )}
        </p>
        <Link
          to="/pricing-calculator"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#4db6ac] hover:underline"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          {t('oc.header.backToCalc', 'Volver a la calculadora')}
        </Link>
      </header>

      {/* INPUTS ─────────────────────────────────────────────────────── */}
      <section
        data-testid="oc-inputs"
        className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-white dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-700/50 p-5"
      >
        <label className="block">
          <span className="flex items-center gap-2 text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
            <Building2 className="w-3.5 h-3.5" />
            {t('oc.inputs.industry', 'Industria')}
          </span>
          <select
            value={industryPrefix}
            onChange={(e) => onIndustryChange(e.target.value)}
            data-testid="oc-industry"
            className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-sm text-slate-900 dark:text-white"
          >
            {SUPPORTED_INDUSTRY_OPTIONS.map((opt) => (
              <option key={opt.prefix} value={opt.prefix}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="flex items-center gap-2 text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
            <Users className="w-3.5 h-3.5" />
            {t('oc.inputs.workers', 'Trabajadores')}
          </span>
          <input
            type="number"
            min={1}
            step={1}
            value={workers}
            onChange={(e) => onWorkersChange(Math.max(1, Number(e.target.value) || 1))}
            data-testid="oc-workers"
            className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-sm text-slate-900 dark:text-white"
          />
        </label>
      </section>

      {/* LINES ──────────────────────────────────────────────────────── */}
      <section
        data-testid="oc-table"
        className="bg-white dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-700/50 p-5 space-y-3"
      >
        <h2 className="text-sm font-bold text-slate-900 dark:text-white">
          {t('oc.lines.title', 'Items recomendados — {{industry}}', { industry: industryLabel })}
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-slate-500 dark:text-slate-400">
              <tr className="border-b border-slate-200 dark:border-slate-700">
                <th className="text-left py-2 pr-2">{t('oc.lines.col_item', 'Item')}</th>
                <th className="text-right py-2 pr-2">{t('oc.lines.col_per_worker', 'Qty / trabajador')}</th>
                <th className="text-right py-2 pr-2">{t('oc.lines.col_unit_cost', 'Costo unitario')}</th>
                <th className="text-right py-2 pr-2">{t('oc.lines.col_life', 'Vida útil (m)')}</th>
                <th className="text-right py-2 pr-2">{t('oc.lines.col_qty', 'Qty total')}</th>
                <th className="text-right py-2 pr-2">{t('oc.lines.col_total', 'Costo total')}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr
                  key={line.label}
                  data-testid={`oc-line-${line.kind}-${line.label}`}
                  className="border-b border-slate-100 dark:border-slate-800"
                >
                  <td className="py-1.5 pr-2 text-slate-900 dark:text-white">{line.label}</td>
                  <td className="py-1.5 pr-2 text-right text-slate-700 dark:text-slate-300">
                    {line.perWorker}
                  </td>
                  <td className="py-1.5 pr-2 text-right text-slate-700 dark:text-slate-300">
                    {formatCurrency(line.unitCostClp, 'CLP')}
                  </td>
                  <td className="py-1.5 pr-2 text-right text-slate-700 dark:text-slate-300">
                    {line.expectedLifeMonths}
                  </td>
                  <td className="py-1.5 pr-2 text-right text-slate-900 dark:text-white font-medium">
                    {line.totalQuantity}
                  </td>
                  <td className="py-1.5 pr-2 text-right text-slate-900 dark:text-white font-semibold">
                    {formatCurrency(line.totalCostClp, 'CLP')}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-300 dark:border-slate-600">
                <td colSpan={5} className="py-2 pr-2 text-right text-sm font-bold text-slate-900 dark:text-white">
                  {t('oc.lines.total', 'Total CLP estimado')}
                </td>
                <td
                  data-testid="oc-total"
                  className="py-2 pr-2 text-right text-base font-black text-[#4db6ac]"
                >
                  {formatCurrency(totalClp, 'CLP')}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          {t(
            'oc.lines.note',
            'Cobertura inicial. Presupuesto mensual prorrateado (reposición): {{m}} CLP.',
            { m: formatCurrency(monthlyBudget.totalClp, 'CLP') },
          )}
        </p>
      </section>

      {/* ACTIONS ─────────────────────────────────────────────────────── */}
      <section className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onExportCsv}
          data-testid="oc-export-csv"
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#4db6ac] hover:bg-[#3aa399] text-white text-sm font-semibold rounded-lg min-h-11"
        >
          <Download className="w-4 h-4" />
          {t('oc.actions.exportCsv', 'Exportar CSV')}
        </button>
      </section>
    </div>
  );
};

export default OcSugerida;
