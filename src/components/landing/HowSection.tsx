/**
 * LÁM. 03 · PROCESO — the existing 3-step flow (Registra → La IA analiza →
 * Cumplimiento automático) restyled as a blueprint process line with a
 * drawn connector and mono step cotas. Copy keys unchanged (e2e pins them).
 */
import { motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Mic, Brain, FileText } from 'lucide-react';

const STEPS = [
  { n: 1, id: 'step1', icon: Mic },
  { n: 2, id: 'step2', icon: Brain },
  { n: 3, id: 'step3', icon: FileText },
] as const;

export function HowSection() {
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
    <section id="como-funciona" className="pv-section" style={{ borderTop: '1px solid var(--pv-line)' }}>
      <motion.div {...reveal()} style={{ maxWidth: '58ch', marginBottom: 'var(--pv-sp-5)' }}>
        <span className="pv-kicker" style={{ marginBottom: 'var(--pv-sp-2)', display: 'inline-flex' }}>
          {t('landing.lam.proceso')} — {t('landing.how.eyebrow')}
        </span>
        <h2 className="pv-h2">{t('landing.how.title')}</h2>
        <p style={{ marginTop: 'var(--pv-sp-2)', color: 'var(--pv-ink-soft)' }}>{t('landing.how.subtitle')}</p>
      </motion.div>

      <div className="relative grid md:grid-cols-3" style={{ gap: 'var(--pv-sp-3)' }}>
        {/* drawn connector — desktop only */}
        <svg
          className="hidden md:block absolute pointer-events-none"
          style={{ top: 30, left: '12%', width: '76%', height: 4, overflow: 'visible' }}
          aria-hidden="true"
        >
          <motion.line
            x1="0"
            y1="2"
            x2="100%"
            y2="2"
            style={{ stroke: 'var(--pv-teal)' }}
            strokeWidth="1.2"
            strokeDasharray="6 5"
            initial={reduced ? { pathLength: 1 } : { pathLength: 0 }}
            whileInView={reduced ? undefined : { pathLength: 1 }}
            viewport={{ once: true }}
            transition={reduced ? undefined : { duration: 1.6, ease: 'easeInOut' }}
          />
        </svg>

        {STEPS.map((s, i) => (
          <motion.div key={s.n} {...reveal(0.1 + i * 0.12)} className="pv-notarial relative" style={{ background: 'var(--pv-paper)' }}>
            <div className="flex items-center" style={{ gap: '0.8rem', marginBottom: 'var(--pv-sp-2)' }}>
              <span
                className="pv-mono flex items-center justify-center"
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: '50%',
                  border: '1.4px solid var(--pv-teal)',
                  color: 'var(--pv-teal)',
                  fontSize: 'var(--pv-t-0)',
                  background: 'var(--pv-paper)',
                  position: 'relative',
                  zIndex: 1,
                }}
                aria-hidden="true"
              >
                {s.n}
              </span>
              <s.icon size={18} style={{ color: 'var(--pv-teal)' }} aria-hidden="true" />
            </div>
            <h3 style={{ fontWeight: 600, fontSize: 'var(--pv-t-1)', letterSpacing: '-0.01em', marginBottom: '0.4rem' }}>
              {t(`landing.how.${s.id}.title`)}
            </h3>
            <p style={{ fontSize: 'var(--pv-t-0)', color: 'var(--pv-ink-soft)' }}>{t(`landing.how.${s.id}.desc`)}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
