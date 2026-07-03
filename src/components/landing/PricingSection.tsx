/**
 * LÁM. 05 · PLANES — matches the Claude Design landing 1:1. Prices come from the
 * single source of truth (services/pricing/tiers.ts); the per-plan `who`/`note`
 * marketing copy and the per-project framing are the design's own (the user's
 * approved wording). Header strings are i18n; the interactive control copy is
 * inline es-CL, as the design ships Spanish-only. φ-gold stays for geometry.
 */
import { useState, type MouseEvent } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { TIERS, type Tier, type TierId } from '../../services/pricing/tiers';

/** Design plan meta: material colour + the exact `who`/`note` marketing copy.
 *  The per-project worker ceiling used for the recommendation comes from
 *  tiers.ts (`trabajadoresMax`) — the single source of truth. */
const PLAN_META: Record<TierId, { metal: string; who: string; note: string }> = {
  gratis: { metal: '#33474a', who: '1 proyecto activo · hasta 3 trabajadores', note: 'Todas las funciones vida-crítica incluidas' },
  cobre: { metal: '#a85f32', who: '3 proyectos activos · 24 trabajadores por proyecto', note: 'Bajo el umbral de CPHS (25 por proyecto)' },
  plata: { metal: '#8c9598', who: '5 proyectos activos · hasta 99 trabajadores por proyecto', note: 'Desbloquea Comité Paritario (CPHS) — requerido desde 25 trabajadores por proyecto' },
  oro: { metal: '#b08733', who: '10 proyectos activos · hasta 499 trabajadores por proyecto', note: 'Desbloquea Depto. de Prevención — requerido desde 100 trabajadores por proyecto' },
  titanio: { metal: '#5e6e71', who: '20 proyectos activos · hasta 1.999 trabajadores por proyecto', note: 'Sin cobros extra · SSO' },
  platino: { metal: '#7c8b93', who: '30 proyectos activos · hasta 9.999 trabajadores por proyecto', note: 'Multi-tenant + ejecutivo de cuenta' },
  diamante: { metal: '#4fa3a0', who: '50 proyectos activos · trabajadores ilimitados', note: 'Multi-jurisdicción + residencia de datos por región' },
};

const clp = (n: number): string => (n === 0 ? '$0' : `$${n.toLocaleString('es-CL')}`);

/** Lowest tier whose per-project worker cap (tiers.ts) covers `workers`. */
function recommendFor(workers: number): Tier {
  return TIERS.find((t) => workers <= t.trabajadoresMax) ?? TIERS[TIERS.length - 1];
}

