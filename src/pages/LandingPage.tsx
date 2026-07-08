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
import { useEffect, useRef } from 'react';
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
import { toHtmlLang } from '../i18n/rtl';

interface LandingPageProps {
  onEnter: () => void;
}

export function LandingPage({ onEnter }: LandingPageProps) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const andamioRef = useRef<HTMLDivElement>(null);

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
      document.documentElement.lang = toHtmlLang(lng) ?? lng;
    };
    apply(i18n.resolvedLanguage ?? 'es');
    i18n.on('languageChanged', apply);
    return () => {
      i18n.off('languageChanged', apply);
    };
  }, [i18n]);

  /* Andamio vivo — the scaffold grows down the page margins with the scroll
     (ported from the Claude Design support.js `_buildZig`). Only drawn where
     there is a free gutter beside the centred content; hidden on narrow
     viewports and static under prefers-reduced-motion. */
  useEffect(() => {
    const layer = andamioRef.current;
    if (!layer) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let rows: { el: SVGGElement; py: number }[] = [];

    const build = () => {
      const W = Math.max(320, window.innerWidth);
      const H = document.documentElement.scrollHeight;
      const gutter = (W - 1360) / 2; // free margin beside the 1360px content column
      if (gutter < 110) {
        layer.innerHTML = '';
        rows = [];
        return;
      }
      const cell = Math.max(84, Math.round(Math.max(104, Math.min(150, gutter / 2))));
      const rightXs: number[] = [];
      for (let x = Math.round(W - gutter + 18); x <= W + cell; x += cell) rightXs.push(x);
      const leftXs = rightXs.map((x) => Math.round(W - x)).sort((a, b) => a - b);
      const startY = Math.round(window.innerHeight * 0.82);
      const band = (xs: number[], y: number, r: number) => {
        let s = `<line x1="${xs[0]}" y1="${y}" x2="${xs[xs.length - 1]}" y2="${y}" stroke="#0F7C6E" stroke-width="1.1" opacity="0.32"/>`;
        for (let c = 0; c < xs.length; c++) {
          s += `<line x1="${xs[c]}" y1="${y}" x2="${xs[c]}" y2="${y + cell}" stroke="#0F7C6E" stroke-width="1.1" opacity="0.32"/>`;
          s += `<circle cx="${xs[c]}" cy="${y}" r="2.4" fill="#0F7C6E" opacity="0.42"/>`;
          if (c < xs.length - 1) {
            const a = (r + c) % 2 === 0;
            s += `<line x1="${xs[a ? c : c + 1]}" y1="${y}" x2="${xs[a ? c + 1 : c]}" y2="${y + cell}" stroke="#17B6A3" stroke-width="0.8" opacity="0.24"/>`;
          }
        }
        return s;
      };
      let g = '';
      for (let y = startY, r = 0; y < H - 30; y += cell, r++) {
        g += `<g data-py="${y}" style="opacity:${reduced ? 1 : 0};transition:opacity .6s ease">${band(rightXs, y, r)}${band(leftXs, y, r)}</g>`;
      }
      layer.innerHTML = `<svg width="100%" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="position:absolute;top:0;left:0;overflow:visible">${g}</svg>`;
      rows = Array.from(layer.querySelectorAll<SVGGElement>('g[data-py]')).map((el) => ({
        el,
        py: parseFloat(el.getAttribute('data-py') || '0'),
      }));
    };

    const onScroll = () => {
      if (reduced) return;
      const front = window.scrollY + window.innerHeight * 0.85;
      for (const rw of rows) rw.el.style.opacity = front >= rw.py ? '1' : '0';
    };
    const onResize = () => {
      build();
      onScroll();
    };

    build();
    onScroll();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

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
      {/* Andamio vivo — scaffold that grows down the page margins with scroll. */}
      <div className="pv-andamio" aria-hidden="true" ref={andamioRef} />

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
