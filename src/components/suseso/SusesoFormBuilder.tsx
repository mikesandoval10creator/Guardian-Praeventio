// Praeventio Guard — Sprint 28 Bucket B6.
//
// SUSESO DIAT/DIEP form builder. Wired into the existing /suseso route
// (replaces the old metadata-only Gemini flow when the user opts to
// emit a real folio-stamped PDF).
//
// Flow:
//   1. User fills the form (worker, company, incident, witnesses).
//   2. POST /api/suseso/form → returns { form, pdfBase64, payloadHashHex }.
//   3. We display the PDF preview + offer "Firmar" / "Descargar".
//   4. "Firmar" triggers a (stub) WebAuthn ceremony; on success we POST
//      /api/suseso/form/:id/sign with the signature blob.
//
// The WebAuthn signing in step 4 is delegated to a tiny helper (see
// `requestSignature` below). For the MVP we don't actually run the
// `navigator.credentials.create/get` call — the helper returns a
// placeholder signature so the round-trip is exercised end-to-end.
// Full WebAuthn integration is owned by the curriculum bucket and
// will be reused here in a follow-up.

import React, { useState } from 'react';
import { auth } from '../../services/firebase';
import type {
  SusesoFormKind,
  SusesoMutualidad,
  SusesoIncidentClassification,
  SusesoForm,
  SusesoSignature,
} from '../../services/suseso/types';
import { folioToDocId } from '../../services/suseso/susesoService';
import { apiAuthHeader } from '../../lib/apiAuth';

interface BuilderState {
  kind: SusesoFormKind;
  workerRut: string;
  workerFullName: string;
  companyRut: string;
  companyName: string;
  mutualidad: SusesoMutualidad;
  incidentDate: string;
  incidentDescription: string;
  incidentLocation: string;
  bodyPartsAffected: string;
  incidentClassification: SusesoIncidentClassification;
  ds101Causal: string;
  ds110Causal: string;
  witnesses: string;
}

const EMPTY: BuilderState = {
  kind: 'DIAT',
  workerRut: '',
  workerFullName: '',
  companyRut: '',
  companyName: '',
  mutualidad: 'achs',
  incidentDate: new Date().toISOString().slice(0, 16),
  incidentDescription: '',
  incidentLocation: '',
  bodyPartsAffected: '',
  incidentClassification: 'accidente_trabajo',
  ds101Causal: '',
  ds110Causal: '',
  witnesses: '',
};

interface BuilderResult {
  form: SusesoForm;
  pdfBase64: string;
  payloadHashHex: string;
  qrCodeUrl: string;
}

/**
 * Stub for the WebAuthn signing ceremony. Returns a deterministic
 * placeholder so the round-trip works end-to-end. Replace with the
 * real ceremony from `useWebAuthn` (curriculum bucket) once that hook
 * is generalized.
 */
async function requestSignature(
  payloadHashHex: string,
  signerUid: string,
  signerRut: string,
): Promise<SusesoSignature> {
  return {
    signerUid,
    signerRut,
    signedAt: new Date().toISOString(),
    algorithm: 'webauthn-ecdsa-p256',
    // Placeholder — real flow returns the signed assertion.
    signatureB64: 'STUB_REPLACE_WITH_WEBAUTHN_ASSERTION',
    payloadHashHex,
  };
}

interface Props {
  tenantId: string;
  /** Reporter info (current user). */
  reportedBy: { uid: string; rut: string; fullName: string };
}

