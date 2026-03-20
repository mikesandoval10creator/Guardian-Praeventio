import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, MicOff, Volume2, VolumeX, X, MessageSquare, Loader2, ShieldCheck, Sparkles } from 'lucide-react';
import { GoogleGenAI, Modality } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export function GuardianVoiceAssistant() {
  const [isOpen, setIsOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [response, setResponse] = useState('');
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder.current = new MediaRecorder(stream);
      audioChunks.current = [];

      mediaRecorder.current.ondataavailable = (event) => {
        audioChunks.current.push(event.data);
      };

      mediaRecorder.current.onstop = async () => {
        const audioBlob = new Blob(audioChunks.current, { type: 'audio/webm' });
        await processAudio(audioBlob);
      };

      mediaRecorder.current.start();
      setIsRecording(true);
      setTranscript('');
      setResponse('');
    } catch (err) {
      console.error('Error accessing microphone:', err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorder.current && isRecording) {
      mediaRecorder.current.stop();
      setIsRecording(false);
      mediaRecorder.current.stream.getTracks().forEach(track => track.stop());
    }
  };

  const processAudio = async (blob: Blob) => {
    setIsProcessing(true);
    try {
      const reader = new FileReader();
      reader.readAsDataURL(blob);
      reader.onloadend = async () => {
        const base64Audio = (reader.result as string).split(',')[1];

        // 1. Transcribe and get AI response
        const result = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: [
            {
              parts: [
                {
                  inlineData: {
                    mimeType: "audio/webm",
                    data: base64Audio,
                  },
                },
                { text: "Eres el Guardián de Praeventio, un asistente experto en seguridad y salud ocupacional. Responde de forma concisa y profesional en español. Si el usuario pregunta algo sobre seguridad, dale una recomendación basada en normativas chilenas." },
              ],
            },
          ],
        });

        const aiText = result.text || "No pude entender el audio.";
        setResponse(aiText);

        // 2. Generate Speech
        const ttsResponse = await ai.models.generateContent({
          model: "gemini-2.5-flash-preview-tts",
          contents: [{ parts: [{ text: aiText }] }],
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: 'Kore' },
              },
            },
          },
        });

        const base64AudioResponse = ttsResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (base64AudioResponse) {
          const audioBlob = b64toBlob(base64AudioResponse, 'audio/mpeg');
          const url = URL.createObjectURL(audioBlob);
          setAudioUrl(url);
          setIsSpeaking(true);
        }
      };
    } catch (err) {
      console.error('Error processing audio:', err);
      setResponse("Hubo un error al procesar tu solicitud.");
    } finally {
      setIsProcessing(false);
    }
  };

  const b64toBlob = (b64Data: string, contentType = '', sliceSize = 512) => {
    const byteCharacters = atob(b64Data);
    const byteArrays = [];
    for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
      const slice = byteCharacters.slice(offset, offset + sliceSize);
      const byteNumbers = new Array(slice.length);
      for (let i = 0; i < slice.length; i++) {
        byteNumbers[i] = slice.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      byteArrays.push(byteArray);
    }
    return new Blob(byteArrays, { type: contentType });
  };

  useEffect(() => {
    if (audioUrl && audioRef.current) {
      audioRef.current.play();
    }
  }, [audioUrl]);

  return (
    <div className="fixed bottom-6 right-6 z-50">
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="absolute bottom-20 right-0 w-80 bg-zinc-900 border border-white/10 rounded-3xl shadow-2xl overflow-hidden"
          >
            <div className="p-4 border-b border-white/5 bg-gradient-to-r from-emerald-500/10 to-blue-500/10 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center">
                  <ShieldCheck className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Guardián AI</h3>
                  <div className="flex items-center gap-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-[10px] text-zinc-400 font-medium uppercase tracking-wider">En línea</span>
                  </div>
                </div>
              </div>
              <button 
                onClick={() => setIsOpen(false)}
                className="p-1 hover:bg-white/5 rounded-lg transition-colors text-zinc-500 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 flex flex-col items-center text-center">
              {isProcessing ? (
                <div className="py-8">
                  <Loader2 className="w-12 h-12 text-emerald-500 animate-spin mb-4" />
                  <p className="text-sm text-zinc-400">Analizando tu consulta...</p>
                </div>
              ) : response ? (
                <div className="space-y-4 w-full text-left">
                  <div className="bg-zinc-800/50 rounded-2xl p-4 border border-white/5">
                    <p className="text-sm text-white leading-relaxed">{response}</p>
                  </div>
                  <button 
                    onClick={() => setResponse('')}
                    className="text-xs text-emerald-500 font-bold hover:underline"
                  >
                    Hacer otra pregunta
                  </button>
                </div>
              ) : (
                <div className="py-8">
                  <div className={`w-24 h-24 rounded-full flex items-center justify-center mb-6 transition-all duration-500 ${
                    isRecording ? 'bg-rose-500/20 scale-110' : 'bg-emerald-500/10'
                  }`}>
                    <button
                      onMouseDown={startRecording}
                      onMouseUp={stopRecording}
                      onTouchStart={startRecording}
                      onTouchEnd={stopRecording}
                      className={`w-16 h-16 rounded-full flex items-center justify-center transition-all ${
                        isRecording ? 'bg-rose-500 animate-pulse' : 'bg-emerald-500 hover:scale-105'
                      }`}
                    >
                      {isRecording ? <MicOff className="w-8 h-8 text-white" /> : <Mic className="w-8 h-8 text-white" />}
                    </button>
                  </div>
                  <p className="text-sm text-white font-bold mb-1">
                    {isRecording ? 'Te escucho...' : 'Mantén presionado para hablar'}
                  </p>
                  <p className="text-xs text-zinc-500">
                    Pregúntame sobre EPP, normativas o riesgos.
                  </p>
                </div>
              )}
            </div>

            {isSpeaking && (
              <div className="px-4 py-2 bg-emerald-500/10 border-t border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Volume2 className="w-4 h-4 text-emerald-500 animate-bounce" />
                  <span className="text-[10px] text-emerald-500 font-bold uppercase tracking-wider">Reproduciendo respuesta</span>
                </div>
                <button onClick={() => setIsSpeaking(false)}>
                  <VolumeX className="w-4 h-4 text-zinc-500" />
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setIsOpen(!isOpen)}
        className={`w-14 h-14 rounded-2xl flex items-center justify-center shadow-2xl transition-all ${
          isOpen ? 'bg-zinc-900 text-white' : 'bg-emerald-500 text-white'
        }`}
      >
        {isOpen ? <MessageSquare className="w-6 h-6" /> : <Sparkles className="w-6 h-6" />}
      </motion.button>

      <audio 
        ref={audioRef} 
        src={audioUrl || undefined} 
        onEnded={() => setIsSpeaking(false)}
        className="hidden"
      />
    </div>
  );
}
