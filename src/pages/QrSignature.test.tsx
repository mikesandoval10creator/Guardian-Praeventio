// @vitest-environment jsdom
//
// Praeventio Guard — Fase F.5 page wrapper tests.
//
// Smoke tests for `<QrSignature />`:
//   1. Empty state when no project is selected.
//   2. Loading state while challenge request is in-flight.
//   3. Click "Generar QR" calls the request mutation with the form input.
//   4. Render the QR modal once the challenge resolves.
//   5. Error surfaces in the UI when the request fails.
//   6. PIN fallback: opening the modal, typing the PIN and submitting POSTs
//      the real sign-item endpoint with the form's itemId + kind, and the
//      resulting acknowledgement is surfaced.
//
// All side-effecting modules (project context, online status, sprintK
// mutations, QRCodeSVG, the PIN sign HTTP boundary) are mocked so the test
// is hermetic — no Firestore, no fetch, no DOM-only QR canvas.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QrSignature } from './QrSignature';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      _k: string,
      fallback?: string | Record<string, unknown>,
      opts?: Record<string, unknown>,
    ) => {
      if (typeof fallback === 'string') {
        if (opts && typeof opts === 'object') {
          let out = fallback;
          for (const [key, val] of Object.entries(opts)) {
            out = out.replace(`{{${key}}}`, String(val));
          }
          return out;
        }
        return fallback;
      }
      return _k;
    },
  }),
}));

// QRCodeSVG renders SVG that vitest-jsdom can't draw — stub it so the
// modal mounts cleanly. The page test doesn't assert on QR pixels;
// QrSignatureModal.test.tsx already covers the QR render contract.
vi.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value }: { value: string }) => (
    <svg data-testid="qrcode-stub" data-value={value} />
  ),
}));

let mockSelectedProject: { id: string; name: string } | null = null;
let mockIsOnline = true;

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));
vi.mock('../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockIsOnline,
}));

const mockRequestChallenge = vi.fn();
const mockPersistAck = vi.fn();
vi.mock('../hooks/useQrSignature', () => ({
  requestQrSignatureChallenge: (...args: unknown[]) =>
    mockRequestChallenge(...args),
  persistQrAcknowledgement: (...args: unknown[]) => mockPersistAck(...args),
}));

// PIN sign HTTP boundary. The page renders the REAL <PinSignModal>, which
// calls signItemWithPinApi → POST /api/sprint-k/:projectId/pin-sign/sign-item.
// We mock only this boundary so the test exercises the real modal submit flow
// and asserts the exact payload sent to the endpoint.
const mockSignItemWithPin = vi.fn();
vi.mock('../hooks/usePinSign', () => ({
  signItemWithPinApi: (...args: unknown[]) => mockSignItemWithPin(...args),
}));

beforeEach(() => {
  mockSelectedProject = null;
  mockIsOnline = true;
  mockRequestChallenge.mockReset();
  mockPersistAck.mockReset();
  mockSignItemWithPin.mockReset();
});

