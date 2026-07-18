// Praeventio Guard — Sprint 39 Bloque 3 wire — <EvacuationQRScanner />.
//
// QR scanner para que un worker (o supervisor) escanee la credencial al
// llegar al punto de encuentro. Reusa `html5-qrcode` (ya instalado y usado
// en `src/components/QRScannerModal.tsx`), encapsulado para la semántica de
// evacuación: el QR DEBE codificar el `workerUid` (texto plano, formato
// canónico `worker:{uid}` o el uid pelado — aceptamos ambos para mejor UX
// si el supervisor pegó un QR existente del trabajador).
//
// Paleta usuario: teal #4db6ac primary, sobre fondo oscuro modal-style.
// Dark-mode-first porque en una emergencia real el teléfono SUELE estar en
// modo oscuro y la cámara entrega imagen oscura — el contraste teal/black
// es lo que mejor funciona en faena nocturna.

import { useEffect, useRef, useState } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { motion, AnimatePresence } from 'framer-motion';
import { X, QrCode, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { logger } from '../../utils/logger';
import { humanErrorMessage } from '../../lib/humanError';


const TEAL = '#4db6ac';

export interface EvacuationQRScannerProps {
  /** Se llama con el workerUid decodificado. El parent posta a /scan-qr. */
  onScanned: (workerUid: string) => void;
  /** Cierra el modal sin escanear. */
  onClose: () => void;
}

// Acepta `worker:{uid}`, `uid:{uid}` o el uid pelado. Devuelve el uid
// normalizado o null si no es parseable.
export function parseWorkerQrPayload(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 256) return null;

  const lower = trimmed.toLowerCase();
  if (lower.startsWith('worker:')) {
    const rest = trimmed.slice('worker:'.length).trim();
    return rest.length > 0 ? rest : null;
  }
  if (lower.startsWith('uid:')) {
    const rest = trimmed.slice('uid:'.length).trim();
    return rest.length > 0 ? rest : null;
  }
  // Plain uid — must look like a Firebase Auth uid (alphanumeric, length
  // 6-128, no spaces). We're permissive on charset to allow custom auth.
  if (/^[A-Za-z0-9_-]{6,128}$/.test(trimmed)) return trimmed;
  return null;
}

const ELEMENT_ID = 'evacuation-qr-reader';

export function EvacuationQRScanner({
  onScanned,
  onClose,
}: EvacuationQRScannerProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);

  useEffect(() => {
    const scanner = new Html5QrcodeScanner(
      ELEMENT_ID,
      { fps: 10, qrbox: { width: 250, height: 250 } },
      /* verbose */ false,
    );
    scannerRef.current = scanner;

    scanner.render(
      (decodedText: string) => {
        const uid = parseWorkerQrPayload(decodedText);
        if (!uid) {
          setParseError('QR no reconocido como credencial de trabajador.');
          return;
        }
        setBusy(true);
        scanner
          .clear()
          .catch((err: unknown) => {
            logger.error?.('evacuation_qr_clear_failed', err);
          })
          .finally(() => {
            onScanned(uid);
          });
      },
      (_err: string) => {
        // Errores frame-a-frame son normales (no hay QR a la vista) —
        // los ignoramos silenciosamente.
      },
    );

    return () => {
      scanner.clear().catch((err: unknown) => {
        logger.error?.('evacuation_qr_clear_failed_unmount', err);
      });
      scannerRef.current = null;
    };
  }, [onScanned]);

  return (
    <AnimatePresence>
      <motion.div
        key="evacuation-qr-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
        data-testid="evacuation-qr-modal"
      >
        <div
          onClick={onClose}
          className="absolute inset-0 bg-black/80 backdrop-blur-sm"
          aria-hidden="true"
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="relative w-full max-w-md rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh] bg-zinc-900 border"
          style={{ borderColor: `${TEAL}55` }}
          role="dialog"
          aria-modal="true"
          aria-label={
            t(
              'evacuation.qr.aria',
              'Escanear credencial QR del trabajador',
            ) as string
          }
        >
          <div
            className="p-6 border-b border-white/5 flex items-center justify-between shrink-0"
            style={{
              background: `linear-gradient(90deg, ${TEAL}26 0%, transparent 100%)`,
            }}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ backgroundColor: `${TEAL}33`, color: TEAL }}
              >
                <QrCode className="w-5 h-5 sm:w-6 sm:h-6" />
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-black text-white uppercase tracking-tight truncate">
                  {t('evacuation.qr.title', 'Escanear credencial')}
                </h2>
                <p
                  className="text-[10px] font-bold uppercase tracking-widest truncate"
                  style={{ color: TEAL }}
                >
                  {t(
                    'evacuation.qr.subtitle',
                    'Conteo en punto de encuentro',
                  )}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl transition-colors text-zinc-400 hover:text-white hover:bg-white/10 shrink-0"
              aria-label={t('common.close', 'Cerrar') as string}
              data-testid="evacuation-qr-close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-6 flex flex-col items-center overflow-y-auto flex-1">
            {busy ? (
              <div className="flex flex-col items-center justify-center py-12 gap-4">
                <Loader2 className="w-8 h-8 animate-spin" style={{ color: TEAL }} />
                <p
                  className="text-sm font-bold uppercase tracking-widest"
                  style={{ color: TEAL }}
                >
                  {t('evacuation.qr.processing', 'Registrando…')}
                </p>
              </div>
            ) : (
              <div
                id={ELEMENT_ID}
                data-testid="evacuation-qr-reader"
                className="w-full overflow-hidden rounded-2xl border-2 border-dashed border-white/10 bg-zinc-800/50"
              />
            )}

            <p className="text-xs text-zinc-400 text-center mt-6">
              {t(
                'evacuation.qr.hint',
                'Apunta la cámara hacia el QR del trabajador para registrarlo como seguro en el punto de encuentro.',
              )}
            </p>

            {parseError && (
              <p
                className="text-[11px] text-rose-300 mt-3 text-center font-bold"
                data-testid="evacuation-qr-parse-error"
              >
                {humanErrorMessage(parseError)}
              </p>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
