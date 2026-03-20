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
  Zap
} from 'lucide-react';

export function Settings() {
  const sections = [
    { title: 'Perfil y Cuenta', icon: User, description: 'Gestiona tu información personal y preferencias de acceso.' },
    { title: 'Seguridad y Privacidad', icon: Lock, description: 'Configura la autenticación de dos factores y permisos de datos.' },
    { title: 'Notificaciones', icon: Bell, description: 'Personaliza qué alertas deseas recibir y por qué canales.' },
    { title: 'Configuración de IA', icon: Zap, description: 'Ajusta el comportamiento de Gemini y el análisis predictivo.' },
    { title: 'Base de Datos y Zettelkasten', icon: Database, description: 'Gestión de nodos, conexiones y exportación de datos.' },
    { title: 'Interfaz y Tema', icon: Palette, description: 'Personaliza el aspecto visual de Praeventio Guard.' },
    { title: 'Idioma y Región', icon: Globe, description: 'Ajusta el idioma de la plataforma y formatos regionales.' },
  ];

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white tracking-tight">Configuración</h1>
        <p className="text-zinc-400 mt-1">Personaliza tu experiencia en Praeventio Guard</p>
      </div>

      <div className="space-y-4">
        {sections.map((section, index) => (
          <motion.div
            key={section.title}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
            className="bg-zinc-900/50 border border-white/10 rounded-2xl p-5 hover:border-emerald-500/30 transition-all group cursor-pointer"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-zinc-800 flex items-center justify-center text-emerald-500 border border-white/5">
                  <section.icon className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-bold text-white group-hover:text-emerald-400 transition-colors">{section.title}</h3>
                  <p className="text-zinc-500 text-sm">{section.description}</p>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-zinc-600 group-hover:text-emerald-500 transition-colors" />
            </div>
          </motion.div>
        ))}
      </div>

      <div className="mt-12 p-6 bg-rose-500/5 border border-rose-500/10 rounded-3xl">
        <div className="flex items-center gap-3 mb-4">
          <Shield className="w-6 h-6 text-rose-500" />
          <h3 className="text-lg font-bold text-white">Zona de Peligro</h3>
        </div>
        <p className="text-zinc-500 text-sm mb-6">
          Estas acciones son permanentes y no se pueden deshacer. Por favor, procede con extrema precaución.
        </p>
        <div className="flex flex-wrap gap-4">
          <button className="px-4 py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 text-sm font-bold rounded-xl transition-all border border-rose-500/20">
            Cerrar Sesión en todos los dispositivos
          </button>
          <button className="px-4 py-2 bg-rose-500 hover:bg-rose-600 text-white text-sm font-bold rounded-xl transition-all shadow-lg shadow-rose-500/20">
            Eliminar Cuenta Permanentemente
          </button>
        </div>
      </div>
    </div>
  );
}
