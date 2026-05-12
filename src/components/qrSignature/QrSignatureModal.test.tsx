// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QrSignatureModal } from './QrSignatureModal.js';
import {
  buildChallenge,
  buildSignedAcknowledgement,
} from '../../services/qrSignature/qrSignatureService.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

const SECRET = 'test-secret-min-16-chars-long';
const NOW = new Date('2026-05-12T22:00:00Z');

function makeChallenge() {
  return buildChallenge(
    {
      challengeId: 'ch-test',
      itemId: 'epp-arnes-001',
      kind: 'epp_delivery',
      projectId: 'p1',
      initiatedByUid: 'sup-1',
      nonceHex: 'a'.repeat(32),
      now: NOW,
    },
    SECRET,
  );
}

describe('<QrSignatureModal />', () => {
  it('renderiza QR y countdown cuando challenge está activo', () => {
    const ch = makeChallenge();
    render(<QrSignatureModal challenge={ch} now={NOW} />);
    expect(screen.getByTestId(`qr-sig-modal-${ch.challengeId}`)).toBeInTheDocument();
    expect(screen.getByTestId(`qr-sig-qrcode-${ch.challengeId}`)).toBeInTheDocument();
    expect(screen.getByTestId(`qr-sig-countdown-${ch.challengeId}`).textContent).toMatch(
      /05:00/,
    );
  });

  it('muestra itemId del challenge', () => {
    const ch = makeChallenge();
    render(<QrSignatureModal challenge={ch} now={NOW} />);
    expect(screen.getByTestId(`qr-sig-itemid-${ch.challengeId}`).textContent).toMatch(
      /epp-arnes-001/,
    );
  });

  it('muestra estado expired cuando now > expiresAt', () => {
    const ch = makeChallenge();
    const later = new Date(NOW.getTime() + 10 * 60_000); // +10min, TTL es 5min
    render(<QrSignatureModal challenge={ch} now={later} />);
    expect(screen.getByTestId(`qr-sig-expired-${ch.challengeId}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`qr-sig-qrcode-${ch.challengeId}`)).toBeNull();
  });

  it('botón regenerar visible cuando expired + callback dispara', () => {
    const ch = makeChallenge();
    const later = new Date(NOW.getTime() + 10 * 60_000);
    const onRegen = vi.fn();
    render(<QrSignatureModal challenge={ch} now={later} onRegenerate={onRegen} />);
    fireEvent.click(screen.getByTestId(`qr-sig-regenerate-${ch.challengeId}`));
    expect(onRegen).toHaveBeenCalled();
  });

  it('estado signed cuando llega acknowledgement', () => {
    const ch = makeChallenge();
    const ack = buildSignedAcknowledgement({
      challenge: ch,
      signedByUid: 'worker-77',
      biometricUsed: true,
      now: new Date('2026-05-12T22:03:00Z'),
    });
    render(<QrSignatureModal challenge={ch} acknowledgement={ack} now={NOW} />);
    expect(
      screen.getByTestId(`qr-sig-modal-${ch.challengeId}-signed`),
    ).toBeInTheDocument();
    expect(screen.queryByTestId(`qr-sig-qrcode-${ch.challengeId}`)).toBeNull();
  });

  it('signed muestra UID del firmante + biometría', () => {
    const ch = makeChallenge();
    const ack = buildSignedAcknowledgement({
      challenge: ch,
      signedByUid: 'worker-77',
      biometricUsed: true,
    });
    render(<QrSignatureModal challenge={ch} acknowledgement={ack} now={NOW} />);
    const modal = screen.getByTestId(`qr-sig-modal-${ch.challengeId}-signed`);
    expect(modal.textContent).toMatch(/worker-77/);
    expect(modal.textContent).toMatch(/Biometría/);
  });

  it('botón close dispara onCancel', () => {
    const ch = makeChallenge();
    const onCancel = vi.fn();
    render(<QrSignatureModal challenge={ch} onCancel={onCancel} now={NOW} />);
    fireEvent.click(screen.getByTestId(`qr-sig-close-${ch.challengeId}`));
    expect(onCancel).toHaveBeenCalled();
  });
});
