// @vitest-environment jsdom
// src/components/layout/NavSearch.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const navigateMock = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigateMock }));
vi.mock('../../contexts/SubscriptionContext', () => ({
  useSubscription: () => ({ features: { canUseExecutiveDashboard: false } }),
}));
vi.mock('../../contexts/FirebaseContext', () => ({ useFirebase: () => ({ isAdmin: false }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_k: string, f?: string) => f ?? _k }) }));

import { NavSearch } from './NavSearch';

describe('NavSearch', () => {
  it('muestra resultados al teclear y navega al elegir', () => {
    render(<NavSearch />);
    const input = screen.getByPlaceholderText('¿Qué necesitas?');
    fireEvent.change(input, { target: { value: 'iper' } });
    const result = screen.getByText('Matriz IPER');
    fireEvent.click(result);
    expect(navigateMock).toHaveBeenCalledWith('/matriz-iper');
  });
  it('sin query no muestra resultados', () => {
    render(<NavSearch />);
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
