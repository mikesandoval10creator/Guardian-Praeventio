// SPDX-License-Identifier: MIT
//
// Sprint 26 Bucket VV — HealthVaultViewer (página pública sin login).
//
// El médico tratante escanea el QR del paciente y aterriza acá. Lee la
// cartera médica del trabajador en modo lectura, con el disclaimer
// permanente: Praeventio NO diagnostica. La información está organizada
// para que el médico tome la mejor decisión clínica.
//
// Cumple Ley 20.584 + 21.719 + 16.744.

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { MedicalDisclaimer } from '../components/health/MedicalDisclaimer';
import type { HealthRecord } from '../services/health/vaultRecord';

type ViewerState =
  | { kind: 'loading' }
  | { kind: 'success'; data: ViewerSuccessPayload }
  | { kind: 'expired' }
  | { kind: 'revoked' }
  | { kind: 'max_consumes' }
  | { kind: 'invalid' }
  | { kind: 'rate_limited' }
  | { kind: 'network_error' };

interface ViewerSuccessPayload {
  workerName: string;
  records: HealthRecord[];
  topicHint?: string;
  expiresAt: number;
}

const TYPE_LABELS: Record<HealthRecord['type'], string> = {
  lab_result: 'Resultado de laboratorio',
  imaging: 'Imagen diagnóstica',
  diagnosis_note: 'Nota clínica',
  medication: 'Medicación',
  allergy: 'Alergia',
  family_history: 'Antecedentes familiares',
  audiometry: 'Audiometría',
  spirometry: 'Espirometría',
  ecg: 'Electrocardiograma',
  ergonomic_log: 'Registro ergonómico',
};

function formatDate(value: number | string | undefined): string {
  if (!value) return '';
  const d = typeof value === 'number' ? new Date(value) : new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('es-CL', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function HealthVaultViewer() {
  const { t } = useTranslation();
  const params = useParams();
  const tokenId = params.tokenId ?? '';
  const secret = params.secret ?? '';

  const [state, setState] = useState<ViewerState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(
          `/api/health-vault/view/${encodeURIComponent(tokenId)}/${encodeURIComponent(secret)}`,
        );
        if (cancelled) return;
        if (res.status === 200) {
          const data = (await res.json()) as ViewerSuccessPayload;
          setState({ kind: 'success', data });
          return;
        }
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (res.status === 410) {
          if (body.error === 'revoked') return setState({ kind: 'revoked' });
          if (body.error === 'max_consumes_reached')
            return setState({ kind: 'max_consumes' });
          return setState({ kind: 'expired' });
        }
        if (res.status === 401 || res.status === 404)
          return setState({ kind: 'invalid' });
        if (res.status === 429) return setState({ kind: 'rate_limited' });
        setState({ kind: 'network_error' });
      } catch {
        if (!cancelled) setState({ kind: 'network_error' });
      }
    }
    if (tokenId && secret) void load();
    else setState({ kind: 'invalid' });
    return () => {
      cancelled = true;
    };
  }, [tokenId, secret]);

  return (
    <div
      className="min-h-screen bg-zinc-50 dark:bg-zinc-950"
      data-testid="health-vault-viewer"
    >
      <MedicalDisclaimer variant="banner" />

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        {state.kind === 'loading' && (
          <p className="text-zinc-600 dark:text-zinc-400" role="status">
            {t('healthVaultViewer.loading', 'Cargando cartera médica…')}
          </p>
        )}

        {state.kind === 'expired' && (
          <ErrorCard
            title={t('healthVaultViewer.expiredTitle', 'Este enlace expiró')}
            body={t('healthVaultViewer.expiredBody', 'El paciente puede generar uno nuevo desde su aplicación.')}
          />
        )}
        {state.kind === 'revoked' && (
          <ErrorCard
            title={t('healthVaultViewer.revokedTitle', 'El paciente revocó este enlace')}
            body={t('healthVaultViewer.revokedBody', 'Por seguridad, el acceso fue cancelado por el dueño de la información.')}
          />
        )}
        {state.kind === 'max_consumes' && (
          <ErrorCard
            title={t('healthVaultViewer.maxConsumesTitle', 'Este enlace alcanzó el límite de visualizaciones')}
            body={t('healthVaultViewer.maxConsumesBody', 'Pídele al paciente que genere uno nuevo si necesitas volver a verlo.')}
          />
        )}
        {state.kind === 'invalid' && (
          <ErrorCard title={t('healthVaultViewer.invalidTitle', 'Enlace inválido')} body={t('healthVaultViewer.invalidBody', 'El enlace que escaneaste no es reconocible.')} />
        )}
        {state.kind === 'rate_limited' && (
          <ErrorCard
            title={t('healthVaultViewer.rateLimitedTitle', 'Demasiadas solicitudes')}
            body={t('healthVaultViewer.rateLimitedBody', 'Espera un momento e intenta de nuevo.')}
          />
        )}
        {state.kind === 'network_error' && (
          <ErrorCard
            title={t('healthVaultViewer.networkErrorTitle', 'No se pudo conectar')}
            body={t('healthVaultViewer.networkErrorBody', 'Revisa tu conexión e intenta de nuevo.')}
          />
        )}

        {state.kind === 'success' && <SuccessView data={state.data} />}
      </main>
    </div>
  );
}

function ErrorCard({ title, body }: { title: string; body: string }) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700/50 p-5"
    >
      <h2 className="text-base font-bold text-amber-900 dark:text-amber-200">{title}</h2>
      <p className="text-sm text-amber-800 dark:text-amber-300/80 mt-1">{body}</p>
    </div>
  );
}

function SuccessView({ data }: { data: ViewerSuccessPayload }) {
  return (
    <div className="space-y-4">
      <header className="rounded-xl border border-teal-200 dark:border-teal-800/50 bg-white dark:bg-zinc-900 p-5">
        <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
          Cartera médica de {data.workerName}
        </h1>
        {data.topicHint && (
          <p className="text-sm text-teal-700 dark:text-teal-300 mt-1">
            Compartido con tema: <span className="font-semibold">{data.topicHint}</span>
          </p>
        )}
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-2">
          Acceso válido hasta {formatDate(data.expiresAt)}
        </p>
      </header>

      <ul className="space-y-3" data-testid="records-list">
        {data.records.length === 0 && (
          <li className="text-sm text-zinc-500 italic">
            No hay registros que mostrar para este alcance.
          </li>
        )}
        {data.records.map((r) => (
          <li
            key={r.id}
            className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wide text-zinc-500">
                  {TYPE_LABELS[r.type] ?? r.type}
                </p>
                <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                  {r.meta.title}
                </h3>
                {r.meta.issueDate && (
                  <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">
                    Fecha emisión: {formatDate(r.meta.issueDate)}
                  </p>
                )}
                {r.meta.issuer && (
                  <p className="text-xs text-zinc-600 dark:text-zinc-400">
                    Emisor: {r.meta.issuer}
                  </p>
                )}
              </div>
              {r.fileUri && (
                <a
                  href={r.fileUri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-teal-700 dark:text-teal-300 underline shrink-0"
                >
                  Ver archivo
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>

      <footer
        role="note"
        className="rounded-xl border border-teal-200 dark:border-teal-800/50 bg-teal-50 dark:bg-teal-950/30 p-4"
      >
        <p className="text-xs text-teal-900 dark:text-teal-200 leading-relaxed">
          Tu paciente compartió esto contigo. Praeventio nunca diagnostica — la
          información está organizada para que tomes la mejor decisión clínica.
        </p>
      </footer>
    </div>
  );
}

export default HealthVaultViewer;
