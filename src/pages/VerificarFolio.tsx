// Public verifier for a SUSESO folio — what a fiscalizador sees after scanning
// the QR printed on a DIAT/DIEP.
//
// WHY THIS PAGE EXISTS: the QR used to point straight at
// `/api/suseso/verify/:folio`, so scanning a legally-required document showed
// raw JSON to a government inspector standing in a worksite:
//   {"valid":false,"verificationStatus":"unverifiable","reason":"legacy_unverifiable"}
// Someone who can't read that doesn't conclude "the system is being careful" —
// they conclude something is wrong with the document, and the company wears the
// consequences. This renders the same verdict in language an inspector can act
// on, without ever overstating it (see verificationCopy for the wording rules:
// never "válido" unless the signature verified, never "falso" for a document we
// merely cannot check).
//
// Public by design: an inspector has no account. No auth, no project context,
// no Firebase read — it calls only the public verify endpoint, which already
// withholds the worker's RUT and any clinical detail.

import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ShieldCheck, ShieldAlert, ShieldQuestion, Loader2 } from 'lucide-react';

import type { SusesoVerificationResult } from '../services/suseso/types';
import {
  verificationCopy,
  type VerificationTone,
} from '../services/suseso/verificationCopy';
import { logger } from '../utils/logger';

const TONE_STYLES: Record<VerificationTone, { ring: string; text: string; Icon: typeof ShieldCheck }> = {
  verified: { ring: 'border-emerald-500/40 bg-emerald-500/5', text: 'text-emerald-600', Icon: ShieldCheck },
  unverifiable: { ring: 'border-amber-500/40 bg-amber-500/5', text: 'text-amber-600', Icon: ShieldQuestion },
  invalid: { ring: 'border-rose-500/40 bg-rose-500/5', text: 'text-rose-600', Icon: ShieldAlert },
  unknown: { ring: 'border-zinc-400/40 bg-zinc-500/5', text: 'text-zinc-600', Icon: ShieldQuestion },
};

/** Rendered in es-CL local time; falls back to the raw value if unparseable. */
function formatSignedAt(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('es-CL', { timeZone: 'America/Santiago' });
}

export function VerificarFolio() {
  const { folio } = useParams<{ folio: string }>();
  const [result, setResult] = useState<SusesoVerificationResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!folio) {
      setLoading(false);
      return undefined;
    }
    (async () => {
      try {
        // Hard timeout: this page is opened on a worksite over a phone
        // connection, and a hanging request would leave the inspector staring
        // at "Verificando documento…" indefinitely. Giving up produces the
        // honest "we could not consult" verdict instead of a dead screen.
        const res = await fetch(`/api/suseso/verify/${encodeURIComponent(folio)}`, {
          signal: AbortSignal.timeout(15_000),
        });
        const body = (await res.json()) as SusesoVerificationResult;
        if (!cancelled) setResult(body);
      } catch (err) {
        // Network/parse failure → `result` stays null, which verificationCopy
        // renders as an honest "couldn't consult" rather than a verdict.
        logger.warn('suseso_public_verify_failed', { err: String(err) });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [folio]);

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="flex items-center gap-3 text-zinc-600">
          <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
          <span>Verificando documento…</span>
        </div>
      </main>
    );
  }

  const copy = verificationCopy(result);
  const style = TONE_STYLES[copy.tone];
  const signedAt = formatSignedAt(result?.signedAt);

  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950 p-4 sm:p-8">
      <div className="mx-auto max-w-xl space-y-4">
        <header className="text-center">
          <span className="text-sm font-black tracking-tight">
            <span className="text-emerald-600">GUARDIAN</span> PRAEVENTIO
          </span>
          <p className="text-xs text-zinc-500 mt-1">
            Verificador público de documentos SUSESO
          </p>
        </header>

        <section
          data-testid="verification-verdict"
          data-tone={copy.tone}
          className={`rounded-2xl border p-5 ${style.ring}`}
        >
          <div className="flex items-start gap-3">
            <style.Icon className={`w-7 h-7 shrink-0 ${style.text}`} aria-hidden="true" />
            <div className="space-y-2">
              <h1 className={`text-lg font-black leading-tight ${style.text}`}>
                {copy.title}
              </h1>
              <p className="text-sm text-zinc-700 dark:text-zinc-300">{copy.detail}</p>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">{copy.guidance}</p>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5 space-y-2 text-sm">
          <h2 className="text-xs font-bold uppercase tracking-tight text-zinc-500">
            Datos del documento
          </h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-zinc-500">Folio</dt>
            <dd className="font-mono font-semibold break-all">{folio ?? '—'}</dd>
            {result?.kind && (
              <>
                <dt className="text-zinc-500">Tipo</dt>
                <dd className="font-semibold">{result.kind}</dd>
              </>
            )}
            {signedAt && (
              <>
                <dt className="text-zinc-500">Firmado</dt>
                <dd className="font-semibold">{signedAt}</dd>
              </>
            )}
            {result?.signerRut && (
              <>
                <dt className="text-zinc-500">RUT firmante</dt>
                <dd className="font-semibold">{result.signerRut}</dd>
              </>
            )}
          </dl>
        </section>

        <p className="text-center text-xs text-zinc-500">
          Esta verificación comprueba la firma electrónica del documento. No
          sustituye la fiscalización presencial.
        </p>
      </div>
    </main>
  );
}

export default VerificarFolio;
