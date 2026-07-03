/**
 * Hero — the thesis. φ grid (61.8 / 38.2): the brand phrase
 * "5 minutos que pueden salvar tu vida" set in Fraunces, and the
 * scaffold-blueprint signature drawing itself over the golden spiral.
 */
import { motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { HeroBlueprint } from './BlueprintArt';

interface LandingHeroProps {
  onStart: () => void;
  onHowItWorks: () => void;
}

export function LandingHero({ onStart, onHowItWorks }: LandingHeroProps) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();

  const enter = (delay: number) =>
    reduced
      ? {}
      : {
          initial: { opacity: 0, y: 24 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.7, delay, ease: 'easeOut' as const },
        };

  return (
    <header className="pv-hero">
      <div>
        <motion.p {...enter(0)} className="pv-kicker" style={{ marginBottom: 'var(--pv-sp-3)' }}>
          {t('landing.hero.compliance_badge')}
        </motion.p>

        <motion.h1 {...enter(0.12)} className="pv-h1" style={{ marginBottom: 'var(--pv-sp-3)' }}>
          {t('landing.hero.title_line_1')}{' '}
          <span className="pv-ac">{t('landing.hero.title_line_2')}</span>
        </motion.h1>

        <motion.p
          {...enter(0.24)}
          style={{
            fontSize: 'var(--pv-t-1)',
            lineHeight: 1.4,
            color: 'var(--pv-ink-soft)',
            maxWidth: '36ch',
            marginBottom: 'var(--pv-sp-2)',
          }}
        >
          {t('landing.hero.subtitle')}
        </motion.p>

        <motion.p
          {...enter(0.32)}
          style={{ color: 'var(--pv-ink-soft)', maxWidth: '52ch', marginBottom: 'var(--pv-sp-4)' }}
        >
          {t('landing.hero.description')}
        </motion.p>

        <motion.div {...enter(0.4)} className="flex flex-wrap items-center" style={{ gap: 'var(--pv-sp-3)' }}>
          <button type="button" className="pv-btn-primary" onClick={onStart}>
            {t('landing.hero.cta_primary')}
          </button>
          <button type="button" className="pv-btn-ghost" onClick={onHowItWorks}>
            {t('landing.hero.cta_secondary')} ↓
          </button>
        </motion.div>

        <motion.p
          {...enter(0.5)}
          className="pv-mono"
          style={{ marginTop: 'var(--pv-sp-3)', fontSize: 'var(--pv-t--1)', color: 'var(--pv-ink-soft)', letterSpacing: '0.02em' }}
        >
          {t('landing.hero.free_tier_note')}
        </motion.p>
      </div>

      <div className="pv-hero-visual">
        <HeroBlueprint caption={t('landing.hero.blueprint_caption')} />
      </div>
    </header>
  );
}
