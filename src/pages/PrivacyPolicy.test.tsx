// @vitest-environment jsdom
//
// Praeventio Guard — page test for `<PrivacyPolicy />`.
//
// Focus (Ley 21.719 blindaje): the privacy policy must render from the
// versioned string-table (`src/services/legal/privacyContent.ts`) with a FIXED
// version date (not `new Date()`), and must surface the legal anchors required
// for the 21.719 / GDPR readiness:
//   - Ley 21.719 named as the in-force framework + APDP authority + GDPR.
//   - Sensitive data (salud ocupacional) treatment + EIPD mention.
//   - International transfer clause (Firebase/Gemini process abroad).
//   - Worker base legal NOT resting solely on consent.
//   - Segregated privacy/DPO channel (by subject, single canonical email).
//
// Hermetic: react-i18next + react-router-dom are mocked (no router, no i18n
// runtime). Matches the patterns used by sibling page tests.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PrivacyPolicy } from './PrivacyPolicy';
import {
  PRIVACY_CONTENT_ES_CL,
  PRIVACY_LAST_UPDATED_ISO,
} from '../services/legal/privacyContent';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    // Return the provided fallback string so the rendered copy is the es-CL
    // default (the page relies on inline defaults, no top-level i18n keys).
    t: (_k: string, fallback?: string) => fallback ?? _k,
  }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

describe('<PrivacyPolicy /> — Ley 21.719 readiness', () => {
  it('renders the page heading from the string-table', () => {
    render(<PrivacyPolicy />);
    expect(
      screen.getByRole('heading', { level: 1, name: PRIVACY_CONTENT_ES_CL.title }),
    ).toBeTruthy();
  });

  it('shows the FIXED versioned date (not new Date())', () => {
    render(<PrivacyPolicy />);
    const expected = new Date(PRIVACY_LAST_UPDATED_ISO).toLocaleDateString('es-CL', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    // The fixed date string from the string-table must appear verbatim.
    expect(screen.getByText(new RegExp(expected))).toBeTruthy();
    // Guard against regression to a live date: the constant is a real ISO date.
    expect(PRIVACY_LAST_UPDATED_ISO).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('names Ley 21.719, the APDP authority and GDPR', () => {
    render(<PrivacyPolicy />);
    expect(screen.getAllByText(/21\.719/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/APDP/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/GDPR/).length).toBeGreaterThan(0);
  });

  it('declares sensitive data (salud ocupacional) treatment + EIPD', () => {
    render(<PrivacyPolicy />);
    expect(screen.getAllByText(/Datos Sensibles/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/salud ocupacional/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/EIPD/).length).toBeGreaterThan(0);
  });

  it('does NOT rest the worker base legal solely on consent', () => {
    render(<PrivacyPolicy />);
    // Must cite contract / legal obligation / legitimate interest, and call out
    // that consent alone is weak due to power asymmetry.
    expect(screen.getAllByText(/obligación legal/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/interés legítimo/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/asimetría de poder/i).length).toBeGreaterThan(0);
  });

  it('includes an international transfer clause', () => {
    render(<PrivacyPolicy />);
    expect(
      screen.getAllByText(/Transferencia Internacional/i).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(/fuera de Chile/i).length).toBeGreaterThan(0);
  });

  it('segregates the privacy/DPO channel via subject on the canonical email', () => {
    render(<PrivacyPolicy />);
    expect(screen.getAllByText(/contacto@praeventio\.net/).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/Encargado de Protección de Datos/i).length,
    ).toBeGreaterThan(0);
  });
});
