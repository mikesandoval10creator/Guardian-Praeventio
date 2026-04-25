import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sun, ShieldCheck, HeartPulse, Brain, CheckCircle2, Award, X, Salad, Droplets, Zap } from 'lucide-react';
import { Card, Button } from '../shared/Card';
import { useFirebase } from '../../contexts/FirebaseContext';
import { db, collection, addDoc, handleFirestoreError, OperationType } from '../../services/firebase';
import { getNutritionSuggestion } from '../../services/geminiService';

interface MorningCheckInProps {
  onComplete: () => void;
}

export function MorningCheckIn({ onComplete }: MorningCheckInProps) {
  const { user } = useFirebase();
  const [step, setStep] = useState(1);
  const [eppChecked, setEppChecked] = useState<Record<string, boolean>>({
    casco: false,
    chaleco: false,
    zapatos: false,
    lentes: false,
  });
  const [mood, setMood] = useState<number | null>(null);
  const [showReward, setShowReward] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [nutrition, setNutrition] = useState<{ suggestion: string; hydration: string; energy: string } | null>(null);

  const allEppChecked = Object.values(eppChecked).every(Boolean);

  const handleComplete = async () => {
    if (!user) {
      onComplete();
      return;
    }
    
    setIsSaving(true);
    try {
      // Save affidavit to immutable audit logs
      await addDoc(collection(db, 'audit_logs'), {
        userId: user.uid,
        action: 'MORNING_CHECKIN_AFFIDAVIT',
        module: 'Gamification',
        timestamp: new Date().toISOString(),
        details: {
          eppChecked,
          psychosocialMood: mood,
          declarationText: "Declaro bajo juramento que cuento con el equipo de protección personal requerido y me encuentro en condiciones óptimas para desempeñar mis labores de manera segura.",
          legalStatus: "Declaración Jurada Simple"
        }
      });
      setShowReward(true);
      // Fetch nutrition suggestion in background; auto-close after 6s if suggestion loads
      getNutritionSuggestion(mood ?? 3, user.displayName ?? 'Trabajador')
        .then(setNutrition)
        .catch(() => {});
      setTimeout(() => {
        onComplete();
      }, 6000);
    } catch (error) {
      console.error("Error saving checkin affidavit:", error);
      handleFirestoreError(error, OperationType.CREATE, 'audit_logs');
      // Even on failure in saving, complete so they aren't stuck, but maybe alert
      onComplete();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <AnimatePresence mode="wait">
        {!showReward ? (
          <motion.div
            key="checkin"
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: -20 }}
            className="w-full max-w-md"
          >
            <Card className="p-6 border-white/10 bg-zinc-900/90 shadow-2xl overflow-hidden relative">
              {/* Header */}
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-amber-500/20 rounded-lg">
                    <Sun className="w-6 h-6 text-amber-500" />
                  </div>
                  <div>
                    <h2 className="text-xl font-black text-white uppercase tracking-tight">
                      Despertar Matutino
                    </h2>
                    <p className="text-xs text-zinc-400 font-medium">
                      Sincronización de Turno
                    </p>
                  </div>
                </div>
                <button onClick={onComplete} className="p-2 hover:bg-white/5 rounded-full transition-colors">
                  <X className="w-5 h-5 text-zinc-500" />
                </button>
              </div>

              {/* Step 1: EPP Check */}
              {step === 1 && (
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="space-y-6"
                >
                  <div className="flex items-center gap-2 text-emerald-400 mb-4">
                    <ShieldCheck className="w-5 h-5" />
                    <h3 className="font-bold uppercase tracking-wider text-sm">Verificación EPP</h3>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-3">
                    {Object.entries(eppChecked).map(([item, isChecked]) => (
                      <button
                        key={item}
                        onClick={() => setEppChecked(prev => ({ ...prev, [item]: !isChecked }))}
                        className={`p-4 rounded-xl border-2 flex flex-col items-center gap-2 transition-all ${
                          isChecked 
                            ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400' 
                            : 'border-zinc-800 bg-zinc-900/50 text-zinc-500 hover:border-zinc-700'
                        }`}
                      >
                        {isChecked ? <CheckCircle2 className="w-6 h-6" /> : <div className="w-6 h-6 rounded-full border-2 border-current opacity-50" />}
                        <span className="text-xs font-bold uppercase tracking-wider">{item}</span>
                      </button>
                    ))}
                  </div>

                  <Button 
                    variant="primary" 
                    className="w-full mt-6"
                    disabled={!allEppChecked}
                    onClick={() => setStep(2)}
                  >
                    Siguiente Fase
                  </Button>
                </motion.div>
              )}

              {/* Step 2: Psychosocial Check */}
              {step === 2 && (
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="space-y-6"
                >
                  <div className="flex items-center gap-2 text-violet-400 mb-4">
                    <Brain className="w-5 h-5" />
                    <h3 className="font-bold uppercase tracking-wider text-sm">Estado Psicosocial</h3>
                  </div>
                  
                  <p className="text-sm text-zinc-400 text-center mb-6">
                    ¿Cómo te sientes para afrontar el turno de hoy, {user?.displayName?.split(' ')[0] || 'Guardián'}?
                  </p>

                  <div className="flex justify-between gap-2">
                    {[
                      { value: 1, emoji: '😫', label: 'Agotado' },
                      { value: 2, emoji: '🥱', label: 'Cansado' },
                      { value: 3, emoji: '😐', label: 'Normal' },
                      { value: 4, emoji: '🙂', label: 'Bien' },
                      { value: 5, emoji: '🚀', label: 'Óptimo' },
                    ].map((state) => (
                      <button
                        key={state.value}
                        onClick={() => setMood(state.value)}
                        className={`flex-1 p-3 rounded-xl border-2 flex flex-col items-center gap-2 transition-all ${
                          mood === state.value 
                            ? 'border-violet-500 bg-violet-500/20 scale-110 z-10' 
                            : 'border-zinc-800 bg-zinc-900/50 hover:border-zinc-700 opacity-70 hover:opacity-100'
                        }`}
                      >
                        <span className="text-2xl">{state.emoji}</span>
                        <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-400">{state.label}</span>
                      </button>
                    ))}
                  </div>

                  <div className="flex gap-3 mt-8">
                    <Button variant="outline" onClick={() => setStep(1)} className="flex-1" disabled={isSaving}>
                      Atrás
                    </Button>
                    <Button 
                      variant="primary" 
                      className="flex-1"
                      disabled={!mood || isSaving}
                      onClick={handleComplete}
                    >
                      {isSaving ? 'Registrando...' : 'Firmar y Sincronizar'}
                    </Button>
                  </div>
                </motion.div>
              )}
            </Card>
          </motion.div>
        ) : (
          <motion.div
            key="reward"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center"
          >
            <div className="w-24 h-24 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-6 border-4 border-emerald-500">
              <Award className="w-12 h-12 text-emerald-400" />
            </div>
            <h2 className="text-3xl font-black text-white uppercase tracking-tight mb-2">
              ¡Sincronización Exitosa!
            </h2>
            <p className="text-emerald-400 font-bold tracking-widest uppercase text-sm mb-6">
              +50 XP Obtenidos
            </p>

            <AnimatePresence>
              {nutrition ? (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="w-full max-w-xs mx-auto bg-zinc-900/80 border border-emerald-500/20 rounded-2xl p-4 text-left space-y-3"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Salad className="w-4 h-4 text-emerald-400" />
                    <span className="text-[10px] font-black text-emerald-400 uppercase tracking-widest">Nutrición Recomendada IA</span>
                  </div>
                  <p className="text-sm text-zinc-300 leading-relaxed">{nutrition.suggestion}</p>
                  <div className="flex items-center gap-2 pt-1 border-t border-zinc-800">
                    <Droplets className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                    <p className="text-xs text-zinc-400">{nutrition.hydration}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Zap className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <p className="text-xs text-zinc-400">Energía esperada: <span className="font-bold text-amber-400">{nutrition.energy}</span></p>
                  </div>
                </motion.div>
              ) : (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-zinc-500 text-xs"
                >
                  Calculando sugerencia nutricional...
                </motion.p>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
