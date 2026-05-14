// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AsesorChatRouter } from './AsesorChatRouter';

const KEY = 'praeventio:asesor:resilient:v1';

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
vi.mock('./ResilientAsesorPanel', () => ({
  ResilientAsesorPanel: () => (
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

  it('flag OFF (default): renderiza legacy AsesorChat', async () => {
    render(<AsesorChatRouter />);
    await waitFor(() => {
      expect(screen.getByTestId('legacy-asesor-mock')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('resilient-asesor-mock')).toBeNull();
  });

  it('flag ON: renderiza ResilientAsesorPanel', async () => {
    localStorage.setItem(KEY, '1');
    render(<AsesorChatRouter />);
    await waitFor(() => {
      expect(screen.getByTestId('resilient-asesor-mock')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('legacy-asesor-mock')).toBeNull();
  });

  it('resilientProps se pasan al panel cuando flag ON', async () => {
    localStorage.setItem(KEY, '1');
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
