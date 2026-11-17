// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Equipment } from '../../services/equipment/equipmentQrService';
import { recordHorometroReading } from '../../hooks/useHorometro';
import { HorometroEntryForm } from './HorometroEntryForm';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: unknown, options?: Record<string, unknown>) => {
      if (typeof fallback !== 'string') return _key;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? `{{${name}}}`));
    },
  }),
}));
vi.mock('../../hooks/useHorometro', () => ({ recordHorometroReading: vi.fn() }));

const equipment = { id: 'eq-1', code: 'EXC-7', type: 'excavator' } as Equipment;
const reading = { equipmentId: 'eq-1', hours: 1234, source: 'qr_entry', createdAt: '2026-10-01T12:00:00.000Z' };

function fillAndSubmit() {
  fireEvent.change(screen.getByTestId('horometro-hours-input'), { target: { value: '1234' } });
  fireEvent.click(screen.getByTestId('horometro-submit'));
}

beforeEach(() => vi.mocked(recordHorometroReading).mockReset());
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('HorometroEntryForm evidence result', () => {
  it('distinguishes a saved reading from failed follow-up evidence and remains dismissible', async () => {
    vi.mocked(recordHorometroReading).mockResolvedValue({
      reading: reading as never,
      flow: { ok: false, reason: 'writeNodes_failed' } as never,
    });
    const onCancel = vi.fn();
    render(<HorometroEntryForm projectId="project-1" equipment={equipment} onCancel={onCancel} />);
    fillAndSubmit();

    expect(await screen.findByTestId('horometro-evidence-pending')).toBeTruthy();
    expect(screen.getByTestId('horometro-result-title').textContent).toMatch(/Lectura guardada/);
    expect(screen.getByTestId('horometro-evidence-pending').textContent).toMatch(/no se pudo guardar/i);
    expect(screen.queryByText(/writeNodes_failed/)).toBeNull();
    fireEvent.click(screen.getByTestId('horometro-result-close'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('reports persisted task/edge counts for a partial flow without claiming all tasks were created', async () => {
    vi.mocked(recordHorometroReading).mockResolvedValue({
      reading: reading as never,
      flow: {
        ok: true, readingNodeId: 'reading-node', crossesDetected: 1,
        tasksCreated: 0, edgesCreated: 0, edgesExpected: 2,
      } as never,
    });
    render(<HorometroEntryForm projectId="project-1" equipment={equipment} />);
    fillAndSubmit();

    expect(await screen.findByTestId('horometro-evidence-pending')).toBeTruthy();
    expect(screen.getByTestId('horometro-result-title').textContent).toMatch(/pendiente/i);
    expect(screen.getByTestId('horometro-persisted-counts').textContent).toContain('0 de 1');
    expect(screen.queryByText(/Se crearon 1 tarea/)).toBeNull();
  });

  it('does not infer complete evidence when a legacy response omits expected edge count', async () => {
    vi.mocked(recordHorometroReading).mockResolvedValue({
      reading: reading as never,
      flow: {
        ok: true, readingNodeId: 'reading-node', crossesDetected: 0,
        tasksCreated: 0, edgesCreated: 1,
      } as never,
    });
    render(<HorometroEntryForm projectId="project-1" equipment={equipment} />);
    fillAndSubmit();

    expect(await screen.findByTestId('horometro-evidence-pending')).toBeTruthy();
    expect(screen.getByTestId('horometro-persisted-counts').textContent).toMatch(/total por confirmar/i);
  });

  it('keeps the completed-success copy only when persistence counts are complete', async () => {
    vi.mocked(recordHorometroReading).mockResolvedValue({
      reading: reading as never,
      flow: {
        ok: true, readingNodeId: 'reading-node', crossesDetected: 1,
        tasksCreated: 1, edgesCreated: 2, edgesExpected: 2,
      } as never,
    });
    render(<HorometroEntryForm projectId="project-1" equipment={equipment} />);
    fillAndSubmit();

    expect((await screen.findByTestId('horometro-result-title')).textContent).toMatch(/Umbrales cruzados/);
    expect(screen.getByTestId('horometro-crosses-count').textContent).toContain('1 tarea');
    expect(screen.queryByTestId('horometro-evidence-pending')).toBeNull();
  });
});
