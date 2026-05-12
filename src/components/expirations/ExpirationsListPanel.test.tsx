// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExpirationsListPanel } from './ExpirationsListPanel.js';
import type { ExpirableItem } from '../../services/expirations/expirationScanner.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

const NOW = new Date('2026-05-12T00:00:00Z');

function days(offset: number): string {
  return new Date(NOW.getTime() + offset * 86_400_000).toISOString();
}

describe('<ExpirationsListPanel />', () => {
  it('renderiza panel vacío con mensaje all-ok cuando nada vence pronto', () => {
    const items: ExpirableItem[] = [
      { id: 'i1', kind: 'document', expiresAt: days(120), label: 'Doc lejano' },
    ];
    render(<ExpirationsListPanel items={items} options={{ now: NOW }} />);
    expect(screen.getByTestId('expirations-panel')).toBeInTheDocument();
    expect(screen.getByTestId('exp-empty')).toBeInTheDocument();
  });

  it('separa items en buckets expired / critical / warning', () => {
    const items: ExpirableItem[] = [
      { id: 'exp1', kind: 'license', expiresAt: days(-5), label: 'Licencia 1' },
      { id: 'cr1', kind: 'epp', expiresAt: days(3), label: 'Casco' },
      { id: 'wn1', kind: 'training', expiresAt: days(20), label: 'Capacitación' },
      { id: 'ok1', kind: 'contract', expiresAt: days(90), label: 'Contrato' },
    ];
    render(<ExpirationsListPanel items={items} options={{ now: NOW }} />);
    expect(screen.getByTestId('exp-bucket-expired')).toBeInTheDocument();
    expect(screen.getByTestId('exp-bucket-critical')).toBeInTheDocument();
    expect(screen.getByTestId('exp-bucket-warning')).toBeInTheDocument();
    expect(screen.getByTestId('exp-row-exp1')).toBeInTheDocument();
    expect(screen.getByTestId('exp-row-cr1')).toBeInTheDocument();
    expect(screen.getByTestId('exp-row-wn1')).toBeInTheDocument();
    expect(screen.queryByTestId('exp-row-ok1')).toBeNull();
  });

  it('muestra total scanned excluyendo skipped', () => {
    const items: ExpirableItem[] = [
      { id: 'a', kind: 'document', expiresAt: days(2), label: 'A' },
      { id: 'b', kind: 'document', expiresAt: null, label: 'B' }, // skipped
      { id: 'c', kind: 'document', expiresAt: days(2), label: 'C', status: 'expired' }, // skipped
    ];
    render(<ExpirationsListPanel items={items} options={{ now: NOW }} />);
    expect(screen.getByTestId('exp-total')).toHaveTextContent('1');
  });

  it('dispara onSelectItem al click en row', () => {
    const onSelect = vi.fn();
    const items: ExpirableItem[] = [
      { id: 'cr1', kind: 'epp', expiresAt: days(3), label: 'Casco' },
    ];
    render(
      <ExpirationsListPanel
        items={items}
        options={{ now: NOW }}
        onSelectItem={onSelect}
      />,
    );
    const row = screen.getByTestId('exp-row-cr1');
    fireEvent.click(row.querySelector('button')!);
    expect(onSelect).toHaveBeenCalledWith(items[0]);
  });

  it('renderiza días vencidos como +Nd para expirados', () => {
    const items: ExpirableItem[] = [
      { id: 'exp1', kind: 'license', expiresAt: days(-10), label: 'Old' },
    ];
    render(<ExpirationsListPanel items={items} options={{ now: NOW }} />);
    expect(screen.getByTestId('exp-row-exp1')).toHaveTextContent('+10d');
  });
});
