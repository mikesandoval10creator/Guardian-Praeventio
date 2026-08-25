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
// [Hy3-audit 3c6aa66d-73fe-81d1-8d8b-cb2cb777c743]
// Removed dead imports: `auth` (no used in body — only line 86 string
// is `'../../services/auth/webauthnComplianceSign'`, not the auth
// instance) and `SusesoSignature` type (declared but never referenced).
// Both were inflating the chunk with firebase-auth + a TS type.
import type {
  SusesoFormKind,
  SusesoMutualidad,
  SusesoIncidentClassification,
  SusesoForm,
} from '../../services/suseso/types';
import { folioToDocId } from '../../services/suseso/susesoService';
import { apiAuthHeader } from '../../lib/apiAuth';
import { humanErrorFromResponse, humanErrorMessage } from '../../lib/humanError';

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
  signChallengeUrl: string,
  authHeader: string | null,
) {
  const { requestComplianceSignature } = await import(
    '../../services/auth/webauthnComplianceSign'
  );
  return requestComplianceSignature({
    signChallengeUrl,
    authHeader,
  });
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
      if (!res.ok) throw new Error(await humanErrorFromResponse(res));
      const data = (await res.json()) as BuilderResult;
      setResult(data);
      setSigned(false);
    } catch (e) {
      // [Hy3-audit 3c6aa66d-73fe-8143-bcf2-ef21b03b52bc reabierto 2026-08-24]:
      // Antes setError(humanErrorMessage(e)) humanizaba aquí y luego el
      // render aplicaba humanErrorMessage otra vez — potencial pérdida de
      // contexto. Ahora guardamos solo el mensaje crudo; humanErrorMessage
      // se aplica una sola vez, en el render JSX (defense-in-depth y
      // check-user-facing-errors ratchet).
      setError(e instanceof Error ? e.message : String(e));
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
      const formId = folioToDocId(result.form.folio);
      const sig = await requestSignature(
        `/api/suseso/form/${encodeURIComponent(formId)}/sign-challenge`,
        authHeader,
      );
      const res = await fetch(`/api/suseso/form/${encodeURIComponent(formId)}/sign`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authHeader ? { 'Authorization': authHeader } : {}),
        },
        body: JSON.stringify({
          tenantId,
          webauthnAssertion: sig.webauthnAssertion,
        }),
      });
      if (!res.ok) throw new Error(await humanErrorFromResponse(res));
      // [P0][compliance][vida-safety] Hy3-audit 3c6aa66d-73fe-81c6-87f4-c5c8e3aefbf5
      // (reabierto 2026-08-24): el código anterior seteaba signed=true
      // solo porque res.ok===200, sin verificar que la firma en el
      // form sea del current user. En una declaración jurada, esto
      // puede atribuir una firma de OTRO usuario a este — falsedad
      // material. Ahora derivamos signed solo si el signature.signerUid
      // del server coincide con reportedBy.uid.
      const data = await res.json() as { form?: { signature?: { signerUid?: string } } };
      const signedByMe = data.form?.signature?.signerUid === reportedBy.uid;
      setSigned(signedByMe);
      if (!signedByMe) {
        // humanErrorMessage aplicado en el render; guardamos string crudo.
        setError(
          'La firma del servidor no corresponde al usuario actual. ' +
          'No se registrará como firma propia.',
        );
      }
    } catch (e) {
      // [Hy3-audit 3c6aa66d-73fe-8143-bcf2-ef21b03b52bc] setError guarda
      // string crudo; humanErrorMessage se aplica en el render.
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDownload = () => {
    if (!result) return;
    try {
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
    } catch (e) {
      // [P1] Hy3-audit 3c6aa66d-73fe-8135-af6f-da231a024d1c (reabierto 2026-08-24):
      // atob lanza InvalidCharacterError si pdfBase64 está malformado.
      // El botón "Descargar PDF" no hacía nada — usuario sin diagnóstico
      // para acceder al PDF de un folio ya emitido. Ahora propagamos
      // el error al estado para que el operador vea el mensaje.
      //
      // [Hy3-audit 3c6aa66d-73fe-8143-bcf2-ef21b03b52bc] string crudo;
      // humanErrorMessage se aplica en el render (defense-in-depth).
      setError(e instanceof Error ? e.message : String(e));
    }
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
        // [Hy3-audit 3c6aa66d-73fe-8143-bcf2-ef21b03b52bc reabierto 2026-08-24]:
        // Antes `setError(humanErrorMessage(e))` humanizaba al setear y el
        // render aplicaba humanErrorMessage otra vez — potencial pérdida de
        // contexto (re-aplicar el mapeo a un string amigable).
        //
        // Fix: setError guarda string crudo. humanErrorMessage se aplica
        // UNA SOLA VEZ en este render. Para strings amigables largos es
        // idempotente (MESSAGE_BY_CODE solo matchea codes cortos). Para
        // defense-in-depth y check-user-facing-errors ratchet.
        <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded px-3 py-2 text-sm">
          {humanErrorMessage(error)}
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
              className="bg-petroleum-700 text-white rounded px-3 py-2"
            >
              {busy ? 'Firmando...' : 'Firmar electrónicamente'}
            </button>
          ) : (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded px-3 py-2 text-sm">
              Firmado correctamente. El PDF lleva impreso un código QR que abre{' '}
              <a
                href={result.qrCodeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline font-semibold"
              >
                su página de verificación
              </a>
              , donde un fiscalizador puede comprobar la firma sin tener cuenta.
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
