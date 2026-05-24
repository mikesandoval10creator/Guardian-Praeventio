// Praeventio Guard — Sprint 23 Bucket FF.
//
// Consent banner shown the first time a user logs in. Records explicit
// consent for each opt-in finalidad (Ley 19.628). `core_service` is
// non-toggleable — it's required to operate the platform. The component
// stores a local "shown" flag in localStorage so it doesn't re-prompt on
// every reload; the source of truth remains the Firestore consent record.

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldCheck, X, ChevronDown, ChevronUp } from 'lucide-react';
import { auth } from '../../services/firebase';
import { PROCESSING_ACTIVITIES } from '../../services/compliance/ley19628';
import { apiAuthHeader } from '../../lib/apiAuth';

const CONSENT_TEXT_VERSION = 'consent_v1.0';
const LOCAL_FLAG_KEY = 'pg.consentBanner.dismissed.v1';

interface ConsentToggleState {
  analytics: boolean;
  marketing: boolean;
  research_anonymized: boolean;
}

export function ConsentBanner() {
  const [open, setOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(LOCAL_FLAG_KEY) !== '1';
    } catch {
      return true;
    }
  });
  const [showActivities, setShowActivities] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toggles, setToggles] = useState<ConsentToggleState>({
    analytics: true,
    marketing: false,
    research_anonymized: false,
  });

  // Re-check Firestore-recorded consent so we don't re-prompt users who
  // already submitted from another device.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // §2.20 (2026-05-23) — apiAuthHeader unified.
        const authHeader = await apiAuthHeader();
        if (!authHeader) return;
        const res = await fetch('/api/compliance/consent', {
          headers: { ...(authHeader ? { 'Authorization': authHeader } : {}) },
        });
        if (!res.ok) return;
        const body = await res.json();
        if (cancelled) return;
        if (body?.consents?.core_service?.granted === true) {
          setOpen(false);
          try {
            localStorage.setItem(LOCAL_FLAG_KEY, '1');
          } catch {
            /* noop */
          }
        }
      } catch {
        // Network failure → keep showing banner so user can submit.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!open) return null;

  const handleAccept = async () => {
    setSubmitting(true);
    try {
      // §2.20 (2026-05-23) — apiAuthHeader unified.
      const authHeader = await apiAuthHeader();
      if (!authHeader) {
        // Not logged in — let the auth flow run; don't block UI.
        setOpen(false);
        return;
      }
      const submissions: { purpose: string; granted: boolean; legalBasis: string }[] = [
        { purpose: 'core_service', granted: true, legalBasis: 'contract' },
        { purpose: 'analytics', granted: toggles.analytics, legalBasis: 'consent' },
        { purpose: 'marketing', granted: toggles.marketing, legalBasis: 'consent' },
        {
          purpose: 'research_anonymized',
          granted: toggles.research_anonymized,
          legalBasis: 'consent',
        },
      ];
      for (const s of submissions) {
        await fetch('/api/compliance/consent', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authHeader ? { 'Authorization': authHeader } : {}),
          },
          body: JSON.stringify({ ...s, textVersion: CONSENT_TEXT_VERSION }),
        });
      }
      try {
        localStorage.setItem(LOCAL_FLAG_KEY, '1');
      } catch {
        /* noop */
      }
      setOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ duration: 0.3 }}
          role="dialog"
          aria-labelledby="consent-banner-title"
          className="fixed inset-x-0 bottom-0 z-50 border-t-4 border-[#4db6ac] bg-[#014c66] text-white shadow-2xl"
          style={{ maxHeight: '70vh', overflowY: 'auto' }}
        >
          <div className="mx-auto max-w-4xl p-5 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-1 h-6 w-6 shrink-0 text-[#4db6ac]" />
                <div>
                  <h2
                    id="consent-banner-title"
                    className="text-base font-bold sm:text-lg"
                  >
                    Tus datos personales (Ley 19.628 — Chile)
                  </h2>
                  <p className="mt-1 text-sm leading-relaxed text-zinc-200">
                    Para prevenir riesgos en faena necesitamos tratar tus datos.
                    Marca abajo qué finalidades autorizas. Puedes cambiar esta
                    elección en cualquier momento desde <strong>Mis datos</strong>.
                  </p>
                </div>
              </div>
              <button
                aria-label="Cerrar"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-zinc-400 hover:bg-white/10 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-5 space-y-3">
              <CoreServiceRow />
              <ToggleRow
                label="Analítica de uso"
                description="Métricas anónimas para mejorar la plataforma."
                checked={toggles.analytics}
                onChange={(v) => setToggles((t) => ({ ...t, analytics: v }))}
              />
              <ToggleRow
                label="Comunicaciones de marketing"
                description="Novedades, capacitaciones y eventos. Sin presión comercial."
                checked={toggles.marketing}
                onChange={(v) => setToggles((t) => ({ ...t, marketing: v }))}
              />
              <ToggleRow
                label="Investigación anonimizada"
                description="Datos pseudonimizados para investigación académica en prevención."
                checked={toggles.research_anonymized}
                onChange={(v) =>
                  setToggles((t) => ({ ...t, research_anonymized: v }))
                }
              />
            </div>

            <div className="mt-5">
              <button
                type="button"
                onClick={() => setShowActivities((v) => !v)}
                className="flex items-center gap-2 text-sm font-medium text-[#4db6ac] hover:underline"
              >
                {showActivities ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
                Ver detalle de tratamiento de datos (RAT)
              </button>
              {showActivities && (
                <div className="mt-3 max-h-64 overflow-y-auto rounded-lg bg-black/30 p-3 text-xs">
                  <table className="w-full table-auto border-collapse">
                    <thead>
                      <tr className="text-left text-[#4db6ac]">
                        <th className="p-1">Actividad</th>
                        <th className="p-1">Finalidad</th>
                        <th className="p-1">Base legal</th>
                        <th className="p-1">Retención</th>
                      </tr>
                    </thead>
                    <tbody>
                      {PROCESSING_ACTIVITIES.map((a) => (
                        <tr key={a.id} className="border-t border-white/10">
                          <td className="p-1 align-top">{a.name}</td>
                          <td className="p-1 align-top">{a.purpose}</td>
                          <td className="p-1 align-top">{a.legalBasis}</td>
                          <td className="p-1 align-top">{a.retention}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
              <a
                href="/privacy"
                className="text-center text-sm text-zinc-300 hover:text-white"
              >
                Política de privacidad
              </a>
              <button
                type="button"
                onClick={handleAccept}
                disabled={submitting}
                className="rounded-lg bg-[#4db6ac] px-6 py-2.5 text-sm font-bold text-[#014c66] shadow hover:bg-[#3da89e] disabled:opacity-60"
              >
                {submitting ? 'Guardando…' : 'Aceptar y continuar'}
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function CoreServiceRow() {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg bg-white/5 p-3">
      <div>
        <div className="text-sm font-semibold text-white">
          Servicio principal (obligatorio)
        </div>
        <div className="mt-0.5 text-xs text-zinc-300">
          Datos necesarios para identificarte, registrar incidentes y cumplir Ley 16.744.
        </div>
      </div>
      <span className="rounded-md bg-[#4db6ac]/20 px-2 py-1 text-xs font-bold text-[#4db6ac]">
        Activo
      </span>
    </div>
  );
}

function ToggleRow({
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
    <label className="flex cursor-pointer items-start justify-between gap-3 rounded-lg bg-white/5 p-3 hover:bg-white/10">
      <div>
        <div className="text-sm font-semibold text-white">{label}</div>
        <div className="mt-0.5 text-xs text-zinc-300">{description}</div>
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

export default ConsentBanner;
