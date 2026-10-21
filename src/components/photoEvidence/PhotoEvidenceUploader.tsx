// Praeventio Guard — subida real de evidencia fotográfica.
//
// El motor (`uploadPhotoEvidenceBytes`) ya existía pero no tenía ninguna
// pantalla que lo llamara: la evidencia se podía listar, no crear. Este
// componente cierra ese circuito desde el expediente de incidente:
//   archivo → SHA-256 → Storage content-addressed → metadata + linkage.
//
// Solo supervisores/administradores ven el control. El endpoint de listado
// ya es supervisor-only y el POST exige membresía del proyecto; ocultar el
// formulario a un trabajador evita ofrecerle una acción que el servidor
// rechazaría.

import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Loader2,
  Upload,
  WifiOff,
} from 'lucide-react';
import { useFirebase } from '../../contexts/FirebaseContext';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import {
  uploadPhotoEvidenceBytes,
  type UploadedPhotoEvidence,
} from '../../hooks/usePhotoEvidence';
import {
  PhotoEvidenceValidationError,
  type LinkedNodeKind,
} from '../../services/photoEvidence/photoEvidenceEngine';
import { humanErrorMessage } from '../../lib/humanError';
import { isAdminRole, isSupervisorRole } from '../../types/roles';
import { logger } from '../../utils/logger';

const ACCEPTED_TYPES =
  'image/jpeg,image/png,image/webp,video/mp4,video/webm';
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_FILE_BYTES = 50 * 1024 * 1024;

export interface PhotoEvidenceUploaderProps {
  projectId: string;
  nodeKind: LinkedNodeKind;
  nodeId: string;
  onUploaded?: (uploaded: UploadedPhotoEvidence) => void;
}

function requestLocation(): Promise<{ lat: number; lng: number } | null> {
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 4_000, maximumAge: 60_000 },
    );
  });
}

