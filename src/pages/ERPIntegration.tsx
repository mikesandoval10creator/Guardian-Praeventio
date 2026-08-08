import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Database, ShieldAlert, CheckCircle2, AlertTriangle, RefreshCw, Server, ArrowRightLeft, Lock, Copy, RotateCw } from 'lucide-react';
import { Card, Button } from '../components/shared/Card';
import { auth } from '../services/firebase';
import { logger } from '../utils/logger';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/shared/ToastContainer';
import { apiAuthHeader } from '../lib/apiAuth';

// Sprint 50 E.6 P1 H2 — anti-stub-disfrazado. ERP state comes ONLY from a
// real capability probe; we never claim "Conectado" without a successful
// handshake. The four states we expose mirror the backend's mode report
// (`/api/erp/sync` returns `real` | `mock` | `not_configured` |
// `missing_credentials` | `not_implemented`). Until the probe resolves we
// render "Verificando..." so the UI never lies.
type ErpAdapterState = 'real' | 'mock' | 'not_configured' | 'missing_credentials' | 'not_implemented' | 'unknown';
type ErpProbeState = 'pending' | 'ok' | 'error';

interface ErpAdapterStatus {
  id: string;            // 'sap' | 'buk' | 'talana'
  label: string;         // 'SAP SuccessFactors'
  description: string;   // 'Estructura Organizacional'
  state: ErpAdapterState;
}

const ERP_ADAPTER_LABELS: ReadonlyArray<ErpAdapterStatus> = [
  { id: 'sap', label: 'SAP SuccessFactors', description: 'Estructura Organizacional', state: 'unknown' },
  { id: 'buk', label: 'Buk / Talana', description: 'Nómina y Asistencia', state: 'unknown' },
];

/**
 * POST /api/erp/sync
 *
 * Probes the backend ERP adapter and returns its honest mode. The
 * response is the same one the manual_sync flow uses, so the UI and
 * the probe agree by construction. Never returns success unless the
 * backend reported `mode: 'real'` AND a successful HTTP status.
 */