export const SusesoFormBuilder: React.FC<Props> = ({ tenantId, reportedBy }) => {
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
        kind: state.kind,
        workerRut: state.workerRut,
        workerFullName: state.workerFullName,
        companyRut: state.companyRut,
        companyName: state.companyName,
        mutualidad: state.mutualidad,
        incidentDate: new Date(state.incidentDate).toISOString(),
        incidentDescription: state.incidentDescription,
        incidentLocation: state.incidentLocation,
        bodyPartsAffected: state.bodyPartsAffected
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        incidentClassification: state.incidentClassification,
        ds101Causal: state.kind === 'DIAT' ? state.ds101Causal || undefined : undefined,
        ds110Causal: state.kind === 'DIEP' ? state.ds110Causal || undefined : undefined,
        witnesses: state.witnesses
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => {
            const [fullName, rut] = line.split('|').map((s) => s.trim());
            return { fullName: fullName || '', rut: rut || '' };
          }),
        reportedBy,
      };
      const res = await fetch('/api/suseso/form', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authHeader ? { 'Authorization': authHeader } : {}),
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const data = (await res.json()) as BuilderResult;
      setResult(data);
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
      const formId = folioToDocId(result.form.folio);
      const res = await fetch(`/api/suseso/form/${encodeURIComponent(formId)}/sign`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authHeader ? { 'Authorization': authHeader } : {}),
        },
        body: JSON.stringify({ tenantId, signature: sig }),
      });
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
    a.download = `${result.form.kind}_${result.form.folio}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
        Generar declaración SUSESO
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
            Tipo de declaración
            <select
              value={state.kind}
              onChange={(e) => update('kind', e.target.value as SusesoFormKind)}
              className="border rounded px-2 py-1"
            >
              <option value="DIAT">DIAT — Accidente del trabajo</option>
              <option value="DIEP">DIEP — Enfermedad profesional</option>
            </select>
          </label>

          <label className="flex flex-col text-sm">
            Mutualidad
            <select
              value={state.mutualidad}
              onChange={(e) => update('mutualidad', e.target.value as SusesoMutualidad)}
              className="border rounded px-2 py-1"
            >
              <option value="achs">ACHS</option>
              <option value="mutual_seguridad">Mutual de Seguridad</option>
              <option value="ist">IST</option>
              <option value="isl">ISL</option>
            </select>
          </label>

          <label className="flex flex-col text-sm">
            RUT trabajador
            <input
              value={state.workerRut}
              onChange={(e) => update('workerRut', e.target.value)}
              className="border rounded px-2 py-1"
              required
            />
          </label>

          <label className="flex flex-col text-sm">
            Nombre trabajador
            <input
              value={state.workerFullName}
              onChange={(e) => update('workerFullName', e.target.value)}
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
            Fecha y hora del incidente
            <input
              type="datetime-local"
              value={state.incidentDate}
              onChange={(e) => update('incidentDate', e.target.value)}
              className="border rounded px-2 py-1"
              required
            />
          </label>

          <label className="flex flex-col text-sm">
            Clasificación
            <select
              value={state.incidentClassification}
              onChange={(e) =>
                update(
                  'incidentClassification',
                  e.target.value as SusesoIncidentClassification,
                )
              }
              className="border rounded px-2 py-1"
            >
              <option value="accidente_trabajo">Accidente del trabajo</option>
              <option value="accidente_trayecto">Accidente de trayecto</option>
              <option value="enfermedad_profesional">Enfermedad profesional</option>
            </select>
          </label>

          <label className="flex flex-col text-sm md:col-span-2">
            Lugar del incidente
            <input
              value={state.incidentLocation}
              onChange={(e) => update('incidentLocation', e.target.value)}
              className="border rounded px-2 py-1"
              required
            />
          </label>

          <label className="flex flex-col text-sm md:col-span-2">
            Descripción
            <textarea
              value={state.incidentDescription}
              onChange={(e) => update('incidentDescription', e.target.value)}
              className="border rounded px-2 py-1"
              rows={3}
              required
            />
          </label>

          <label className="flex flex-col text-sm md:col-span-2">
            Partes del cuerpo afectadas (separar por coma)
            <input
              value={state.bodyPartsAffected}
              onChange={(e) => update('bodyPartsAffected', e.target.value)}
              className="border rounded px-2 py-1"
            />
          </label>

          {state.kind === 'DIAT' && (
            <label className="flex flex-col text-sm md:col-span-2">
              Causal DS 101
              <input
                value={state.ds101Causal}
                onChange={(e) => update('ds101Causal', e.target.value)}
                className="border rounded px-2 py-1"
              />
            </label>
          )}

          {state.kind === 'DIEP' && (
            <label className="flex flex-col text-sm md:col-span-2">
              Causal DS 110
              <input
                value={state.ds110Causal}
                onChange={(e) => update('ds110Causal', e.target.value)}
                className="border rounded px-2 py-1"
              />
            </label>
          )}

          <label className="flex flex-col text-sm md:col-span-2">
            Testigos (uno por línea: <code>Nombre | RUT</code>)
            <textarea
              value={state.witnesses}
              onChange={(e) => update('witnesses', e.target.value)}
              className="border rounded px-2 py-1"
              rows={3}
            />
          </label>

          <button
            type="submit"
            disabled={busy}
            className="md:col-span-2 bg-teal-600 text-white rounded px-3 py-2 disabled:opacity-50"
          >
            {busy ? 'Generando...' : 'Generar DIAT/DIEP'}
          </button>
        </form>
      )}

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded px-3 py-2 text-sm">
          {error}
        </div>
      )}

      {result && (
        <div className="border rounded p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-mono text-sm text-zinc-500">Folio</div>
              <div className="font-bold text-lg">{result.form.folio}</div>
            </div>
            <div className="text-xs text-zinc-500">
              Hash: <code>{result.payloadHashHex.slice(0, 16)}…</code>
            </div>
          </div>

          {!signed ? (
            <button
              onClick={() => void handleSign()}
              disabled={busy}
              className="bg-petroleum-700 bg-zinc-900 text-white rounded px-3 py-2"
            >
              {busy ? 'Firmando...' : 'Firmar electrónicamente'}
            </button>
          ) : (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded px-3 py-2 text-sm">
              Firmado correctamente. La declaración es ahora verificable en{' '}
              <code>{result.qrCodeUrl}</code>.
            </div>
          )}

          <button
            onClick={handleDownload}
            className="border rounded px-3 py-2 ml-2"
          >
            Descargar PDF
          </button>
        </div>
      )}
    </div>
  );
};

export default SusesoFormBuilder;
