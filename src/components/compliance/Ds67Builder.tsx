// Praeventio Guard — Sprint 31 Bucket PP.
//
// DS 67 — Reglamento Interno de Higiene y Seguridad builder. Mirrors
// the SusesoFormBuilder UX: fill the form, POST to /api/compliance/ds67
// → server returns { form, pdfBase64 } → user can preview, download,
// or trigger a (stub) WebAuthn signing ceremony.

import React, { useState } from 'react';
import { auth } from '../../services/firebase';
import { ds67FolioToDocId } from '../../services/compliance/ds67/ds67Service';
import { apiAuthHeader } from '../../lib/apiAuth';

interface BuilderState {
  companyName: string;
  companyRut: string;
  companyAddress: string;
  scopeOfApplication: string;
  workerObligations: string;
  workerProhibitions: string;
  sanctions: string;
  complaintProcedure: string;
  effectiveFrom: string;
  effectiveUntil: string;
}

const EMPTY: BuilderState = {
  companyName: '',
  companyRut: '',
  companyAddress: '',
  scopeOfApplication: '',
  workerObligations: '',
  workerProhibitions: '',
  sanctions: '',
  complaintProcedure: '',
  effectiveFrom: new Date().toISOString().slice(0, 10),
  effectiveUntil: '',
};

interface BuilderResult {
  form: { folio: string };
  pdfBase64: string;
  payloadHashHex: string;
}

interface Props {
  tenantId: string;
  /** Reporter info — used as default signer. */
  reportedBy: { uid: string; rut: string; fullName: string };
}

/**
 * Stub WebAuthn ceremony placeholder. Replace with the real `useWebAuthn`
 * hook once Sprint 32 generalizes it across all signing flows.
 */
async function requestSignature(
  payloadHashHex: string,
  signerUid: string,
  signerRut: string,
) {
  return {
    signerUid,
    signerRut,
    signedAt: new Date().toISOString(),
    algorithm: 'webauthn-ecdsa-p256' as const,
    signatureB64: 'STUB_REPLACE_WITH_WEBAUTHN_ASSERTION',
    payloadHashHex,
  };
}

