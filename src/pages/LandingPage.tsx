/**
 * Guardian Praeventio — public landing ("Plano Vivo").
 *
 * A technical blueprint that draws itself as you scroll. φ = 1.618 governs
 * type, spacing and layout (see components/landing/landing.css). Narrative:
 * paper (planning) → ink (the night emergency: LÁM. VIDA) → paper (system,
 * process, trust, plans) → ink (close). Life-safety is free, forever
 * (ADR 0021) — that is the heart of the message:
 * "5 minutos que pueden salvar tu vida."
 *
 * Renders OUTSIDE AppProviders (App.tsx) — everything here must be
 * self-contained: raw i18next (global instance), no app contexts.
 */
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

// Self-hosted display faces (latin subsets; JetBrains Mono already global).
import '@fontsource-variable/fraunces/index.css';
import '@fontsource-variable/fraunces/wght-italic.css';
import '@fontsource-variable/space-grotesk/index.css';

import '../components/landing/landing.css';
import { PublicEmergencyButton } from '../components/emergency/PublicEmergencyButton';
import { LandingNav } from '../components/landing/LandingNav';
import { LandingHero } from '../components/landing/LandingHero';
import { ComplianceStrip } from '../components/landing/ComplianceStrip';
import { SistemaSection } from '../components/landing/SistemaSection';
import { SecuritySection } from '../components/landing/SecuritySection';
import { PricingSection } from '../components/landing/PricingSection';
import { CierreSection } from '../components/landing/CierreSection';
import { LandingFooter } from '../components/landing/LandingFooter';
import { detectLandingLocale, APP_LOCALE_STORAGE_KEY, LANDING_GEO_FLAG_KEY } from '../components/landing/langDetect';
import { loadLocale } from '../i18n';

interface LandingPageProps {
  onEnter: () => void;
}

export function LandingPage({ onEnter }: LandingPageProps) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();

  /* document title + meta description, restored on unmount */
  useEffect(() => {
    const previousTitle = document.title;
    document.title = t('landing.meta.title');

    const description = t('landing.meta.description');
    let meta = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;
    let created = false;
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'description';
      document.head.appendChild(meta);
      created = true;
    }
    const previousDescription = meta.content;
    meta.content = description;

    return () => {
      document.title = previousTitle;
      if (meta) {
        if (created) {
          meta.remove();
        } else {
          meta.content = previousDescription;
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Geodetection (privacy-first: timezone + navigator.languages, no IP API).
     Runs ONCE per browser — after that the manual selector always wins. */
  useEffect(() => {
    try {
      // An explicit choice (manual selector or the app's LanguageProvider)
      // always wins over geodetection.
      if (window.localStorage.getItem(APP_LOCALE_STORAGE_KEY)) return;
      if (window.localStorage.getItem(LANDING_GEO_FLAG_KEY)) return;
      window.localStorage.setItem(LANDING_GEO_FLAG_KEY, '1');
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
      const target = detectLandingLocale(tz, navigator.languages ?? [navigator.language]);
      if (target && target !== i18n.resolvedLanguage) {
        void loadLocale(target).then(() => i18n.changeLanguage(target));
      }
    } catch {
      /* detector default stands */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* keep <html lang> in sync — a11y + SEO on the public page */
  useEffect(() => {
    const apply = (lng: string) => {
      document.documentElement.lang = lng;
    };
    apply(i18n.resolvedLanguage ?? 'es');
    i18n.on('languageChanged', apply);
    return () => {
      i18n.off('languageChanged', apply);
    };
  }, [i18n]);

  const handleEnter = () => {
    onEnter();
  };

  const handleLogin = () => {
    onEnter();
    setTimeout(() => navigate('/login'), 50);
  };

  const scrollToHow = () => {
    document.getElementById('sistema')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="pv-landing pv-grain min-h-screen">
      {/* Public, no-login emergency access (prototype-recovery #1): a person
          in crisis reaches first-aid + call-for-help in one tap from the
          public landing, BEFORE "Entrar". Self-contained — renders outside
          AppProviders. */}
      <PublicEmergencyButton />

      {/* Skip link — first Tab focus. WCAG 2.1 (2.4.1). */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:px-4 focus:py-2 focus:rounded-xl focus:font-bold focus:text-xs focus:uppercase focus:tracking-widest focus:shadow-2xl"
        style={{ background: 'var(--pv-teal)', color: 'var(--pv-paper)' }}
      >
        {t('landing.skip_to_content')}
      </a>

      <LandingNav onEnter={handleEnter} onLogin={handleLogin} />

      <main id="main-content" tabIndex={-1}>
        <LandingHero onStart={handleLogin} onHowItWorks={scrollToHow} />
        <ComplianceStrip />
        <SistemaSection />
        <SecuritySection />
        <PricingSection onChoosePlan={handleLogin} />
        <CierreSection onStart={handleEnter} />
      </main>

      <LandingFooter />
    </div>
  );
}
