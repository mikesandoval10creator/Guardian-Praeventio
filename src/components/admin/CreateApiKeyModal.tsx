// Praeventio Guard — Bucket CC: CreateApiKeyModal.
//
// Form to issue a new B2D API key. Calls POST /api/admin/b2d/keys and
// shows the raw key EXACTLY ONCE — there is no second chance to view
// it. The "copy + acknowledge" gate enforces that contract in the UI.
//
// The customer-id field is a free input today; once Bucket BB exposes
// the customers/ collection autocomplete it can be wired here. The
// scopes checklist is derived from the selected tier (one scope per
// API code: `climate:*`, `hazmat:*`, `normativa:*`, `suite:*`).

import React, { useState, useMemo } from 'react';
import { API_TIERS, type ApiTierId } from '../../services/pricing/aiTier';

export interface CreateApiKeyModalProps {
  open: boolean;
  onClose: () => void;
  /**
   * Caller-supplied submitter so this modal can be tested without
   * touching `fetch`. The default in the page wires through to
   * `POST /api/admin/b2d/keys`.
   */
  onSubmit: (input: {
    customerId: string;
    tier: ApiTierId;
    scopes: string[];
    expiresInDays?: number;
  }) => Promise<{ id: string; rawKey: string; maskedKey: string }>;
}

// Scope vocabulary mirrors `B2dScope` in services/b2d/apiKeyService.ts.
// New scopes added there must be reflected here.
const SCOPES_FOR_API: Record<'A' | 'B' | 'C' | 'D', string[]> = {
  A: ['climate.read', 'climate.forecast'],
  B: ['hazmat.calculate'],
  C: ['normativa.search', 'normativa.validate'],
  D: ['suite.all'],
};

function scopesForTier(id: ApiTierId): string[] {
  const tier = API_TIERS.find((t) => t.id === id);
  if (!tier) return [];
  return SCOPES_FOR_API[tier.apiCode] ?? [];
}

export function CreateApiKeyModal({ open, onClose, onSubmit }: CreateApiKeyModalProps) {
  const [customerId, setCustomerId] = useState('');
  const [tier, setTier] = useState<ApiTierId>('climate-base');
  const [selectedScopes, setSelectedScopes] = useState<string[]>(['climate.read']);
  const [expiresInDays, setExpiresInDays] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issuedKey, setIssuedKey] = useState<{ id: string; rawKey: string; maskedKey: string } | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);

  const availableScopes = useMemo(() => scopesForTier(tier), [tier]);

  if (!open) return null;

  const reset = () => {
    setCustomerId('');
    setTier('climate-base');
    setSelectedScopes(['climate.read']);
    setExpiresInDays('');
    setError(null);
    setIssuedKey(null);
    setAcknowledged(false);
    setSubmitting(false);
  };

  const handleClose = () => {
    if (issuedKey && !acknowledged) {
      // Force the operator to acknowledge BEFORE the raw key disappears.
      setError('Confirma que copiaste la API key antes de cerrar.');
      return;
    }
    reset();
    onClose();
  };

  const handleTierChange = (next: ApiTierId) => {
    setTier(next);
    // Default to first scope of the new tier.
    setSelectedScopes(scopesForTier(next).slice(0, 1));
  };

  const toggleScope = (scope: string) => {
    setSelectedScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerId.trim()) {
      setError('Customer ID es obligatorio.');
      return;
    }
    if (selectedScopes.length === 0) {
      setError('Selecciona al menos un scope.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const expiresNum = expiresInDays.trim() ? parseInt(expiresInDays, 10) : undefined;
      const result = await onSubmit({
        customerId: customerId.trim(),
        tier,
        scopes: selectedScopes,
        expiresInDays: Number.isFinite(expiresNum) ? expiresNum : undefined,
      });
      setIssuedKey(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Crear API key B2D"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
    >
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-zinc-900 dark:text-white">
            {issuedKey ? 'API key creada' : 'Crear nueva API key B2D'}
          </h3>
          <button
            type="button"
            onClick={handleClose}
            className="text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>

        {issuedKey ? (
          <div className="space-y-4">
            <p className="text-sm text-zinc-700 dark:text-zinc-300">
              Esta es la única vez que verás la API key completa. Cópiala ahora —
              después solo verás el masked.
            </p>
            <div className="bg-zinc-100 dark:bg-zinc-800 p-3 rounded-lg font-mono text-xs break-all select-all">
              {issuedKey.rawKey}
            </div>
            <p className="text-xs text-zinc-500">
              ID: <code>{issuedKey.id}</code>
            </p>
            <p className="text-xs text-zinc-500">
              Masked: <code>{issuedKey.maskedKey}</code>
            </p>
            <label className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                aria-label="Confirmo que copié la API key"
              />
              <span>Copié la API key y entiendo que no podré recuperarla.</span>
            </label>
            {error && <p className="text-xs text-rose-600">{error}</p>}
            <button
              type="button"
              onClick={handleClose}
              disabled={!acknowledged}
              className="w-full px-4 py-2 rounded-lg bg-[#4db6ac] text-white font-bold hover:bg-[#3a9b91] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cerrar
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="customerId" className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-1">
                Customer ID
              </label>
              <input
                id="customerId"
                type="text"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                placeholder="cust_abc123"
                className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-sm"
                autoComplete="off"
                required
              />
            </div>

            <div>
              <label htmlFor="tier" className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-1">
                Tier
              </label>
              <select
                id="tier"
                value={tier}
                onChange={(e) => handleTierChange(e.target.value as ApiTierId)}
                className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-sm"
              >
                {API_TIERS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} — ${t.monthlyUsd}/mes
                  </option>
                ))}
              </select>
            </div>

            <div>
              <span className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-1">
                Scopes
              </span>
              <div className="space-y-1">
                {availableScopes.map((scope) => (
                  <label key={scope} className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                    <input
                      type="checkbox"
                      checked={selectedScopes.includes(scope)}
                      onChange={() => toggleScope(scope)}
                      aria-label={scope}
                    />
                    <code className="text-xs">{scope}</code>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="expiresInDays" className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-1">
                Expira en N días (opcional)
              </label>
              <input
                id="expiresInDays"
                type="number"
                min={1}
                max={3650}
                value={expiresInDays}
                onChange={(e) => setExpiresInDays(e.target.value)}
                placeholder="365"
                className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-800 text-sm"
              />
            </div>

            {error && <p className="text-xs text-rose-600">{error}</p>}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 rounded-lg text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-sm"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 rounded-lg bg-[#4db6ac] text-white font-bold hover:bg-[#3a9b91] disabled:opacity-50 text-sm"
              >
                {submitting ? 'Creando…' : 'Crear API key'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
