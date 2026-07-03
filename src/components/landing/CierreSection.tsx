/**
 * LÁM. 06 · CIERRE — the close, on ink. Left: the promise ("today's facts in a
 * filing cabinet become living evidence tomorrow") + the free CTA. Right: the
 * brand lockup in a white card, framed by two slow rings and a gentle bob
 * (2026-07 design). The copihue blooms small — life — and the φ spiral rests
 * in the background.
 */
import { motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { CopihueLine } from './BlueprintArt';

interface CierreSectionProps {
  onStart: () => void;
}

export function CierreSection({ onStart }: CierreSectionProps) {
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
    <section className="pv-section pv-on-ink" style={{ overflow: 'hidden', paddingTop: 'calc(var(--pv-sp-6) + 2rem)' }}>
      <div className="pv-fold-edge-top" aria-hidden="true" />

      {/* φ spiral resting in the background */}
      <svg
        viewBox="0 0 400 400"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ opacity: 0.1 }}
        aria-hidden="true"
      >
        <path
          d="M247 297 a144 144 0 0 1 -144 -144 a89 89 0 0 1 89 -89 a55 55 0 0 1 55 55 a34 34 0 0 1 -34 34 a21 21 0 0 1 -21 -21"
          style={{ stroke: 'var(--pv-gold)', fill: 'none' }}
          strokeWidth="1.4"
        />
      </svg>

      <div className="pv-cierre-grid">
        <motion.div {...reveal()}>
          <span className="pv-kicker" style={{ marginBottom: 'var(--pv-sp-2)', display: 'inline-flex' }}>
            {t('landing.lam.cierre')}
          </span>
          <h2 className="pv-h2" style={{ color: 'var(--pv-paper)' }}>
            {t('landing.final_cta.title_line_1')} <span className="pv-ac">{t('landing.final_cta.title_line_2')}</span>
          </h2>
          <p style={{ color: 'rgba(244,241,233,0.66)', margin: 'var(--pv-sp-3) 0 var(--pv-sp-4)', maxWidth: '48ch', fontSize: 'var(--pv-t-1)', lineHeight: 1.45 }}>
            {t('landing.final_cta.subtitle')}
          </p>
          <button
            type="button"
            onClick={onStart}
            className="pv-btn-primary"
            style={{ background: 'var(--pv-mist)', color: 'var(--pv-ink)', boxShadow: '0 10px 30px -12px rgba(207,224,219,0.5)' }}
          >
            {t('landing.final_cta.button')}
          </button>
          <div className="flex items-center" style={{ gap: 'var(--pv-sp-3)', marginTop: 'var(--pv-sp-4)' }}>
            <CopihueLine delay={0.4} />
            <p className="pv-mono" style={{ fontSize: 'var(--pv-t--1)', color: 'rgba(244,241,233,0.6)', letterSpacing: '0.03em', margin: 0 }}>
              {t('landing.dc.no_card')}
            </p>
          </div>
        </motion.div>

        <motion.div {...reveal(0.12)} className="pv-cierre-logo-wrap">
          <svg viewBox="0 0 300 300" aria-hidden="true" className="pv-cierre-rings">
            <circle cx="150" cy="150" r="142" fill="none" stroke="var(--pv-teal-bright)" strokeWidth="1" strokeDasharray="3 10" opacity="0.4">
              {!reduced && (
                <animateTransform attributeName="transform" type="rotate" from="0 150 150" to="360 150 150" dur="50s" repeatCount="indefinite" />
              )}
            </circle>
            <circle cx="150" cy="150" r="118" fill="none" stroke="var(--pv-teal)" strokeWidth="1" strokeDasharray="1 14" opacity="0.35">
              {!reduced && (
                <animateTransform attributeName="transform" type="rotate" from="360 150 150" to="0 150 150" dur="66s" repeatCount="indefinite" />
              )}
            </circle>
          </svg>
          <div className={reduced ? 'pv-cierre-logo-card' : 'pv-cierre-logo-card pv-floaty'}>
            <img src="/brand/logo%20guardian%20praeventio.jpg" alt="Guardian Praeventio" />
          </div>
        </motion.div>
      </div>
    </section>
  );
}
