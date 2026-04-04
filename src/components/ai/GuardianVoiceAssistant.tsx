import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, MicOff, Volume2, VolumeX, X, MessageSquare, Loader2, ShieldCheck, Sparkles, Send, WifiOff } from 'lucide-react';
import { processAudioWithAI, generateActionPlan } from '../../services/geminiService';
import { useRiskEngine } from '../../hooks/useRiskEngine';
import { useProject } from '../../contexts/ProjectContext';
import { useFirebase } from '../../contexts/FirebaseContext';
import { NodeType } from '../../types';
import { getOfflineResponse, savePendingOfflineQuery, getPendingOfflineQueries, clearPendingOfflineQueries } from '../../utils/offlineKnowledge';
import { isOnline } from '../../utils/pwa-offline';

export function GuardianVoiceAssistant() {
  const [isOpen, setIsOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [response, setResponse] = useState('');
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [textInput, setTextInput] = useState('');
  const [onlineStatus, setOnlineStatus] = useState(isOnline());
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const { addNode, addConnection, nodes } = useRiskEngine();
  const { selectedProject } = useProject();
  const { user } = useFirebase();

  useEffect(() => {
    const handleOnline = () => {
      setOnlineStatus(true);
      const pending = getPendingOfflineQueries();
      if (pending.length > 0) {
        setPendingPrompt(`¡Conexión recuperada! Mientras estabas offline preguntaste sobre: "${pending[0]}". ¿Te gustaría que profundicemos en eso ahora con IA?`);
        setIsOpen(true);
      }
    };
    const handleOffline = () => setOnlineStatus(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const handleClearPending = () => {
    clearPendingOfflineQueries();
    setPendingPrompt(null);
  };

  const handleProcessText = async () => {
    if (!textInput.trim()) return;
    
    const query = textInput;
    setTextInput('');
    setIsProcessing(true);
    setResponse('');

    if (!onlineStatus) {
      setTimeout(() => {
        const offlineRes = getOfflineResponse(query, nodes);
        setResponse(offlineRes);
        savePendingOfflineQuery(query);
        setIsProcessing(false);
      }, 800);
      return;
    }

    try {
      if (onlineStatus) {
        // Use geminiService for online text processing
        const { getChatResponse, semanticSearch } = await import('../../services/geminiService');
        
        // Get top 5 most relevant nodes
        const relevantNodes = await semanticSearch(query, nodes, 5);
        const context = relevantNodes.length > 0 
          ? relevantNodes.map(n => `- [${n.type}] ${n.title}: ${n.description}`).join('\n')
          : "Usuario consultando al Guardián AI."; 
        
        const aiResponse = await getChatResponse(query, context, [], 1);
        setResponse(aiResponse);
      } else {
        const offlineRes = getOfflineResponse(query, nodes);
        setResponse(offlineRes);
      }
    } catch (err) {
      console.error('Error processing text:', err);
      setResponse("Hubo un error al procesar tu solicitud.");
    } finally {
      setIsProcessing(false);
    }
  };

  const startRecording = async () => {
    if (!onlineStatus) {
      setResponse("La grabación de voz requiere conexión a internet. Por favor, escribe tu consulta abajo.");
      return;
    }

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
      setPendingPrompt(null);
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

        const { text, audioBase64, functionCall } = await processAudioWithAI(base64Audio);

        setResponse(text);

        if (functionCall && functionCall.title) {
          // Handle the function call to report an incident
          const findingNode = {
            type: 'finding' as NodeType,
            title: functionCall.title,
            description: functionCall.description,
            content: functionCall.description,
            tags: ['Incidente', functionCall.category, 'Voz'],
            authorId: user?.uid || 'unknown',
            metadata: {
              severity: functionCall.severity,
              status: 'Abierto',
              category: functionCall.category,
              projectId: selectedProject?.id
            },
            connections: [],
            projectId: selectedProject?.id
          };

          const newFindingNode = await addNode(findingNode);

          // Generate Action Plan automatically
          try {
            const actionPlan = await generateActionPlan(findingNode.title, findingNode.content);
            
            const actionPlanNode = {
              type: 'action-plan' as NodeType,
              title: `Plan de Acción: ${findingNode.title}`,
              description: actionPlan.summary,
              content: actionPlan.summary,
              tags: ['Plan de Acción', 'IA', functionCall.category],
              authorId: 'ai-guardian',
              metadata: {
                status: 'Pendiente',
                priority: functionCall.severity === 'Crítica' || functionCall.severity === 'Alta' ? 'Alta' : 'Media',
                tasks: actionPlan.correctiveActions.map((action: any) => ({
                  id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                  description: action.action,
                  status: 'Pendiente',
                  priority: action.priority
                }))
              },
              connections: [],
              projectId: selectedProject?.id
            };

            const newActionPlanNode = await addNode(actionPlanNode);
            if (newFindingNode && newActionPlanNode) {
              await addConnection(newFindingNode.id, newActionPlanNode.id);
            }
          } catch (planErr) {
            console.error('Error generating action plan:', planErr);
          }
        }

        if (audioBase64) {
          const audioBlob = b64toBlob(audioBase64, 'audio/mpeg');
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
    <div className="fixed bottom-6 left-6 z-50">
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="absolute bottom-20 left-0 w-80 sm:w-96 bg-zinc-900 border border-white/10 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
          >
            <div className={`p-4 border-b border-white/5 flex items-center justify-between ${onlineStatus ? 'bg-gradient-to-r from-emerald-500/10 to-blue-500/10' : 'bg-gradient-to-r from-amber-500/10 to-orange-500/10'}`}>
              <div className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${onlineStatus ? 'bg-emerald-500' : 'bg-amber-500'}`}>
                  {onlineStatus ? <ShieldCheck className="w-5 h-5 text-white" /> : <WifiOff className="w-5 h-5 text-white" />}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Guardián AI</h3>
                  <div className="flex items-center gap-1">
                    <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${onlineStatus ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                    <span className="text-[10px] text-zinc-400 font-medium uppercase tracking-wider">
                      {onlineStatus ? 'En línea' : 'Modo Offline'}
                    </span>
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

            <div className="p-6 flex-1 overflow-y-auto flex flex-col items-center text-center">
              {pendingPrompt && (
                <div className="mb-4 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-left w-full">
                  <p className="text-sm text-emerald-400 mb-3">{pendingPrompt}</p>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => {
                        const queries = getPendingOfflineQueries();
                        setTextInput(queries[0] || '');
                        handleClearPending();
                      }}
                      className="flex-1 bg-emerald-500 text-white text-xs font-bold py-2 rounded-xl"
                    >
                      Sí, preguntar
                    </button>
                    <button 
                      onClick={handleClearPending}
                      className="flex-1 bg-white/5 text-white text-xs font-bold py-2 rounded-xl"
                    >
                      Descartar
                    </button>
                  </div>
                </div>
              )}

              {isProcessing ? (
                <div className="py-8">
                  <Loader2 className={`w-12 h-12 animate-spin mb-4 ${onlineStatus ? 'text-emerald-500' : 'text-amber-500'}`} />
                  <p className="text-sm text-zinc-400">Analizando tu consulta...</p>
                </div>
              ) : response ? (
                <div className="space-y-4 w-full text-left">
                  <div className="bg-zinc-800/50 rounded-2xl p-4 border border-white/5">
                    <p className="text-sm text-white leading-relaxed whitespace-pre-wrap">{response}</p>
                  </div>
                  <button 
                    onClick={() => setResponse('')}
                    className={`text-xs font-bold hover:underline ${onlineStatus ? 'text-emerald-500' : 'text-amber-500'}`}
                  >
                    Hacer otra pregunta
                  </button>
                </div>
              ) : (
                <div className="py-4 w-full flex flex-col items-center">
                  <div className={`w-24 h-24 rounded-full flex items-center justify-center mb-6 transition-all duration-500 ${
                    isRecording ? 'bg-rose-500/20 scale-110' : onlineStatus ? 'bg-emerald-500/10' : 'bg-amber-500/10'
                  }`}>
                    <button
                      onMouseDown={startRecording}
                      onMouseUp={stopRecording}
                      onTouchStart={startRecording}
                      onTouchEnd={stopRecording}
                      className={`w-16 h-16 rounded-full flex items-center justify-center transition-all ${
                        isRecording ? 'bg-rose-500 animate-pulse' : onlineStatus ? 'bg-emerald-500 hover:scale-105' : 'bg-amber-500 hover:scale-105'
                      }`}
                    >
                      {isRecording ? <MicOff className="w-8 h-8 text-white" /> : <Mic className="w-8 h-8 text-white" />}
                    </button>
                  </div>
                  <p className="text-sm text-white font-bold mb-1">
                    {isRecording ? 'Te escucho...' : 'Mantén presionado para hablar'}
                  </p>
                  <p className="text-xs text-zinc-500 mb-6">
                    {onlineStatus ? 'Pregúntame sobre EPP, normativas o riesgos.' : 'El dictado por voz no está disponible offline.'}
                  </p>

                  <div className="w-full flex gap-2">
                    <input
                      type="text"
                      value={textInput}
                      onChange={(e) => setTextInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleProcessText()}
                      placeholder="O escribe tu consulta aquí..."
                      className="flex-1 bg-zinc-800/50 border border-white/10 rounded-xl px-4 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500/50"
                    />
                    <button
                      onClick={handleProcessText}
                      disabled={!textInput.trim()}
                      className={`p-2 rounded-xl flex items-center justify-center transition-colors ${
                        textInput.trim() ? (onlineStatus ? 'bg-emerald-500 text-white' : 'bg-amber-500 text-white') : 'bg-white/5 text-zinc-500'
                      }`}
                    >
                      <Send className="w-5 h-5" />
                    </button>
                  </div>
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
          isOpen ? 'bg-zinc-900 text-white' : onlineStatus ? 'bg-emerald-500 text-white' : 'bg-amber-500 text-white'
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
