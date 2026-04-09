import React, { useState, useEffect, useRef } from 'react';
import { Volume2, AlertTriangle, Mic, MicOff, Activity } from 'lucide-react';
import { Card } from '../shared/Card';
import { motion } from 'framer-motion';

export function NoiseMonitor() {
  const [isListening, setIsListening] = useState(false);
  const [decibels, setDecibels] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const audioContextRef = useRef<any>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const microphoneRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const animationFrameRef = useRef<number | undefined>(undefined);

  const startListening = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
      audioContextRef.current = new AudioContextClass();
      analyserRef.current = audioContextRef.current.createAnalyser();
      microphoneRef.current = audioContextRef.current.createMediaStreamSource(stream);
      
      microphoneRef.current.connect(analyserRef.current);
      analyserRef.current.fftSize = 256;
      
      const bufferLength = analyserRef.current.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const updateDecibels = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        
        // Calculate average volume
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;
        
        // Map 0-255 to approximate decibels (0-120 dB range for UI purposes)
        const db = Math.round((average / 255) * 120);
        setDecibels(db);
        
        animationFrameRef.current = requestAnimationFrame(updateDecibels);
      };

      updateDecibels();
      setIsListening(true);
      setError(null);
    } catch (err) {
      console.error("Error accessing microphone:", err);
      setError("No se pudo acceder al micrófono. Verifique los permisos.");
    }
  };

  const stopListening = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    if (microphoneRef.current) {
      microphoneRef.current.disconnect();
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
    }
    setIsListening(false);
    setDecibels(0);
  };

  useEffect(() => {
    return () => {
      stopListening();
    };
  }, []);

  const getRiskLevel = (db: number) => {
    if (db < 60) return { level: 'Seguro', color: 'text-emerald-500', bg: 'bg-emerald-500', alert: null };
    if (db < 80) return { level: 'Precaución', color: 'text-yellow-500', bg: 'bg-yellow-500', alert: null };
    if (db < 85) return { level: 'Alerta', color: 'text-orange-500', bg: 'bg-orange-500', alert: 'Límite de exposición cercano.' };
    return { level: 'Peligro', color: 'text-rose-500', bg: 'bg-rose-500', alert: '¡Uso obligatorio de protección auditiva!' };
  };

  const risk = getRiskLevel(decibels);

  return (
    <Card className="p-6 border-white/5 space-y-6 relative overflow-hidden">
      <div className="flex justify-between items-start">
        <div>
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Volume2 className="w-5 h-5 text-indigo-500" />
            Dosimetría Aproximada
          </h3>
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-1">
            Control de Ruido Ambiental
          </p>
        </div>
        <button
          onClick={isListening ? stopListening : startListening}
          className={`p-3 rounded-full transition-colors ${
            isListening ? 'bg-rose-500/20 text-rose-500 hover:bg-rose-500/30' : 'bg-indigo-500/20 text-indigo-500 hover:bg-indigo-500/30'
          }`}
        >
          {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
        </button>
      </div>

      {error && (
        <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs text-rose-400">
          {error}
        </div>
      )}

      <div className="flex flex-col items-center justify-center py-4">
        <div className="relative flex items-center justify-center w-32 h-32">
          {/* Animated rings based on decibels */}
          {isListening && (
            <>
              <motion.div
                className={`absolute inset-0 rounded-full ${risk.bg} opacity-20`}
                animate={{ scale: [1, 1 + decibels / 100, 1] }}
                transition={{ duration: 0.5, repeat: Infinity }}
              />
              <motion.div
                className={`absolute inset-4 rounded-full ${risk.bg} opacity-30`}
                animate={{ scale: [1, 1 + decibels / 150, 1] }}
                transition={{ duration: 0.5, repeat: Infinity, delay: 0.1 }}
              />
            </>
          )}
          <div className="z-10 flex flex-col items-center">
            <span className={`text-4xl font-black ${isListening ? risk.color : 'text-zinc-600'}`}>
              {decibels}
            </span>
            <span className="text-xs font-bold text-zinc-500 uppercase">dB</span>
          </div>
        </div>
      </div>

      {isListening && risk.alert && (
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className={`p-3 rounded-xl border flex items-start gap-2 ${
            decibels >= 85 ? 'bg-rose-500/10 border-rose-500/30 text-rose-400' : 'bg-orange-500/10 border-orange-500/30 text-orange-400'
          }`}
        >
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <p className="text-xs font-bold">{risk.alert}</p>
        </motion.div>
      )}

      <div className="pt-4 border-t border-white/5">
        <div className="flex items-center gap-2 text-[10px] text-zinc-500">
          <Activity className="w-3 h-3" />
          <p>
            <strong>Privacidad:</strong> Este módulo mide niveles de presión sonora localmente. No se graba ni transmite audio.
          </p>
        </div>
      </div>
    </Card>
  );
}
