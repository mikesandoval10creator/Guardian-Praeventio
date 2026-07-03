// @vitest-environment jsdom
/**
 * Landing "Plano Vivo" — render contract.
 *
 * Pins the three invariants the redesign must never break:
 *   1. Prices/limits come from tiers.ts (single source of truth) — the
 *      cards render the REAL numbers, never hardcoded marketing copy.
 *   2. The brand phrase "5 minutos que pueden salvar tu vida" is the H1.
 *   3. Compliance badges render with the non-endorsement disclaimer and
 *      the vida section declares life-safety free, forever (ADR 0021).
 *
 * The real src/i18n module is mocked with a self-contained instance: its
 * import-time LanguageDetector reads document.cookie, which leaks an async
 * handle under jsdom (vitest 4 flags it) and adds non-determinism.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LandingPage } from './LandingPage';
import { TIERS } from '../services/pricing/tiers';
import { COMPLIANCE_BADGES } from '../components/landing/ComplianceStrip';
import { LANDING_GEO_FLAG_KEY } from '../components/landing/langDetect';

// Self-contained i18n: Spanish resources, no browser detector, no side effects.
vi.mock('../i18n', async () => {
  const { createInstance } = await import('i18next');
  const { initReactI18next } = await import('react-i18next');
  const esCommon = (await import('../i18n/locales/es/common.json')).default;
  const instance = createInstance();
  await instance.use(initReactI18next).init({
    lng: 'es',
    fallbackLng: 'es',
    ns: ['common', 'translation'],
    defaultNS: 'translation',
    resources: { es: { common: esCommon, translation: esCommon } },
    interpolation: { escapeValue: false },
  });
  return { default: instance, loadLocale: async () => {}, resources: {} };
});

// Self-contained overlay tested elsewhere; not the subject of this contract.
vi.mock('../components/emergency/PublicEmergencyButton', () => ({
  PublicEmergencyButton: () => null,
}));

// jsdom lacks the observers framer-motion uses for whileInView.
class IO {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

beforeAll(() => {
  vi.stubGlobal('IntersectionObserver', IO as unknown as typeof IntersectionObserver);
  {
    // Override jsdom's matchMedia to report prefers-reduced-motion, so
    // framer-motion starts no animations (jsdom can't run them; their
    // pending promises would be flagged as leaks by vitest 4). Bonus: the
    // suite exercises the reduced-motion path — the plano arrives drawn.
    vi.stubGlobal(
      'matchMedia',
      (query: string) =>
        ({
          matches: query.includes('prefers-reduced-motion'),
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          dispatchEvent: () => false,
          onchange: null,
        }) as unknown as MediaQueryList,
    );
  }
  // Deterministic: geodetection flag set → the effect is a no-op.
  window.localStorage.setItem(LANDING_GEO_FLAG_KEY, '1');
});

function renderLanding() {
  return render(
    <MemoryRouter>
      <LandingPage onEnter={() => {}} />
    </MemoryRouter>,
  );
}

describe('LandingPage (Plano Vivo)', () => {
  it('renders the brand phrase as the H1', () => {
    renderLanding();
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.textContent).toMatch(/5 minutos que pueden/i);
    expect(h1.textContent).toMatch(/salvar tu vida/i);
  });

  it('renders the four consumer tiers with REAL prices and limits from tiers.ts', () => {
    renderLanding();
    for (const id of ['gratis', 'cobre', 'plata', 'oro'] as const) {
      const tier = TIERS.find((t) => t.id === id)!;
      // name (mono header on the card)
      expect(screen.getAllByText(new RegExp(`^${tier.nombre}$`, 'i')).length).toBeGreaterThan(0);
      if (tier.clpRegular > 0) {
        // price with es-CL dot-thousands, e.g. $9.990
        const formatted = `$${tier.clpRegular.toLocaleString('es-CL')}`;
        expect(screen.getAllByText(new RegExp(formatted.replace(/[.$]/g, '\\$&'))).length).toBeGreaterThan(0);
        // worker limit interpolated from the tier, never hardcoded
        expect(screen.getAllByText(new RegExp(`${tier.trabajadoresMax}`)).length).toBeGreaterThan(0);
      }
    }
  });

  it('renders all 7 compliance badges plus the non-endorsement disclaimer', () => {
    renderLanding();
    for (const badge of COMPLIANCE_BADGES) {
      expect(screen.getAllByText(badge).length).toBeGreaterThan(0);
    }
    expect(screen.getByText(/No implica afiliación ni respaldo/i)).toBeInTheDocument();
  });

  it('declares life-safety free forever (ADR 0021) in the vida section', () => {
    renderLanding();
    expect(screen.getAllByText(/Gratis para el trabajador, siempre/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Red mesh sin señal/i)).toBeInTheDocument();
    expect(screen.getByText(/Evacuación con ruteo A\*/i)).toBeInTheDocument();
  });

  it('keeps the e2e-pinned sections: Por qué Guardian + Cómo funciona', () => {
    renderLanding();
    expect(screen.getByText(/Por qué Guardian/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Cómo funciona/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Registra/i).length).toBeGreaterThan(0);
  });
});