function uploadErrorMessage(error: unknown): string {
  if (error instanceof PhotoEvidenceValidationError) {
    if (error.code === 'invalid_mime') {
      return 'Formato no soportado. Usa JPG, PNG, WebP, MP4 o WebM.';
    }
    if (error.code === 'too_large') {
      return 'El archivo es demasiado grande. Las imágenes pueden pesar hasta 25 MB y los videos hasta 50 MB.';
    }
    if (error.code === 'future_capture' || error.code === 'invalid_capture_date') {
      return 'La fecha de captura no es válida. Vuelve a tomar la foto e inténtalo de nuevo.';
    }
    if (error.code === 'invalid_filename') {
      return 'El archivo no tiene un nombre válido. Renómbralo e inténtalo de nuevo.';
    }
    if (error.code === 'missing_uid') {
      return 'Tu sesión no es válida. Vuelve a iniciar sesión para subir evidencia.';
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'linkage_required') {
    return 'La evidencia debe estar vinculada a un incidente. Recarga la página e inténtalo de nuevo.';
  }
  if (message === 'sha256_unavailable_insecure_context') {
    return 'Este navegador no puede verificar el archivo porque la conexión no es segura. Abre la app con HTTPS.';
  }
  return humanErrorMessage(error);
}

export function PhotoEvidenceUploader({
  projectId,
  nodeKind,
  nodeId,
  onUploaded,
}: PhotoEvidenceUploaderProps) {
  const { t } = useTranslation();
  const { user, userRole, isAdmin } = useFirebase();
  const isOnline = useOnlineStatus();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const canUpload =
    Boolean(user) &&
    Boolean(projectId) &&
    Boolean(nodeId) &&
    (isAdmin || isSupervisorRole(userRole) || isAdminRole(userRole));

  if (!canUpload) return null;

  const selectFile = (selected: File | null) => {
    setError(null);
    setSuccess(null);
    if (!selected) {
      setFile(null);
      return;
    }
    if (selected.size <= 0) {
      setError('El archivo está vacío. Elige otra foto o video.');
      setFile(null);
      return;
    }
    if (selected.size > MAX_FILE_BYTES) {
      setError('El archivo supera los 50 MB. Elige uno más liviano.');
      setFile(null);
      return;
    }
    if (selected.type.startsWith('image/') && selected.size > MAX_IMAGE_BYTES) {
      setError('La imagen supera los 25 MB. Elige una más liviana.');
      setFile(null);
      return;
    }
    setFile(selected);
  };

  const submit = async () => {
    if (!file || !user || uploading) return;
    setUploading(true);
    setError(null);
    setSuccess(null);
    try {
      const capturedLocation = await requestLocation();
      const uploaded = await uploadPhotoEvidenceBytes(projectId, file, {
        capturedByUid: user.uid,
        capturedAt: new Date().toISOString(),
        ...(capturedLocation ? { capturedLocation } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        linkages: [{ nodeKind, nodeId }],
      });
      setSuccess(
        t(
          'photoEvidence.uploader.success',
          'Evidencia subida y verificada por hash: {{name}}',
          { name: uploaded.artifact.originalFilename },
        ),
      );
      setFile(null);
      setNotes('');
      if (inputRef.current) inputRef.current.value = '';
      onUploaded?.(uploaded);
    } catch (err) {
      logger.warn('photoEvidence.upload.failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      setError(uploadErrorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  return (
    <section
      className="rounded-2xl border border-teal-200 dark:border-teal-900/50 bg-teal-50/70 dark:bg-teal-950/20 p-4 space-y-3"
      data-testid="photoEvidence.uploader"
      aria-label={t('photoEvidence.uploader.aria', 'Agregar evidencia fotográfica')}
    >
      <header className="flex items-center gap-2">
        <Camera className="w-4 h-4 text-teal-600 dark:text-teal-400" aria-hidden="true" />
        <h2 className="text-sm font-bold text-teal-800 dark:text-teal-200">
          {t('photoEvidence.uploader.title', 'Agregar evidencia')}
        </h2>
      </header>

      {!isOnline && (
        <p
          className="flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-300"
          data-testid="photoEvidence.uploader.offline"
        >
          <WifiOff className="w-3 h-3" aria-hidden="true" />
          {t(
            'photoEvidence.uploader.offline',
            'Sin conexión: la evidencia se podrá subir cuando vuelva la señal.',
          )}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          id="photo-evidence-file"
          type="file"
          accept={ACCEPTED_TYPES}
          className="sr-only"
          disabled={!isOnline || uploading}
          onChange={(event) => selectFile(event.target.files?.[0] ?? null)}
          data-testid="photoEvidence.uploader.input"
        />
        <label
          htmlFor="photo-evidence-file"
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-bold transition-colors ${
            !isOnline || uploading
              ? 'bg-zinc-200 text-zinc-500 cursor-not-allowed dark:bg-zinc-800 dark:text-zinc-500'
              : 'bg-teal-600 text-white hover:bg-teal-700 cursor-pointer'
          }`}
        >
          <Upload className="w-3.5 h-3.5" aria-hidden="true" />
          {t('photoEvidence.uploader.choose', 'Tomar foto o adjuntar archivo')}
        </label>
        {file && (
          <span
            className="text-[11px] text-teal-800 dark:text-teal-200 truncate max-w-full"
            data-testid="photoEvidence.uploader.selected"
          >
            {file.name} · {(file.size / 1024).toFixed(1)} KB
          </span>
        )}
      </div>

      {file && (
        <>
          <label
            htmlFor="photo-evidence-notes"
            className="block text-[11px] font-semibold text-teal-800 dark:text-teal-200"
          >
            {t('photoEvidence.uploader.notes', 'Nota (opcional)')}
          </label>
          <textarea
            id="photo-evidence-notes"
            value={notes}
            maxLength={2000}
            rows={2}
            onChange={(event) => setNotes(event.target.value)}
            className="w-full rounded-lg border border-teal-200 dark:border-teal-900/60 bg-white dark:bg-zinc-900 p-2 text-[12px] text-primary-token"
            placeholder={t(
              'photoEvidence.uploader.notesPlaceholder',
              'Qué muestra la evidencia, sector, condiciones…',
            )}
          />
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!isOnline || uploading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-2 text-[11px] font-bold text-white hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="photoEvidence.uploader.submit"
          >
            {uploading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            {uploading
              ? t('photoEvidence.uploader.uploading', 'Subiendo y verificando hash…')
              : t('photoEvidence.uploader.submit', 'Subir evidencia')}
          </button>
        </>
      )}

      {error && (
        <p
          className="flex items-start gap-1 text-[11px] text-rose-700 dark:text-rose-300"
          role="alert"
          data-testid="photoEvidence.uploader.error"
        >
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}

      {success && (
        <p
          className="flex items-start gap-1 text-[11px] text-emerald-700 dark:text-emerald-300"
          role="status"
          data-testid="photoEvidence.uploader.success"
        >
          <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
          {success}
        </p>
      )}
    </section>
  );
}
