// Praeventio Guard — Fase F.5 page wrapper.
//
// Centro de Firma QR de Recepción. Esta página cierra el wire end-to-end
// del flujo F.5 (EPP, charlas, documentos, capacitaciones, permisos,
// inspecciones): el motor HMAC + el modal QR ya existían, pero no había
// page que orqueste challenge → render → ack.
//
// Flujo:
//   1. Supervisor selecciona `kind` + escribe `itemId`.
//   2. Click "Generar QR" → `requestQrSignatureChallenge()` → 201 con
//      challenge firmado.
//   3. Se renderiza `<QrSignatureModal>` con countdown TTL.
//   4. El trabajador escanea con su app autenticada y firma (su app POST
//      al endpoint /acknowledge). Para soportar polling sin sockets, esta
//      page expone también un botón "Marcar firmado" que dispara
//      `persistQrAcknowledgement` en supervisión presencial (tablet del
//      supervisor frente al trabajador con biometría).
//   5. Confirmación + reset para emitir otro.
//
// Directiva del usuario (product_signing_no_blocking_directives_2026-05-06):
// generamos el comprobante de firma; NUNCA empujamos a SUSESO/SII/MINSAL.
// La empresa firma + entrega el documento a la autoridad por su cuenta.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScanLine, WifiOff, ShieldCheck } from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import {
  requestQrSignatureChallenge,
  persistQrAcknowledgement,
} from '../hooks/useSprintK';
import { QrSignatureModal } from '../components/qrSignature/QrSignatureModal';
import type {
  QrSignatureChallenge,
  SignatureItemKind,
  SignedAcknowledgement,
} from '../services/qrSignature/qrSignatureService';
import { logger } from '../utils/logger';

const KIND_OPTIONS: ReadonlyArray<{ value: SignatureItemKind; label: string }> = [
  { value: 'epp_delivery', label: 'Entrega de EPP' },
  { value: 'safety_talk', label: 'Charla de seguridad' },
  { value: 'document_read', label: 'Lectura de documento' },
  { value: 'training_completion', label: 'Capacitación' },
  { value: 'permit_acknowledgement', label: 'Permiso de trabajo' },
  { value: 'inspection_handover', label: 'Entrega de inspección' },
];

