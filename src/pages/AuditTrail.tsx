import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Database, ShieldAlert, Activity, Filter, Search, Download, Clock, User, FileText, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card, Button } from '../components/shared/Card';
import { auth } from '../services/firebase';
import { useProject } from '../contexts/ProjectContext';
import { logger } from '../utils/logger';
import { apiAuthHeader } from '../lib/apiAuth';
import { humanErrorMessage } from '../lib/humanError';


// Codex fake fix §2.2 (2026-05-15): antes esta página mostraba 5 entradas
// hardcoded tras `setTimeout(1500)`. Esto era false-completeness peligrosa
// para ISO 45001 §10.2 (audit trail debe ser real e inmutable). Ahora
// consume `GET /api/audit-log` que lee la colección `audit_logs` de
// Firestore (ver src/server/routes/audit.ts).
interface AuditLogEntry {
  id: string;
  action: string;
  module: string;
  details: Record<string, unknown> | string | null;
  userId: string;
  userEmail: string | null;
  projectId: string | null;
  timestamp: string | null;  // ISO o null
  ip: string | null;
}

export function AuditTrail() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    const loadAuditLogs = async () => {
      setIsLoading(true);
      setError(null);
      try {
        // §2.20 (2026-05-23) — apiAuthHeader unified.
        const authHeader = await apiAuthHeader();
        if (!authHeader) {
          setError(
            t(
              'audit.errors.notAuthenticated',
              'Debes iniciar sesión para ver el audit trail.',
            ) as string,
          );
          return;
        }
        const projectQuery = selectedProject?.id
          ? `?projectId=${encodeURIComponent(selectedProject.id)}&limit=100`
          : '?limit=100';
        const res = await fetch(`/api/audit-log${projectQuery}`, {
          headers: { ...(authHeader ? { 'Authorization': authHeader } : {}) },
        });
        if (res.status === 403) {
          setError(
            t(
              'audit.errors.forbidden',
              'No tienes acceso al audit trail de este proyecto.',
            ) as string,
          );
          return;
        }
        if (!res.ok) {
          setError(
            t(
              'audit.errors.fetchFailed',
              'No se pudo cargar el audit trail. Reintenta en unos segundos.',
            ) as string,
          );
          return;
        }
        const json = (await res.json()) as { entries?: AuditLogEntry[] };
        setLogs(json.entries ?? []);
      } catch (err) {
        logger.error('audit_trail_load_failed', err);
        setError(
          t(
            'audit.errors.unexpected',
            'Error inesperado al cargar el audit trail.',
          ) as string,
        );
      } finally {
        setIsLoading(false);
      }
    };
    void loadAuditLogs();
  }, [selectedProject?.id, t]);

  // Búsqueda local (cliente) sobre los entries cargados
  const visibleLogs = searchTerm.trim()
    ? logs.filter((log) => {
        const term = searchTerm.toLowerCase();
        return (
          log.action.toLowerCase().includes(term) ||
          log.module.toLowerCase().includes(term) ||
          (log.userEmail?.toLowerCase().includes(term) ?? false) ||
          (typeof log.details === 'object' && JSON.stringify(log.details).toLowerCase().includes(term))
        );
      })
    : logs;

  const getActionColor = (action: string) => {
    switch (action) {
      case 'CREATE': return 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20';
      case 'UPDATE': return 'text-blue-500 bg-blue-500/10 border-blue-500/20';
      case 'DELETE': return 'text-rose-500 bg-rose-500/10 border-rose-500/20';
      case 'LOGIN': return 'text-violet-500 bg-violet-500/10 border-violet-500/20';
      case 'EXPORT': return 'text-amber-500 bg-amber-500/10 border-amber-500/20';
      default: return 'text-zinc-500 bg-zinc-500/10 border-zinc-500/20';
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-primary-token uppercase tracking-tighter leading-tight flex items-center gap-3">
            <Database className="w-8 h-8 text-rose-500" />
            {t('audit.header.title', 'Caja Negra (Audit Trail)')}
          </h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-muted-token uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            {t('audit.header.subtitle', 'Registro Inmutable de Operaciones')}
          </p>
        </div>
        <div className="px-4 py-2 rounded-xl border flex items-center gap-2 text-rose-500 bg-rose-500/10 border-rose-500/20">
          <ShieldAlert className="w-5 h-5" />
          <span className="font-bold uppercase tracking-wider text-sm">
            {t('audit.header.level', 'Nivel: Compliance Legal')}
          </span>
        </div>
      </div>

      <Card className="p-6 border-default-token space-y-6">
        <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
          <div className="relative w-full sm:w-96">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-token" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={t('audit.search.placeholder', 'Buscar por usuario, acción o módulo...')}
              className="w-full bg-surface border border-default-token rounded-xl py-3 pl-10 pr-4 text-primary-token focus:outline-none focus:border-rose-500 transition-colors"
              data-testid="audit-search-input"
            />
          </div>
          <div className="flex gap-2 w-full sm:w-auto">
            <Button variant="secondary" className="flex-1 sm:flex-none">
              <Filter className="w-4 h-4 mr-2" />
              {t('audit.actions.filters', 'Filtros')}
            </Button>
            <Button className="flex-1 sm:flex-none">
              <Download className="w-4 h-4 mr-2" />
              {t('audit.actions.exportCsv', 'Exportar CSV')}
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-default-token text-xs font-bold text-muted-token uppercase tracking-widest">
                <th className="p-4">{t('audit.table.timestamp', 'Timestamp')}</th>
                <th className="p-4">{t('audit.table.action', 'Acción')}</th>
                <th className="p-4">{t('audit.table.user', 'Usuario')}</th>
                <th className="p-4">{t('audit.table.resource', 'Módulo')}</th>
                <th className="p-4">{t('audit.table.details', 'Detalles')}</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-muted-token" data-testid="audit-loading">
                    <div className="flex flex-col items-center justify-center">
                      <Activity className="w-8 h-8 animate-spin mb-2 text-rose-500" />
                      {t('audit.table.loading', 'Cargando registros inmutables...')}
                    </div>
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center" data-testid="audit-error">
                    <div className="flex flex-col items-center justify-center text-amber-400">
                      <AlertCircle className="w-8 h-8 mb-2" />
                      <p className="font-bold">{humanErrorMessage(error)}</p>
                    </div>
                  </td>
                </tr>
              ) : visibleLogs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-muted-token" data-testid="audit-empty">
                    {searchTerm
                      ? t('audit.table.noMatch', 'Sin resultados para la búsqueda.')
                      : t(
                          'audit.table.empty',
                          'No hay registros en el audit trail para este proyecto. Las acciones de usuario se irán registrando automáticamente.',
                        )}
                  </td>
                </tr>
              ) : (
                visibleLogs.map((log) => (
                  <motion.tr
                    key={log.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="border-b border-default-token/50 hover:bg-surface transition-colors"
                    data-testid={`audit-row-${log.id}`}
                  >
                    <td className="p-4 text-secondary-token whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-muted-token" />
                        {log.timestamp ? new Date(log.timestamp).toLocaleString() : '—'}
                      </div>
                    </td>
                    <td className="p-4">
                      <span className={`px-2 py-1 rounded text-[10px] font-bold border ${getActionColor(log.action)}`}>
                        {log.action}
                      </span>
                    </td>
                    <td className="p-4 text-primary-token font-medium">
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-muted-token" />
                        {log.userEmail ?? log.userId}
                      </div>
                    </td>
                    <td className="p-4 text-secondary-token">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-muted-token" />
                        {log.module}
                      </div>
                    </td>
                    <td className="p-4 text-muted-token max-w-xs truncate" title={typeof log.details === 'string' ? log.details : JSON.stringify(log.details)}>
                      {typeof log.details === 'string'
                        ? log.details
                        : JSON.stringify(log.details ?? {})}
                    </td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
