/**
 * Landing nav — brand mark, always-visible language selector (launch pills
 * ES / PT / EN + compact select with every shipped locale) and the two
 * entry actions. Fixed, paper-translucent, hairline bottom rule.
 */
import { useTranslation } from 'react-i18next';
import { loadLocale } from '../../i18n';
import { LANDING_SUPPORTED_LOCALES } from './langDetect';

const PILL_LOCALES = [
  { tag: 'es', label: 'ES' },
  { tag: 'pt-BR', label: 'PT' },
  { tag: 'en', label: 'EN' },
] as const;

interface LandingNavProps {
  onEnter: () => void;
  onLogin: () => void;
}

export function LandingNav({ onEnter, onLogin }: LandingNavProps) {
  const { t, i18n } = useTranslation();
  const active = i18n.resolvedLanguage ?? i18n.language ?? 'es';

  const changeLang = (tag: string) => {
    void loadLocale(tag).then(() => i18n.changeLanguage(tag));
  };

  return (
    <nav className="pv-nav">
      <div className="flex items-center gap-2.5">
        <img className="pv-nav-logo" src="/brand/logo%20guardian%20praeventio.jpg" alt="" aria-hidden="true" />
        <span className="leading-tight">
          <span className="font-semibold tracking-tight">
            Guardian <b style={{ color: 'var(--pv-teal)' }}>Praeventio</b>
          </span>
          {/* ponytail: fixed brand tagline, inline (not i18n) — matches the design lockup */}
          <span className="pv-nav-tagline">Tu aplicación de prevención de riesgos</span>
        </span>
      </div>

      <div className="flex items-center gap-4 sm:gap-6">
        <div className="flex items-center gap-1" role="group" aria-label={t('landing.lang.label')}>
          {PILL_LOCALES.map(({ tag, label }) => (
            <button
              key={tag}
              type="button"
              className="pv-lang-btn"
              aria-pressed={active === tag || active.startsWith(`${tag}-`) || (tag === 'es' && active.startsWith('es'))}
              onClick={() => changeLang(tag)}
            >
              {label}
            </button>
          ))}
          <select
            className="pv-lang-select"
            aria-label={t('landing.lang.more')}
            value={LANDING_SUPPORTED_LOCALES.includes(active as (typeof LANDING_SUPPORTED_LOCALES)[number]) ? active : 'es'}
            onChange={(e) => changeLang(e.target.value)}
          >
            {LANDING_SUPPORTED_LOCALES.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={onLogin}
          className="pv-btn-ghost hidden sm:block"
          style={{ fontSize: 'var(--pv-t--1)' }}
        >
          {t('landing.nav.login')}
        </button>
        <button
          type="button"
          onClick={onEnter}
          className="pv-btn-primary pv-btn-ink"
          style={{ padding: '0.6rem 1.2rem', fontSize: 'var(--pv-t--1)' }}
        >
          {t('landing.nav.enter')}
        </button>
      </div>
    </nav>
  );
}
