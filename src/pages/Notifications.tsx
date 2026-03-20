import React from 'react';
import { motion } from 'framer-motion';
import { 
  Bell, 
  Shield, 
  AlertTriangle, 
  CheckCircle2, 
  Clock, 
  Trash2, 
  Check,
  Info
} from 'lucide-react';

export function Notifications() {
  const notifications = [
    { id: '1', title: 'Nueva Normativa Publicada', message: 'Se ha actualizado la Ley 16.744 sobre accidentes del trabajo.', type: 'info', time: 'Hace 2 horas', read: false },
    { id: '2', title: 'Alerta de Riesgo Crítico', message: 'Nivel de ruido excedido en Zona de Carga. Se requiere acción inmediata.', type: 'warning', time: 'Hace 5 horas', read: false },
    { id: '3', title: 'Capacitación Completada', message: 'La sesión de "Primeros Auxilios" ha sido finalizada con éxito.', type: 'success', time: 'Ayer', read: true },
    { id: '4', title: 'Examen Médico Vencido', message: 'El trabajador Juan Pérez tiene su examen médico vencido.', type: 'error', time: 'Hace 2 días', read: true },
  ];

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Notificaciones</h1>
          <p className="text-zinc-400 mt-1">Mantente al tanto de las alertas y actualizaciones de seguridad</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="p-2 text-zinc-500 hover:text-white transition-colors" title="Marcar todas como leídas">
            <Check className="w-5 h-5" />
          </button>
          <button className="p-2 text-zinc-500 hover:text-rose-500 transition-colors" title="Eliminar todas">
            <Trash2 className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {notifications.map((notification, index) => (
          <motion.div
            key={notification.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
            className={`p-5 rounded-2xl border transition-all group relative ${
              notification.read ? 'bg-zinc-900/30 border-white/5' : 'bg-zinc-900/60 border-emerald-500/20 shadow-lg shadow-emerald-500/5'
            }`}
          >
            {!notification.read && (
              <div className="absolute top-5 right-5 w-2 h-2 bg-emerald-500 rounded-full" />
            )}
            
            <div className="flex gap-4">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
                notification.type === 'warning' ? 'bg-amber-500/10 text-amber-500' :
                notification.type === 'error' ? 'bg-rose-500/10 text-rose-500' :
                notification.type === 'success' ? 'bg-emerald-500/10 text-emerald-500' :
                'bg-blue-500/10 text-blue-500'
              }`}>
                {notification.type === 'warning' ? <AlertTriangle className="w-6 h-6" /> :
                 notification.type === 'error' ? <Shield className="w-6 h-6" /> :
                 notification.type === 'success' ? <CheckCircle2 className="w-6 h-6" /> :
                 <Info className="w-6 h-6" />}
              </div>
              
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1">
                  <h3 className={`font-bold ${notification.read ? 'text-zinc-300' : 'text-white'}`}>
                    {notification.title}
                  </h3>
                  <div className="flex items-center gap-1 text-[10px] text-zinc-500 font-bold uppercase tracking-wider">
                    <Clock className="w-3 h-3" />
                    <span>{notification.time}</span>
                  </div>
                </div>
                <p className="text-sm text-zinc-500 leading-relaxed">
                  {notification.message}
                </p>
                
                <div className="mt-4 flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button className="text-[10px] font-black uppercase tracking-widest text-emerald-500 hover:text-emerald-400 transition-colors">
                    Ver Detalles
                  </button>
                  <button className="text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-white transition-colors">
                    Marcar como leída
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {notifications.length === 0 && (
        <div className="py-20 text-center">
          <div className="w-20 h-20 bg-zinc-900 rounded-3xl flex items-center justify-center mx-auto mb-6 border border-white/5">
            <Bell className="w-10 h-10 text-zinc-700" />
          </div>
          <h3 className="text-xl font-bold text-white mb-2">No hay notificaciones</h3>
          <p className="text-zinc-500">Todo está bajo control por aquí.</p>
        </div>
      )}
    </div>
  );
}