/** "165deg" metal wash → paper, from a #rrggbb metal. */
function metalGradient(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const rgb = `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
  return `linear-gradient(165deg, rgba(${rgb},0.18) 0%, rgba(${rgb},0.06) 44%, var(--pv-paper) 82%)`;
}

interface PricingSectionProps {
  onChoosePlan: () => void;
}

export function PricingSection({ onChoosePlan }: PricingSectionProps) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const [yearly, setYearly] = useState(false);
  const [workers, setWorkers] = useState(72);

  const rec = recommendFor(workers);
  const legal =
    workers >= 100
      ? 'Obligatorio Departamento de Prevención de Riesgos (≥100 por proyecto) · incluido desde el plan Oro'
      : workers >= 25
        ? 'Obligatorio Comité Paritario CPHS (≥25 por proyecto) · incluido desde el plan Plata'
        : 'A este tamaño no se exige Comité Paritario (umbral: 25 trabajadores por proyecto)';

  const reveal = (delay = 0) =>
    reduced
      ? {}
      : {
          initial: { opacity: 0, y: 24 },
          whileInView: { opacity: 1, y: 0 },
          viewport: { once: true, margin: '-60px' },
          transition: { duration: 0.6, delay, ease: 'easeOut' as const },
        };

  const free = TIERS[0];
  const paid = TIERS.slice(1);

  const choose = (e: MouseEvent) => {
    e.preventDefault();
    onChoosePlan();
  };

  return (
    <section id="planes" className="pv-section">
      <motion.div {...reveal()} style={{ maxWidth: '64ch', margin: '0 auto var(--pv-sp-4)' }}>
        <span className="pv-kicker" style={{ marginBottom: 'var(--pv-sp-2)' }}>
          {t('landing.lam.planes')}
        </span>
        <h2 className="pv-h2">{t('landing.pricing.title')}</h2>
        <p style={{ marginTop: 'var(--pv-sp-2)', color: 'var(--pv-ink-soft)' }}>{t('landing.pricing.subtitle')}</p>
      </motion.div>

      {/* controls: monthly/annual toggle + workers slider + live legal note */}
      <motion.div {...reveal(0.05)} className="pv-price-controls">
        <div className="pv-toggle" role="group" aria-label="Ciclo de facturación">
          <button type="button" className="pv-toggle-btn" aria-pressed={!yearly} onClick={() => setYearly(false)}>
            Mensual
          </button>
          <button type="button" className="pv-toggle-btn" aria-pressed={yearly} onClick={() => setYearly(true)}>
            Anual · ahorra 3 meses
          </button>
        </div>

        <div className="pv-slider-box">
          <label htmlFor="pv-workers" className="pv-mono pv-slider-label">
            Trabajadores por proyecto
          </label>
          <input
            id="pv-workers"
            type="range"
            min={1}
            max={10000}
            value={workers}
            onChange={(e) => setWorkers(Number(e.target.value) || 1)}
            className="pv-range"
          />
          <span className="pv-mono pv-slider-rec">
            <b>{workers.toLocaleString('es-CL')}</b> por proyecto → plan recomendado <b>{rec.nombre}</b>
          </span>
          <span className="pv-mono pv-slider-legal" data-on={workers >= 25}>
            {legal}
          </span>
        </div>
      </motion.div>

      {/* free plan — highlighted full-width row */}
      <motion.a
        {...reveal(0.1)}
        href="/login"
        onClick={choose}
        className="pv-plan-free"
        aria-label={t('landing.pricing.choose_plan', { name: free.nombre })}
      >
        <span className="pv-plan-free-name">
          <i className="pv-plan-dot" style={{ background: PLAN_META.gratis.metal }} aria-hidden="true" />
          {free.nombre}
        </span>
        <span className="pv-mono pv-plan-free-who">{PLAN_META.gratis.who}</span>
        <span className="pv-plan-free-price">
          $0 <small className="pv-mono">para siempre</small>
        </span>
        <span className="pv-plan-free-note">{PLAN_META.gratis.note}</span>
      </motion.a>

      {/* paid plans — metal cards */}
      <div className="pv-plan-grid">
        {paid.map((tier, i) => {
          const meta = PLAN_META[tier.id];
          const isRec = tier.id === rec.id;
          const price = yearly ? tier.clpAnual : tier.clpRegular;
          const per = yearly ? '/año · IVA incl.' : '/mes · IVA incl.';
          const sub = yearly ? 'ahorra 3 meses vs mensual' : `intro 3 meses: ${clp(tier.clpIntro3mo)}/mes`;
          return (
            <motion.a
              key={tier.id}
              {...reveal(0.12 + i * 0.05)}
              href="/login"
              onClick={choose}
              className="pv-plan-card"
              data-rec={isRec || undefined}
              style={{ background: metalGradient(meta.metal), borderTopColor: meta.metal }}
              aria-label={t('landing.pricing.choose_plan', { name: tier.nombre })}
            >
              {isRec && <span className="pv-plan-badge">Para tu dotación</span>}
              <span className="pv-plan-name">
                <i className="pv-plan-dot" style={{ background: meta.metal }} aria-hidden="true" />
                {tier.nombre}
              </span>
              <span className="pv-mono pv-plan-who">{meta.who}</span>
              <span className="pv-plan-price">
                {clp(price)} <small className="pv-mono">{per}</small>
              </span>
              <span className="pv-mono pv-plan-sub">{sub}</span>
              <span className="pv-plan-note">{meta.note}</span>
            </motion.a>
          );
        })}
      </div>

      <p className="pv-price-outro">
        <span className="pv-pulse-dot" aria-hidden="true" />
        Ten un buen día, cada día y así una buena vida
      </p>
    </section>
  );
}
