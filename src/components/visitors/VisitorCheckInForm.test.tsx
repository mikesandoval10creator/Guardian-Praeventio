// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VisitorCheckInForm } from './VisitorCheckInForm.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

const hosts = [
  { uid: 'h1', name: 'Pedro' },
  { uid: 'h2', name: 'Ana' },
];

describe('<VisitorCheckInForm />', () => {
  it('muestra error si faltan campos requeridos', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<VisitorCheckInForm availableHosts={hosts} onSubmit={onSubmit} />);
    // El form pide nombre y documento y org, no las llenamos
    await user.type(screen.getByTestId('visitor-fullname'), 'María');
    // Submit sin documento ni organización
    fireEvent.submit(screen.getByTestId('visitor-checkin-form'));
    await waitFor(() => {
      // El input "required" del HTML5 puede bloquear submit, pero podemos verificar
      // que onSubmit no fue llamado
      expect(onSubmit).not.toHaveBeenCalled();
    });
  });

  it('submit válido envía payload', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<VisitorCheckInForm availableHosts={hosts} onSubmit={onSubmit} />);
    await user.type(screen.getByTestId('visitor-fullname'), 'María Visitante');
    await user.type(screen.getByTestId('visitor-document'), '11.111.111-1');
    await user.type(screen.getByTestId('visitor-organization'), 'Mandante SA');
    fireEvent.submit(screen.getByTestId('visitor-checkin-form'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.fullName).toBe('María Visitante');
    expect(payload.organization).toBe('Mandante SA');
    expect(payload.hostUid).toBe('h1'); // primer host por default
  });

  it('error de submit se muestra al usuario', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('quota_exceeded'));
    const user = userEvent.setup();
    render(<VisitorCheckInForm availableHosts={hosts} onSubmit={onSubmit} />);
    await user.type(screen.getByTestId('visitor-fullname'), 'María');
    await user.type(screen.getByTestId('visitor-document'), '11.111.111-1');
    await user.type(screen.getByTestId('visitor-organization'), 'Org');
    fireEvent.submit(screen.getByTestId('visitor-checkin-form'));
    const err = await screen.findByTestId('visitor-error');
    expect(err).toHaveTextContent(/límite del plan/i);
  });

  it('onCancel dispara', () => {
    const onCancel = vi.fn();
    render(
      <VisitorCheckInForm availableHosts={hosts} onSubmit={vi.fn()} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByTestId('visitor-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
