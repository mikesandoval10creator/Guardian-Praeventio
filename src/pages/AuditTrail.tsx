import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Database, ShieldAlert, Activity, Filter, Search, Download, Clock, User, FileText } from 'lucide-react';
import { Card, Button } from '../components/shared/Card';

export function AuditTrail() {
  const [logs, setLogs] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Simulate fetching audit logs
    setTimeout(() => {
      setLogs([
        { id: '1', action: 'CREATE', resource: 'Matriz IPER', user: 'admin@praeventio.net', timestamp: new Date(Date.now() - 1000 * 60 * 5), details: 'Creación de matriz base para Proyecto Alpha' },
        { id: '2', action: 'UPDATE', resource: 'Protocolo Evacuación', user: 'prevencion@praeventio.net', timestamp: new Date(Date.now() - 1000 * 60 * 30), details: 'Actualización de ruta principal' },
        { id: '3', action: 'DELETE', resource: 'Usuario', user: 'admin@praeventio.net', timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2), details: 'Eliminación de cuenta inactiva' },
        { id: '4', action: 'LOGIN', resource: 'Sistema', user: 'operador@praeventio.net', timestamp: new Date(Date.now() - 1000 * 60 * 60 * 5), details: 'Inicio de sesión exitoso (IP: 192.168.1.100)' },
        { id: '5', action: 'EXPORT', resource: 'Reporte SUSESO', user: 'gerencia@praeventio.net', timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24), details: 'Exportación a PDF' },
      ]);
      setIsLoading(false);
    }, 1500);
  }, []);

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
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white uppercase tracking-tighter leading-tight flex items-center gap-3">
            <Database className="w-8 h-8 text-rose-500" />
            Caja Negra (Audit Trail)
          </h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            Registro Inmutable de Operaciones
          </p>
        </div>
        <div className="px-4 py-2 rounded-xl border flex items-center gap-2 text-rose-500 bg-rose-500/10 border-rose-500/20">
          <ShieldAlert className="w-5 h-5" />
          <span className="font-bold uppercase tracking-wider text-sm">
            Nivel: Compliance Legal
          </span>
        </div>
      </div>

      <Card className="p-6 border-white/5 space-y-6">
        <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
          <div className="relative w-full sm:w-96">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
            <input 
              type="text" 
              placeholder="Buscar por usuario, acción o recurso..." 
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-3 pl-10 pr-4 text-white focus:outline-none focus:border-rose-500 transition-colors"
            />
          </div>
          <div className="flex gap-2 w-full sm:w-auto">
            <Button variant="secondary" className="flex-1 sm:flex-none">
              <Filter className="w-4 h-4 mr-2" />
              Filtros
            </Button>
            <Button className="flex-1 sm:flex-none">
              <Download className="w-4 h-4 mr-2" />
              Exportar CSV
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-zinc-800 text-xs font-bold text-zinc-500 uppercase tracking-widest">
                <th className="p-4">Timestamp</th>
                <th className="p-4">Acción</th>
                <th className="p-4">Usuario</th>
                <th className="p-4">Recurso</th>
                <th className="p-4">Detalles</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-zinc-500">
                    <div className="flex flex-col items-center justify-center">
                      <Activity className="w-8 h-8 animate-spin mb-2 text-rose-500" />
                      Cargando registros inmutables...
                    </div>
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <motion.tr 
                    key={log.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="border-b border-zinc-800/50 hover:bg-zinc-900/50 transition-colors"
                  >
                    <td className="p-4 text-zinc-400 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-zinc-600" />
                        {log.timestamp.toLocaleString()}
                      </div>
                    </td>
                    <td className="p-4">
                      <span className={`px-2 py-1 rounded text-[10px] font-bold border ${getActionColor(log.action)}`}>
                        {log.action}
                      </span>
                    </td>
                    <td className="p-4 text-white font-medium">
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-zinc-500" />
                        {log.user}
                      </div>
                    </td>
                    <td className="p-4 text-zinc-300">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-zinc-500" />
                        {log.resource}
                      </div>
                    </td>
                    <td className="p-4 text-zinc-500 max-w-xs truncate" title={log.details}>
                      {log.details}
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
