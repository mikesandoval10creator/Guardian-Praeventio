/**
 * LÁM. 05 · PLANES — pricing reads REAL tiers from the single source of truth
 * (services/pricing/tiers.ts). NEVER hardcode plan names, prices, worker or
 * project counts here. Layout follows the Claude Design landing (2026-07):
 * monthly/annual toggle + a workers slider that recommends a plan and shows
 * the CPHS/DPRP legal threshold, then the free row + the paid metal cards.
 * φ-gold (#B08733) stays reserved for geometry — cards use each plan's metal.
 * Control copy is inline es-CL (ponytail: the design ships Spanish-only; header
 * strings stay i18n).
 */
import { useState, type MouseEvent } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { TIERS, type Tier, type TierId } from '../../services/pricing/tiers';

/** Material colour per tier (design palette). Not φ-gold except Oro's own metal. */
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
const cap = (n: number): string => (Number.isFinite(n) ? n.toLocaleString('es-CL') : 'ilimitados');

/** Lowest tier whose worker cap covers `workers` (falls through to Diamante). */
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
      ? 'Obligatorio Departamento de Prevención de Riesgos (≥100) · incluido desde el plan Oro'
      : workers >= 25
        ? 'Obligatorio Comité Paritario CPHS (≥25) · incluido desde el plan Plata'
        : 'A este tamaño no se exige Comité Paritario (umbral: 25 trabajadores)';

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
      <motion.div {...reveal()} style={{ maxWidth: '62ch', margin: '0 auto var(--pv-sp-4)' }}>
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
            Trabajadores en tu faena más grande
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
            <b>{workers.toLocaleString('es-CL')}</b> trabajadores → plan recomendado <b>{rec.nombre}</b>
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
        <span className="pv-mono pv-plan-free-who">
          {free.proyectosMax} proyecto · hasta {cap(free.trabajadoresMax)} trabajadores
        </span>
        <span className="pv-plan-free-price">
          $0 <small className="pv-mono">para siempre</small>
        </span>
        <span className="pv-plan-free-note">Todas las funciones vida-crítica incluidas</span>
      </motion.a>

      {/* paid plans — metal cards */}
      <div className="pv-plan-grid">
        {paid.map((tier, i) => {
          const isRec = tier.id === rec.id;
          const price = yearly ? tier.clpAnual : tier.clpRegular;
          const per = yearly ? '/año · IVA incl.' : '/mes · IVA incl.';
          const sub = yearly
            ? 'ahorra 3 meses vs mensual'
            : `intro 3 meses: ${clp(tier.clpIntro3mo)}/mes`;
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
              {isRec && <span className="pv-plan-badge">Para tu dotación</span>}
              <span className="pv-plan-name">
                <i className="pv-plan-dot" style={{ background: METAL[tier.id] }} aria-hidden="true" />
                {tier.nombre}
              </span>
              <span className="pv-mono pv-plan-who">
                {cap(tier.proyectosMax)} proyectos · hasta {cap(tier.trabajadoresMax)} trabajadores
              </span>
              <span className="pv-plan-price">
                {clp(price)} <small className="pv-mono">{per}</small>
              </span>
              <span className="pv-mono pv-plan-sub">{sub}</span>
            </motion.a>
          );
        })}
      </div>

      <p
        className="text-center"
        style={{ maxWidth: '72ch', margin: 'var(--pv-sp-4) auto 0', fontSize: '0.68rem', lineHeight: 1.5, color: 'var(--pv-ink-soft)', opacity: 0.85 }}
      >
        {t('landing.pricing.regulatory_note')}
      </p>
    </section>
  );
}
