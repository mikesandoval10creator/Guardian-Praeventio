// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LegalStatusAlert } from './LegalStatusAlert.js';
import { useLegalStatusAlert } from '../../hooks/useLegalStatusAlert';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

vi.mock('../../hooks/useLegalStatusAlert', () => ({
  useLegalStatusAlert: vi.fn(),
}));

const mockHook = vi.mocked(useLegalStatusAlert);

function renderAlert() {
  return render(
    <MemoryRouter>
      <LegalStatusAlert />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  mockHook.mockReset();
});

describe('<LegalStatusAlert />', () => {
  it('renders nothing when there is no obligation crossed', () => {
    mockHook.mockReturnValue(null);
    const { container } = renderAlert();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the CPHS advisory with a calm (status, non-alert) role and a calendar CTA', () => {
    mockHook.mockReturnValue({ alertType: 'cphs', projectId: 'p1', workersCount: 30, threshold: 25 });
    renderAlert();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/Comité Paritario obligatorio/i)).toBeInTheDocument();
    const cta = screen.getByRole('link', { name: /calendario legal/i });
    expect(cta).toHaveAttribute('href', '/legal-calendar');
  });

  it('renders the DPRP advisory at the higher threshold', () => {
    mockHook.mockReturnValue({ alertType: 'dprp', projectId: 'p1', workersCount: 120, threshold: 100 });
    renderAlert();
    expect(screen.getByText(/Departamento de Prevención obligatorio/i)).toBeInTheDocument();
  });

  it('dismissing hides the banner and persists per (project, obligation)', () => {
    mockHook.mockReturnValue({ alertType: 'cphs', projectId: 'p1', workersCount: 30, threshold: 25 });
    const { container } = renderAlert();
    fireEvent.click(screen.getByRole('button', { name: /descartar/i }));
    expect(container).toBeEmptyDOMElement();
    expect(window.localStorage.getItem('legal-alert-dismissed-p1-cphs')).toBe('1');
  });

  it('stays dismissed on re-mount for the SAME obligation', () => {
    window.localStorage.setItem('legal-alert-dismissed-p1-cphs', '1');
    mockHook.mockReturnValue({ alertType: 'cphs', projectId: 'p1', workersCount: 30, threshold: 25 });
    const { container } = renderAlert();
    expect(container).toBeEmptyDOMElement();
  });

  it('re-surfaces after an escalation cphs→dprp even though the CPHS notice was dismissed', () => {
    window.localStorage.setItem('legal-alert-dismissed-p1-cphs', '1');
    mockHook.mockReturnValue({ alertType: 'dprp', projectId: 'p1', workersCount: 120, threshold: 100 });
    renderAlert();
    expect(screen.getByText(/Departamento de Prevención obligatorio/i)).toBeInTheDocument();
  });
});
