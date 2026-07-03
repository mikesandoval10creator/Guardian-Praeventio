/**
 * LÁM. 06 · GUARDIÁN — the close, on ink. The golden spiral rests in the
 * background (φ), the copihue blooms in technical line (life), and the
 * Guardián mascot welcomes the visitor in: protect the one who brings
 * bread home. Start free.
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
    <section className="pv-section pv-on-ink text-center" style={{ overflow: 'hidden', paddingTop: 'calc(var(--pv-sp-6) + 2rem)' }}>
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

      <motion.div {...reveal()} className="relative flex flex-col items-center">
        <div className="flex items-end" style={{ gap: 'var(--pv-sp-3)', marginBottom: 'var(--pv-sp-3)' }}>
          <CopihueLine delay={0.3} />
          <motion.img
            src="/mascots/guardian-default-trans.png"
            alt={t('landing.mascot_alt')}
            width={118}
            height={104}
            draggable={false}
            className={reduced ? 'select-none' : 'select-none pv-floaty'}
            style={{ objectFit: 'contain' }}
          />
        </div>

        <span className="pv-kicker" style={{ marginBottom: 'var(--pv-sp-2)' }}>
          {t('landing.lam.cierre')}
        </span>
        <h2 className="pv-h2" style={{ color: 'var(--pv-paper)' }}>
          {t('landing.final_cta.title_line_1')} <span className="pv-ac">{t('landing.final_cta.title_line_2')}</span>
        </h2>
        <p style={{ color: 'rgba(244,241,233,0.66)', margin: 'var(--pv-sp-3) auto var(--pv-sp-4)', maxWidth: '46ch', fontSize: 'var(--pv-t-1)', lineHeight: 1.45 }}>
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
      </motion.div>
    </section>
  );
}
