import React from 'react';
import { motion } from 'framer-motion';
import { 
  Settings as SettingsIcon, 
  Shield, 
  Bell, 
  User, 
  Database, 
  Lock, 
  Globe, 
  Palette,
  ChevronRight,
  Zap,
  Smartphone,
  WifiOff
} from 'lucide-react';
import { usePushNotifications } from '../hooks/usePushNotifications';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export function Settings() {
  const { notificationPermissionStatus, requestPermission } = usePushNotifications();
  const isOnline = useOnlineStatus();

  const sections = [
    { title: 'Perfil y Cuenta', icon: User, description: 'Gestiona tu información personal y preferencias de acceso.' },
    { title: 'Seguridad y Privacidad', icon: Lock, description: 'Configura la autenticación de dos factores y permisos de datos.' },
    { title: 'Notificaciones', icon: Bell, description: 'Personaliza qué alertas deseas recibir y por qué canales.' },
    { title: 'Configuración de IA', icon: Zap, description: 'Ajusta el comportamiento de Gemini y el análisis predictivo.' },
    { title: 'Base de Datos y Red Neuronal', icon: Database, description: 'Gestión de nodos, conexiones y exportación de datos.' },
    { title: 'Interfaz y Tema', icon: Palette, description: 'Personaliza el aspecto visual de Praeventio Guard.' },
    { title: 'Idioma y Región', icon: Globe, description: 'Ajusta el idioma de la plataforma y formatos regionales.' },
  ];

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">Configuración</h1>
        <p className="text-zinc-400 mt-1 text-xs sm:text-sm">Personaliza tu experiencia en Praeventio Guard</p>
      </div>

      <div className="space-y-4 mb-6 sm:mb-8">
        <div className="bg-zinc-900/50 border border-emerald-500/30 rounded-2xl p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
            <div className="flex items-start sm:items-center gap-3 sm:gap-4">
              <div className="w-10 h-10 sm:w-12 sm:h-12 shrink-0 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-500 border border-emerald-500/20">
                <Smartphone className="w-5 h-5 sm:w-6 sm:h-6" />
              </div>
              <div>
                <h3 className="font-bold text-white text-sm sm:text-base">Notificaciones Push (FCM)</h3>
                <p className="text-zinc-400 text-[10px] sm:text-sm">Recibe alertas críticas y de emergencia en tiempo real.</p>
              </div>
            </div>
            <div className="flex flex-row sm:flex-col items-center sm:items-end justify-between sm:justify-start w-full sm:w-auto mt-2 sm:mt-0">
              <span className={`text-[10px] sm:text-xs font-bold uppercase tracking-widest px-2 py-1 rounded-full sm:mb-2 ${
                notificationPermissionStatus === 'granted' ? 'bg-emerald-500/20 text-emerald-400' :
                notificationPermissionStatus === 'denied' ? 'bg-rose-500/20 text-rose-400' :
                'bg-amber-500/20 text-amber-400'
              }`}>
                {notificationPermissionStatus === 'granted' ? 'Activas' :
                 notificationPermissionStatus === 'denied' ? 'Bloqueadas' :
                 'Pendientes'}
              </span>
              {notificationPermissionStatus !== 'granted' && (
                <button 
                  onClick={requestPermission}
                  disabled={!isOnline}
                  className={`px-4 py-2 rounded-xl text-[10px] sm:text-xs font-bold uppercase tracking-widest transition-colors flex items-center gap-2 ${
                    !isOnline 
                      ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed' 
                      : 'bg-emerald-500 hover:bg-emerald-600 text-white'
                  }`}
                >
                  {!isOnline ? (
                    <>
                      <WifiOff className="w-3 h-3" />
                      Requiere Conexión
                    </>
                  ) : (
                    'Activar Notificaciones'
                  )}
                </button>
              )}
            </div>
          </div>
          <p className="text-[10px] sm:text-xs text-zinc-500 leading-relaxed">
            Para recibir notificaciones push, debes permitir el acceso en tu navegador. Esto habilitará Firebase Cloud Messaging (FCM) para enviarte alertas críticas incluso cuando la aplicación esté en segundo plano.
          </p>
        </div>
      </div>

      <div className="space-y-3 sm:space-y-4">
        {sections.map((section, index) => (
          <motion.div
            key={section.title}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
            className="bg-zinc-900/50 border border-white/10 rounded-xl sm:rounded-2xl p-4 sm:p-5 hover:border-emerald-500/30 transition-all group cursor-pointer"
          >
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-start sm:items-center gap-3 sm:gap-4 flex-1">
                <div className="w-10 h-10 sm:w-12 sm:h-12 shrink-0 rounded-lg sm:rounded-xl bg-zinc-800 flex items-center justify-center text-emerald-500 border border-white/5">
                  <section.icon className="w-5 h-5 sm:w-6 sm:h-6" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-white text-sm sm:text-base group-hover:text-emerald-400 transition-colors truncate">{section.title}</h3>
                  <p className="text-zinc-500 text-[10px] sm:text-sm line-clamp-2 sm:line-clamp-1">{section.description}</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5 shrink-0 text-zinc-600 group-hover:text-emerald-500 transition-colors" />
            </div>
          </motion.div>
        ))}
      </div>

      <div className="mt-8 sm:mt-12 p-4 sm:p-6 bg-rose-500/5 border border-rose-500/10 rounded-2xl sm:rounded-3xl">
        <div className="flex items-center gap-2 sm:gap-3 mb-3 sm:mb-4">
          <Shield className="w-5 h-5 sm:w-6 sm:h-6 text-rose-500" />
          <h3 className="text-base sm:text-lg font-bold text-white uppercase tracking-widest">Zona de Peligro</h3>
        </div>
        <p className="text-[10px] sm:text-sm text-zinc-500 mb-4 sm:mb-6 leading-relaxed">
          Estas acciones son permanentes y no se pueden deshacer. Por favor, procede con extrema precaución.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
          <button className="w-full sm:w-auto px-4 py-3 sm:py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 text-[10px] sm:text-sm font-black uppercase tracking-widest rounded-xl transition-all border border-rose-500/20 active:scale-95">
            Cerrar Sesión Global
          </button>
          <button className="w-full sm:w-auto px-4 py-3 sm:py-2 bg-rose-500 hover:bg-rose-600 text-white text-[10px] sm:text-sm font-black uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-rose-500/20 active:scale-95">
            Eliminar Cuenta
          </button>
        </div>
      </div>
    </div>
  );
}
