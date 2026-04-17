import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, UserCheck, Radio, ShieldAlert, MapPin, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Card, Button } from '../shared/Card';

interface SquadMember {
  id: string;
  name: string;
  role: 'Líder' | 'Rescatista' | 'Comunicador' | 'Soporte Vital';
  status: 'En Posición' | 'En Tránsito' | 'No Responde';
  distance: string;
  skills: string[];
}

export function EmergencySquadManager() {
  const [squad, setSquad] = useState<SquadMember[]>([
    { id: '1', name: 'Carlos Mendoza', role: 'Líder', status: 'En Posición', distance: '0m', skills: ['Mando', 'Primeros Auxilios Avanzados'] },
    { id: '2', name: 'Ana Silva', role: 'Rescatista', status: 'En Tránsito', distance: '45m', skills: ['Rescate en Altura', 'Espacios Confinados'] },
    { id: '3', name: 'Luis Pérez', role: 'Comunicador', status: 'En Posición', distance: '10m', skills: ['Radiocomunicaciones', 'Coordinación Externa'] },
    { id: '4', name: 'María Gómez', role: 'Soporte Vital', status: 'No Responde', distance: '120m', skills: ['Enfermería', 'Manejo de DEA'] },
  ]);

  const [activeRole, setActiveRole] = useState<string | null>(null);

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
        <div className="flex gap-2">
          <Button variant="outline" className="border-rose-500/50 text-rose-500 hover:bg-rose-500/10">
            <Radio className="w-4 h-4 mr-2" />
            Llamado General
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
      </div>
    </Card>
  );
}