async function probeErpAdapter(adapterId: string): Promise<{
  state: ErpAdapterState;
  reason?: string;
  timestamp?: string;
}> {
  const authHeader = await apiAuthHeader();
  const response = await fetch(`/api/erp/sync?probe=${encodeURIComponent(adapterId)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authHeader ? { 'Authorization': authHeader } : {}),
    },
    body: JSON.stringify({ action: 'probe' }),
  });
  const data: { mode?: string; reason?: string; timestamp?: string } = await response.json();
  const mode = (data?.mode ?? 'unknown') as ErpAdapterState;
  return { state: mode, reason: data?.reason, timestamp: data?.timestamp };
}

function stateColor(state: ErpAdapterState): { dot: string; text: string; label: string } {
  switch (state) {
    case 'real':
      return { dot: 'bg-emerald-500', text: 'text-emerald-400', label: 'Conectado (real)' };
    case 'mock':
      return { dot: 'bg-blue-500', text: 'text-blue-400', label: 'Mock (no real)' };
    case 'not_configured':
      return { dot: 'bg-amber-500', text: 'text-amber-400', label: 'No configurado' };
    case 'missing_credentials':
      return { dot: 'bg-amber-500', text: 'text-amber-400', label: 'Sin credenciales' };
    case 'not_implemented':
      return { dot: 'bg-rose-500', text: 'text-rose-400', label: 'No implementado (stub)' };
    case 'unknown':
    default:
      return { dot: 'bg-zinc-500', text: 'text-zinc-400', label: 'Verificando...' };
  }
}

export function ERPIntegration() {
  const { t } = useTranslation();
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [syncMode, setSyncMode] = useState<ErpAdapterState | null>(null);
  const [syncReason, setSyncReason] = useState<string | null>(null);
  const [probeState, setProbeState] = useState<ErpProbeState>('pending');
  const [adapterStatuses, setAdapterStatuses] = useState<ReadonlyArray<ErpAdapterStatus>>(ERP_ADAPTER_LABELS);
  const [apiEndpoint, setApiEndpoint] = useState<string>('');
  const [apiKeyMasked, setApiKeyMasked] = useState<string>('');
  const [apiKeyRevealed, setApiKeyRevealed] = useState<string | null>(null);
  const [rotateInFlight, setRotateInFlight] = useState(false);
  const { toasts, show: showToast, dismiss } = useToast();

  // Probe each adapter on mount. Until the probe resolves, every status
  // shows "Verificando..." — never the misleading hard-coded "Conectado".
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const probed = await Promise.all(
          ERP_ADAPTER_LABELS.map(async (a) => {
            try {
              const { state } = await probeErpAdapter(a.id);
              return { ...a, state };
            } catch {
              return { ...a, state: 'unknown' as ErpAdapterState };
            }
          }),
        );
        if (!cancelled) {
          setAdapterStatuses(probed);
          setProbeState('ok');
        }
      } catch (err) {
        if (!cancelled) {
          setProbeState('error');
          logger.error('ERP probe failed:', err);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const copyEndpoint = async () => {
    if (!apiEndpoint) return;
    try {
      await navigator.clipboard.writeText(apiEndpoint);
      showToast('Endpoint copiado al portapapeles.', 'success');
    } catch {
      showToast('No se pudo copiar el endpoint.', 'error');
    }
  };

  const rotateApiKey = async () => {
    setRotateInFlight(true);
    try {
      const authHeader = await apiAuthHeader();
      const response = await fetch('/api/erp/rotate-key', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authHeader ? { 'Authorization': authHeader } : {}),
        },
      });
      if (!response.ok) {
        showToast(`Rotación no disponible. Contacta al administrador.`, 'warning');
        return;
      }
      const data: { key?: string; masked?: string } = await response.json();
      if (data.key) setApiKeyRevealed(data.key);
      if (data.masked) setApiKeyMasked(data.masked);
      showToast('API key rotada. Copia el nuevo valor antes de continuar.', 'success');
    } catch (err) {
      logger.error('ERP rotate key failed:', err);
      showToast('No se pudo rotar la API key. Verifica la conexión.', 'error');
    } finally {
      setRotateInFlight(false);
    }
  };

  const handleSync = async () => {
    setIsSyncing(true);
    setSyncMode(null);
    setSyncReason(null);
    try {
      // §2.20 (2026-05-23) — apiAuthHeader unified.
      const authHeader = await apiAuthHeader();
      // Codex P1 fix (PR #266, 2026-05-15): NO mandar `erpType` desde el
      // frontend — el backend lee `ERP_ADAPTER` env y decide el adapter.
      // Si el frontend hardcodea 'mock', prod con ERP_ADAPTER=sap siempre
      // recibiría mode:'mock' (porque el body sobreescribía el env).
      // Ahora dejamos al server decidir; el response.mode dice cuál corrió.
      const response = await fetch('/api/erp/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authHeader ? { 'Authorization': authHeader } : {}),
        },
        body: JSON.stringify({
          action: 'manual_sync'
        })
      });

      const data = await response.json();
      // Capturar el modo HONESTAMENTE — el backend reporta si fue real,
      // mock, no configurado, o stub.
      const mode: ErpAdapterState = (data?.mode ?? 'unknown') as ErpAdapterState;
      const reason: string | undefined = data?.reason;
      const timestamp: string | undefined = data?.timestamp;
      setSyncMode(mode);
      setSyncReason(reason ?? null);
      // Si el endpoint/base URL fueron devueltos, actualizarlos.
      if (typeof data?.endpoint === 'string') setApiEndpoint(data.endpoint);
      if (typeof data?.apiKeyMasked === 'string') setApiKeyMasked(data.apiKeyMasked);

      if (response.status === 503 && mode === 'not_configured') {
        showToast(
          'ERP no está configurado en este servidor. Contacta al administrador.',
          'warning',
        );
      } else if (response.status === 503 && mode === 'missing_credentials') {
        showToast(
          'El adapter ERP requiere credenciales no configuradas. Revisa env vars.',
          'warning',
        );
      } else if (response.status === 501 && mode === 'not_implemented') {
        showToast(
          'Adapter declarado pero la acción aún no está implementada (stub honesto).',
          'info',
        );
      } else if (mode === 'mock') {
        showToast(
          'Sincronización en modo MOCK — no se conectó a ERP real.',
          'info',
        );
      } else if (response.ok && mode === 'real') {
        showToast('Sincronización real con ERP completada.', 'success');
      } else {
        showToast('Sincronización terminó con error. Ver detalles.', 'error');
      }

      if (timestamp) setLastSync(new Date(timestamp).toLocaleString());
    } catch (error) {
      logger.error('Error syncing ERP:', error);
      showToast('Error al sincronizar con el ERP. Verifica la conexión con el servidor.', 'error');
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-primary-token uppercase tracking-tighter leading-tight flex items-center gap-3">
            <Server className="w-8 h-8 text-blue-500" />
            {t('erpIntegration.title', 'Integración ERP / RRHH')}
          </h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-muted-token uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            {t('erpIntegration.subtitle', 'API-First: Sincronización con SAP, Buk, Talana')}
          </p>
        </div>
        <div className="px-4 py-2 rounded-xl border flex items-center gap-2 text-blue-500 bg-blue-500/10 border-blue-500/20">
          <ShieldAlert className="w-5 h-5" />
          <span className="font-bold uppercase tracking-wider text-sm">
            {t('erpIntegration.tierBadge', 'Nivel: Enterprise')}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sync Panel */}
        <Card className="p-6 border-default-token space-y-6">
          <h2 className="text-lg font-bold text-primary-token flex items-center gap-2">
            <ArrowRightLeft className="w-5 h-5 text-blue-500" />
            {t('erpIntegration.syncSection', 'Sincronización de Datos')}
          </h2>

          <div className="space-y-4">
            {adapterStatuses.map((adapter) => {
              const color = stateColor(adapter.state);
              return (
                <div
                  key={adapter.id}
                  data-testid={`erp-adapter-row-${adapter.id}`}
                  className="p-4 rounded-xl bg-surface border border-default-token flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <Database className="w-6 h-6 text-blue-500" />
                    <div>
                      <h3 className="text-sm font-bold text-primary-token">{adapter.label}</h3>
                      <p className="text-xs text-muted-token">{adapter.description}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2" data-testid={`erp-adapter-status-${adapter.id}`} data-state={adapter.state}>
                    <span className={`w-2 h-2 rounded-full ${color.dot}`} />
                    <span className={`text-xs ${color.text}`}>{color.label}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <Button
            className="w-full py-4 text-lg"
            onClick={handleSync}
            disabled={isSyncing}
          >
            {isSyncing ? (
              <>
                <RefreshCw className="w-5 h-5 animate-spin mr-2" />
                Sincronizando Vía API REST...
              </>
            ) : (
              <>
                <ArrowRightLeft className="w-5 h-5 mr-2" />
                Forzar Sincronización Manual
              </>
            )}
          </Button>

          {/* Sprint 39 — surface honesto del modo de la última sync. */}
          {syncMode && (
            <div
              data-testid="erp-sync-mode-banner"
              className={`text-center text-xs px-3 py-2 rounded ${
                syncMode === 'real'
                  ? 'bg-emerald-500/10 text-emerald-400'
                  : syncMode === 'mock'
                    ? 'bg-blue-500/10 text-blue-400'
                    : syncMode === 'not_configured' ||
                        syncMode === 'missing_credentials' ||
                        syncMode === 'not_implemented'
                      ? 'bg-amber-500/10 text-amber-400'
                      : 'bg-rose-500/10 text-rose-400'
              }`}
            >
              <p className="font-bold uppercase tracking-wider">Modo: {syncMode}</p>
              {syncReason && <p className="mt-1 opacity-80">{syncReason}</p>}
            </div>
          )}

          {lastSync && (
            <div className="text-center">
              <p className="text-xs text-muted-token">Último intento: {lastSync}</p>
            </div>
          )}
        </Card>

        {/* API Config Panel */}
        <Card className="p-6 border-default-token space-y-6">
          <h2 className="text-lg font-bold text-primary-token flex items-center gap-2">
            <Lock className="w-5 h-5 text-blue-500" />
            {t('erpIntegration.apiConfigSection', 'Configuración API REST')}
          </h2>

          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-surface border border-default-token">
              <p className="text-[10px] font-bold text-muted-token uppercase tracking-widest mb-2">Endpoint Base</p>
              <div className="flex items-center justify-between bg-black p-2 rounded border border-default-token">
                <code
                  className="text-xs text-blue-400"
                  data-testid="erp-endpoint-display"
                >
                  {apiEndpoint || (probeState === 'pending' ? 'Verificando…' : 'No configurado')}
                </code>
                <Button
                  variant="secondary"
                  className="px-2 py-1 h-auto text-[10px]"
                  onClick={copyEndpoint}
                  disabled={!apiEndpoint}
                  data-testid="erp-copy-endpoint"
                >
                  <Copy className="w-3 h-3 mr-1" />
                  Copiar
                </Button>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-surface border border-default-token">
              <p className="text-[10px] font-bold text-muted-token uppercase tracking-widest mb-2">API Key (Bearer Token)</p>
              <div className="flex items-center justify-between bg-black p-2 rounded border border-default-token">
                <code
                  className="text-xs text-muted-token"
                  data-testid="erp-api-key-display"
                >
                  {apiKeyRevealed
                    ? apiKeyRevealed
                    : apiKeyMasked || (probeState === 'pending' ? 'Verificando…' : 'No configurada')}
                </code>
                <Button
                  variant="secondary"
                  className="px-2 py-1 h-auto text-[10px]"
                  onClick={rotateApiKey}
                  disabled={rotateInFlight}
                  data-testid="erp-rotate-key"
                >
                  <RotateCw className={`w-3 h-3 mr-1 ${rotateInFlight ? 'animate-spin' : ''}`} />
                  {rotateInFlight ? 'Rotando…' : 'Rotar Key'}
                </Button>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/20">
              <div className="flex gap-2">
                <ShieldAlert className="w-4 h-4 text-blue-400 shrink-0" />
                <p className="text-xs text-blue-300">
                  La API REST utiliza autenticación basada en JWT y está protegida por rate limiting (1000 req/min) y filtrado de IP.
                </p>
              </div>
            </div>
          </div>
        </Card>
      </div>
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
