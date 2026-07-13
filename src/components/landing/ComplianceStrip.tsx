/**
 * Compliance marquee — regulatory frameworks + reference bodies Guardian
 * helps comply with, in blueprint mono. NOT an endorsement: the disclaimer
 * below the strip (landing.trust.disclaimer) makes that explicit and the
 * list intentionally omits OHSAS 18001 (superseded by ISO 45001).
 */
import { useTranslation } from 'react-i18next';

// Keep aligned with tests/e2e/landing.spec.ts ("compliance badges row renders all 7").
export const COMPLIANCE_BADGES = ['DS 44/2024', 'Ley 16.744', 'ISO 45001', 'SUSESO', 'ISL', 'ACHS', 'IST'] as const;

export function ComplianceStrip() {
  const { t } = useTranslation();
  const items = [...COMPLIANCE_BADGES, t('landing.trust.data_residency_badge'), t('landing.trust.audit_badge')];

  return (
    <section aria-label={t('landing.trust.aria_label')}>
      <div className="pv-strip">
        <div className="pv-strip-track">
          {[0, 1].map((dup) => (
            <span key={dup} aria-hidden={dup === 1} className="contents">
              {items.map((label) => (
                <span key={`${dup}-${label}`}>{label}</span>
              ))}
            </span>
          ))}
        </div>
      </div>
      <p
        className="text-center"
        style={{
          maxWidth: '72ch',
          margin: '0.8rem auto 0',
          padding: '0 var(--pv-edge)',
          fontSize: '0.68rem',
          color: 'var(--pv-ink-soft)',
          opacity: 0.85,
          lineHeight: 1.5,
        }}
      >
        {t('landing.trust.disclaimer')}
      </p>
    </section>
  );
}
