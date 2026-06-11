// @vitest-environment jsdom
//
// Praeventio Guard — page wrapper tests for <CealSmResponder /> (anonymous
// CEAL-SM/SUSESO worker flow). The questionnaire rendered is the REAL
// official instrument from cealSmDefinition.ts (54 items, 12 dimensions) —
// only the remote calls and the project context are mocked.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CealSmResponder } from './CealSmResponder';
import {
  CEAL_DIMENSIONS,
  CEAL_ITEM_CODES,
  CEAL_SCALE_OPTIONS,
} from '../services/protocols/cealSmDefinition';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, fallback?: unknown) => {
      if (typeof fallback === 'string') return fallback;
      if (fallback && typeof fallback === 'object' && 'defaultValue' in (fallback as Record<string, unknown>)) {
        let out = String((fallback as Record<string, unknown>).defaultValue);
        for (const [key, val] of Object.entries(fallback as Record<string, unknown>)) {
          out = out.replace(`{{${key}}}`, String(val));
        }
        return out;
      }
      return k;
    },
  }),
}));

let mockSelectedProject: { id: string; name: string } | null = null;
vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));

const listMock = vi.fn();
const submitMock = vi.fn();
vi.mock('../hooks/useCealSm', () => ({
  listCealCampaigns: (...args: unknown[]) => listMock(...args),
  submitCealResponse: (...args: unknown[]) => submitMock(...args),
}));

const openCampaign = {
  id: 'c-1',
  title: 'Evaluación CEAL-SM 2026',
  status: 'open' as const,
  openAt: '2026-06-01T00:00:00.000Z',
  closeAt: '2026-07-01T00:00:00.000Z',
  totalWorkers: 30,
  createdAt: '2026-06-01T00:00:00.000Z',
  responseCount: 3,
  participationRate: 0.1,
  hasResponded: false,
};

/** Answer every official item with its minimum point value. */
function answerAll() {
  for (const d of CEAL_DIMENSIONS) {
    for (const item of d.items) {
      const min = Math.min(...CEAL_SCALE_OPTIONS[item.scale].map((o) => o.points));
      fireEvent.click(screen.getByTestId(`ceal-opt-${item.code}-${min}`));
    }
  }
}

beforeEach(() => {
  mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
  listMock.mockReset().mockResolvedValue({ campaigns: [openCampaign] });
  submitMock.mockReset().mockResolvedValue({ ok: true });
});

describe('<CealSmResponder /> page (CEAL-SM/SUSESO, anónimo)', () => {
  it('renderiza el empty-state cuando no hay proyecto seleccionado', () => {
    mockSelectedProject = null;
    render(<CealSmResponder />);
    expect(screen.getByTestId('ceal-responder-empty')).toBeInTheDocument();
  });

  it('el aviso de anonimato es prominente y precede al cuestionario', async () => {
    render(<CealSmResponder />);
    expect(screen.getByTestId('ceal-anonymity-notice')).toBeInTheDocument();
    expect(screen.getByText('Tu respuesta es anónima')).toBeInTheDocument();
    expect(await screen.findByTestId('ceal-pick-c-1')).toBeInTheDocument();
  });

  it('una campaña ya respondida se muestra bloqueada (una respuesta por persona)', async () => {
    listMock.mockResolvedValue({
      campaigns: [{ ...openCampaign, hasResponded: true }],
    });
    render(<CealSmResponder />);
    expect(await screen.findByTestId('ceal-responded-c-1')).toBeInTheDocument();
    expect(screen.queryByTestId('ceal-pick-c-1')).not.toBeInTheDocument();
  });

  it('renderiza el instrumento oficial completo: 12 dimensiones y 54 ítems', async () => {
    render(<CealSmResponder />);
    fireEvent.click(await screen.findByTestId('ceal-pick-c-1'));
    expect(screen.getByTestId('ceal-questionnaire')).toBeInTheDocument();
    for (const d of CEAL_DIMENSIONS) {
      expect(screen.getByTestId(`ceal-dimension-${d.id}`)).toBeInTheDocument();
    }
    for (const code of CEAL_ITEM_CODES) {
      expect(screen.getByTestId(`ceal-item-${code}`)).toBeInTheDocument();
    }
    // Texto legal verbatim del Anexo Nº 1 (muestra).
    expect(
      screen.getByText('¿Con qué frecuencia le falta tiempo para completar sus tareas?'),
    ).toBeInTheDocument();
    // La escala VU parte en 1 (sin opción 0) — Anexo Nº 1.
    expect(screen.queryByTestId('ceal-opt-VU1-0')).not.toBeInTheDocument();
    expect(screen.getByTestId('ceal-opt-VU1-1')).toBeInTheDocument();
  });

  it('el envío queda deshabilitado hasta responder las 54 preguntas y luego envía el set completo', async () => {
    render(<CealSmResponder />);
    fireEvent.click(await screen.findByTestId('ceal-pick-c-1'));
    const submitBtn = screen.getByTestId('ceal-submit-btn') as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);

    answerAll();
    expect(screen.getByTestId('ceal-progress')).toHaveTextContent('54 de 54');
    expect((screen.getByTestId('ceal-submit-btn') as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByTestId('ceal-submit-btn'));
    await waitFor(() => expect(submitMock).toHaveBeenCalledTimes(1));
    const [pid, cid, answers] = submitMock.mock.calls[0];
    expect(pid).toBe('p-1');
    expect(cid).toBe('c-1');
    expect(Object.keys(answers as Record<string, number>)).toHaveLength(54);
    expect((answers as Record<string, number>).VU1).toBe(1); // VU floor
    expect((answers as Record<string, number>).QD1).toBe(0);
    expect(await screen.findByTestId('ceal-submitted')).toBeInTheDocument();
  });

  it('muestra el error de respuesta duplicada (already_responded)', async () => {
    submitMock.mockRejectedValue(new Error('already_responded'));
    render(<CealSmResponder />);
    fireEvent.click(await screen.findByTestId('ceal-pick-c-1'));
    answerAll();
    fireEvent.click(screen.getByTestId('ceal-submit-btn'));
    expect(await screen.findByTestId('ceal-responder-error')).toHaveTextContent(
      /Ya respondiste/,
    );
    expect(screen.queryByTestId('ceal-submitted')).not.toBeInTheDocument();
  });
});
