import React, { useState, useRef } from 'react';
import { Car, Phone, MapPin, Mic, ShieldAlert, MicOff, CheckCircle2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { db } from '../services/firebase';
import { collection, addDoc } from 'firebase/firestore';
import { useProject } from '../contexts/ProjectContext';
import { useFirebase } from '../contexts/FirebaseContext';
import { useEmergency } from '../contexts/EmergencyContext';

export function SafeDrivingMode() {
  const navigate = useNavigate();
  const { selectedProject } = useProject();
  const { user } = useFirebase();
  const { triggerEmergency } = useEmergency();
  const [isEmergency, setIsEmergency] = useState(false);
  const [sosConfirmedAt, setSosConfirmedAt] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [dictatedText, setDictatedText] = useState('');
  const [reportSaved, setReportSaved] = useState(false);
  const recognitionRef = useRef<any>(null);
  const dictatedTextRef = useRef('');

  const saveReport = async (text: string) => {
    if (!text.trim() || !selectedProject) return;
    try {
      await addDoc(collection(db, `projects/${selectedProject.id}/driving_reports`), {
        content: text.trim(),
        userId: user?.uid || null,
        createdAt: new Date().toISOString(),
        type: 'DrivingReport',
      });
      setReportSaved(true);
      setTimeout(() => setReportSaved(false), 3000);
    } catch {
      // silent — text remains visible so user can copy it manually
    }
  };

  const handleDictate = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }
    dictatedTextRef.current = '';
    setDictatedText('');
    setReportSaved(false);
    const recognition = new SpeechRecognition();
    recognition.lang = 'es-CL';
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onresult = (e: any) => {
      const transcript = Array.from(e.results).map((r: any) => r[0].transcript).join(' ');
      dictatedTextRef.current = transcript;
      setDictatedText(transcript);
    };
    recognition.onend = () => {
      setIsListening(false);
      saveReport(dictatedTextRef.current);
    };
    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  };

  const handleEmergency = async () => {
    setIsEmergency(true);
    if ('vibrate' in navigator) {
      navigator.vibrate([200, 100, 200, 100, 500]);
    }
    await triggerEmergency('driving_sos', selectedProject?.id);
    setSosConfirmedAt(new Date().toLocaleTimeString('es-CL'));
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
        <button
          onClick={handleDictate}
          className={`flex-1 rounded-[3rem] border-4 flex flex-col items-center justify-center gap-6 transition-all active:scale-95 ${
            isListening ? 'bg-indigo-900 border-indigo-500 animate-pulse' : 'bg-zinc-900 hover:bg-zinc-800 border-zinc-800'
          }`}
        >
          <div className={`w-32 h-32 rounded-full flex items-center justify-center ${isListening ? 'bg-indigo-500/40' : 'bg-indigo-500/20'}`}>
            {isListening ? <MicOff className="w-16 h-16 text-indigo-300" /> : <Mic className="w-16 h-16 text-indigo-500" />}
          </div>
          <span className="text-3xl font-black text-white uppercase tracking-widest">
            {isListening ? 'Detener' : 'Dictar Reporte'}
          </span>
          {dictatedText && !isListening && (
            <span className="text-sm text-zinc-400 px-6 text-center max-w-xs">{dictatedText}</span>
          )}
          {reportSaved && (
            <div className="flex items-center gap-2 text-emerald-400 text-sm font-bold">
              <CheckCircle2 className="w-4 h-4" />
              Reporte guardado
            </div>
          )}
        </button>

        {/* Two large action buttons */}
        <div className="flex gap-6 h-64">
          <button
            onClick={() => navigate('/evacuation')}
            className="flex-1 bg-zinc-900 hover:bg-zinc-800 rounded-[3rem] border-4 border-zinc-800 flex flex-col items-center justify-center gap-4 transition-all active:scale-95"
          >
            <MapPin className="w-12 h-12 text-blue-500" />
            <span className="text-xl font-black text-white uppercase tracking-widest">Ruta</span>
          </button>
          {selectedProject?.phone ? (
            <a
              href={`tel:${selectedProject.phone}`}
              className="flex-1 bg-zinc-900 hover:bg-zinc-800 rounded-[3rem] border-4 border-zinc-800 flex flex-col items-center justify-center gap-4 transition-all active:scale-95"
            >
              <Phone className="w-12 h-12 text-emerald-500" />
              <span className="text-xl font-black text-white uppercase tracking-widest">Base</span>
            </a>
          ) : (
            <div
              title="Configure el número de base en los ajustes del proyecto"
              className="flex-1 bg-zinc-900 rounded-[3rem] border-4 border-zinc-800 flex flex-col items-center justify-center gap-4 opacity-40 cursor-not-allowed"
            >
              <Phone className="w-12 h-12 text-zinc-600" />
              <span className="text-xl font-black text-zinc-600 uppercase tracking-widest">Base</span>
            </div>
          )}
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
            {isEmergency ? (sosConfirmedAt ? `S.O.S. ${sosConfirmedAt}` : 'Enviando...') : 'Emergencia'}
          </span>
        </button>
      </div>
    </div>
  );
}