export function QrSignature() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const isOnline = useOnlineStatus();
  const projectId = selectedProject?.id ?? null;

  const [kind, setKind] = useState<SignatureItemKind>('epp_delivery');
  const [itemId, setItemId] = useState('');
  const [workerUid, setWorkerUid] = useState('');
  const [challenge, setChallenge] = useState<QrSignatureChallenge | null>(null);
  const [acknowledgement, setAcknowledgement] =
    useState<SignedAcknowledgement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const handleGenerate = async () => {
    if (!projectId || !itemId.trim()) return;
    setLoading(true);
    setError(null);
    setAcknowledgement(null);
    try {
      const c = await requestQrSignatureChallenge(
        projectId,
        itemId.trim(),
        kind,
      );
      setChallenge(c);
    } catch (err) {
      logger.error('qrSignature.page.challenge.failed', err);
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  };

  // Codex P2 (PR #313, line 93): NUNCA enviar `biometricUsed: true` sin
  // un challenge biométrico real — eso corrompía la evidencia de
  // auditoría (todos los acks aparecían respaldados por huella aunque
  // hubieran sido tipeados). Llamamos al plugin Capacitor lazy-loaded
  // (mismo patrón que Site25DPanel/DigitalTwinFaena); si el plugin no
  // está disponible (web sin Capacitor, simulador) o el usuario
  // cancela, el ack se persiste con `biometricUsed: false` — el
  // supervisor sigue siendo responsable de la firma manual, pero la
  // bandera no miente.
  const tryBiometric = async (): Promise<boolean> => {
    try {
      const mod: any = await import(
        /* @vite-ignore */ '@aparajita/capacitor-biometric-auth'
      );
      const result = await mod.BiometricAuth.authenticate({
        reason: 'Verifica tu identidad para firmar la recepción',
        cancelTitle: 'Cancelar',
      });
      return Boolean(result?.isAuthenticated ?? true);
    } catch (err) {
      logger.warn?.('qrSignature.page.biometric.unavailable', err);
      return false;
    }
  };

  const handleAck = async () => {
    if (!projectId || !challenge || !workerUid.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const biometricOk = await tryBiometric();
      const ack = await persistQrAcknowledgement(projectId, {
        challengeId: challenge.challengeId,
        workerUid: workerUid.trim(),
        // Sólo true si el plugin biométrico devolvió isAuthenticated:true.
        biometricUsed: biometricOk,
        signedAt: new Date().toISOString(),
      });
      // Promote the server payload to the SignedAcknowledgement shape
      // the modal expects. Server stores its own audit fields; the modal
      // only reads challengeId/signedByUid/signedAt/biometricUsed.
      setAcknowledgement({
        challengeId: ack.challengeId,
        itemId: challenge.itemId,
        kind: challenge.kind,
        projectId: challenge.projectId,
        initiatedByUid: challenge.initiatedByUid,
        signedByUid: (ack as unknown as { workerUid?: string }).workerUid ?? workerUid.trim(),
        signedAt: ack.signedAt,
        biometricUsed:
          (ack as unknown as { biometricUsed?: boolean }).biometricUsed ?? biometricOk,
      });
    } catch (err) {
      logger.error('qrSignature.page.acknowledge.failed', err);
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setChallenge(null);
    setAcknowledgement(null);
    setItemId('');
    setWorkerUid('');
    setError(null);
  };

  if (!selectedProject) {
    return (
      <div
        className="flex-1 w-full p-4 sm:p-6 max-w-3xl mx-auto"
        data-testid="qr-signature-page-empty"
      >
        <div className="rounded-2xl border border-default-token bg-surface p-8 text-center">
          <ScanLine
            className="w-12 h-12 mx-auto mb-4 text-secondary-token"
            aria-hidden="true"
          />
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('qrSig.page.title', 'Firma QR de Recepción')}
          </h1>
          <p className="mt-2 text-sm text-secondary-token">
            {t(
              'qrSig.page.selectProject',
              'Selecciona un proyecto para emitir firmas QR.',
            )}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex-1 w-full p-4 sm:p-6 max-w-3xl mx-auto space-y-4"
      data-testid="qr-signature-page"
    >
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-violet-500/10 text-violet-500 flex items-center justify-center border border-violet-500/20">
          <ScanLine className="w-5 h-5" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('qrSig.page.title', 'Firma QR de Recepción')}
          </h1>
          <p className="text-xs text-secondary-token">
            {t(
              'qrSig.page.subtitle',
              'EPP, charlas, documentos, capacitaciones — firma con HMAC + biometría.',
            )}
          </p>
        </div>
        {!isOnline && (
          <span
            className="ml-auto flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400"
            data-testid="qr-signature-offline-chip"
          >
            <WifiOff className="w-3 h-3" aria-hidden="true" />
            {t('common.offline', 'Sin conexión')}
          </span>
        )}
      </header>

      {!challenge && (
        <section
          className="rounded-2xl border border-default-token bg-surface p-4 space-y-3"
          data-testid="qr-signature-form"
        >
          <div className="space-y-1">
            <label
              htmlFor="qr-sig-kind"
              className="text-xs font-bold uppercase tracking-wide text-secondary-token"
            >
              {t('qrSig.page.kindLabel', 'Tipo de firma')}
            </label>
            <div
              id="qr-sig-kind"
              role="radiogroup"
              aria-label={t('qrSig.page.kindLabel', 'Tipo de firma') as string}
              className="grid grid-cols-2 gap-2"
            >
              {KIND_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={kind === opt.value}
                  onClick={() => setKind(opt.value)}
                  data-testid={`qr-sig-kind-${opt.value}`}
                  className={`text-xs font-bold px-3 py-2 rounded-xl border transition-colors ${
                    kind === opt.value
                      ? 'border-violet-500 bg-violet-500/10 text-violet-700 dark:text-violet-300'
                      : 'border-default-token text-secondary-token hover:bg-surface-hover'
                  }`}
                >
                  {t(`qrSig.kind.${opt.value}`, opt.label)}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <label
              htmlFor="qr-sig-item-id"
              className="text-xs font-bold uppercase tracking-wide text-secondary-token"
            >
              {t('qrSig.page.itemIdLabel', 'ID del ítem')}
            </label>
            <input
              id="qr-sig-item-id"
              type="text"
              value={itemId}
              onChange={(e) => setItemId(e.target.value)}
              placeholder={t(
                'qrSig.page.itemIdPlaceholder',
                'ej. arnes-001, charla-2026-05-17',
              ) as string}
              data-testid="qr-sig-item-id-input"
              className="w-full rounded-xl border border-default-token bg-surface px-3 py-2 text-sm text-primary-token focus:outline-none focus:ring-2 focus:ring-violet-500/40"
            />
          </div>

          <button
            type="button"
            onClick={handleGenerate}
            disabled={loading || !itemId.trim() || !isOnline}
            data-testid="qr-sig-generate-btn"
            className="w-full rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-black uppercase tracking-wide text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading
              ? t('qrSig.page.generating', 'Generando…')
              : t('qrSig.page.generate', 'Generar QR')}
          </button>
        </section>
      )}

      {loading && !challenge && (
        <div
          className="rounded-2xl border border-default-token bg-surface p-6 text-center text-sm text-secondary-token"
          data-testid="qr-signature-loading"
        >
          {t('common.loading', 'Cargando…')}
        </div>
      )}

      {error && (
        <div
          className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-600 dark:text-rose-400"
          data-testid="qr-signature-error"
          role="alert"
        >
          {t('qrSig.page.error', 'No se pudo procesar la firma: {{msg}}', {
            msg: error.message,
          })}
        </div>
      )}

      {challenge && (
        <div className="space-y-3" data-testid="qr-signature-modal-wrapper">
          <QrSignatureModal
            challenge={challenge}
            acknowledgement={acknowledgement ?? undefined}
            onCancel={handleReset}
            onRegenerate={handleGenerate}
          />

          {!acknowledgement && (
            <section
              className="rounded-2xl border border-default-token bg-surface p-4 space-y-3"
              data-testid="qr-sig-ack-form"
            >
              <p className="text-[11px] text-secondary-token">
                {t(
                  'qrSig.page.ackHelp',
                  'Para firmas presenciales en la tablet del supervisor, ingresa el UID del trabajador y registra la firma con biometría.',
                )}
              </p>
              <div className="space-y-1">
                <label
                  htmlFor="qr-sig-worker-uid"
                  className="text-xs font-bold uppercase tracking-wide text-secondary-token"
                >
                  {t('qrSig.page.workerUidLabel', 'UID del trabajador')}
                </label>
                <input
                  id="qr-sig-worker-uid"
                  type="text"
                  value={workerUid}
                  onChange={(e) => setWorkerUid(e.target.value)}
                  data-testid="qr-sig-worker-uid-input"
                  className="w-full rounded-xl border border-default-token bg-surface px-3 py-2 text-sm text-primary-token focus:outline-none focus:ring-2 focus:ring-violet-500/40"
                />
              </div>
              <button
                type="button"
                onClick={handleAck}
                disabled={loading || !workerUid.trim() || !isOnline}
                data-testid="qr-sig-ack-btn"
                className="w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-black uppercase tracking-wide text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <ShieldCheck className="w-4 h-4" aria-hidden="true" />
                {loading
                  ? t('qrSig.page.persisting', 'Registrando…')
                  : t('qrSig.page.acknowledge', 'Registrar firma')}
              </button>
            </section>
          )}

          {acknowledgement && (
            <button
              type="button"
              onClick={handleReset}
              data-testid="qr-sig-new-btn"
              className="w-full rounded-xl border border-default-token bg-surface px-4 py-2.5 text-sm font-bold text-primary-token hover:bg-surface-hover"
            >
              {t('qrSig.page.newSignature', 'Emitir otra firma')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default QrSignature;
