/**
 * LÁM. 05 · PLANES — matches the Claude Design landing 1:1, fully i18n'd
 * (es/en/pt-BR under `landing.dc.*`). Prices come from the single source of
 * truth (services/pricing/tiers.ts); the per-project worker ceiling used for
 * the slider recommendation is tiers.ts `trabajadoresMax`. φ-gold stays for
 * geometry; each card uses its plan's own material colour.
 */
import { useState, type MouseEvent } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { TIERS, type Tier, type TierId } from '../../services/pricing/tiers';

/** Material colour per tier (design palette). */
const METAL: Record<TierId, string> = {
  gratis: '#33474a',
  cobre: '#a85f32',
  plata: '#8c9598',
  oro: '#b08733',
  titanio: '#5e6e71',
  platino: '#7c8b93',
  diamante: '#4fa3a0',
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
      ? t('landing.dc.legal_dprp')
      : workers >= 25
        ? t('landing.dc.legal_cphs')
        : t('landing.dc.legal_none');

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
        <div className="pv-toggle" role="group" aria-label={t('landing.dc.toggle_monthly')}>
          <button type="button" className="pv-toggle-btn" aria-pressed={!yearly} onClick={() => setYearly(false)}>
            {t('landing.dc.toggle_monthly')}
          </button>
          <button type="button" className="pv-toggle-btn" aria-pressed={yearly} onClick={() => setYearly(true)}>
            {t('landing.dc.toggle_annual')}
          </button>
        </div>

        <div className="pv-slider-box">
          <label htmlFor="pv-workers" className="pv-mono pv-slider-label">
            {t('landing.dc.slider_label')}
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
            {t('landing.dc.rec_line', { n: workers.toLocaleString('es-CL'), plan: rec.nombre })}
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
          <i className="pv-plan-dot" style={{ background: METAL.gratis }} aria-hidden="true" />
          {free.nombre}
        </span>
        <span className="pv-mono pv-plan-free-who">{t('landing.dc.who_gratis')}</span>
        <span className="pv-plan-free-price">
          $0 <small className="pv-mono">{t('landing.dc.free_forever')}</small>
        </span>
        <span className="pv-plan-free-note">{t('landing.dc.note_gratis')}</span>
      </motion.a>

      {/* paid plans — metal cards */}
      <div className="pv-plan-grid">
        {paid.map((tier, i) => {
          const isRec = tier.id === rec.id;
          const price = yearly ? tier.clpAnual : tier.clpRegular;
          const per = yearly ? t('landing.dc.per_year') : t('landing.dc.per_month');
          const sub = yearly
            ? t('landing.dc.sub_annual')
            : t('landing.dc.sub_intro', { price: clp(tier.clpIntro3mo) });
          return (
            <motion.a
              key={tier.id}
              {...reveal(0.12 + i * 0.05)}
              href="/login"
              onClick={choose}
              className="pv-plan-card"
              data-rec={isRec || undefined}
              style={{ background: metalGradient(METAL[tier.id]), borderTopColor: METAL[tier.id] }}
              aria-label={t('landing.pricing.choose_plan', { name: tier.nombre })}
            >
              {isRec && <span className="pv-plan-badge">{t('landing.dc.recommended_for')}</span>}
              <span className="pv-plan-name">
                <i className="pv-plan-dot" style={{ background: METAL[tier.id] }} aria-hidden="true" />
                {tier.nombre}
              </span>
              <span className="pv-mono pv-plan-who">{t(`landing.dc.who_${tier.id}`)}</span>
              <span className="pv-plan-price">
                {clp(price)} <small className="pv-mono">{per}</small>
              </span>
              <span className="pv-mono pv-plan-sub">{sub}</span>
              <span className="pv-plan-note">{t(`landing.dc.note_${tier.id}`)}</span>
            </motion.a>
          );
        })}
      </div>

      <p className="pv-price-outro">
        <span className="pv-pulse-dot" aria-hidden="true" />
        {t('landing.dc.outro')}
      </p>
    </section>
  );
}
