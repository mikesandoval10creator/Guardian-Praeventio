// Praeventio Guard — Sprint 23 Bucket FF.
//
// /my-data — Data-subject control center (Ley 19.628).
//
// Sections:
//   1. Consents — toggleable per finalidad (analytics/marketing/research).
//   2. Rights — 4 buttons (access / rectification / erasure / portability)
//      that open a confirmation modal and POST /api/compliance/data-request.
//   3. RAT — collapsible table sourced from PROCESSING_ACTIVITIES.

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
  Download,
  Edit3,
  Trash2,
  PackageOpen,
  ShieldCheck,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { auth } from '../services/firebase';
import { MedicalDisclaimer } from '../components/health/MedicalDisclaimer';
import {
  PROCESSING_ACTIVITIES,
  type ConsentRecord,
  type DataAccessRequest,
} from '../services/compliance/ley19628';

const CONSENT_TEXT_VERSION = 'consent_v1.0';

type ConsentMap = Record<string, ConsentRecord>;

async function authedFetch(input: string, init: RequestInit = {}) {
  const idToken = await auth.currentUser?.getIdToken();
  return fetch(input, {
    ...init,
    headers: {
      ...(init.headers || {}),
      'Content-Type': 'application/json',
      Authorization: idToken ? `Bearer ${idToken}` : '',
    },
  });
}

