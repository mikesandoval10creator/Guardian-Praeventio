// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AuditExpressButton } from './AuditExpressButton.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

describe('<AuditExpressButton />', () => {
  it('idle muestra botón "Preparar"', () => {
    const onRequest = vi.fn().mockResolvedValue({ downloadUrl: 'x', expiresAt: 'y' });
    render(<AuditExpressButton projectId="p1" onRequest={onRequest} />);
    expect(screen.getByTestId('audit-express-button')).toHaveTextContent(/Preparar/);
  });

  it('al click llama onRequest con projectId y muestra spinner', async () => {
    let resolve: (v: { downloadUrl: string; expiresAt: string }) => void = () => {};
    const onRequest = vi.fn(
      () => new Promise<{ downloadUrl: string; expiresAt: string }>((r) => (resolve = r)),
    );
    render(<AuditExpressButton projectId="p1" onRequest={onRequest} />);
    fireEvent.click(screen.getByTestId('audit-express-button'));
    expect(onRequest).toHaveBeenCalledWith('p1');
    expect(screen.getByTestId('audit-express-button')).toHaveTextContent(/Generando/);
    resolve({ downloadUrl: 'https://storage.cloud/abc', expiresAt: '2026-05-11T13:00:00Z' });
    await waitFor(() => expect(screen.getByTestId('audit-express-ready')).toBeInTheDocument());
  });

  it('estado ready muestra link de descarga con href', async () => {
    const onRequest = vi.fn().mockResolvedValue({
      downloadUrl: 'https://storage.cloud/zip',
      expiresAt: '2026-05-11T13:00:00Z',
    });
    render(<AuditExpressButton projectId="p1" onRequest={onRequest} />);
    fireEvent.click(screen.getByTestId('audit-express-button'));
    const ready = await screen.findByTestId('audit-express-ready');
    expect(ready.getAttribute('href')).toBe('https://storage.cloud/zip');
  });

  it('onReady callback se invoca con url y expiresAt', async () => {
    const onReady = vi.fn();
    const onRequest = vi.fn().mockResolvedValue({
      downloadUrl: 'https://x.zip',
      expiresAt: '2026-05-11T13:00:00Z',
    });
    render(<AuditExpressButton projectId="p1" onRequest={onRequest} onReady={onReady} />);
    fireEvent.click(screen.getByTestId('audit-express-button'));
    await screen.findByTestId('audit-express-ready');
    expect(onReady).toHaveBeenCalledWith('https://x.zip', '2026-05-11T13:00:00Z');
  });

  it('error muestra mensaje + reintentar', async () => {
    const onRequest = vi.fn().mockRejectedValue(new Error('quota_exceeded'));
    render(<AuditExpressButton projectId="p1" onRequest={onRequest} />);
    fireEvent.click(screen.getByTestId('audit-express-button'));
    const errorEl = await screen.findByTestId('audit-express-error');
    expect(errorEl).toHaveTextContent('quota_exceeded');
    expect(errorEl).toHaveTextContent(/Reintentar/);
  });
});
