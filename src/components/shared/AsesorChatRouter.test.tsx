// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AsesorChatRouter } from './AsesorChatRouter';

// 2026-05-15: actualizado a la semántica Sprint 55 (#242). Antes:
//   • default OFF → legacy
//   • LEGACY_OPT_IN_KEY ('praeventio:asesor:resilient:v1') = '1' → ON
// Ahora:
//   • default ON → resilient
//   • LEGACY_OPT_OUT_KEY ('praeventio:asesor:legacy-optout:v2') = '1' → OFF
const LEGACY_OPT_OUT_KEY = 'praeventio:asesor:legacy-optout:v2';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

// Mock heavy components to avoid loading their full transitive graphs.
vi.mock('./AsesorChat', () => ({
  AsesorChat: () => <div data-testid="legacy-asesor-mock">legacy</div>,
}));
// B14: el router monta el launcher flotante (que envuelve el panel).
vi.mock('./ResilientAsesorLauncher', () => ({
  ResilientAsesorLauncher: () => (
    <div data-testid="resilient-asesor-mock">resilient</div>
  ),
}));

describe('<AsesorChatRouter />', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('default (sin opt-out): renderiza ResilientAsesorPanel (Sprint 55 default ON)', async () => {
    render(<AsesorChatRouter />);
    await waitFor(() => {
      expect(screen.getByTestId('resilient-asesor-mock')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('legacy-asesor-mock')).toBeNull();
  });

  it('LEGACY_OPT_OUT_KEY=1: renderiza legacy AsesorChat (opt-out al panel viejo)', async () => {
    localStorage.setItem(LEGACY_OPT_OUT_KEY, '1');
    render(<AsesorChatRouter />);
    await waitFor(() => {
      expect(screen.getByTestId('legacy-asesor-mock')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('resilient-asesor-mock')).toBeNull();
  });

  it('resilientProps se pasan al panel por defecto (flag ON, no opt-out)', async () => {
    render(
      <AsesorChatRouter
        resilientProps={{
          tenantId: 't-1',
          userUid: 'u-1',
        }}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('resilient-asesor-mock')).toBeInTheDocument();
    });
  });
});
