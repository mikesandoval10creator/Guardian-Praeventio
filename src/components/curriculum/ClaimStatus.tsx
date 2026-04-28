// Praeventio Guard — Round 14 (R5 agent): claim status card.
//
// Renders one CurriculumClaim with:
//   • Status badge (pending / verified / rejected / expired) — Spanish-CL.
//   • Claim text + category + creation date.
//   • Per-referee row: name, email, signed/pending/declined, signedAt.
//   • "Reenviar enlace" button per pending referee. Rate-limiting is
//     enforced server-side; we just disable the button locally for 30 s
//     after a successful resend so the worker doesn't spam-click.

import React, { useState } from 'react';
import { Card } from '../shared/Card';
import { CheckCircle2, Clock, AlertTriangle, XCircle, Mail, Send, Loader2 } from 'lucide-react';
import { auth } from '../../services/firebase';
import type { CurriculumClaim, RefereeSlot, ClaimStatus as TStatus } from '../../services/curriculum/claims';

const STATUS_LABEL: Record<TStatus, { label: string; tone: string; Icon: React.ComponentType<{ className?: string }> }> = {
  pending_referees: {
    label: 'Esperando 2 referencias',
    tone: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    Icon: Clock,
  },
  verified: {
    label: 'Verificado',
    tone: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    Icon: CheckCircle2,
  },
  rejected: {
    label: 'Rechazado',
    tone: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
    Icon: XCircle,
  },
  expired: {
    label: 'Expirado',
    tone: 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400',
    Icon: AlertTriangle,
  },
};

function refereeBadge(slot: RefereeSlot): { label: string; tone: string } {
  if (slot.declined) return { label: 'Rechazó', tone: 'bg-rose-500/10 text-rose-500' };
  if (slot.signedAt) return { label: 'Firmó', tone: 'bg-emerald-500/10 text-emerald-500' };
  return { label: 'Pendiente', tone: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' };
}

export interface ClaimStatusProps {
  claim: CurriculumClaim;
}

export function ClaimStatus({ claim }: ClaimStatusProps) {
  const [resendIndex, setResendIndex] = useState<number | null>(null);
  const [cooldownIdx, setCooldownIdx] = useState<Set<number>>(new Set());
  const [resendError, setResendError] = useState<string | null>(null);
  const status = STATUS_LABEL[claim.status];
  const StatusIcon = status.Icon;

  async function handleResend(idx: number) {
    setResendError(null);
    setResendIndex(idx);
    try {
      if (!auth.currentUser) throw new Error('Sesión inactiva.');
      const idToken = await auth.currentUser.getIdToken();
      const res = await fetch(`/api/curriculum/claim/${claim.id}/resend`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ refereeIndex: idx }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || 'No se pudo reenviar.');
      }
      // Disable the button for 30s to avoid spam clicks.
      setCooldownIdx((s) => new Set(s).add(idx));
      setTimeout(() => {
        setCooldownIdx((s) => {
          const next = new Set(s);
          next.delete(idx);
          return next;
        });
      }, 30_000);
    } catch (err: any) {
      setResendError(err?.message || 'Error desconocido.');
    } finally {
      setResendIndex(null);
    }
  }

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1.5 flex-1 min-w-0">
          <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
            {new Date(claim.createdAt).toLocaleDateString('es-CL')} · {claim.category}
          </p>
          <p className="text-sm text-zinc-900 dark:text-white leading-snug break-words">
            "{claim.claim}"
          </p>
        </div>
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider shrink-0 ${status.tone}`}>
          <StatusIcon className="w-3 h-3" />
          {status.label}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Referencias</p>
        {claim.referees.map((r, idx) => {
          const badge = refereeBadge(r);
          const cooling = cooldownIdx.has(idx);
          const canResend =
            claim.status === 'pending_referees' && !r.signedAt && !r.declined;
          return (
            <div
              key={idx}
              className="flex items-center justify-between gap-3 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700">
                  <Mail className="w-3.5 h-3.5 text-zinc-500" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-zinc-900 dark:text-white truncate">{r.name}</p>
                  <p className="text-[10px] text-zinc-500 truncate">{r.email}</p>
                  {r.signedAt && (
                    <p className="text-[10px] text-emerald-500">
                      firmó el {new Date(r.signedAt).toLocaleDateString('es-CL')}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${badge.tone}`}>
                  {badge.label}
                </span>
                {canResend && (
                  <button
                    type="button"
                    onClick={() => handleResend(idx)}
                    disabled={resendIndex === idx || cooling}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 disabled:opacity-40"
                  >
                    {resendIndex === idx ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Send className="w-3 h-3" />
                    )}
                    {cooling ? 'Enviado' : 'Reenviar enlace'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {resendError && (
        <div className="flex items-center gap-2 text-rose-500 text-xs font-bold bg-rose-500/10 border border-rose-500/20 rounded-xl p-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          {resendError}
        </div>
      )}

      {claim.status === 'verified' && claim.verifiedAt && (
        <p className="text-[10px] font-black uppercase tracking-widest text-emerald-500">
          Verificado el {new Date(claim.verifiedAt).toLocaleDateString('es-CL')}
        </p>
      )}
      {claim.status === 'pending_referees' && (
        <p className="text-[10px] text-zinc-500">
          Expira el {new Date(claim.expiresAt).toLocaleDateString('es-CL')} si no se completa.
        </p>
      )}
    </Card>
  );
}
