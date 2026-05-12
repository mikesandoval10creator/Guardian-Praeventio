// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ShiftQualityCard } from './ShiftQualityCard.js';
import {
  startShift,
  addHandoverNote,
} from '../../services/shiftHandover/shiftHandoverService.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function shift() {
  return startShift({
    id: 's1',
    projectId: 'p1',
    kind: 'morning',
    supervisorUid: 'sup1',
    now: new Date('2026-05-11T06:00:00Z'),
  });
}

describe('<ShiftQualityCard />', () => {
  it('shift sin notas → poor + categorias faltantes', () => {
    render(<ShiftQualityCard shift={shift()} />);
    expect(screen.getByTestId('shift-quality-card')).toBeInTheDocument();
    expect(screen.getByTestId('shift-missing-critical')).toBeInTheDocument();
  });

  it('shift con notas críticas → score más alto', () => {
    let s = shift();
    for (const cat of ['open_incidents', 'equipment_down', 'pending_controls', 'active_permits'] as const) {
      s = addHandoverNote(s, { category: cat, text: 'nota completa relevante', severity: 'info' });
    }
    render(<ShiftQualityCard shift={s} />);
    expect(Number(screen.getByTestId('shift-quality-score').textContent)).toBeGreaterThan(70);
  });

  it('onAddNote dispara con la categoría', () => {
    const onAdd = vi.fn();
    render(<ShiftQualityCard shift={shift()} onAddNote={onAdd} />);
    fireEvent.click(screen.getByTestId('shift-add-note-open_incidents'));
    expect(onAdd).toHaveBeenCalledWith('open_incidents');
  });
});
