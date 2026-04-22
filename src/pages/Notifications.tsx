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

import { useNotifications } from '../contexts/NotificationContext';
import { usePushNotifications } from '../hooks/usePushNotifications';

export function Notifications() {
  const { notifications, markAsRead, markAllAsRead, clearAll } = useNotifications();
  const { requestPermission, notificationPermissionStatus } = usePushNotifications();

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 sm:mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight leading-tight">Notificaciones</h1>
          <p className="text-zinc-400 mt-1 text-[10px] sm:text-sm">Mantente al tanto de las alertas y actualizaciones de seguridad</p>
        </div>
        <div className="flex items-center gap-2">
          {notificationPermissionStatus !== 'granted' && (
            <button 
              onClick={requestPermission}
              className="px-3 sm:px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-[9px] sm:text-[10px] font-black uppercase tracking-widest transition-colors flex-1 sm:flex-none text-center"
            >
              Activar Notificaciones Push
            </button>
          )}
          <button 
            onClick={markAllAsRead}
            className="p-2 bg-zinc-900/50 border border-white/10 rounded-xl text-zinc-500 hover:text-white transition-colors" 
            title="Marcar todas como leídas"
          >
            <Check className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
          <button 
            onClick={clearAll}
            className="p-2 bg-zinc-900/50 border border-white/10 rounded-xl text-zinc-500 hover:text-rose-500 transition-colors" 
            title="Eliminar todas"
          >
            <Trash2 className="w-4 h-4 sm:w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="space-y-3 sm:space-y-4">
        {notifications.map((notification, index) => (
          <motion.div
            key={notification.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
            className={`p-4 sm:p-5 rounded-2xl border transition-all group relative ${
              notification.read ? 'bg-zinc-900/30 border-white/5' : 'bg-zinc-900/60 border-emerald-500/20 shadow-lg shadow-emerald-500/5'
            }`}
          >
            {!notification.read && (
              <div className="absolute top-4 sm:top-5 right-4 sm:right-5 w-1.5 h-1.5 sm:w-2 sm:h-2 bg-emerald-500 rounded-full" />
            )}
            
            <div className="flex gap-3 sm:gap-4">
              <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center shrink-0 ${
                notification.type === 'warning' ? 'bg-amber-500/10 text-amber-500' :
                notification.type === 'error' ? 'bg-rose-500/10 text-rose-500' :
                notification.type === 'success' ? 'bg-emerald-500/10 text-emerald-500' :
                'bg-blue-500/10 text-blue-500'
              }`}>
                {notification.type === 'warning' ? <AlertTriangle className="w-5 h-5 sm:w-6 sm:h-6" /> :
                 notification.type === 'error' ? <Shield className="w-5 h-5 sm:w-6 sm:h-6" /> :
                 notification.type === 'success' ? <CheckCircle2 className="w-5 h-5 sm:w-6 sm:h-6" /> :
                 <Info className="w-5 h-5 sm:w-6 sm:h-6" />}
              </div>
              
              <div className="flex-1 min-w-0">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-1 sm:mb-2 gap-1 sm:gap-4">
                  <h3 className={`text-sm sm:text-base font-bold truncate pr-4 sm:pr-0 ${notification.read ? 'text-zinc-300' : 'text-white'}`}>
                    {notification.title}
                  </h3>
                  <div className="flex items-center gap-1 text-[9px] sm:text-[10px] text-zinc-500 font-bold uppercase tracking-wider shrink-0">
                    <Clock className="w-3 h-3" />
                    <span>{notification.time}</span>
                  </div>
                </div>
                <p className="text-xs sm:text-sm text-zinc-500 leading-relaxed line-clamp-2 sm:line-clamp-none">
                  {notification.message}
                </p>
                
                <div className="mt-3 sm:mt-4 flex items-center gap-3 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                  <button className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-emerald-500 hover:text-emerald-400 transition-colors">
                    Ver Detalles
                  </button>
                  {!notification.read && (
                    <button 
                      onClick={() => markAsRead(notification.id)}
                      className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-white transition-colors"
                    >
                      Marcar como leída
                    </button>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {notifications.length === 0 && (
        <div className="py-12 sm:py-20 text-center bg-zinc-900/30 rounded-3xl border border-white/5 mt-4">
          <div className="w-16 h-16 sm:w-20 sm:h-20 bg-zinc-900 rounded-2xl sm:rounded-3xl flex items-center justify-center mx-auto mb-4 sm:mb-6 border border-white/5 shadow-inner">
            <Bell className="w-8 h-8 sm:w-10 sm:h-10 text-zinc-700" />
          </div>
          <h3 className="text-lg sm:text-xl font-bold text-white mb-2">No hay notificaciones</h3>
          <p className="text-xs sm:text-sm text-zinc-500">Todo está bajo control por aquí.</p>
        </div>
      )}
    </div>
  );
}
