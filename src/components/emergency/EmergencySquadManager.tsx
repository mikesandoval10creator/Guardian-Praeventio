import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, UserCheck, Radio, ShieldAlert, MapPin, AlertTriangle, CheckCircle2, Search, Clock, Award } from 'lucide-react';
import { Card, Button } from '../shared/Card';
import { useFirebase } from '../../contexts/FirebaseContext';
import { getBreadcrumbs } from '../../utils/offlineStorage';
import { SkillTree } from './SkillTree';
import { useBluetoothMesh } from '../../hooks/useBluetoothMesh';

interface SquadMember {
  id: string;
  name: string;
  role: 'Líder' | 'Rescatista' | 'Comunicador' | 'Soporte Vital';
  status: 'En Posición' | 'En Tránsito' | 'No Responde';
  distance: string;
  skills: string[];
}

interface Breadcrumb {
  lat: number;
  lng: number;
  timestamp: number;
}

export function EmergencySquadManager() {
  const { user } = useFirebase();
  const { isSupported: bleSupported, isScanning: bleScanning, peerBreadcrumbs, nearbyDevices, startScanning } = useBluetoothMesh();
  const [squad] = useState<SquadMember[]>([
    { id: '1', name: 'Carlos Mendoza', role: 'Líder', status: 'En Posición', distance: '0m', skills: ['Mando', 'Primeros Auxilios Avanzados'] },
    { id: '2', name: 'Ana Silva', role: 'Rescatista', status: 'En Tránsito', distance: '45m', skills: ['Rescate en Altura', 'Espacios Confinados'] },
    { id: '3', name: 'Luis Pérez', role: 'Comunicador', status: 'En Posición', distance: '10m', skills: ['Radiocomunicaciones', 'Coordinación Externa'] },
    { id: '4', name: 'María Gómez', role: 'Soporte Vital', status: 'No Responde', distance: '120m', skills: ['Enfermería', 'Manejo de DEA'] },
  ]);

  const [activeRole, setActiveRole] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'squad' | 'search' | 'skills'>('squad');
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([]);
  const [loadingCrumbs, setLoadingCrumbs] = useState(false);

  useEffect(() => {
    if (viewMode !== 'search' || !user) return;
    setLoadingCrumbs(true);
    getBreadcrumbs(user.uid, 20)
      .then(setBreadcrumbs)
      .catch(() => setBreadcrumbs([]))
      .finally(() => setLoadingCrumbs(false));
    // Also trigger BLE scan to detect nearby peers and record their breadcrumbs
    if (bleSupported) startScanning();
  }, [viewMode, user, bleSupported]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'En Posición': return 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20';
      case 'En Tránsito': return 'text-amber-500 bg-amber-500/10 border-amber-500/20';
      case 'No Responde': return 'text-rose-500 bg-rose-500/10 border-rose-500/20';
      default: return 'text-zinc-500 bg-zinc-500/10 border-zinc-500/20';
    }
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'Líder': return <ShieldAlert className="w-5 h-5" />;
      case 'Rescatista': return <UserCheck className="w-5 h-5" />;
      case 'Comunicador': return <Radio className="w-5 h-5" />;
      case 'Soporte Vital': return <AlertTriangle className="w-5 h-5" />;
      default: return <Users className="w-5 h-5" />;
    }
  };

  const formatTime = (ts: number) => {
    const diff = Math.floor((Date.now() - ts) / 60000);
    if (diff < 1) return 'Hace menos de 1 min';
    if (diff === 1) return 'Hace 1 min';
    return `Hace ${diff} min`;
  };

  return (
    <Card className="p-6 border-rose-500/20 bg-zinc-900/50">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-rose-500/20 rounded-lg">
            <Users className="w-6 h-6 text-rose-500" />
          </div>
          <div>
            <h2 className="text-xl font-black text-white uppercase tracking-tight">Escuadrón de Emergencia</h2>
            <p className="text-sm text-zinc-400 font-medium">Asignación Cinética de Roles</p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {(['squad', 'search', 'skills'] as const).map(mode => (
            <Button
              key={mode}
              variant="outline"
              className={`border-zinc-700 text-zinc-300 hover:bg-zinc-800 ${viewMode === mode ? 'border-amber-500/50 text-amber-400 bg-amber-500/10' : ''}`}
              onClick={() => setViewMode(mode)}
            >
              {mode === 'squad' && <><Users className="w-4 h-4 mr-2" />Escuadrón</>}
              {mode === 'search' && <><Search className="w-4 h-4 mr-2" />Búsqueda</>}
              {mode === 'skills' && <><Award className="w-4 h-4 mr-2" />Habilidades</>}
            </Button>
          ))}
          <Button variant="outline" className="border-rose-500/50 text-rose-500 hover:bg-rose-500/10">
            <Radio className="w-4 h-4 mr-2" />
            Llamado General
          </Button>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {viewMode === 'skills' ? (
          <motion.div key="skills" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
            <SkillTree />
          </motion.div>
        ) : viewMode === 'search' ? (
          <motion.div
            key="search"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-4"
          >
            <div className="flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl">
              <MapPin className="w-4 h-4 text-amber-500 shrink-0" />
              <p className="text-xs text-amber-400 font-bold">
                Última ruta conocida (migas de pan GPS). Muestra tus posiciones registradas offline.
              </p>
            </div>

            {loadingCrumbs ? (
              <div className="text-center py-8 text-zinc-500 text-sm">Cargando rastro GPS...</div>
            ) : breadcrumbs.length === 0 ? (
              <div className="text-center py-8 space-y-2">
                <MapPin className="w-8 h-8 text-zinc-700 mx-auto" />
                <p className="text-zinc-500 text-sm">Sin rastro GPS disponible.</p>
                <p className="text-zinc-600 text-xs">Las migas se registran automáticamente cada minuto cuando hay señal GPS.</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {breadcrumbs.map((crumb, idx) => (
                  <div key={idx} className="flex items-center gap-3 p-3 bg-black/40 border border-white/5 rounded-xl">
                    <div className={`w-3 h-3 rounded-full shrink-0 ${idx === 0 ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.8)]' : 'bg-zinc-600'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-mono text-zinc-300 truncate">
                        {crumb.lat.toFixed(5)}, {crumb.lng.toFixed(5)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 text-zinc-500 shrink-0">
                      <Clock className="w-3 h-3" />
                      <span className="text-[10px]">{formatTime(crumb.timestamp)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <p className="text-[10px] text-zinc-600 text-center">
              {breadcrumbs.length > 0 && `${breadcrumbs.length} posición(es) registrada(s) • Última: ${new Date(breadcrumbs[0]?.timestamp).toLocaleTimeString()}`}
            </p>

            {/* BLE Peer Breadcrumbs */}
            {bleSupported && (
              <div className="mt-4 border-t border-white/5 pt-4">
                <div className="flex items-center gap-2 mb-3">
                  <Radio className="w-4 h-4 text-blue-400" />
                  <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Compañeros detectados vía BLE</p>
                  {bleScanning && <span className="text-[10px] text-blue-400 animate-pulse">Escaneando...</span>}
                </div>
                {peerBreadcrumbs.length === 0 ? (
                  <p className="text-xs text-zinc-600">Sin compañeros BLE detectados en rango.</p>
                ) : (
                  <div className="space-y-2">
                    {peerBreadcrumbs.slice(0, 10).map(peer => (
                      <div key={peer.peerId} className="flex items-center gap-3 p-2 bg-blue-500/10 border border-blue-500/20 rounded-xl">
                        <div className="w-3 h-3 rounded-full bg-blue-400 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-blue-300 truncate">{peer.peerName}</p>
                          <p className="text-[10px] text-zinc-500 font-mono truncate">{peer.peerId.slice(0, 12)}…</p>
                        </div>
                        <div className="flex items-center gap-1 text-zinc-500 shrink-0">
                          <Clock className="w-3 h-3" />
                          <span className="text-[10px]">{formatTime(peer.timestamp)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </motion.div>
        ) : viewMode === 'squad' ? (
          <motion.div
            key="squad"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="grid grid-cols-1 md:grid-cols-2 gap-4"
          >
            <AnimatePresence>
              {squad.map((member) => (
                <motion.div
                  key={member.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`p-4 rounded-xl border ${activeRole === member.role ? 'border-rose-500 bg-rose-500/5' : 'border-zinc-800 bg-black/40'} transition-all cursor-pointer`}
                  onClick={() => setActiveRole(activeRole === member.role ? null : member.role)}
                >
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${getStatusColor(member.status)}`}>
                        {getRoleIcon(member.role)}
                      </div>
                      <div>
                        <h3 className="text-white font-bold">{member.name}</h3>
                        <p className="text-xs text-zinc-400 uppercase tracking-wider">{member.role}</p>
                      </div>
                    </div>
                    <div className={`px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest border ${getStatusColor(member.status)}`}>
                      {member.status}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 text-xs text-zinc-500 mt-4">
                    <div className="flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      {member.distance}
                    </div>
                    <div className="flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      {member.skills.length} Competencias
                    </div>
                  </div>

                  {activeRole === member.role && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      className="mt-4 pt-4 border-t border-zinc-800"
                    >
                      <p className="text-xs text-zinc-400 mb-2 font-bold uppercase tracking-wider">Competencias Validadas:</p>
                      <div className="flex flex-wrap gap-2">
                        {member.skills.map((skill, idx) => (
                          <span key={idx} className="px-2 py-1 rounded bg-zinc-800 text-zinc-300 text-[10px] font-medium">
                            {skill}
                          </span>
                        ))}
                      </div>
                      <div className="mt-4 flex gap-2">
                        <Button className="flex-1 bg-rose-600 hover:bg-rose-700 text-white text-xs py-1.5 h-auto">
                          Reasignar Rol
                        </Button>
                        <Button variant="outline" className="flex-1 border-zinc-700 text-zinc-300 hover:bg-zinc-800 text-xs py-1.5 h-auto">
                          Ver Ubicación
                        </Button>
                      </div>
                    </motion.div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </Card>
  );
}
