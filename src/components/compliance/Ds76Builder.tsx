// Praeventio Guard — Sprint 31 Bucket PP.
//
// DS 76 — Reglamento Especial Subcontratación (Mining) builder.
// Mirrors Ds67Builder.

import React, { useState } from 'react';
import { auth } from '../../services/firebase';
import { ds76FolioToDocId } from '../../services/compliance/ds76/ds76Service';

interface BuilderState {
  principalCompanyName: string;
  principalCompanyRut: string;
  contractorCompanyName: string;
  contractorCompanyRut: string;
  worksiteName: string;
  worksiteAddress: string;
  sstManagementPlan: string;
  managementSystemDescription: string;
  supervisionScheme: string;
  trainingItems: string;
  susesoFiscalizationRecord: string;
}

const EMPTY: BuilderState = {
  principalCompanyName: '',
  principalCompanyRut: '',
  contractorCompanyName: '',
  contractorCompanyRut: '',
  worksiteName: '',
  worksiteAddress: '',
  sstManagementPlan: '',
  managementSystemDescription: '',
  supervisionScheme: '',
  trainingItems: '',
  susesoFiscalizationRecord: '',
};

interface BuilderResult {
  form: { folio: string };
  pdfBase64: string;
  payloadHashHex: string;
}

interface Props {
  tenantId: string;
  reportedBy: { uid: string; rut: string; fullName: string };
}

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

/**
 * Parse one training entry per line: "Topic | hours". Empty/malformed
 * lines are skipped silently. (User-friendly: pasting from a spreadsheet
 * with a stray tab line shouldn't break the form.)
 */
function parseTrainingItems(s: string): Array<{ topic: string; hours: number }> {
  return s
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [topic, hoursStr] = line.split('|').map((p) => p.trim());
      const hours = Number(hoursStr);
      if (!topic || Number.isNaN(hours)) return null;
      return { topic, hours };
    })
    .filter((x): x is { topic: string; hours: number } => x !== null);
}

export const Ds76Builder: React.FC<Props> = ({ tenantId, reportedBy }) => {
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
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error('No estás autenticado.');
      const payload = {
        tenantId,
        principalCompanyName: state.principalCompanyName,
        principalCompanyRut: state.principalCompanyRut,
        contractorCompanyName: state.contractorCompanyName,
        contractorCompanyRut: state.contractorCompanyRut,
        worksiteName: state.worksiteName,
        worksiteAddress: state.worksiteAddress,
        sstManagementPlan: state.sstManagementPlan,
        managementSystemDescription: state.managementSystemDescription,
        supervisionScheme: state.supervisionScheme,
        trainingItems: parseTrainingItems(state.trainingItems),
        susesoFiscalizationRecord: state.susesoFiscalizationRecord,
      };
      const res = await fetch('/api/compliance/ds76', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
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
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error('No estás autenticado.');
      const sig = await requestSignature(
        result.payloadHashHex,
        reportedBy.uid,
        reportedBy.rut,
      );
      const formId = ds76FolioToDocId(result.form.folio);
      const res = await fetch(
        `/api/compliance/ds76/${encodeURIComponent(formId)}/sign`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
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
        DS 76 — Reglamento Subcontratación (Mining)
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
            Empresa principal (mandante)
            <input
              value={state.principalCompanyName}
              onChange={(e) => update('principalCompanyName', e.target.value)}
              className="border rounded px-2 py-1"
              required
            />
          </label>
          <label className="flex flex-col text-sm">
            RUT mandante
            <input
              value={state.principalCompanyRut}
              onChange={(e) => update('principalCompanyRut', e.target.value)}
              className="border rounded px-2 py-1"
              required
            />
          </label>
          <label className="flex flex-col text-sm">
            Empresa contratista / sub.
            <input
              value={state.contractorCompanyName}
              onChange={(e) => update('contractorCompanyName', e.target.value)}
              className="border rounded px-2 py-1"
              required
            />
          </label>
          <label className="flex flex-col text-sm">
            RUT contratista
            <input
              value={state.contractorCompanyRut}
              onChange={(e) => update('contractorCompanyRut', e.target.value)}
              className="border rounded px-2 py-1"
              required
            />
          </label>
          <label className="flex flex-col text-sm">
            Faena (nombre)
            <input
              value={state.worksiteName}
              onChange={(e) => update('worksiteName', e.target.value)}
              className="border rounded px-2 py-1"
              required
            />
          </label>
          <label className="flex flex-col text-sm">
            Faena (dirección)
            <input
              value={state.worksiteAddress}
              onChange={(e) => update('worksiteAddress', e.target.value)}
              className="border rounded px-2 py-1"
              required
            />
          </label>
          <label className="flex flex-col text-sm md:col-span-2">
            Plan de Gestión SST
            <textarea
              value={state.sstManagementPlan}
              onChange={(e) => update('sstManagementPlan', e.target.value)}
              className="border rounded px-2 py-1"
              rows={3}
              required
            />
          </label>
          <label className="flex flex-col text-sm md:col-span-2">
            Sistema de Gestión
            <textarea
              value={state.managementSystemDescription}
              onChange={(e) => update('managementSystemDescription', e.target.value)}
              className="border rounded px-2 py-1"
              rows={3}
              required
            />
          </label>
          <label className="flex flex-col text-sm md:col-span-2">
            Supervisión
            <textarea
              value={state.supervisionScheme}
              onChange={(e) => update('supervisionScheme', e.target.value)}
              className="border rounded px-2 py-1"
              rows={3}
              required
            />
          </label>
          <label className="flex flex-col text-sm md:col-span-2">
            Capacitación (una línea por curso, formato &laquo;Tema | horas&raquo;)
            <textarea
              value={state.trainingItems}
              onChange={(e) => update('trainingItems', e.target.value)}
              className="border rounded px-2 py-1"
              rows={4}
              placeholder={'Trabajo en altura | 8\nEspacios confinados | 4'}
            />
          </label>
          <label className="flex flex-col text-sm md:col-span-2">
            Registro fiscalización SUSESO
            <textarea
              value={state.susesoFiscalizationRecord}
              onChange={(e) => update('susesoFiscalizationRecord', e.target.value)}
              className="border rounded px-2 py-1"
              rows={3}
              required
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
