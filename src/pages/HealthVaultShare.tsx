// SPDX-License-Identifier: MIT
//
// Sprint 26 Bucket VV — HealthVaultShare (worker logueado).
//
// Página /my-data/share. El trabajador genera un QR para compartir su
// cartera médica con un médico tratante. Praeventio NO diagnostica; el
// QR es sólo el canal de transporte. Cumple Ley 20.584 + 21.719 + 16.744.

import React, { useEffect, useState } from 'react';
import QRCode from 'react-qr-code';
import { MedicalDisclaimer } from '../components/health/MedicalDisclaimer';
import { useFirebase } from '../contexts/FirebaseContext';
import type { VaultShareScope } from '../services/health/vaultShare';

interface CreatedShare {
  tokenId: string;
  secret: string;
  qrPayload: string;
  expiresAt: number;
}

interface ActiveShareSummary {
  id: string;
  scope: VaultShareScope;
  topic?: string;
  createdAt: number;
  expiresAt: number;
  consumeCount: number;
  maxConsumes: number;
  revokedAt: number | null;
}

const SCOPE_LABELS: Record<VaultShareScope, string> = {
  full: 'Toda la cartera',
  recent: 'Últimos 90 días',
  topic: 'Por tema (selección manual)',
};

export function HealthVaultShare() {
  const { user, db } = useFirebase() as any;

  const [scope, setScope] = useState<VaultShareScope>('full');
  const [topic, setTopic] = useState('');
  const [ttlHours, setTtlHours] = useState(24);
  const [submitting, setSubmitting] = useState(false);
  const [createdShare, setCreatedShare] = useState<CreatedShare | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<ActiveShareSummary[]>([]);

  // Cargar shares activos del trabajador (Firestore client SDK).
  useEffect(() => {
    if (!user?.uid || !db) return;
    let cancelled = false;
    async function load() {
      try {
        const { collection, getDocs, query, orderBy } = await import('firebase/firestore');
        const ref = collection(db, 'users', user.uid, 'health_vault_shares');
        const snap = await getDocs(query(ref, orderBy('createdAt', 'desc')));
        if (cancelled) return;
        setActive(
          snap.docs.map((d: any) => {
            const data = d.data();
            return {
              id: data.id,
              scope: data.scope,
              topic: data.topic,
              createdAt: data.createdAt,
              expiresAt: data.expiresAt,
              consumeCount: data.consumeCount ?? 0,
              maxConsumes: data.maxConsumes ?? 0,
              revokedAt: data.revokedAt ?? null,
            };
          }),
        );
      } catch {
        // soft-fail: la lista activos es informativa
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [user?.uid, db, createdShare]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const idToken = await user?.getIdToken();
      const res = await fetch('/api/health-vault/share', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          scope,
          topic: scope === 'topic' ? topic : undefined,
          ttlHours,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `error_${res.status}`);
      }
      const data = (await res.json()) as CreatedShare;
      setCreatedShare(data);
    } catch (err: any) {
      setError(err?.message ?? 'unknown_error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRevoke(tokenId: string) {
    try {
      const idToken = await user?.getIdToken();
      await fetch(`/api/health-vault/share/${tokenId}/revoke`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      setActive((prev) =>
        prev.map((s) =>
          s.id === tokenId ? { ...s, revokedAt: Date.now() } : s,
        ),
      );
    } catch {
      // soft fail; el usuario puede reintentar
    }
  }

  function copyLink() {
    if (!createdShare) return;
    void navigator.clipboard?.writeText(createdShare.qrPayload);
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-5">
        <MedicalDisclaimer variant="card" />

        <header>
          <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
            Compartir cartera médica
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
            Genera un QR temporal para que tu médico tratante lo escanee. Tú
            decides el alcance, la duración y puedes revocarlo cuando quieras.
          </p>
        </header>

        {!createdShare && (
          <form
            onSubmit={handleSubmit}
            className="space-y-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5"
          >
            <label className="block">
              <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                Alcance
              </span>
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value as VaultShareScope)}
                className="mt-1 block w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 p-2 text-sm"
              >
                <option value="full">{SCOPE_LABELS.full}</option>
                <option value="recent">{SCOPE_LABELS.recent}</option>
                <option value="topic">{SCOPE_LABELS.topic}</option>
              </select>
            </label>

            {scope === 'topic' && (
              <label className="block">
                <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  Tema
                </span>
                <input
                  type="text"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="ej. lumbalgia"
                  className="mt-1 block w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 p-2 text-sm"
                />
              </label>
            )}

            <label className="block">
              <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                Duración: {ttlHours}h{' '}
                <span className="text-xs text-zinc-500">(1h - 168h)</span>
              </span>
              <input
                type="range"
                min={1}
                max={168}
                step={1}
                value={ttlHours}
                onChange={(e) => setTtlHours(Number(e.target.value))}
                className="mt-2 block w-full"
              />
            </label>

            {error && (
              <p role="alert" className="text-sm text-red-700 dark:text-red-400">
                Error: {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting || (scope === 'topic' && !topic)}
              className="w-full rounded-md bg-teal-600 hover:bg-teal-700 disabled:bg-zinc-400 px-4 py-2 text-sm font-semibold text-white"
            >
              {submitting ? 'Generando…' : 'Generar QR'}
            </button>
          </form>
        )}

        {createdShare && (
          <section className="space-y-4 rounded-xl border border-teal-200 dark:border-teal-800/50 bg-white dark:bg-zinc-900 p-5">
            <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
              QR listo para tu médico
            </h2>
            <div className="bg-white p-4 rounded-md flex items-center justify-center">
              <QRCode value={createdShare.qrPayload} size={220} />
            </div>
            <p className="text-xs text-zinc-600 dark:text-zinc-400 break-all">
              {createdShare.qrPayload}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={copyLink}
                className="flex-1 rounded-md border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm"
              >
                Copiar link
              </button>
              <button
                type="button"
                onClick={() => setCreatedShare(null)}
                className="flex-1 rounded-md bg-teal-600 hover:bg-teal-700 px-3 py-2 text-sm text-white"
              >
                Generar otro
              </button>
            </div>
          </section>
        )}

        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
            Tus enlaces compartidos
          </h2>
          {active.length === 0 && (
            <p className="text-xs italic text-zinc-500">Aún no has generado ninguno.</p>
          )}
          <ul className="space-y-2">
            {active.map((s) => (
              <li
                key={s.id}
                className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3 text-xs"
              >
                <div className="flex justify-between gap-3">
                  <div>
                    <p className="font-medium text-zinc-800 dark:text-zinc-200">
                      {SCOPE_LABELS[s.scope]}
                      {s.topic ? ` — ${s.topic}` : ''}
                    </p>
                    <p className="text-zinc-500">
                      Visualizaciones: {s.consumeCount}/{s.maxConsumes}
                    </p>
                    <p className="text-zinc-500">
                      Expira: {new Date(s.expiresAt).toLocaleString('es-CL')}
                    </p>
                    {s.revokedAt && (
                      <p className="text-amber-700 dark:text-amber-400">
                        Revocado: {new Date(s.revokedAt).toLocaleString('es-CL')}
                      </p>
                    )}
                  </div>
                  {!s.revokedAt && Date.now() < s.expiresAt && (
                    <button
                      type="button"
                      onClick={() => handleRevoke(s.id)}
                      className="self-start text-red-700 dark:text-red-400 underline"
                    >
                      Revocar
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}

export default HealthVaultShare;
