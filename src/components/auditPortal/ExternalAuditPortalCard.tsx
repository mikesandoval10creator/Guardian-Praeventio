// Praeventio Guard — Wire UI S44: <ExternalAuditPortalCard />
//
// Tarjeta presentacional para un portal de auditor externo. Muestra
// token, estado, scope y vencimiento. El padre computa el estado vía
// derivePortalStatus y pasa el resultado como prop.

import { ShieldCheck, AlertTriangle, Ban, Clock } from 'lucide-react';
import type {
  AuditPortalConfig,
  PortalStatus,
} from '../../services/auditPortal/externalAuditPortal.js';

interface ExternalAuditPortalCardProps {
  portal: AuditPortalConfig;
  status: PortalStatus;
  accessCount?: number;
}

const STATUS_META: Record<
  PortalStatus,
  { label: string; tone: string; Icon: typeof ShieldCheck }
> = {
  active: {
    label: 'Activo',
    tone: 'bg-teal-50 text-teal-700 border-teal-200',
    Icon: ShieldCheck,
  },
  expired: {
    label: 'Expirado',
    tone: 'bg-amber-50 text-amber-700 border-amber-200',
    Icon: Clock,
  },
  revoked: {
    label: 'Revocado',
    tone: 'bg-rose-50 text-rose-700 border-rose-200',
    Icon: Ban,
  },
};

export function ExternalAuditPortalCard({
  portal,
  status,
  accessCount,
}: ExternalAuditPortalCardProps) {
  const meta = STATUS_META[status];
  const { Icon } = meta;
  const masked = portal.accessToken.slice(0, 8) + '…';

  return (
    <section
      className={`rounded-2xl border p-4 space-y-2 ${meta.tone}`}
      data-testid="auditPortal.card"
      aria-label="Portal auditor externo"
    >
      <header className="flex items-center gap-2">
        <Icon className="w-4 h-4" aria-hidden="true" />
        <h2 className="text-sm font-bold" data-testid="auditPortal.card.title">
          {portal.auditorName}
        </h2>
        <span
          className="ml-auto text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-white/60"
          data-testid="auditPortal.card.status"
        >
          {meta.label}
        </span>
      </header>

      <dl className="grid grid-cols-2 gap-2 text-[11px]">
        <div>
          <dt className="uppercase text-slate-500">Afiliación</dt>
          <dd className="font-bold" data-testid="auditPortal.card.affiliation">
            {portal.auditorAffiliation}
          </dd>
        </div>
        <div>
          <dt className="uppercase text-slate-500">Token</dt>
          <dd className="font-mono" data-testid="auditPortal.card.token">
            {masked}
          </dd>
        </div>
        <div>
          <dt className="uppercase text-slate-500">Vence</dt>
          <dd data-testid="auditPortal.card.expiresAt">
            {new Date(portal.expiresAt).toLocaleDateString()}
          </dd>
        </div>
        <div>
          <dt className="uppercase text-slate-500">Módulos</dt>
          <dd className="font-bold" data-testid="auditPortal.card.modules">
            {portal.scopeModules.length}
          </dd>
        </div>
      </dl>

      {typeof accessCount === 'number' && (
        <p
          className="text-[11px] text-slate-600"
          data-testid="auditPortal.card.access"
        >
          Accesos registrados: {accessCount}
        </p>
      )}

      {status === 'revoked' && portal.revokedReason && (
        <div
          className="rounded bg-white/70 border border-current/20 p-2 text-[11px]"
          data-testid="auditPortal.card.revokedReason"
        >
          <AlertTriangle className="w-3 h-3 inline mr-1" aria-hidden="true" />
          {portal.revokedReason}
        </div>
      )}
    </section>
  );
}