export const Ds67Builder: React.FC<Props> = ({ tenantId, reportedBy }) => {
  const [state, setState] = useState<BuilderState>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BuilderResult | null>(null);
  const [signed, setSigned] = useState(false);

  const update = <K extends keyof BuilderState>(k: K, v: BuilderState[K]) =>
    setState((s) => ({ ...s, [k]: v }));

  const handleGenerate = async () => {
    setBusy(true);
    setError(null);
    try {
      // §2.20 (2026-05-23) — apiAuthHeader unified.
      const authHeader = await apiAuthHeader();
      if (!authHeader) throw new Error('No estás autenticado.');
      const payload = {
        tenantId,
        companyName: state.companyName,
        companyRut: state.companyRut,
        companyAddress: state.companyAddress,
        scopeOfApplication: state.scopeOfApplication,
        workerObligations: state.workerObligations
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
        workerProhibitions: state.workerProhibitions
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
        sanctions: state.sanctions,
        complaintProcedure: state.complaintProcedure,
        effectiveFrom: new Date(state.effectiveFrom).toISOString(),
        effectiveUntil: state.effectiveUntil
          ? new Date(state.effectiveUntil).toISOString()
          : undefined,
      };
      const res = await fetch('/api/compliance/ds67', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authHeader ? { 'Authorization': authHeader } : {}),
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      setResult((await res.json()) as BuilderResult);
      setSigned(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error desconocido');
    } finally {
      setBusy(false);
    }
  };

  const handleSign = async () => {
    if (!result) return;
    setBusy(true);
    setError(null);
    try {
      // §2.20 (2026-05-23) — apiAuthHeader unified.
      const authHeader = await apiAuthHeader();
      if (!authHeader) throw new Error('No estás autenticado.');
      const sig = await requestSignature(
        result.payloadHashHex,
        reportedBy.uid,
        reportedBy.rut,
      );
      const formId = ds67FolioToDocId(result.form.folio);
      const res = await fetch(
        `/api/compliance/ds67/${encodeURIComponent(formId)}/sign`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authHeader ? { 'Authorization': authHeader } : {}),
          },
          body: JSON.stringify({ tenantId, signature: sig }),
        },
      );
      if (!res.ok) throw new Error(`Error ${res.status}`);
      setSigned(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error desconocido');
    } finally {
      setBusy(false);
    }
  };

  const handleDownload = () => {
    if (!result) return;
    const bin = atob(result.pdfBase64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const blob = new Blob([arr], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${result.form.folio}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
        DS 67 — Reglamento Interno de Higiene y Seguridad
      </h2>

      {!result && (
        <form
          className="grid grid-cols-1 md:grid-cols-2 gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void handleGenerate();
          }}
        >
          <label className="flex flex-col text-sm">
            Razón social
            <input
              value={state.companyName}
              onChange={(e) => update('companyName', e.target.value)}
              className="border rounded px-2 py-1"
              required
            />
          </label>
          <label className="flex flex-col text-sm">
            RUT empresa
            <input
              value={state.companyRut}
              onChange={(e) => update('companyRut', e.target.value)}
              className="border rounded px-2 py-1"
              required
            />
          </label>
          <label className="flex flex-col text-sm md:col-span-2">
            Domicilio
            <input
              value={state.companyAddress}
              onChange={(e) => update('companyAddress', e.target.value)}
              className="border rounded px-2 py-1"
              required
            />
          </label>
          <label className="flex flex-col text-sm md:col-span-2">
            Ámbito de aplicación
            <textarea
              value={state.scopeOfApplication}
              onChange={(e) => update('scopeOfApplication', e.target.value)}
              className="border rounded px-2 py-1"
              rows={3}
              required
            />
          </label>
          <label className="flex flex-col text-sm">
            Obligaciones del trabajador (una por línea)
            <textarea
              value={state.workerObligations}
              onChange={(e) => update('workerObligations', e.target.value)}
              className="border rounded px-2 py-1"
              rows={5}
            />
          </label>
          <label className="flex flex-col text-sm">
            Prohibiciones (una por línea)
            <textarea
              value={state.workerProhibitions}
              onChange={(e) => update('workerProhibitions', e.target.value)}
              className="border rounded px-2 py-1"
              rows={5}
            />
          </label>
          <label className="flex flex-col text-sm md:col-span-2">
            Sanciones
            <textarea
              value={state.sanctions}
              onChange={(e) => update('sanctions', e.target.value)}
              className="border rounded px-2 py-1"
              rows={3}
              required
            />
          </label>
          <label className="flex flex-col text-sm md:col-span-2">
            Procedimiento de reclamo
            <textarea
              value={state.complaintProcedure}
              onChange={(e) => update('complaintProcedure', e.target.value)}
              className="border rounded px-2 py-1"
              rows={3}
              required
            />
          </label>
          <label className="flex flex-col text-sm">
            Vigencia desde
            <input
              type="date"
              value={state.effectiveFrom}
              onChange={(e) => update('effectiveFrom', e.target.value)}
              className="border rounded px-2 py-1"
              required
            />
          </label>
          <label className="flex flex-col text-sm">
            Vigencia hasta (opcional)
            <input
              type="date"
              value={state.effectiveUntil}
              onChange={(e) => update('effectiveUntil', e.target.value)}
              className="border rounded px-2 py-1"
            />
          </label>
          <div className="md:col-span-2 flex gap-3">
            <button
              type="submit"
              disabled={busy}
              className="bg-teal-600 text-white px-4 py-2 rounded disabled:opacity-50"
            >
              {busy ? 'Generando…' : 'Generar PDF'}
            </button>
          </div>
        </form>
      )}

      {error && (
        <div className="text-red-600 text-sm border border-red-300 bg-red-50 px-3 py-2 rounded">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-3">
          <div className="text-sm">
            Folio asignado: <strong>{result.form.folio}</strong>
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleDownload}
              className="bg-petroleum-700 text-white px-4 py-2 rounded"
            >
              Descargar PDF
            </button>
            <button
              onClick={handleSign}
              disabled={busy || signed}
              className="bg-teal-600 text-white px-4 py-2 rounded disabled:opacity-50"
            >
              {signed ? 'Firmado ✓' : busy ? 'Firmando…' : 'Firmar'}
            </button>
            <button
              onClick={() => {
                setResult(null);
                setState(EMPTY);
              }}
              className="border px-4 py-2 rounded"
            >
              Nuevo reglamento
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
