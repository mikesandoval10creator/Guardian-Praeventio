// Praeventio Guard — Wire UI Sprint 40 F.5: QR signature modal.
//
// Componente que muestra el QR al supervisor + countdown TTL + manejo
// del estado de firma (waiting → signed). El componente NO genera el
// challenge — recibe uno ya construido por el server.

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { QRCodeSVG } from 'qrcode.react';
import { ScanLine, Clock, ShieldCheck, X, RefreshCw } from 'lucide-react';
import {
  encodeForQr,
  type QrSignatureChallenge,
  type SignedAcknowledgement,
} from '../../services/qrSignature/qrSignatureService.js';

interface QrSignatureModalProps {
  challenge: QrSignatureChallenge;
  /** Si el trabajador ya firmó (server polling lo detectó). */
  acknowledgement?: SignedAcknowledgement;
  onCancel?: () => void;
  onRegenerate?: () => void;
  /** Override now para tests. */
  now?: Date;
}

function secondsBetween(a: Date, b: Date): number {
  return Math.max(0, Math.floor((b.getTime() - a.getTime()) / 1000));
}

function formatMmSs(sec: number): string {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = (sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export function QrSignatureModal({
  challenge,
  acknowledgement,
  onCancel,
  onRegenerate,
  now,
}: QrSignatureModalProps) {
  const { t } = useTranslation();
  const [tick, setTick] = useState(0);

  // Codex P2 PR #94: stale-ack guard reused for effect + expired checks.
  const ackMatchesChallenge =
    Boolean(acknowledgement) &&
    acknowledgement?.challengeId === challenge.challengeId;

  // Re-render cada 1s para countdown
  useEffect(() => {
    if (ackMatchesChallenge) return undefined; // ya firmado, no countdown
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [ackMatchesChallenge]);

  const currentNow = now ?? new Date();
  // tick consumed para forzar re-render (no se usa directo)
  void tick;
  const expiresMs = useMemo(() => Date.parse(challenge.expiresAt), [challenge.expiresAt]);
  const remainingSec = secondsBetween(currentNow, new Date(expiresMs));
  const expired = !ackMatchesChallenge && remainingSec === 0;

  const qrPayload = useMemo(() => encodeForQr(challenge), [challenge]);

  // Codex P2 PR #94: only switch to signed state if the acknowledgement
  // matches the CURRENT challenge. Prevents late polling responses or
  // regenerated QRs from showing a stale signed banner.
  const matchingAck =
    acknowledgement && acknowledgement.challengeId === challenge.challengeId
      ? acknowledgement
      : undefined;

  if (matchingAck) {
    return (
      <section
        role="dialog"
        aria-modal="true"
        className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 shadow-mode space-y-3"
        data-testid={`qr-sig-modal-${challenge.challengeId}-signed`}
        aria-label={t('qrSig.signedAria', 'Firma completada') as string}
      >
        <header className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-emerald-500" aria-hidden="true" />
          <h2 className="text-sm font-black uppercase text-primary-token">
            {t('qrSig.signedTitle', 'Firma completada')}
          </h2>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              data-testid={`qr-sig-close-${challenge.challengeId}`}
              className="ml-auto text-secondary-token"
              aria-label={t('qrSig.close', 'Cerrar') as string}
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
        </header>
        <p className="text-xs text-secondary-token">
          {t('qrSig.signedBy', 'Firmado por')}:{' '}
          <span className="font-bold tabular-nums">{matchingAck.signedByUid}</span>
        </p>
        <p className="text-[10px] text-secondary-token tabular-nums">
          {matchingAck.signedAt.slice(0, 19).replace('T', ' ')}{' '}
          {matchingAck.biometricUsed && (
            <span className="ml-2 inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
              ✓ {t('qrSig.biometric', 'Biometría')}
            </span>
          )}
        </p>
      </section>
    );
  }

  return (
    <section
      role="dialog"
      aria-modal="true"
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
      data-testid={`qr-sig-modal-${challenge.challengeId}`}
      aria-label={t('qrSig.aria', 'Firma QR') as string}
    >
      <header className="flex items-center gap-2">
        <ScanLine className="w-5 h-5 text-sky-500" aria-hidden="true" />
        <h2 className="text-sm font-black uppercase text-primary-token tracking-wide">
          {t(`qrSig.kind.${challenge.kind}`, challenge.kind)}
        </h2>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            data-testid={`qr-sig-close-${challenge.challengeId}`}
            className="ml-auto text-secondary-token"
            aria-label={t('qrSig.close', 'Cerrar') as string}
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        )}
      </header>

      <p className="text-[11px] text-secondary-token">
        {t(
          'qrSig.instructions',
          'El trabajador debe escanear el código con la app Praeventio autenticada para firmar.',
        )}
      </p>

      <div className="flex justify-center">
        {expired ? (
          <div
            className="flex flex-col items-center gap-2 text-rose-600 p-4"
            data-testid={`qr-sig-expired-${challenge.challengeId}`}
          >
            <p className="text-xs font-bold uppercase">{t('qrSig.expired', 'Caducado')}</p>
            {onRegenerate && (
              <button
                type="button"
                onClick={onRegenerate}
                data-testid={`qr-sig-regenerate-${challenge.challengeId}`}
                className="flex items-center gap-1 text-xs font-bold text-sky-600 underline"
              >
                <RefreshCw className="w-3 h-3" aria-hidden="true" />
                {t('qrSig.regenerate', 'Regenerar QR')}
              </button>
            )}
          </div>
        ) : (
          <div
            className="bg-white p-3 rounded"
            data-testid={`qr-sig-qrcode-${challenge.challengeId}`}
          >
            <QRCodeSVG value={qrPayload} size={196} level="M" />
          </div>
        )}
      </div>

      {!expired && (
        <div className="flex items-center justify-center gap-2 text-xs text-secondary-token">
          <Clock className="w-3 h-3" aria-hidden="true" />
          <span data-testid={`qr-sig-countdown-${challenge.challengeId}`}>
            {t('qrSig.expiresIn', 'Vence en')}{' '}
            <span className="font-black tabular-nums">{formatMmSs(remainingSec)}</span>
          </span>
        </div>
      )}

      <div className="text-[10px] text-secondary-token text-center" data-testid={`qr-sig-itemid-${challenge.challengeId}`}>
        {t('qrSig.item', 'Ítem')}:{' '}
        <span className="font-mono">{challenge.itemId}</span>
      </div>
    </section>
  );
}
