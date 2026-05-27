// Praeventio Guard — Wire-orphan Bloque 3 §3.7: <PortalPublicView />.
//
// STANDALONE — esta vista NO importa Sidebar ni el layout autenticado de la
// app. El auditor externo (SUSESO, ISP, mutualidad, mandante) entra por URL
// `/audit-portal/{token}` SIN cuenta Praeventio. El token de la URL ES la
// credencial.
//
// Read-only por contrato:
//   - Cero formularios de edición.
//   - Cero botones que mutan estado.
//   - Watermark visible "Portal Auditor — SUSESO" repetido para imprimir/
//     screenshot trazabilidad (el auditor ve el watermark en cualquier
//     captura que tome).
//
// Flujo:
//   1. Lee `token` de las props (el router parent extrae req.params.token).
//   2. Para cada módulo en `scopeModules`, hace GET /api/audit-portal/public/:token
//      cuando el auditor lo abre. Esto:
//        a) Verifica TTL + scope + revoked en el backend.
//        b) Aplica access_log (el admin queda con evidencia auditable).
//   3. Renderiza paneles read-only por módulo: documents (PDFs DIAT/IPER),
//      capacitaciones, etc. La extracción real del contenido por módulo es
//      out-of-scope para este wrapper — paneles muestran SCAFFOLD para
//      conectar con los endpoints existentes en el adapter Firestore.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Shield,
  ShieldAlert,
  FileText,
  AlertTriangle,
  GraduationCap,
  HardHat,
  ClipboardList,
  Wrench,
  Image as ImageIcon,
  CheckCircle2,
  Lock,
} from 'lucide-react';
import type { AuditModule } from '../../services/auditPortal/externalAuditPortal';
import {
  fetchPublicAuditPortal,
  type PortalPublicView as PortalPublicViewData,
} from '../../hooks/useExternalAuditPortal';

interface PortalPublicViewProps {
  /** Plaintext token from the URL — typically /audit-portal/:token. */
  token: string;
  /** projectId selected by the auditor among the portal's scope. */
  projectId?: string;
}

const MODULE_META: Record<
  AuditModule,
  { label: string; description: string; Icon: typeof FileText }
> = {
  documents: {
    label: 'Documentos',
    description: 'IPER, PEC, plan SySO, autorizaciones de funcionamiento.',
    Icon: FileText,
  },
  iper_matrix: {
    label: 'Matriz IPER',
    description: 'Identificación de peligros + evaluación de riesgos.',
    Icon: AlertTriangle,
  },
  trainings: {
    label: 'Capacitaciones',
    description: 'Registros DS 76, ART 19 Ley 16.744, listas de asistencia.',
    Icon: GraduationCap,
  },
  epp: {
    label: 'EPP',
    description: 'Entrega/recepción de elementos de protección personal.',
    Icon: HardHat,
  },
  incidents: {
    label: 'Incidentes',
    description: 'DIAT, DIEP, investigaciones de accidentes.',
    Icon: AlertTriangle,
  },
  corrective_actions: {
    label: 'Acciones correctivas',
    description: 'Planes de acción + cierre verificado.',
    Icon: Wrench,
  },
  evidences: {
    label: 'Evidencias',
    description: 'Fotos y geo-evidencia de controles aplicados en terreno.',
    Icon: ImageIcon,
  },
  compliance_snapshot: {
    label: 'Cumplimiento',
    description: 'Estado de cumplimiento por norma chilena (Ley 16.744, DS 594, DS 76, …).',
    Icon: ClipboardList,
  },
};

type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; data: PortalPublicViewData }
  | { kind: 'forbidden' }
  | { kind: 'error'; message: string };

