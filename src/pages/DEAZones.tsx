import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { HeartPulse, MapPin, Battery, AlertTriangle, CheckCircle2, Plus, Calendar, ShieldAlert, Activity, FileText } from 'lucide-react';
import { Card, Button } from '../components/shared/Card';

interface DEA {
  id: string;
  location: string;
  description: string;
  status: 'operational' | 'warning' | 'critical';
  batteryExpiry: string;
  padsExpiry: string;
  lastCheck: string;
  assignedTo: string;
}

const MOCK_DEAS: DEA[] = [
  {
    id: '1',
    location: 'Recepción Principal',
    description: 'Muro este, junto a extintor',
    status: 'operational',
    batteryExpiry: '2027-05-10',
    padsExpiry: '2026-12-01',
    lastCheck: '2026-04-01',
    assignedTo: 'Juan Pérez'
  },
  {
    id: '2',
    location: 'Casino Nivel 2',
    description: 'Entrada principal casino',
    status: 'warning',
    batteryExpiry: '2026-08-15',
    padsExpiry: '2026-05-20', // Expiring soon
    lastCheck: '2026-03-15',
    assignedTo: 'María González'
  },
  {
    id: '3',
    location: 'Taller Mecánico',
    description: 'Pilar central T-4',
    status: 'critical',
    batteryExpiry: '2025-11-01', // Expired
    padsExpiry: '2026-10-10',
    lastCheck: '2026-01-10',
    assignedTo: 'Carlos Rodríguez'
  }
];

export function DEAZones() {
  const [deas, setDeas] = useState<DEA[]>(MOCK_DEAS);
  const [selectedDEA, setSelectedDEA] = useState<DEA | null>(null);
  const [isChecklistOpen, setIsChecklistOpen] = useState(false);

  const getStatusColor = (status: DEA['status']) => {
    switch (status) {
      case 'operational': return 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20';
      case 'warning': return 'text-amber-500 bg-amber-500/10 border-amber-500/20';
      case 'critical': return 'text-rose-500 bg-rose-500/10 border-rose-500/20';
    }
  };

  const getStatusIcon = (status: DEA['status']) => {
    switch (status) {
      case 'operational': return <CheckCircle2 className="w-5 h-5" />;
      case 'warning': return <AlertTriangle className="w-5 h-5" />;
      case 'critical': return <ShieldAlert className="w-5 h-5" />;
    }
  };

  const handlePerformCheck = (dea: DEA) => {
    setSelectedDEA(dea);
    setIsChecklistOpen(true);
  };

  const submitChecklist = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDEA) return;
    
    // In a real app, save to Firestore
    setDeas(prev => prev.map(d => 
      d.id === selectedDEA.id 
        ? { ...d, lastCheck: new Date().toISOString().split('T')[0], status: 'operational' } 
        : d
    ));
    setIsChecklistOpen(false);
    setSelectedDEA(null);
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white uppercase tracking-tighter leading-tight flex items-center gap-3">
            <HeartPulse className="w-8 h-8 text-rose-500" />
            Zonas DEA
          </h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            Ley 21.156 - Desfibriladores Externos Automáticos
          </p>
        </div>
        <Button className="shrink-0">
          <Plus className="w-4 h-4 mr-2" />
          Registrar Nuevo DEA
        </Button>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-4 border-emerald-500/20 bg-emerald-500/5">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-emerald-500/20 rounded-xl">
              <CheckCircle2 className="w-6 h-6 text-emerald-500" />
            </div>
            <div>
              <p className="text-2xl font-black text-white">{deas.filter(d => d.status === 'operational').length}</p>
              <p className="text-xs font-bold text-emerald-500 uppercase tracking-wider">Operativos</p>
            </div>
          </div>
        </Card>
        <Card className="p-4 border-amber-500/20 bg-amber-500/5">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-amber-500/20 rounded-xl">
              <AlertTriangle className="w-6 h-6 text-amber-500" />
            </div>
            <div>
              <p className="text-2xl font-black text-white">{deas.filter(d => d.status === 'warning').length}</p>
              <p className="text-xs font-bold text-amber-500 uppercase tracking-wider">Por Vencer</p>
            </div>
          </div>
        </Card>
        <Card className="p-4 border-rose-500/20 bg-rose-500/5">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-rose-500/20 rounded-xl">
              <ShieldAlert className="w-6 h-6 text-rose-500" />
            </div>
            <div>
              <p className="text-2xl font-black text-white">{deas.filter(d => d.status === 'critical').length}</p>
              <p className="text-xs font-bold text-rose-500 uppercase tracking-wider">Críticos</p>
            </div>
          </div>
        </Card>
      </div>

      {/* DEA List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {deas.map((dea, index) => (
          <motion.div
            key={dea.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
          >
            <Card className={`p-6 border ${getStatusColor(dea.status)} transition-all hover:scale-[1.02]`}>
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg bg-zinc-900/50 border ${getStatusColor(dea.status)}`}>
                    {getStatusIcon(dea.status)}
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white">{dea.location}</h3>
                    <p className="text-xs text-zinc-400">{dea.description}</p>
                  </div>
                </div>
              </div>

              <div className="space-y-3 mb-6">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-zinc-500 flex items-center gap-2"><Battery className="w-4 h-4" /> Batería</span>
                  <span className="text-white font-medium">{dea.batteryExpiry}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-zinc-500 flex items-center gap-2"><Activity className="w-4 h-4" /> Parches</span>
                  <span className="text-white font-medium">{dea.padsExpiry}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-zinc-500 flex items-center gap-2"><Calendar className="w-4 h-4" /> Última Rev.</span>
                  <span className="text-white font-medium">{dea.lastCheck}</span>
                </div>
              </div>

              <Button 
                className="w-full" 
                variant={dea.status === 'critical' ? 'primary' : 'secondary'}
                onClick={() => handlePerformCheck(dea)}
              >
                <FileText className="w-4 h-4 mr-2" />
                Realizar Inspección
              </Button>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Checklist Modal */}
      {isChecklistOpen && selectedDEA && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-zinc-900 border border-white/10 rounded-2xl p-6 max-w-md w-full shadow-2xl"
          >
            <h2 className="text-xl font-bold text-white mb-2">Inspección Mensual DEA</h2>
            <p className="text-sm text-zinc-400 mb-6 flex items-center gap-2">
              <MapPin className="w-4 h-4" /> {selectedDEA.location}
            </p>

            <form onSubmit={submitChecklist} className="space-y-4">
              {[
                'Luz indicadora de estado parpadeando en verde',
                'Batería conectada y dentro de fecha útil',
                'Parches pediátricos y adultos sellados y vigentes',
                'Kit de respuesta (tijeras, rasuradora, mascarilla) completo',
                'Gabinete sin daños y alarma sonora operativa'
              ].map((item, i) => (
                <label key={i} className="flex items-start gap-3 p-3 rounded-xl bg-zinc-800/50 border border-white/5 cursor-pointer hover:bg-zinc-800 transition-colors">
                  <input type="checkbox" required className="mt-1 w-4 h-4 rounded border-zinc-600 text-emerald-500 focus:ring-emerald-500/50 bg-zinc-900" />
                  <span className="text-sm text-zinc-300">{item}</span>
                </label>
              ))}

              <div className="pt-4 flex gap-3">
                <Button type="button" variant="secondary" className="flex-1" onClick={() => setIsChecklistOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white">
                  Aprobar Inspección
                </Button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
}
