// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RoleViewCards } from './RoleViewCards.js';
import type { RoleCard } from '../../services/roleViews/roleViewBuilder.js';

const cards: RoleCard[] = [
  {
    id: 'w-tasks',
    title: 'Mis tareas hoy (3)',
    body: 'Revisa el día',
    primaryAction: { label: 'Ver tareas', route: '/me/tasks' },
    severity: 'action_required',
    category: 'tasks',
    count: 3,
  },
  {
    id: 'w-epp',
    title: 'EPP por vencer',
    body: 'Renueva pronto',
    severity: 'urgent',
    category: 'epp',
  },
];

describe('<RoleViewCards />', () => {
  it('renderiza título, count y tarjetas', () => {
    render(<RoleViewCards role="worker" cards={cards} />);
    expect(screen.getByTestId('roleViews.cards.title')).toHaveTextContent('Trabajador');
    expect(screen.getByTestId('roleViews.cards.count')).toHaveTextContent('2');
    expect(screen.getByTestId('roleViews.cards.item.w-tasks')).toBeInTheDocument();
    expect(screen.getByTestId('roleViews.cards.item.w-tasks.count')).toHaveTextContent('3');
  });

  it('llama onAction al clickear botón', () => {
    const onAction = vi.fn();
    render(<RoleViewCards role="worker" cards={cards} onAction={onAction} />);
    fireEvent.click(screen.getByTestId('roleViews.cards.item.w-tasks.action'));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction.mock.calls[0][0].id).toBe('w-tasks');
  });

  it('muestra estado vacío sin tarjetas', () => {
    render(<RoleViewCards role="management" cards={[]} />);
    expect(screen.getByTestId('roleViews.cards.empty')).toBeInTheDocument();
  });
});
