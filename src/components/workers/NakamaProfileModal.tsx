import React, { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Worker } from '../../types';
import { Shield, Sword, Heart, Zap, Download, X, Star, Award, BookOpen, Loader2 } from 'lucide-react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

interface NakamaProfileModalProps {
  worker: Worker;
  onClose: () => void;
}

export function NakamaProfileModal({ worker, onClose }: NakamaProfileModalProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [isExporting, setIsExporting] = useState(false);

  const getRoleClass = (role: string) => {
    switch (role.toLowerCase()) {
      case 'supervisor': return { name: 'Paladín', color: 'from-amber-400 to-orange-600', icon: Shield };
      case 'prevencionista': return { name: 'Clérigo', color: 'from-emerald-400 to-teal-600', icon: Heart };
      case 'operario': return { name: 'Guerrero', color: 'from-rose-400 to-red-600', icon: Sword };
      case 'técnico': return { name: 'Artífice', color: 'from-blue-400 to-indigo-600', icon: Zap };
      default: return { name: 'Aventurero', color: 'from-zinc-400 to-zinc-600', icon: Star };
    }
  };

  const roleInfo = getRoleClass(worker.role);
  const RoleIcon = roleInfo.icon;

  // Calculate some mock stats based on worker data
  const level = Math.max(1, Math.floor((Date.now() - new Date(worker.joinedAt || Date.now()).getTime()) / (1000 * 60 * 60 * 24 * 30))); // 1 level per month
  const safetyScore = 95; // Mock score
  const trainingsCount = 12; // Mock count

  // Calculate acclimatization progress (7 days)
  const joinedDate = new Date(worker.joinedAt || Date.now());
  const daysSinceArrival = Math.floor((Date.now() - joinedDate.getTime()) / (1000 * 60 * 60 * 24));
  const acclimatizationDays = 7;
  const acclimatizationProgress = Math.min(100, Math.max(0, (daysSinceArrival / acclimatizationDays) * 100));
  const isAcclimatized = daysSinceArrival >= acclimatizationDays;

  const exportToPDF = async () => {
    if (!cardRef.current) return;
    setIsExporting(true);
    try {
      const canvas = await html2canvas(cardRef.current, {
        scale: 2,
        backgroundColor: '#18181b', // zinc-900
        useCORS: true,
      });
      
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
      });

      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`Curriculum_Preventivo_${worker.name.replace(/\s+/g, '_')}.pdf`);
    } catch (error) {
      console.error('Error exporting PDF:', error);
      alert('Error al exportar el currículum a PDF.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        className="relative w-full max-w-md"
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute -top-12 right-0 p-2 text-white/70 hover:text-white bg-white/10 hover:bg-white/20 rounded-full backdrop-blur-md transition-all"
        >
          <X className="w-6 h-6" />
        </button>

        {/* RPG Card */}
        <div 
          ref={cardRef}
          className="relative bg-zinc-900 rounded-3xl overflow-hidden border-2 border-zinc-800 shadow-2xl shadow-black"
          style={{
            backgroundImage: `radial-gradient(circle at 50% 0%, rgba(255,255,255,0.05) 0%, transparent 70%)`
          }}
        >
          {/* Card Header / Banner */}
          <div className={`h-32 bg-gradient-to-br ${roleInfo.color} relative flex items-center justify-center overflow-hidden`}>
            <div className="absolute inset-0 bg-black/20 mix-blend-overlay" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'20\' height=\'20\' viewBox=\'0 0 20 20\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'%23ffffff\' fill-opacity=\'0.1\' fill-rule=\'evenodd\'%3E%3Ccircle cx=\'3\' cy=\'3\' r=\'3\'/%3E%3Ccircle cx=\'13\' cy=\'13\' r=\'3\'/%3E%3C/g%3E%3C/svg%3E")' }}></div>
            <RoleIcon className="w-24 h-24 text-white/20 absolute -right-4 -bottom-4 transform rotate-12" />
          </div>

          {/* Avatar & Level */}
          <div className="relative px-6 pb-6">
            <div className="flex justify-between items-end -mt-12 mb-4">
              <div className="relative">
                <div className="w-24 h-24 rounded-2xl bg-zinc-800 border-4 border-zinc-900 flex items-center justify-center text-4xl font-black text-white shadow-xl relative z-10 overflow-hidden">
                  <div className={`absolute inset-0 bg-gradient-to-br ${roleInfo.color} opacity-20`}></div>
                  {worker.name.charAt(0)}
                </div>
                <div className="absolute -bottom-3 -right-3 bg-amber-500 text-black text-xs font-black px-2 py-1 rounded-lg border-2 border-zinc-900 shadow-lg z-20">
                  LVL {level}
                </div>
              </div>
              
              <div className="text-right">
                <div className={`text-[10px] font-black uppercase tracking-widest bg-gradient-to-r ${roleInfo.color} text-transparent bg-clip-text`}>
                  {roleInfo.name}
                </div>
                <div className="text-xs text-zinc-500 font-medium">{worker.role}</div>
              </div>
            </div>

            {/* Name & Title */}
            <div className="mb-6">
              <h2 className="text-2xl font-black text-white tracking-tight leading-none mb-1">{worker.name}</h2>
              <p className="text-sm text-zinc-400 flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${worker.status === 'active' ? 'bg-emerald-500' : 'bg-rose-500'}`}></span>
                {worker.status === 'active' ? 'Activo en Faena' : 'Inactivo'}
              </p>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-3 gap-3 mb-6">
              <div className="bg-zinc-800/50 rounded-xl p-3 border border-zinc-700/50 text-center">
                <Shield className="w-5 h-5 text-emerald-400 mx-auto mb-1" />
                <div className="text-lg font-black text-white">{safetyScore}%</div>
                <div className="text-[8px] uppercase tracking-widest text-zinc-500 font-bold">Defensa (SSOMA)</div>
              </div>
              <div className="bg-zinc-800/50 rounded-xl p-3 border border-zinc-700/50 text-center">
                <BookOpen className="w-5 h-5 text-blue-400 mx-auto mb-1" />
                <div className="text-lg font-black text-white">{trainingsCount}</div>
                <div className="text-[8px] uppercase tracking-widest text-zinc-500 font-bold">Sabiduría (Cursos)</div>
              </div>
              <div className="bg-zinc-800/50 rounded-xl p-3 border border-zinc-700/50 text-center">
                <Award className="w-5 h-5 text-amber-400 mx-auto mb-1" />
                <div className="text-lg font-black text-white">3</div>
                <div className="text-[8px] uppercase tracking-widest text-zinc-500 font-bold">Insignias</div>
              </div>
            </div>

            {/* Acclimatization Progress */}
            <div className="mb-6 bg-zinc-800/30 border border-zinc-700/30 rounded-xl p-4">
              <div className="flex justify-between items-end mb-2">
                <div className="flex items-center gap-2">
                  <Heart className={`w-4 h-4 ${isAcclimatized ? 'text-emerald-500' : 'text-rose-500'}`} />
                  <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Aclimatación (Altura/Terreno)</span>
                </div>
                <span className={`text-xs font-black ${isAcclimatized ? 'text-emerald-500' : 'text-rose-500'}`}>
                  {isAcclimatized ? '100%' : `${Math.round(acclimatizationProgress)}%`}
                </span>
              </div>
              <div className="h-2 w-full bg-zinc-900 rounded-full overflow-hidden mb-1">
                <motion.div 
                  className={`h-full rounded-full ${isAcclimatized ? 'bg-emerald-500' : 'bg-gradient-to-r from-rose-500 to-amber-500'}`}
                  initial={{ width: 0 }}
                  animate={{ width: `${acclimatizationProgress}%` }}
                  transition={{ duration: 1, ease: "easeOut" }}
                />
              </div>
              <p className="text-[9px] text-zinc-500 font-medium text-right">
                {isAcclimatized ? 'Aclimatación completa.' : `Día ${daysSinceArrival} de ${acclimatizationDays} requeridos.`}
              </p>
            </div>

            {/* Active Buffs (Certifications) */}
            <div>
              <h3 className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-3 flex items-center gap-2">
                <Zap className="w-3 h-3 text-amber-400" />
                Buffs Activos (Certificaciones)
              </h3>
              <div className="space-y-2">
                <div className="bg-zinc-800/30 border border-zinc-700/30 rounded-lg p-2.5 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-md bg-emerald-500/10 flex items-center justify-center text-emerald-400 shrink-0">
                    <Shield className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-zinc-200">Trabajo en Altura Física</div>
                    <div className="text-[9px] text-emerald-400 font-medium">Vigente hasta 2027</div>
                  </div>
                </div>
                <div className="bg-zinc-800/30 border border-zinc-700/30 rounded-lg p-2.5 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-md bg-blue-500/10 flex items-center justify-center text-blue-400 shrink-0">
                    <Heart className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-zinc-200">Primeros Auxilios (RCP)</div>
                    <div className="text-[9px] text-blue-400 font-medium">Vigente hasta 2026</div>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Footer Info */}
            <div className="mt-6 pt-4 border-t border-zinc-800 flex justify-between items-center">
              <div className="text-[9px] text-zinc-600 font-mono">
                ID: {worker.id.substring(0, 8).toUpperCase()}
              </div>
              <div className="text-[9px] text-zinc-600 font-mono">
                PRAEVENTIO GUARD OS
              </div>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="mt-4 flex gap-3">
          <button
            onClick={exportToPDF}
            disabled={isExporting}
            className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-white py-3 rounded-xl font-black text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2 border border-zinc-700 hover:border-zinc-600 shadow-lg"
          >
            {isExporting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Forjando PDF...
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                Exportar Currículum
              </>
            )}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
