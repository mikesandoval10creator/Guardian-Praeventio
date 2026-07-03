/**
 * LÁM. 05 · PLANES — pricing cards read REAL tiers from the single source
 * of truth (services/pricing/tiers.ts). NEVER hardcode plan names, prices
 * or worker counts here. Only the consumer ladder is shown as cards;
 * premium tiers (Titanio/Platino/Diamante) are acknowledged honestly in
 * the footnote. Metal rules use each plan's own material color — the
 * φ-gold (#B08733) stays reserved for geometry.
 */
import { motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Users, Layers, CheckCircle2 } from 'lucide-react';
import { TIERS, type Tier, type TierId } from '../../services/pricing/tiers';

interface PlanCard {
  tier: Tier;
  metal: string;
  popular?: boolean;
  recommended?: boolean;
}

const tierById = (id: TierId): Tier => TIERS.find((t) => t.id === id)!;

export const PLAN_CARDS: PlanCard[] = [
  { tier: tierById('gratis'), metal: 'var(--pv-ink-soft)' },
  { tier: tierById('cobre'), metal: '#b87333' },
  { tier: tierById('plata'), metal: '#8f9a9c', popular: true },
  { tier: tierById('oro'), metal: '#c9a227', recommended: true },
];

/** Monthly CLP price for a landing card: 0 → "Gratis", else "$1.234.567" (es-CL). */
export function formatTierPriceClp(clp: number): string {
  return clp === 0 ? 'Gratis' : `$${clp.toLocaleString('es-CL')}`;
}

interface PricingSectionProps {
  onChoosePlan: () => void;
}

export function PricingSection({ onChoosePlan }: PricingSectionProps) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();

  const reveal = (delay = 0) =>
    reduced
      ? {}
      : {
          initial: { opacity: 0, y: 28 },
          whileInView: { opacity: 1, y: 0 },
          viewport: { once: true, margin: '-60px' },
          transition: { duration: 0.7, delay, ease: 'easeOut' as const },
        };

  return (
    <section id="planes" className="pv-section">
      <motion.div {...reveal()} className="text-center" style={{ maxWidth: '58ch', margin: '0 auto var(--pv-sp-5)' }}>
        <span className="pv-kicker" style={{ marginBottom: 'var(--pv-sp-2)', display: 'inline-flex' }}>
          {t('landing.lam.planes')}
        </span>
        <h2 className="pv-h2">{t('landing.pricing.title')}</h2>
        <p style={{ marginTop: 'var(--pv-sp-2)', color: 'var(--pv-ink-soft)' }}>{t('landing.pricing.subtitle')}</p>
      </motion.div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4" style={{ gap: 'var(--pv-sp-3)', maxWidth: 1200, margin: '0 auto' }}>
        {PLAN_CARDS.map(({ tier, metal, popular, recommended }, i) => (
          <motion.a
            key={tier.id}
            {...reveal(0.06 + i * 0.09)}
            href="/login"
            onClick={(e) => {
              e.preventDefault();
              onChoosePlan();
            }}
            className="pv-plan"
            style={popular ? { borderColor: 'var(--pv-teal)' } : undefined}
            aria-label={t('landing.pricing.choose_plan', { name: tier.nombre })}
          >
            <span className="pv-plan-metal" style={{ background: metal }} aria-hidden="true" />
            {popular && (
              <span className="pv-plan-pill" style={{ background: 'var(--pv-teal)', color: 'var(--pv-paper)' }}>
                {t('landing.pricing.popular_badge')}
              </span>
            )}
            {recommended && (
              <span className="pv-plan-pill" style={{ background: '#c9a227', color: 'var(--pv-ink)' }}>
                {t('landing.pricing.recommended_badge')}
              </span>
            )}

            <p className="pv-mono" style={{ fontSize: 'var(--pv-t--1)', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--pv-ink-soft)' }}>
              {tier.nombre}
            </p>
            <p className="pv-serif" style={{ fontSize: 'var(--pv-t-2)', lineHeight: 1, letterSpacing: '-0.02em' }}>
              {formatTierPriceClp(tier.clpRegular)}
              {tier.clpRegular > 0 && (
                <span style={{ fontSize: 'var(--pv-t--1)', fontFamily: "'Space Grotesk Variable','Space Grotesk',sans-serif", color: 'var(--pv-ink-soft)' }}>
                  {' '}
                  /{t('landing.pricing.per_month')}
                </span>
              )}
            </p>
            {tier.clpAnual > 0 && (
              <p style={{ fontSize: 'var(--pv-t--1)', fontWeight: 600, color: 'var(--pv-teal)', marginTop: '-0.2rem' }}>
                {t('landing.pricing.annual', { price: formatTierPriceClp(tier.clpAnual) })}
              </p>
            )}

            <div style={{ display: 'grid', gap: '0.35rem', color: 'var(--pv-ink-soft)', margin: '0.4rem 0' }}>
              <span className="flex items-center" style={{ gap: '0.45rem', fontSize: 'var(--pv-t--1)', fontWeight: 600 }}>
                <Users size={13} aria-hidden="true" />
                {t('landing.pricing.workers_line', { n: tier.trabajadoresMax })}
              </span>
              <span className="flex items-center" style={{ gap: '0.45rem', fontSize: 'var(--pv-t--1)', fontWeight: 600 }}>
                <Layers size={13} aria-hidden="true" />
                {t('landing.pricing.projects_line', { n: tier.proyectosMax })}
              </span>
            </div>

            <ul className="list-none p-0 m-0" style={{ display: 'grid', gap: '0.4rem' }}>
              {(['b1', 'b2', 'b3'] as const).map((k) => (
                <li key={k} className="flex items-start" style={{ gap: '0.45rem' }}>
                  <CheckCircle2 size={12} style={{ color: 'var(--pv-teal)', flex: 'none', marginTop: 3 }} aria-hidden="true" />
                  <span style={{ fontSize: 'var(--pv-t--1)', lineHeight: 1.5 }}>{t(`landing.pricing.includes.${tier.id}.${k}`)}</span>
                </li>
              ))}
            </ul>
          </motion.a>
        ))}
      </div>

      <p className="text-center pv-mono" style={{ marginTop: 'var(--pv-sp-4)', fontSize: 'var(--pv-t--1)', color: 'var(--pv-ink-soft)' }}>
        {t('landing.pricing.footnote')}
      </p>
      <p
        className="text-center"
        style={{ maxWidth: '72ch', margin: '0.8rem auto 0', fontSize: '0.68rem', lineHeight: 1.5, color: 'var(--pv-ink-soft)', opacity: 0.85 }}
      >
        {t('landing.pricing.regulatory_note')}
      </p>
    </section>
  );
}
