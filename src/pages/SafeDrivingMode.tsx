import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Car, AlertTriangle, Phone, MapPin, Mic, ShieldAlert } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export function SafeDrivingMode() {
  const navigate = useNavigate();
  const [isEmergency, setIsEmergency] = useState(false);

  const handleEmergency = () => {
    setIsEmergency(true);
    // Vibrate if supported
    if ('vibrate' in navigator) {
      navigator.vibrate([200, 100, 200, 100, 500]);
    }
  };

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col">
      {/* Top Bar */}
      <div className="flex items-center justify-between p-6 bg-zinc-900 border-b border-zinc-800">
        <div className="flex items-center gap-4">
          <Car className="w-10 h-10 text-emerald-500" />
          <div>
            <h1 className="text-2xl font-black text-white uppercase tracking-widest">Safe Driving</h1>
            <p className="text-emerald-500 font-bold uppercase tracking-widest text-xs">Modo Activo</p>
          </div>
        </div>
        <button 
          onClick={() => navigate(-1)}
          className="px-6 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-2xl text-white font-black uppercase tracking-widest text-sm transition-colors"
        >
          Salir
        </button>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col p-6 gap-6">
        {/* Voice Assistant Button (Huge) */}
        <button className="flex-1 bg-zinc-900 hover:bg-zinc-800 rounded-[3rem] border-4 border-zinc-800 flex flex-col items-center justify-center gap-6 transition-all active:scale-95">
          <div className="w-32 h-32 bg-indigo-500/20 rounded-full flex items-center justify-center">
            <Mic className="w-16 h-16 text-indigo-500" />
          </div>
          <span className="text-3xl font-black text-white uppercase tracking-widest">Dictar Reporte</span>
        </button>

        {/* Two large action buttons */}
        <div className="flex gap-6 h-64">
          <button className="flex-1 bg-zinc-900 hover:bg-zinc-800 rounded-[3rem] border-4 border-zinc-800 flex flex-col items-center justify-center gap-4 transition-all active:scale-95">
            <MapPin className="w-12 h-12 text-blue-500" />
            <span className="text-xl font-black text-white uppercase tracking-widest">Ruta</span>
          </button>
          <button className="flex-1 bg-zinc-900 hover:bg-zinc-800 rounded-[3rem] border-4 border-zinc-800 flex flex-col items-center justify-center gap-4 transition-all active:scale-95">
            <Phone className="w-12 h-12 text-emerald-500" />
            <span className="text-xl font-black text-white uppercase tracking-widest">Base</span>
          </button>
        </div>

        {/* Emergency Button (Massive) */}
        <button 
          onClick={handleEmergency}
          className={`h-48 rounded-[3rem] border-4 flex flex-col items-center justify-center gap-4 transition-all active:scale-95 ${
            isEmergency 
              ? 'bg-rose-600 border-rose-500 animate-pulse' 
              : 'bg-rose-500/10 border-rose-500/30 hover:bg-rose-500/20'
          }`}
        >
          <ShieldAlert className={`w-16 h-16 ${isEmergency ? 'text-white' : 'text-rose-500'}`} />
          <span className={`text-3xl font-black uppercase tracking-widest ${isEmergency ? 'text-white' : 'text-rose-500'}`}>
            {isEmergency ? 'S.O.S. Enviado' : 'Emergencia'}
          </span>
        </button>
      </div>
    </div>
  );
}
