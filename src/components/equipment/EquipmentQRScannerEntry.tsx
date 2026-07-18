// Praeventio Guard — Bloque 3 wire huérfanos (3.11) <EquipmentQRScannerEntry />.
//
// Mobile entry screen: trabajador activa la cámara, escanea el QR del
// equipo y, una vez decodificado, hacemos lookup al server y renderizamos
// `<PreUseChecklistMobile />` con el qrId resuelto.
//
// Reutiliza la lib `html5-qrcode` (ya en use en EvacuationQRScanner +
// QRScannerModal). La parsing function vive en useEquipmentQr.ts para
// poder unit-testearla sin necesidad de tocar la cámara.

import { useEffect, useRef, useState } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ScanLine, Loader2, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { humanErrorMessage } from '../../lib/humanError';
import { logger } from '../../utils/logger';
import {
  lookupEquipmentByQr,
  parseEquipmentQrPayload,
  type LookupEquipmentResponse,
} from '../../hooks/useEquipmentQr';
import { PreUseChecklistMobile } from './PreUseChecklistMobile';

const TEAL = '#4db6ac';
const ELEMENT_ID = 'equipment-qr-reader';

export interface EquipmentQRScannerEntryProps {
  projectId: string;
  /** Cerrar sin escanear. */
  onClose: () => void;
}

type Phase =
  | { kind: 'scanning' }
  | { kind: 'looking-up'; qrId: string }
  | { kind: 'checklist'; data: LookupEquipmentResponse }
  | { kind: 'submitted' }
  | { kind: 'error'; message: string };

export function EquipmentQRScannerEntry({
  projectId,
  onClose,
}: EquipmentQRScannerEntryProps) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>({ kind: 'scanning' });
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);

  useEffect(() => {
    if (phase.kind !== 'scanning') return undefined;
    const scanner = new Html5QrcodeScanner(
      ELEMENT_ID,
      { fps: 10, qrbox: { width: 250, height: 250 } },
      /* verbose */ false,
    );
    scannerRef.current = scanner;
    scanner.render(
      (decodedText: string) => {
        const qrId = parseEquipmentQrPayload(decodedText);
        if (!qrId) {
          setPhase({
            kind: 'error',
            message: 'QR no reconocido como equipo registrado.',
          });
          return;
        }
        setPhase({ kind: 'looking-up', qrId });
        scanner.clear().catch((err: unknown) => {
          logger.error?.('equipment_qr_clear_failed', err);
        });
      },
      (_err: string) => {
        // Frame errors are normal (no QR in view), ignore.
      },
    );
    return () => {
      scanner.clear().catch((err: unknown) => {
        logger.error?.('equipment_qr_clear_failed_unmount', err);
      });
      scannerRef.current = null;
    };
  }, [phase.kind]);

  useEffect(() => {
    if (phase.kind !== 'looking-up') return;
    let cancelled = false;
    (async () => {
      try {
        const data = await lookupEquipmentByQr(projectId, phase.qrId);
        if (!cancelled) setPhase({ kind: 'checklist', data });
      } catch (err) {
        if (!cancelled) {
          setPhase({
            kind: 'error',
            message: humanErrorMessage((err as Error).message ?? 'lookup_failed'),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phase, projectId]);

  // Once the worker has submitted, we fall back to a confirmation screen.
  if (phase.kind === 'checklist') {
    return (
      <PreUseChecklistMobile
        projectId={projectId}
        equipment={phase.data.equipment}
        checklist={phase.data.checklist}
        onSubmitted={() => setPhase({ kind: 'submitted' })}
        onCancel={onClose}
      />
    );
  }

  if (phase.kind === 'submitted') {
    return (
      <section
        className="min-h-screen bg-zinc-950 text-white flex flex-col items-center justify-center p-6 text-center"
        data-testid="equipment-qr-submitted"
      >
        <div className="space-y-3 max-w-sm">
          <ScanLine
            className="w-12 h-12 mx-auto"
            style={{ color: TEAL }}
            aria-hidden="true"
          />
          <h2 className="text-lg font-black uppercase tracking-tight">
            {t('equipmentQr.submittedTitle', 'Registro guardado')}
          </h2>
          <p className="text-sm text-zinc-400 leading-relaxed">
            {t(
              'equipmentQr.submittedHint',
              'El pre-uso quedó archivado en el historial del equipo.',
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          data-testid="equipment-qr-done"
          className="mt-8 w-full max-w-sm py-3 rounded-2xl bg-zinc-800 text-white text-sm font-bold uppercase tracking-widest hover:bg-zinc-700"
        >
          {t('common.done', 'Listo')}
        </button>
      </section>
    );
  }

  return (
    <AnimatePresence>
      <motion.div
        key="equipment-qr-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
        data-testid="equipment-qr-modal"
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
            t('equipmentQr.aria', 'Escanear QR del equipo') as string
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
                <ScanLine className="w-5 h-5 sm:w-6 sm:h-6" />
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-black text-white uppercase tracking-tight truncate">
                  {t('equipmentQr.title', 'Escanear equipo')}
                </h2>
                <p
                  className="text-[10px] font-bold uppercase tracking-widest truncate"
                  style={{ color: TEAL }}
                >
                  {t('equipmentQr.subtitle', 'Pre-uso obligatorio')}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl transition-colors text-zinc-400 hover:text-white hover:bg-white/10 shrink-0"
              aria-label={t('common.close', 'Cerrar') as string}
              data-testid="equipment-qr-close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="p-6 flex flex-col items-center overflow-y-auto flex-1">
            {phase.kind === 'scanning' && (
              <>
                <div
                  id={ELEMENT_ID}
                  data-testid="equipment-qr-reader"
                  className="w-full overflow-hidden rounded-2xl border-2 border-dashed border-white/10 bg-zinc-800/50"
                />
                <p className="text-xs text-zinc-400 text-center mt-6">
                  {t(
                    'equipmentQr.hint',
                    'Apunta la cámara al QR del equipo para iniciar el checklist pre-uso.',
                  )}
                </p>
              </>
            )}
            {phase.kind === 'looking-up' && (
              <div className="flex flex-col items-center justify-center py-12 gap-4">
                <Loader2
                  className="w-8 h-8 animate-spin"
                  style={{ color: TEAL }}
                  aria-hidden="true"
                />
                <p
                  className="text-sm font-bold uppercase tracking-widest"
                  style={{ color: TEAL }}
                  data-testid="equipment-qr-looking-up"
                >
                  {t('equipmentQr.lookingUp', 'Buscando equipo…')}
                </p>
              </div>
            )}
            {phase.kind === 'error' && (
              <div
                className="w-full p-4 rounded-2xl border border-rose-500/40 bg-rose-500/10 text-rose-200 space-y-2"
                data-testid="equipment-qr-error"
              >
                <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest">
                  <AlertTriangle className="w-4 h-4" aria-hidden="true" />
                  {t('equipmentQr.errorTitle', 'No se pudo procesar el QR')}
                </div>
                <p className="text-xs leading-relaxed">{phase.message}</p>
                <button
                  type="button"
                  onClick={() => setPhase({ kind: 'scanning' })}
                  data-testid="equipment-qr-retry"
                  className="mt-2 w-full py-2 rounded-xl bg-rose-500/30 text-rose-100 text-xs font-bold uppercase tracking-widest hover:bg-rose-500/40"
                >
                  {t('common.retry', 'Reintentar')}
                </button>
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