export function MyData() {
  const { t } = useTranslation();
  const [consents, setConsents] = useState<ConsentMap>({});
  const [loadingConsents, setLoadingConsents] = useState(true);
  const [requests, setRequests] = useState<DataAccessRequest[]>([]);
  const [showActivities, setShowActivities] = useState(false);
  const [pendingAction, setPendingAction] = useState<null | DataAccessRequest['type']>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const refreshConsents = async () => {
    setLoadingConsents(true);
    try {
      const res = await authedFetch('/api/compliance/consent');
      if (res.ok) {
        const body = await res.json();
        setConsents(body.consents || {});
      }
    } finally {
      setLoadingConsents(false);
    }
  };

  useEffect(() => {
    refreshConsents();
  }, []);

  const handleToggleConsent = async (
    purpose: 'analytics' | 'marketing' | 'research_anonymized',
    value: boolean,
  ) => {
    setError(null);
    if (value) {
      const res = await authedFetch('/api/compliance/consent', {
        method: 'POST',
        body: JSON.stringify({
          purpose,
          granted: true,
          legalBasis: 'consent',
          textVersion: CONSENT_TEXT_VERSION,
        }),
      });
      if (!res.ok) {
        setError('No pudimos guardar tu preferencia. Intenta de nuevo.');
      }
    } else {
      const res = await authedFetch(
        `/api/compliance/consent/${encodeURIComponent(purpose)}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        setError('No pudimos revocar el consentimiento. Intenta de nuevo.');
      }
    }
    await refreshConsents();
  };

  const submitRequest = async (
    type: DataAccessRequest['type'],
    extras?: Record<string, unknown>,
  ) => {
    setError(null);
    setInfo(null);
    const res = await authedFetch('/api/compliance/data-request', {
      method: 'POST',
      body: JSON.stringify({ type, ...extras }),
    });
    if (!res.ok) {
      setError('No pudimos registrar tu solicitud.');
      return;
    }
    const body = await res.json();
    setRequests((r) => [body.request, ...r]);
    if (type === 'erasure') {
      setInfo(
        'Solicitud de eliminación recibida. Te enviaremos un correo cuando se complete.',
      );
    } else if (type === 'access' || type === 'portability') {
      setInfo(
        'Tu archivo se está preparando. Recibirás un correo con el enlace de descarga.',
      );
    } else {
      setInfo('Solicitud de rectificación enviada al equipo de protección de datos.');
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="mx-auto max-w-4xl p-4 sm:p-6"
    >
      <header className="mb-6">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-7 w-7 text-[#4db6ac]" />
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
            {t('myData.title', 'Mis datos')}
          </h1>
        </div>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Tus derechos sobre tus datos personales bajo la <strong>Ley 19.628</strong> de
          Chile. Puedes consultar, rectificar, exportar o eliminar tus datos en cualquier
          momento.
        </p>
      </header>

      {/*
       * ADR 0012 — esta vista permite exportar/eliminar datos personales,
       * incluida la cartera médica (Health Vault). El disclaimer es
       * obligatorio en toda superficie que toque datos de salud, aunque
       * sea de forma indirecta.
       */}
      <MedicalDisclaimer variant="card" className="mb-6" />

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-700 dark:bg-red-900/40 dark:text-red-200">
          <AlertTriangle className="mt-0.5 h-4 w-4" />
          <div>{error}</div>
        </div>
      )}
      {info && (
        <div className="mb-4 rounded-lg border border-[#4db6ac]/40 bg-[#4db6ac]/10 p-3 text-sm text-[#014c66] dark:text-[#4db6ac]">
          {info}
        </div>
      )}

      {/* Consents */}
      <section className="mb-8 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
        <h2 className="mb-3 text-lg font-bold text-zinc-900 dark:text-zinc-100">
          {t('myData.consents', 'Mis consentimientos')}
        </h2>
        {loadingConsents ? (
          <p className="text-sm text-zinc-500">Cargando…</p>
        ) : (
          <div className="space-y-2">
            <CoreConsentRow granted={consents.core_service?.granted === true} />
            <ConsentToggle
              label="Analítica de uso"
              description="Métricas anónimas para mejorar la plataforma."
              checked={consents.analytics?.granted === true}
              onChange={(v) => handleToggleConsent('analytics', v)}
            />
            <ConsentToggle
              label="Comunicaciones de marketing"
              description="Novedades, capacitaciones y eventos."
              checked={consents.marketing?.granted === true}
              onChange={(v) => handleToggleConsent('marketing', v)}
            />
            <ConsentToggle
              label="Investigación anonimizada"
              description="Datos pseudonimizados para investigación académica."
              checked={consents.research_anonymized?.granted === true}
              onChange={(v) => handleToggleConsent('research_anonymized', v)}
            />
          </div>
        )}
      </section>

      {/* Rights */}
      <section className="mb-8 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
        <h2 className="mb-3 text-lg font-bold text-zinc-900 dark:text-zinc-100">
          Mis derechos
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <RightButton
            icon={Download}
            title="Descargar mis datos"
            description="Te enviaremos un correo con un enlace para descargar todos tus datos."
            onClick={() => setPendingAction('access')}
          />
          <RightButton
            icon={Edit3}
            title="Rectificar mis datos"
            description="Solicita corrección de información inexacta o desactualizada."
            onClick={() => setPendingAction('rectification')}
          />
          <RightButton
            icon={PackageOpen}
            title="Portabilidad"
            description="Recibe tus datos en formato estándar para migrar a otra plataforma."
            onClick={() => setPendingAction('portability')}
          />
          <RightButton
            icon={Trash2}
            title="Eliminar mi cuenta y datos"
            description="Eliminación permanente. Algunos registros legales se conservan 7 años (Ley 16.744)."
            onClick={() => setPendingAction('erasure')}
            danger
          />
        </div>
      </section>

      {/* Requests history */}
      {requests.length > 0 && (
        <section className="mb-8 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
          <h2 className="mb-3 text-lg font-bold text-zinc-900 dark:text-zinc-100">
            Solicitudes recientes
          </h2>
          <ul className="space-y-2 text-sm">
            {requests.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between rounded border border-zinc-200 p-2 dark:border-zinc-700"
              >
                <span>
                  <strong>{r.type}</strong> · {new Date(r.requestedAt).toLocaleString('es-CL')}
                </span>
                <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                  {r.status}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* RAT */}
      <section className="mb-8 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
        <button
          type="button"
          onClick={() => setShowActivities((v) => !v)}
          className="flex w-full items-center justify-between text-left"
        >
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
            Detalle de tratamiento de datos (RAT)
          </h2>
          {showActivities ? (
            <ChevronUp className="h-5 w-5 text-zinc-500" />
          ) : (
            <ChevronDown className="h-5 w-5 text-zinc-500" />
          )}
        </button>
        {showActivities && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[#014c66] dark:text-[#4db6ac]">
                  <th className="p-2">Actividad</th>
                  <th className="p-2">Finalidad</th>
                  <th className="p-2">Base legal</th>
                  <th className="p-2">Categorías</th>
                  <th className="p-2">Retención</th>
                </tr>
              </thead>
              <tbody>
                {PROCESSING_ACTIVITIES.map((a) => (
                  <tr key={a.id} className="border-t border-zinc-200 dark:border-zinc-700">
                    <td className="p-2 align-top font-semibold">{a.name}</td>
                    <td className="p-2 align-top">{a.purpose}</td>
                    <td className="p-2 align-top">{a.legalBasis}</td>
                    <td className="p-2 align-top">{a.dataCategories.join(', ')}</td>
                    <td className="p-2 align-top">{a.retention}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="mt-2 text-center text-xs text-zinc-500 dark:text-zinc-400">
        Encargado de protección de datos:{' '}
        <a className="text-[#4db6ac]" href="mailto:contacto@praeventio.net">
          contacto@praeventio.net
        </a>
      </p>

      {pendingAction && (
        <ConfirmModal
          type={pendingAction}
          onCancel={() => setPendingAction(null)}
          onConfirm={async () => {
            const t = pendingAction;
            setPendingAction(null);
            await submitRequest(t);
          }}
        />
      )}
    </motion.div>
  );
}

function CoreConsentRow({ granted }: { granted: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800">
      <div>
        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Servicio principal (obligatorio)
        </div>
        <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          Datos necesarios para identificarte y cumplir Ley 16.744. Para revocar este
          consentimiento debes solicitar la eliminación de tu cuenta.
        </div>
      </div>
      <span
        className={`shrink-0 rounded-md px-2 py-1 text-xs font-bold ${
          granted
            ? 'bg-[#4db6ac]/20 text-[#014c66] dark:text-[#4db6ac]'
            : 'bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300'
        }`}
      >
        {granted ? 'Activo' : 'Pendiente'}
      </span>
    </div>
  );
}

function ConsentToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3 rounded-lg bg-zinc-50 p-3 hover:bg-zinc-100 dark:bg-zinc-800 dark:hover:bg-zinc-700">
      <div>
        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {label}
        </div>
        <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          {description}
        </div>
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-5 w-5 cursor-pointer accent-[#4db6ac]"
      />
    </label>
  );
}

function RightButton({
  icon: Icon,
  title,
  description,
  onClick,
  danger,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-start gap-3 rounded-lg border p-3 text-left transition hover:shadow ${
        danger
          ? 'border-red-200 bg-red-50 hover:bg-red-100 dark:border-red-800 dark:bg-red-900/30 dark:hover:bg-red-900/40'
          : 'border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800'
      }`}
    >
      <Icon
        className={`mt-0.5 h-5 w-5 shrink-0 ${
          danger ? 'text-red-600 dark:text-red-400' : 'text-[#4db6ac]'
        }`}
      />
      <div>
        <div
          className={`text-sm font-bold ${
            danger ? 'text-red-700 dark:text-red-300' : 'text-zinc-900 dark:text-zinc-100'
          }`}
        >
          {title}
        </div>
        <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          {description}
        </div>
      </div>
    </button>
  );
}

function ConfirmModal({
  type,
  onCancel,
  onConfirm,
}: {
  type: DataAccessRequest['type'];
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const isErase = type === 'erasure';
  const titles: Record<DataAccessRequest['type'], string> = {
    access: '¿Solicitar exportación de datos?',
    portability: '¿Solicitar archivo de portabilidad?',
    rectification: '¿Solicitar rectificación?',
    erasure: '¿Eliminar tu cuenta y datos?',
  };
  const messages: Record<DataAccessRequest['type'], string> = {
    access:
      'Te enviaremos un correo con un enlace temporal para descargar todos tus datos.',
    portability:
      'Te enviaremos tu archivo en formato JSON estándar para que puedas migrarlo a otra plataforma.',
    rectification:
      'Nuestro encargado de protección de datos se contactará para coordinar las correcciones.',
    erasure:
      'Esta acción es PERMANENTE. Eliminaremos tu cuenta y la mayoría de tus datos. Por obligación de la Ley 16.744 conservamos los registros de seguridad ocupacional (audit_logs, incidentes, alertas SOS) por 7 años.',
  };
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="max-w-md rounded-xl bg-white p-5 shadow-xl dark:bg-zinc-900">
        <h3
          className={`mb-2 text-lg font-bold ${
            isErase ? 'text-red-700 dark:text-red-300' : 'text-zinc-900 dark:text-zinc-100'
          }`}
        >
          {titles[type]}
        </h3>
        <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-300">{messages[type]}</p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`rounded-lg px-4 py-2 text-sm font-bold text-white ${
              isErase
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-[#4db6ac] hover:bg-[#3da89e]'
            }`}
          >
            {isErase ? 'Sí, eliminar' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default MyData;
