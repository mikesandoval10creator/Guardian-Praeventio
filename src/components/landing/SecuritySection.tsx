/**
 * LÁM. 04 · CONFIANZA — the bank/mining section: data residency in Chile
 * (Ley 19.628 / 21.719), end-to-end encryption, on-device biometrics that
 * never travel, immutable audit trail (DS 44), verified backups and ISO 45001.
 * The pensativo guardian anchors it, framed by two slow HUD rings (2026-07 design).
 */
import { motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Server, Lock, Fingerprint, ScrollText, Database, ShieldCheck } from 'lucide-react';

const PILLARS = [
  { id: 'residency', icon: Server },
  { id: 'encryption', icon: Lock },
  { id: 'biometria', icon: Fingerprint },
  { id: 'audit', icon: ScrollText },
  { id: 'backups', icon: Database },
  { id: 'iso', icon: ShieldCheck },
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
      <div className="pv-sec-head">
        <motion.div {...reveal()}>
          <span className="pv-kicker" style={{ marginBottom: 'var(--pv-sp-2)', display: 'inline-flex' }}>
            {t('landing.lam.confianza')} — {t('landing.security.eyebrow')}
          </span>
          <h2 className="pv-h2">{t('landing.security.title')}</h2>
          <p style={{ marginTop: 'var(--pv-sp-2)', color: 'var(--pv-ink-soft)', maxWidth: '52ch' }}>
            {t('landing.security.subtitle')}
          </p>
        </motion.div>

        <motion.div {...reveal(0.1)} className="pv-sec-guardian">
          <svg viewBox="0 0 300 300" aria-hidden="true" className="pv-sec-rings">
            <circle cx="150" cy="150" r="140" fill="none" stroke="var(--pv-teal)" strokeWidth="1" strokeDasharray="3 10" opacity="0.4">
              {!reduced && (
                <animateTransform attributeName="transform" type="rotate" from="0 150 150" to="360 150 150" dur="54s" repeatCount="indefinite" />
              )}
            </circle>
            <circle cx="150" cy="150" r="116" fill="none" stroke="var(--pv-teal-bright)" strokeWidth="1" strokeDasharray="1 14" opacity="0.35">
              {!reduced && (
                <animateTransform attributeName="transform" type="rotate" from="360 150 150" to="0 150 150" dur="72s" repeatCount="indefinite" />
              )}
            </circle>
          </svg>
          <img src="/mascots/guardian-pensativo-trans.png" alt="" aria-hidden="true" className="pv-sec-mascot" />
        </motion.div>
      </div>

      <div className="pv-sec-grid">
        {PILLARS.map((pillar, i) => (
          <motion.article key={pillar.id} {...reveal(0.06 + i * 0.07)} className="pv-notarial">
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