export function PortalPublicView({ token, projectId }: PortalPublicViewProps) {
  // Initial portal probe — we hit GET public with a "low-cost" module just
  // to retrieve scope + auditor identity. The "compliance_snapshot" module
  // is the safest probe since it's metadata-only.
  const [bootstrap, setBootstrap] = useState<LoadState>({ kind: 'idle' });
  const [selectedModule, setSelectedModule] = useState<AuditModule | null>(
    null,
  );
  const [moduleState, setModuleState] = useState<LoadState>({ kind: 'idle' });

  const probe = useCallback(
    async (m: AuditModule, pid: string) => {
      setBootstrap({ kind: 'loading' });
      try {
        const { portal } = await fetchPublicAuditPortal({
          token,
          module: m,
          projectId: pid,
        });
        setBootstrap({ kind: 'ok', data: portal });
      } catch (err) {
        const msg = (err as Error).message;
        if (msg === 'forbidden') {
          setBootstrap({ kind: 'forbidden' });
        } else {
          setBootstrap({ kind: 'error', message: msg });
        }
      }
    },
    [token],
  );

  useEffect(() => {
    // Probe with `compliance_snapshot` since that's the lowest-impact module:
    // if it's in scope, we get the portal identity; if it isn't, the auditor
    // sees a graceful "no scope" message and can pick another module.
    // The projectId is required — if the auditor opens the URL without one,
    // we attempt with a sentinel and let the deny surface guide them.
    if (token) {
      void probe('compliance_snapshot', projectId ?? '__probe__');
    }
  }, [probe, token, projectId]);

  const fetchModule = useCallback(
    async (m: AuditModule, pid: string) => {
      setSelectedModule(m);
      setModuleState({ kind: 'loading' });
      try {
        const { portal } = await fetchPublicAuditPortal({
          token,
          module: m,
          projectId: pid,
        });
        setModuleState({ kind: 'ok', data: portal });
      } catch (err) {
        const msg = (err as Error).message;
        if (msg === 'forbidden') {
          setModuleState({ kind: 'forbidden' });
        } else {
          setModuleState({ kind: 'error', message: msg });
        }
      }
    },
    [token],
  );

  // If bootstrap denied (token invalid/expired/revoked), show a single deny
  // page. Same surface for all deny reasons — opaque on purpose.
  if (bootstrap.kind === 'forbidden') {
    return <DenyScreen />;
  }
  if (bootstrap.kind === 'error') {
    return <ErrorScreen message={bootstrap.message} onRetry={() => void probe('compliance_snapshot', projectId ?? '__probe__')} />;
  }
  if (bootstrap.kind === 'idle' || bootstrap.kind === 'loading') {
    return <LoadingScreen />;
  }

  const data = bootstrap.data;
  const effectiveProjectId =
    projectId && data.scopeProjectIds.includes(projectId)
      ? projectId
      : data.scopeProjectIds[0] ?? '';

  return (
    <div
      className="min-h-screen bg-slate-50 dark:bg-zinc-950 relative overflow-hidden"
      data-testid="portalPublic.root"
    >
      <Watermark
        auditorName={data.auditorName}
        affiliation={data.auditorAffiliation}
      />

      <main className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <Header
          auditorName={data.auditorName}
          affiliation={data.auditorAffiliation}
          expiresAt={data.expiresAt}
          tenantId={data.tenantId}
        />

        <ProjectPicker
          projectIds={data.scopeProjectIds}
          selected={effectiveProjectId}
          onChange={(pid) => {
            // Re-probe with the new project to refresh the access decision.
            void fetchModule(selectedModule ?? 'compliance_snapshot', pid);
          }}
        />

        <ModuleNav
          available={data.scopeModules}
          selected={selectedModule}
          onSelect={(m) => void fetchModule(m, effectiveProjectId)}
        />

        <ModulePanel
          selectedModule={selectedModule}
          state={moduleState}
        />

        <Footer />
      </main>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Pieces
// ────────────────────────────────────────────────────────────────────────

function Watermark({
  auditorName,
  affiliation,
}: {
  auditorName: string;
  affiliation: string;
}) {
  const tiles = Array.from({ length: 32 });
  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 z-0 pointer-events-none select-none opacity-[0.045] dark:opacity-[0.08] flex flex-wrap content-start"
      data-testid="portalPublic.watermark"
    >
      {tiles.map((_, i) => (
        <div
          key={i}
          className="w-1/4 sm:w-1/5 lg:w-1/6 p-4 -rotate-12 text-xs font-bold uppercase tracking-widest text-teal-900 dark:text-teal-200"
        >
          Portal Auditor — {affiliation.toUpperCase()}
          <br />
          {auditorName}
        </div>
      ))}
    </div>
  );
}

function Header({
  auditorName,
  affiliation,
  expiresAt,
  tenantId,
}: {
  auditorName: string;
  affiliation: string;
  expiresAt: string;
  tenantId: string;
}) {
  const expires = new Date(expiresAt);
  const remainingDays = Math.max(
    0,
    Math.ceil((expires.getTime() - Date.now()) / 86_400_000),
  );
  return (
    <header
      className="rounded-2xl border-2 border-teal-200 dark:border-teal-800 bg-white dark:bg-zinc-900 shadow-sm p-5 space-y-2"
      data-testid="portalPublic.header"
    >
      <div className="flex items-center gap-3">
        <Shield
          className="w-6 h-6 text-teal-600 dark:text-teal-400"
          aria-hidden="true"
        />
        <h1 className="text-lg font-bold text-zinc-800 dark:text-zinc-100">
          Portal de Auditoría Externa
        </h1>
        <span
          className="ml-auto inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-teal-50 text-teal-700 border border-teal-200 dark:bg-teal-900/20 dark:text-teal-300 dark:border-teal-800"
          data-testid="portalPublic.readOnlyBadge"
        >
          <Lock className="w-3 h-3" aria-hidden="true" />
          Solo lectura
        </span>
      </div>
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div>
          <dt className="uppercase tracking-wider text-zinc-500 dark:text-zinc-400 text-[10px]">
            Auditor
          </dt>
          <dd
            className="font-bold text-zinc-800 dark:text-zinc-100"
            data-testid="portalPublic.header.auditor"
          >
            {auditorName}
          </dd>
        </div>
        <div>
          <dt className="uppercase tracking-wider text-zinc-500 dark:text-zinc-400 text-[10px]">
            Afiliación
          </dt>
          <dd
            className="font-bold text-zinc-800 dark:text-zinc-100 uppercase"
            data-testid="portalPublic.header.affiliation"
          >
            {affiliation}
          </dd>
        </div>
        <div>
          <dt className="uppercase tracking-wider text-zinc-500 dark:text-zinc-400 text-[10px]">
            Empresa auditada
          </dt>
          <dd
            className="font-medium text-zinc-700 dark:text-zinc-300 font-mono text-[11px]"
            data-testid="portalPublic.header.tenant"
          >
            {tenantId}
          </dd>
        </div>
        <div>
          <dt className="uppercase tracking-wider text-zinc-500 dark:text-zinc-400 text-[10px]">
            Vence en
          </dt>
          <dd
            className="font-bold text-zinc-800 dark:text-zinc-100 tabular-nums"
            data-testid="portalPublic.header.expires"
          >
            {remainingDays} día{remainingDays === 1 ? '' : 's'}
          </dd>
        </div>
      </dl>
    </header>
  );
}

function ProjectPicker({
  projectIds,
  selected,
  onChange,
}: {
  projectIds: string[];
  selected: string;
  onChange: (pid: string) => void;
}) {
  if (projectIds.length <= 1) return null;
  return (
    <section
      className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-3"
      data-testid="portalPublic.projectPicker"
    >
      <label className="text-[11px] uppercase tracking-wider font-medium text-zinc-600 dark:text-zinc-400 block mb-1">
        Proyecto
      </label>
      <select
        value={selected}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm text-zinc-800 dark:text-zinc-100"
      >
        {projectIds.map((pid) => (
          <option key={pid} value={pid}>
            {pid}
          </option>
        ))}
      </select>
    </section>
  );
}

function ModuleNav({
  available,
  selected,
  onSelect,
}: {
  available: AuditModule[];
  selected: AuditModule | null;
  onSelect: (m: AuditModule) => void;
}) {
  return (
    <nav
      className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2"
      aria-label="Módulos disponibles"
      data-testid="portalPublic.moduleNav"
    >
      {available.map((m) => {
        const meta = MODULE_META[m];
        const { Icon } = meta;
        const isSelected = selected === m;
        return (
          <button
            key={m}
            type="button"
            onClick={() => onSelect(m)}
            data-testid={`portalPublic.moduleNav.${m}`}
            className={`text-left p-3 rounded-xl border-2 transition-colors ${
              isSelected
                ? 'border-teal-500 bg-teal-50 dark:bg-teal-900/30 dark:border-teal-600'
                : 'border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:border-teal-300 dark:hover:border-teal-700'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <Icon
                className={`w-4 h-4 ${
                  isSelected
                    ? 'text-teal-600 dark:text-teal-400'
                    : 'text-zinc-500 dark:text-zinc-400'
                }`}
                aria-hidden="true"
              />
              <span className="text-sm font-bold text-zinc-800 dark:text-zinc-100">
                {meta.label}
              </span>
            </div>
            <p className="text-[11px] text-zinc-600 dark:text-zinc-400">
              {meta.description}
            </p>
          </button>
        );
      })}
    </nav>
  );
}

function ModulePanel({
  selectedModule,
  state,
}: {
  selectedModule: AuditModule | null;
  state: LoadState;
}) {
  if (!selectedModule) {
    return (
      <section
        className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-8 text-center"
        data-testid="portalPublic.panel.idle"
      >
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Selecciona un módulo de la lista para ver la evidencia.
        </p>
      </section>
    );
  }
  if (state.kind === 'loading') {
    return (
      <section
        className="rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-8 text-center"
        data-testid="portalPublic.panel.loading"
      >
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Cargando módulo…
        </p>
      </section>
    );
  }
  if (state.kind === 'forbidden') {
    return (
      <section
        className="rounded-2xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/20 p-6 text-center"
        data-testid="portalPublic.panel.forbidden"
      >
        <ShieldAlert
          className="w-6 h-6 mx-auto mb-2 text-rose-600 dark:text-rose-400"
          aria-hidden="true"
        />
        <p className="text-sm font-bold text-rose-700 dark:text-rose-200">
          Acceso no autorizado a este módulo o proyecto.
        </p>
        <p className="text-xs text-rose-600 dark:text-rose-300 mt-1">
          Contacta con la empresa auditada si necesitas acceso adicional.
        </p>
      </section>
    );
  }
  if (state.kind === 'error') {
    return (
      <section
        className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-6"
        data-testid="portalPublic.panel.error"
        role="alert"
      >
        <p className="text-sm font-bold text-amber-800 dark:text-amber-200">
          Error de conexión
        </p>
        <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
          {state.message}
        </p>
      </section>
    );
  }
  if (state.kind === 'idle') {
    return null;
  }
  // ok — scaffold panel. Real data extraction per module is out-of-scope
  // for this orphan-wire — the integrator wires module-specific endpoints
  // (documents PDFs, IPER matrix entries, etc.) that pass `tenantId` and
  // `projectId` from `state.data` back to the existing read-only endpoints.
  const meta = MODULE_META[selectedModule];
  const { Icon } = meta;
  return (
    <section
      className="rounded-2xl border-2 border-teal-200 dark:border-teal-800 bg-white dark:bg-zinc-900 p-6 space-y-4"
      data-testid={`portalPublic.panel.${selectedModule}`}
    >
      <header className="flex items-center gap-2">
        <Icon
          className="w-5 h-5 text-teal-600 dark:text-teal-400"
          aria-hidden="true"
        />
        <h2 className="text-base font-bold text-zinc-800 dark:text-zinc-100">
          {meta.label}
        </h2>
        <span className="ml-auto inline-flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider text-teal-700 dark:text-teal-300">
          <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
          Acceso autorizado
        </span>
      </header>
      <p className="text-xs text-zinc-600 dark:text-zinc-400">
        {meta.description}
      </p>
      <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 p-4 text-xs text-zinc-600 dark:text-zinc-300 space-y-1">
        <p>
          <strong className="text-zinc-800 dark:text-zinc-100">
            Proyecto:
          </strong>{' '}
          {state.data.projectId}
        </p>
        <p>
          <strong className="text-zinc-800 dark:text-zinc-100">Módulo:</strong>{' '}
          {state.data.module}
        </p>
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400 italic">
          Tu acceso quedó registrado en el log de auditoría de la empresa
          (timestamp, módulo, IP). Esta es una vista de solo lectura — ningún
          dato puede modificarse desde este portal.
        </p>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer
      className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-3 text-center"
      data-testid="portalPublic.footer"
    >
      <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
        Praeventio Guard — Acceso de solo lectura para auditoría externa. La
        empresa auditada se reserva el derecho de revocar este acceso en
        cualquier momento. Cumple Ley 16.744, Ley 19.628 y Ley 21.719.
      </p>
    </footer>
  );
}

function DenyScreen() {
  return (
    <div
      className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-zinc-950 p-4"
      data-testid="portalPublic.deny"
    >
      <section className="max-w-md w-full rounded-2xl border-2 border-rose-200 dark:border-rose-800 bg-white dark:bg-zinc-900 p-6 text-center space-y-3">
        <ShieldAlert
          className="w-8 h-8 mx-auto text-rose-600 dark:text-rose-400"
          aria-hidden="true"
        />
        <h1 className="text-lg font-bold text-zinc-800 dark:text-zinc-100">
          Acceso no autorizado
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          El enlace que estás usando no es válido, ha expirado, o fue
          revocado por la empresa auditada.
        </p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Si crees que esto es un error, contacta con el responsable de
          prevención de riesgos de la empresa para que te genere un enlace
          nuevo.
        </p>
      </section>
    </div>
  );
}

function ErrorScreen({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-zinc-950 p-4"
      data-testid="portalPublic.error"
    >
      <section className="max-w-md w-full rounded-2xl border-2 border-amber-200 dark:border-amber-800 bg-white dark:bg-zinc-900 p-6 text-center space-y-3">
        <AlertTriangle
          className="w-8 h-8 mx-auto text-amber-600 dark:text-amber-400"
          aria-hidden="true"
        />
        <h1 className="text-lg font-bold text-zinc-800 dark:text-zinc-100">
          Error de conexión
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-300">{message}</p>
        <button
          type="button"
          onClick={onRetry}
          data-testid="portalPublic.error.retry"
          className="text-xs font-bold px-3 py-1.5 rounded-lg bg-teal-600 text-white hover:bg-teal-700 dark:bg-teal-500 dark:hover:bg-teal-600"
        >
          Reintentar
        </button>
      </section>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div
      className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-zinc-950 p-4"
      data-testid="portalPublic.loading"
    >
      <section className="max-w-md w-full rounded-2xl bg-white dark:bg-zinc-900 p-6 text-center space-y-3 border border-zinc-200 dark:border-zinc-700">
        <Shield
          className="w-8 h-8 mx-auto text-teal-600 dark:text-teal-400 animate-pulse"
          aria-hidden="true"
        />
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          Verificando acceso…
        </p>
      </section>
    </div>
  );
}
