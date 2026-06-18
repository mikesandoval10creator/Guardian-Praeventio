// Praeventio Guard — Auditoría 5S self-assessment tool.
//
// Self-contained operational-housekeeping tool: the user names a zone and rates
// each 5S checklist item 0/1/2; the REAL pure engine `buildFiveSAuditReport`
// (in the FiveSAuditForm's onSubmit) computes the per-dimension + overall score
// (0-100) and level. No fetch / no aggregation — pure client compute over the
// user's input. (Mounts the previously-orphan FiveSAuditForm over the real,
// tested buildFiveSAuditReport engine; the fiveS route is stateless compute, so
// there is no persistence to fabricate.)
//
// DIRECTIVE: this is GUIDANCE, never an operational block — it scores
// housekeeping; the team decides.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardCheck, Award } from 'lucide-react';
import { FiveSAuditForm } from '../components/fiveS/FiveSAuditForm';
import type { FiveSAuditReport } from '../services/fiveS/fiveSAudit';

const LEVEL_KEY: Record<FiveSAuditReport['level'], string> = {
  critical: 'fiveS.level.critical',
  low: 'fiveS.level.low',
  fair: 'fiveS.level.fair',
  good: 'fiveS.level.good',
  excellent: 'fiveS.level.excellent',
};
const LEVEL_FALLBACK: Record<FiveSAuditReport['level'], string> = {
  critical: 'Crítico',
  low: 'Bajo',
  fair: 'Regular',
  good: 'Bueno',
  excellent: 'Excelente',
};

export function Auditoria5S() {
  const { t } = useTranslation();
  const [zoneId, setZoneId] = useState('');
  const [report, setReport] = useState<FiveSAuditReport | null>(null);
  const trimmedZone = zoneId.trim();

  return (
    <div
      data-testid="auditoria-5s-page"
      className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto space-y-6"
    >
      <header className="flex items-center gap-3">
        <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 shrink-0">
          <ClipboardCheck className="w-6 h-6 text-emerald-500" />
        </div>
        <div>
          <h1 className="text-2xl font-black uppercase tracking-tighter text-primary-token leading-tight">
            {t('fiveS.page.title', 'Auditoría 5S')}
          </h1>
          <p className="text-xs sm:text-sm text-secondary-token font-medium mt-1">
            {t(
              'fiveS.page.subtitle',
              'Evalúa el orden y limpieza de una zona (Seiri…Shitsuke). Es una guía — la decisión es del equipo.',
            )}
          </p>
        </div>
      </header>

      <section className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode">
        <label
          htmlFor="five-s-zone"
          className="text-[10px] font-bold uppercase tracking-widest text-secondary-token"
        >
          {t('fiveS.page.zoneLabel', 'Zona a auditar')}
        </label>
        <input
          id="five-s-zone"
          type="text"
          value={zoneId}
          onChange={(e) => setZoneId(e.target.value)}
          data-testid="five-s-zone-input"
          placeholder={t('fiveS.page.zonePlaceholder', 'Ej: Bodega A / Taller mecánico')}
          className="mt-1 w-full bg-surface border border-default-token rounded-xl px-3 py-2 text-sm text-primary-token outline-none focus:border-emerald-500"
        />
      </section>

      {trimmedZone && (
        <FiveSAuditForm zoneId={trimmedZone} onSubmit={(r) => setReport(r)} />
      )}

      {report && (
        <section
          data-testid="five-s-result"
          className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 flex items-center gap-3"
        >
          <Award className="w-6 h-6 text-emerald-600 shrink-0" aria-hidden="true" />
          <div>
            <h2 className="text-xs font-bold uppercase tracking-widest text-secondary-token">
              {t('fiveS.result.heading', 'Resultado 5S')}
            </h2>
            <p className="text-lg font-black text-primary-token" data-testid="five-s-result-score">
              {t('fiveS.result.score', 'Puntaje')}: {report.overallScore}/100 —{' '}
              {t(LEVEL_KEY[report.level], LEVEL_FALLBACK[report.level])}
            </p>
          </div>
        </section>
      )}
    </div>
  );
}

export default Auditoria5S;
