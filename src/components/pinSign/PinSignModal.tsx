// Praeventio Guard — Sprint K F.25: <PinSignModal />
//
// Componente reusable para firmar items sin biometría. Recibe los datos
// del item (itemId, kind) y dispara `signItemWithPinApi` para verificar PIN
// + emitir acknowledgement atómicamente. La credencial PIN vive SERVER-SIDE
// (B17): el cliente sólo envía el PIN; nunca maneja el hash/salt ni el
// contador de lockout. UX: campo 4-6 dígitos numérico + masked + soft-keyboard
// numérico en mobile (`inputMode="numeric"`), con feedback de lockout.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRound, Lock, AlertTriangle, CheckCircle2, Loader2, X } from 'lucide-react';
import { Card } from '../shared/Card';
import {
  signItemWithPinApi,
  type SignItemInput,
  type SignItemResponse,
} from '../../hooks/usePinSign';
import type {
  PinSignItemKind,
  PinSignedAcknowledgement,
} from '../../services/pinSign/pinSignService';

export interface PinSignModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  itemId: string;
  kind: PinSignItemKind;
  /** Lat/lng opcional para audit. */
  location?: { lat: number; lng: number };
  /**
   * Callback con el acknowledgement firmado. El caller decide cómo persistir
   * el ack (típicamente a `signatures/{id}`). La credencial PIN ya se
   * actualizó server-side dentro del endpoint sign-item.
   */
  onSigned: (result: { acknowledgement: PinSignedAcknowledgement }) => void;
}

export function PinSignModal({
  isOpen,
  onClose,
  projectId,
  itemId,
  kind,
  location,
  onSigned,
}: PinSignModalProps) {
  const { t } = useTranslation();
  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockoutMinutes, setLockoutMinutes] = useState<number | null>(null);

  if (!isOpen) return null;

  const valid = /^\d{4,6}$/.test(pin);

  async function handleSign() {
    if (!valid) {
      setError(t('pinSign.errors.format', 'El PIN debe tener 4 a 6 dígitos.') as string);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const input: SignItemInput = {
        pin,
        itemId,
        kind,
        location,
      };
      const response: SignItemResponse = await signItemWithPinApi(projectId, input);
      if (response.ok && response.acknowledgement) {
        onSigned({ acknowledgement: response.acknowledgement });
        setPin('');
        onClose();
      } else if (response.justLockedOut || response.remainingLockoutMinutes) {
        setLockoutMinutes(response.remainingLockoutMinutes ?? null);
        setError(
          t(
            'pinSign.errors.lockedOut',
            'Cuenta bloqueada por demasiados intentos. Intenta más tarde.',
          ) as string,
        );
      } else {
        // The failure counter is server-authoritative and not returned to the
        // client; show a generic wrong-PIN message.
        setError(t('pinSign.errors.wrongPin', 'PIN incorrecto.') as string);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : (t('pinSign.errors.unknown', 'Error desconocido.') as string),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pin-sign-modal-title"
    >
      <Card className="w-full max-w-sm m-4 p-5 space-y-4" interactive={false}>
        <header className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-amber-500" aria-hidden="true" />
            <h2
              id="pin-sign-modal-title"
              className="text-base font-black text-primary-token uppercase tracking-wide"
            >
              {t('pinSign.title', 'Firmar con PIN')}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-full p-1 hover:bg-surface-token disabled:opacity-50"
            aria-label={t('common.close', 'Cerrar') as string}
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <p className="text-xs text-secondary-token">
          {t(
            'pinSign.description',
            'Ingresa tu PIN para firmar este item. Es una alternativa cuando no tienes biometría disponible.',
          )}
        </p>

        <div className="space-y-2">
          <label
            htmlFor="pin-sign-input"
            className="text-xs font-semibold uppercase tracking-wide text-secondary-token flex items-center gap-1"
          >
            <Lock className="w-3 h-3" aria-hidden="true" />
            {t('pinSign.pinLabel', 'PIN (4-6 dígitos)')}
          </label>
          <input
            id="pin-sign-input"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            pattern="\d{4,6}"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && valid && !submitting) handleSign();
            }}
            disabled={submitting || lockoutMinutes !== null}
            className="w-full rounded-xl border border-default-token bg-input-token px-3 py-2 text-center text-xl font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-50"
            data-testid="pin-sign-input"
            aria-describedby={error ? 'pin-sign-error' : undefined}
          />
        </div>

        {error && (
          <div
            id="pin-sign-error"
            role="alert"
            className="flex items-start gap-2 rounded-lg bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-700 dark:text-rose-300"
          >
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {lockoutMinutes !== null && lockoutMinutes > 0 && (
          <div
            role="status"
            className="flex items-center gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"
          >
            <AlertTriangle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
            <span>
              {t(
                'pinSign.lockoutCountdown',
                'Cuenta bloqueada por {{n}} minutos.',
                { n: lockoutMinutes },
              )}
            </span>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-xl border border-default-token px-3 py-1.5 text-sm font-semibold text-secondary-token hover:bg-surface-token disabled:opacity-50"
          >
            {t('common.cancel', 'Cancelar')}
          </button>
          <button
            type="button"
            onClick={handleSign}
            disabled={!valid || submitting || lockoutMinutes !== null}
            data-testid="pin-sign-submit"
            className="inline-flex items-center gap-1.5 rounded-xl bg-teal-600 hover:bg-teal-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {submitting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            <span>{t('pinSign.submit', 'Firmar')}</span>
          </button>
        </div>
      </Card>
    </div>
  );
}