describe('<QrSignature /> page wrapper (Fase F.5)', () => {
  it('renderiza el empty-state cuando no hay proyecto seleccionado', () => {
    mockSelectedProject = null;
    render(<QrSignature />);
    expect(screen.getByTestId('qr-signature-page-empty')).toBeInTheDocument();
    expect(
      screen.getByText(/selecciona un proyecto/i),
    ).toBeInTheDocument();
  });

  it('muestra el chip offline cuando isOnline=false', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockIsOnline = false;
    render(<QrSignature />);
    expect(
      screen.getByTestId('qr-signature-offline-chip'),
    ).toBeInTheDocument();
  });

  it('llama a requestQrSignatureChallenge al hacer click en Generar QR', async () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockRequestChallenge.mockResolvedValueOnce({
      challengeId: 'ch-1',
      itemId: 'arnes-001',
      kind: 'epp_delivery',
      projectId: 'p-1',
      initiatedByUid: 'sup-1',
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      signatureHex: 'deadbeef'.repeat(8),
      nonceHex: 'a'.repeat(32),
      schemaVersion: 1,
    });

    render(<QrSignature />);

    const input = screen.getByTestId('qr-sig-item-id-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'arnes-001' } });

    const btn = screen.getByTestId('qr-sig-generate-btn');
    fireEvent.click(btn);

    await waitFor(() => {
      expect(mockRequestChallenge).toHaveBeenCalledTimes(1);
    });
    expect(mockRequestChallenge).toHaveBeenCalledWith(
      'p-1',
      'arnes-001',
      'epp_delivery',
    );
  });

  it('renderiza el modal QR cuando el challenge se resuelve', async () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockRequestChallenge.mockResolvedValueOnce({
      challengeId: 'ch-render-1',
      itemId: 'doc-pts-2026',
      kind: 'document_read',
      projectId: 'p-1',
      initiatedByUid: 'sup-1',
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      signatureHex: 'cafebabe'.repeat(8),
      nonceHex: 'b'.repeat(32),
      schemaVersion: 1,
    });

    render(<QrSignature />);

    fireEvent.change(screen.getByTestId('qr-sig-item-id-input'), {
      target: { value: 'doc-pts-2026' },
    });
    fireEvent.click(screen.getByTestId('qr-sig-generate-btn'));

    await waitFor(() => {
      expect(
        screen.getByTestId('qr-signature-modal-wrapper'),
      ).toBeInTheDocument();
    });
    // The stubbed QRCodeSVG renders the encoded payload.
    expect(screen.getByTestId('qrcode-stub')).toBeInTheDocument();
  });

  it('muestra error si la mutation falla', async () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockRequestChallenge.mockRejectedValueOnce(new Error('Network down'));

    render(<QrSignature />);

    fireEvent.change(screen.getByTestId('qr-sig-item-id-input'), {
      target: { value: 'arnes-001' },
    });
    fireEvent.click(screen.getByTestId('qr-sig-generate-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('qr-signature-error')).toBeInTheDocument();
    });
    expect(screen.getByText(/conectar con el servidor/i)).toBeInTheDocument();
  });

  describe('PIN fallback (firma por PIN sin biometría)', () => {
    it('el botón de PIN se deshabilita hasta que haya un itemId', () => {
      mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
      render(<QrSignature />);
      const pinBtn = screen.getByTestId(
        'qr-sig-pin-fallback-btn',
      ) as HTMLButtonElement;
      expect(pinBtn.disabled).toBe(true);

      fireEvent.change(screen.getByTestId('qr-sig-item-id-input'), {
        target: { value: 'arnes-001' },
      });
      expect(pinBtn.disabled).toBe(false);
    });

    it('firma de verdad vía sign-item con el itemId + kind del formulario', async () => {
      mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
      mockSignItemWithPin.mockResolvedValueOnce({
        ok: true,
        acknowledgement: {
          itemId: 'arnes-001',
          kind: 'safety_talk',
          projectId: 'p-1',
          signedByUid: 'worker-1',
          signedAt: new Date().toISOString(),
          attestationHex: 'ab'.repeat(16),
          biometricUsed: false,
        },
      });

      render(<QrSignature />);

      // Pick a non-default kind so we prove the form's kind reaches the POST.
      fireEvent.click(screen.getByTestId('qr-sig-kind-safety_talk'));
      fireEvent.change(screen.getByTestId('qr-sig-item-id-input'), {
        target: { value: 'arnes-001' },
      });

      // Open the PIN modal.
      fireEvent.click(screen.getByTestId('qr-sig-pin-fallback-btn'));
      const pinInput = await screen.findByTestId('pin-sign-input');
      fireEvent.change(pinInput, { target: { value: '8520' } });

      fireEvent.click(screen.getByTestId('pin-sign-submit'));

      await waitFor(() => {
        expect(mockSignItemWithPin).toHaveBeenCalledTimes(1);
      });
      // Asserts the exact payload the modal POSTs to the real endpoint.
      expect(mockSignItemWithPin).toHaveBeenCalledWith('p-1', {
        pin: '8520',
        itemId: 'arnes-001',
        kind: 'safety_talk',
        location: undefined,
      });

      // The signed acknowledgement is surfaced back on the page.
      await waitFor(() => {
        expect(
          screen.getByTestId('qr-sig-pin-ack-confirm'),
        ).toBeInTheDocument();
      });
      expect(screen.getByText(/arnes-001/)).toBeInTheDocument();
    });

    it('mantiene el modal abierto y muestra error de PIN incorrecto', async () => {
      mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
      mockSignItemWithPin.mockResolvedValueOnce({ ok: false });

      render(<QrSignature />);

      fireEvent.change(screen.getByTestId('qr-sig-item-id-input'), {
        target: { value: 'charla-2026' },
      });
      fireEvent.click(screen.getByTestId('qr-sig-pin-fallback-btn'));
      const pinInput = await screen.findByTestId('pin-sign-input');
      fireEvent.change(pinInput, { target: { value: '4093' } });
      fireEvent.click(screen.getByTestId('pin-sign-submit'));

      await waitFor(() => {
        expect(mockSignItemWithPin).toHaveBeenCalledTimes(1);
      });
      // Wrong PIN → modal stays open, no ack confirmation surfaced.
      expect(screen.getByTestId('pin-sign-input')).toBeInTheDocument();
      expect(
        screen.queryByTestId('qr-sig-pin-ack-confirm'),
      ).not.toBeInTheDocument();
    });
  });
});
