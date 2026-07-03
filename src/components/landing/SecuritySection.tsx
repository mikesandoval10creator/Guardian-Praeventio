/**
 * LÁM. 04 · CONFIANZA — the bank section, set on shaded paper with a
 * notarial double-rule treatment: data residency in Chile/LATAM
 * (Ley 19.628 / 21.719), on-device encryption + biometrics, immutable
 * audit trail (DS 44) and backups. Copy keys unchanged.
 */
import { motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Server, Lock, ScrollText, Database } from 'lucide-react';

const PILLARS = [
  { id: 'residency', icon: Server },
  { id: 'encryption', icon: Lock },
  { id: 'audit', icon: ScrollText },
  { id: 'backups', icon: Database },
] as const;

export function SecuritySection() {
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
    <section id="seguridad" className="pv-section pv-on-paper2">
      <motion.div {...reveal()} className="text-center" style={{ maxWidth: '58ch', margin: '0 auto var(--pv-sp-5)' }}>
        <span className="pv-kicker" style={{ marginBottom: 'var(--pv-sp-2)', display: 'inline-flex' }}>
          {t('landing.lam.confianza')} — {t('landing.security.eyebrow')}
        </span>
        <h2 className="pv-h2">{t('landing.security.title')}</h2>
        <p style={{ marginTop: 'var(--pv-sp-2)', color: 'var(--pv-ink-soft)' }}>{t('landing.security.subtitle')}</p>
      </motion.div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4" style={{ gap: 'var(--pv-sp-3)', maxWidth: 1200, margin: '0 auto' }}>
        {PILLARS.map((pillar, i) => (
          <motion.article key={pillar.id} {...reveal(0.08 + i * 0.09)} className="pv-notarial">
            <pillar.icon size={20} style={{ color: 'var(--pv-teal)', marginBottom: 'var(--pv-sp-2)' }} aria-hidden="true" />
            <h3 style={{ fontWeight: 600, fontSize: 'var(--pv-t-0)', letterSpacing: '-0.01em', marginBottom: '0.45rem' }}>
              {t(`landing.security.${pillar.id}.title`)}
            </h3>
            <p style={{ fontSize: 'var(--pv-t--1)', lineHeight: 1.6, color: 'var(--pv-ink-soft)' }}>
              {t(`landing.security.${pillar.id}.desc`)}
            </p>
          </motion.article>
        ))}
      </div>

      <p
        className="text-center"
        style={{ maxWidth: '72ch', margin: 'var(--pv-sp-4) auto 0', fontSize: '0.68rem', lineHeight: 1.5, color: 'var(--pv-ink-soft)', opacity: 0.85 }}
      >
        {t('landing.security.disclaimer')}
      </p>
    </section>
  );
}
