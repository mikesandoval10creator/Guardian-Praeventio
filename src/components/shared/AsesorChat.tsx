// Sprint 20 fifth wave (Bucket Phi): wired al orchestrator SLM, soporta offline-first via Brecha B.
// TODO Ola 5b — Bucket O: cuando `SLM_OFFLINE_ENABLED` esté true en prod,
// migrar este wire al hook `useSlmOffline` (`src/hooks/useSlmOffline.ts`)
// + `OnnxSlmAdapter` directo. Hoy seguimos sobre `services/slm.ask()`,
// que usa el adapter Worker-based (registry Phi-3 / Qwen). El nuevo
// adapter ONNX-direct con TinyLlama 1.1B Q4 y streaming `onToken` queda
// detrás del feature flag mientras se publican los pesos en CDN.
import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare, X, Send, Brain, Loader2, Bot, User, Sparkles, WifiOff, Wifi, Shield, Save, CheckCircle2, ThumbsUp, ThumbsDown } from 'lucide-react';
import { db } from '../../services/firebase';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { useRiskEngine } from '../../hooks/useRiskEngine';
import { NodeType } from '../../types';
import { useProject } from '../../contexts/ProjectContext';
import ReactMarkdown from 'react-markdown';
import { getOfflineResponse, savePendingOfflineQuery, getPendingOfflineQueries, clearPendingOfflineQueries } from '../../utils/offlineKnowledge';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { getComprehensiveNormativeContext } from '../../contexts/NormativeContext';
import { fetchWeatherData, fetchSeismicData } from '../../services/orchestratorService';
import { auth } from '../../services/firebase';
import { logger } from '../../utils/logger';
// Bucket Phi T-1.5.x: orchestrator drives the AI call (online Gemini vs.
// offline on-device SLM); enqueueSession captures offline answers for the
// reconciliation pass once connectivity returns.
import { ask, enqueueSession, type SLMResponse } from '../../services/slm';
import { useSLM, SLM_ENQUEUED_EVENT } from '../slm/SLMProvider';
// Sprint 26 Bucket ZZ — fallback El Guardián Offline (caso sísmico).
// Se activa cuando `ask()` (orchestrator) falla por completo: corpus
// local + cache + FAQ garantizan que el trabajador reciba algo útil
// para sangrado, evacuación, gas, RCP, etc., aunque el modelo SLM no
// esté descargado todavía.
import { GuardianOfflineService } from '../../services/slm/guardianOffline';
// Sprint 20 17th-wave (Bucket D — title= â†’ <Tooltip>): WCAG 1.4.13
// compliant tooltip replaces the native `title=` on the per-message
// thumbs up/down feedback buttons (icon-only).
import { Tooltip } from './Tooltip';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isOffline?: boolean;
}

export function AsesorChat() {
  const [isOpen, setIsOpen] = useState(false);
  const isOnline = useOnlineStatus();
  const [pendingQueries, setPendingQueries] = useState<string[]>([]);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: 'Hola, soy El Guardián. Â¿En qué puedo asesorarte hoy sobre la seguridad y salud de tu proyecto?',
      timestamp: new Date()
    }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [detailLevel, setDetailLevel] = useState(1);
  const [lastTopic, setLastTopic] = useState('');
  const [savedNodeId, setSavedNodeId] = useState<string | null>(null);
  const [messageFeedback, setMessageFeedback] = useState<Record<string, 'up' | 'down'>>({});

  const handleFeedback = async (msgId: string, content: string, vote: 'up' | 'down') => {
    if (messageFeedback[msgId]) return;
    setMessageFeedback(prev => ({ ...prev, [msgId]: vote }));
    try {
      await addDoc(collection(db, 'ai_feedback'), {
        messageId: msgId,
        vote,
        response: content.slice(0, 1000),
        userId: auth.currentUser?.uid || null,
        createdAt: serverTimestamp(),
      });
    } catch { /* non-critical — feedback loss is acceptable */ }
  };
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { nodes, addNode } = useRiskEngine();
  const { selectedProject } = useProject();
  // Pending count surfaced as a badge in the header. Provider polls every
  // 30s and refreshes immediately on `gp-slm-enqueued`, so the count
  // reflects offline answers we ourselves push below.
  const { pendingCount } = useSLM();
  // Last response backend, surfaced as a debug chip ("gemini" vs.
  // "webgpu"/"wasm-simd"). Cleared between sends; null means no chip.
  const [lastBackend, setLastBackend] = useState<SLMResponse['backend'] | null>(null);
  // Bucket ZZ: El Guardián Offline service. fromEnv() retorna null si
  // SLM_OFFLINE_ENABLED no está activo — en ese caso simplemente no hay
  // fallback offline disponible y mostramos el mensaje genérico.
  const [offlineService] = useState(() => GuardianOfflineService.fromEnv());
  // Pre-cargar el corpus + (si está) el modelo en idle al montar para
  // que el primer ask() en emergencia no pague costo de download.
  useEffect(() => {
    if (!offlineService) return undefined;
    let cancelled = false;
    const idle = (cb: () => void) =>
      typeof window.requestIdleCallback === 'function'
        ? window.requestIdleCallback(cb, { timeout: 5000 })
        : setTimeout(cb, 1500);
    idle(() => { if (!cancelled) offlineService.preload().catch(() => {}); });
    return () => { cancelled = true; };
  }, [offlineService]);

  const handleSaveToRiskNetwork = async (content: string, topic: string) => {
    if (!selectedProject) return;
    
    try {
      const newNode = await addNode({
        title: `Asesoría: ${topic || 'Consulta IA'}`,
        description: content,
        type: NodeType.NORMATIVE,
        tags: ['ia-advice', 'chat-capture', topic].filter(Boolean),
        projectId: selectedProject.id,
        connections: [],
        metadata: {
          source: 'chat-bot',
          capturedAt: new Date().toISOString()
        }
      });
      if (newNode) {
        setSavedNodeId(newNode.id);
        setTimeout(() => setSavedNodeId(null), 3000);
      }
    } catch (error) {
      logger.error('Error saving to Risk Network:', error);
    }
  };

  useEffect(() => {
    // Load pending queries from IndexedDB on mount
    const loadPending = async () => {
      const storedQueries = await getPendingOfflineQueries();
      if (storedQueries.length > 0) {
        setPendingQueries(storedQueries);
      }
    };
    loadPending();
  }, []);

  useEffect(() => {
    const handleReconnection = async () => {
      if (isOnline && pendingQueries.length > 0) {
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          role: 'assistant',
          content: `**Â¡Conexión Restaurada!** ðŸŒ\n\nHe notado que tenías consultas pendientes mientras estabas offline:\n\n${pendingQueries.map(q => `- "${q}"`).join('\n')}\n\nÂ¿Te gustaría que analice alguna de estas consultas ahora con toda mi capacidad?`,
          timestamp: new Date()
        }]);
        setPendingQueries([]); // Clear pending queries state
        await clearPendingOfflineQueries(); // Clear IndexedDB
      }
    };
    handleReconnection();
  }, [isOnline, pendingQueries]);

  useEffect(() => {
    const handleOpenChat = (e: any) => {
      setIsOpen(true);
      if (e.detail?.query) {
        setInput(e.detail.query);
      }
    };
    window.addEventListener('open-ai-chat', handleOpenChat);
    return () => window.removeEventListener('open-ai-chat', handleOpenChat);
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    const currentInput = input;
    setInput('');
    setLoading(true);

    try {
      // Determine if this is a continuation to increase depth
      const isContinuation = /m[aá]s|detalle|profundiza|ampl[ií]a|contin[uú]a|ejemplo|explica|profundidad/i.test(currentInput);
      let newDetailLevel = detailLevel;

      if (isContinuation) {
        newDetailLevel = Math.min(detailLevel + 1, 3);
      } else {
        newDetailLevel = 1;
        setLastTopic(currentInput);
      }
      setDetailLevel(newDetailLevel);

      const searchQuery = isContinuation ? `${lastTopic} ${currentInput}` : currentInput;

      // Enrich with normative + live environment context in parallel.
      // The orchestrator's `ask()` accepts only a flat prompt string, so we
      // splice the context directly into the prompt — same payload Gemini
      // used to receive via the `normativeContext` / `environmentContext`
      // body fields, just rolled into the text the model sees.
      // Sprint 27 (audit P0 H12) — drop the Santiago fallback. A faena
      // in Antofagasta or Punta Arenas was getting clima/sismo for
      // Santiago, leading the model to recommend Santiago-specific
      // protocols. If the project has no coords, we now skip the
      // climate/seismic fetch entirely and let the prompt run without
      // geo context — better silent miss than confidently wrong reply.
      const projectLat = selectedProject?.coordinates?.lat;
      const projectLon = selectedProject?.coordinates?.lng;
      const hasGeoContext =
        typeof projectLat === 'number' && typeof projectLon === 'number';
      const [weatherData, seismicData] = hasGeoContext
        ? await Promise.allSettled([
            fetchWeatherData(projectLat, projectLon),
            fetchSeismicData(projectLat, projectLon),
          ])
        : [{ status: 'fulfilled' as const, value: null }, { status: 'fulfilled' as const, value: null }];
      const weather = weatherData.status === 'fulfilled' ? weatherData.value : null;
      const seismic = seismicData.status === 'fulfilled' ? seismicData.value : null;

      const environmentContext = [
        weather
          ? (() => {
              // Codex P2 (PR #308): the weather payload can return a
              // partial snapshot where `windSpeed` is intentionally
              // `undefined` (e.g. `getMockWeatherData()` when
              // `unavailable: true`). Substituting `0` would tell the
              // assistant prompt that wind is calm, which can produce
              // unsafe height/izaje advice. Build the field list and
              // OMIT wind when no real measurement exists.
              const parts: string[] = [
                `${weather.temp}°C`,
                weather.condition,
              ];
              if (typeof weather.windSpeed === 'number') {
                parts.push(`Viento: ${Math.round(weather.windSpeed)} km/h`);
              } else {
                parts.push('Viento: no disponible');
              }
              parts.push(`Humedad: ${weather.humidity}%`);
              parts.push(`Calidad del aire: ${weather.airQuality}`);
              return `Clima actual: ${parts.join(', ')}.`;
            })()
          : '',
        seismic ? `Sismo reciente: Magnitud ${seismic.magnitude} — Nivel de alerta: ${seismic.alertLevel}.` : '',
      ].filter(Boolean).join(' ');

      const normativeContext = getComprehensiveNormativeContext();
      const promptParts = [
        normativeContext ? `[Contexto normativo]\n${normativeContext}` : '',
        environmentContext ? `[Contexto ambiental]\n${environmentContext}` : '',
        `[Consulta del usuario]\n${searchQuery}`,
      ].filter(Boolean);
      const prompt = promptParts.join('\n\n');

      // Single entry point: orchestrator picks online (Gemini) vs. offline
      // (on-device SLM) based on `navigator.onLine`. We do NOT need the
      // explicit `if (!isOnline)` branch anymore — the orchestrator
      // handles that decision and any silent fallback on network failure.
      const response = await ask({ prompt });
      setLastBackend(response.backend);

      const isOfflineBackend = response.backend === 'webgpu' || response.backend === 'wasm-simd';

      const assistantMessageId = (Date.now() + 1).toString();
      setMessages(prev => [...prev, {
        id: assistantMessageId,
        role: 'assistant',
        content: response.text,
        timestamp: new Date(),
        isOffline: isOfflineBackend,
      }]);

      // If the orchestrator chose (or fell back to) the on-device SLM,
      // capture the {query, response} pair in the offline queue so the
      // reconciliation pass can replay it against the server LLM once
      // connectivity returns. We also fire the SLMProvider's enqueue
      // event so the pending-count badge updates immediately.
      if (isOfflineBackend) {
        try {
          await enqueueSession({ prompt }, response);
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent(SLM_ENQUEUED_EVENT));
          }
          // Mirror into the legacy `pendingQueries` list so the existing
          // "consultas pendientes" reconnection prompt still fires.
          setPendingQueries(prev => [...prev, currentInput]);
          await savePendingOfflineQuery(currentInput);
        } catch (queueErr) {
          logger.error('Error enqueueing offline session:', queueErr);
        }
      }
    } catch (error) {
      logger.error('Error in chat:', error);
      // Last-resort fallback chain (Bucket ZZ):
      //   1. Guardian Offline Service (corpus + FAQ + cache) si flag on
      //   2. getOfflineResponse legacy (Risk Network local heuristic)
      let fallbackContent = '';
      let fallbackCitations: string[] = [];
      if (offlineService) {
        try {
          const r = await offlineService.ask({ prompt: currentInput });
          fallbackContent = r.answer;
          fallbackCitations = r.citations;
        } catch (offErr) {
          logger.error('Guardian offline fallback also failed:', offErr);
        }
      }
      if (!fallbackContent) {
        fallbackContent = getOfflineResponse(currentInput, nodes);
      }
      const composed = fallbackCitations.length > 0
        ? `${fallbackContent}\n\n_Fuentes:_ ${fallbackCitations.join('; ')}`
        : fallbackContent;
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: composed,
        timestamp: new Date(),
        isOffline: true,
      };
      setMessages(prev => [...prev, errorMessage]);
      setPendingQueries(prev => [...prev, currentInput]);
      await savePendingOfflineQuery(currentInput);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Floating Button */}
      <AnimatePresence>
        {!isOpen && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            onClick={() => setIsOpen(true)}
            className="fixed bottom-20 sm:bottom-6 right-4 sm:right-6 z-40 w-14 h-14 sm:w-16 sm:h-16 bg-gradient-to-br from-emerald-400 to-emerald-600 hover:from-emerald-500 hover:to-emerald-700 text-white rounded-full shadow-2xl shadow-emerald-500/30 flex items-center justify-center transition-all group border border-white/10"
          >
            <Shield className="w-6 h-6 sm:w-7 sm:h-7 group-hover:scale-110 transition-transform drop-shadow-md" />
            {!isOnline && (
              <span className="absolute top-0 right-0 w-4 h-4 bg-amber-500 border-2 border-zinc-900 rounded-full animate-pulse" />
            )}
          </motion.button>
        )}
      </AnimatePresence>

      {/* Chat Window */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 100, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 100, scale: 0.9 }}
            className="fixed bottom-20 sm:bottom-6 right-2 sm:right-6 z-50 w-[calc(100vw-1rem)] sm:w-[400px] h-[500px] sm:h-[600px] max-h-[80vh] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-2xl sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="p-4 border-b border-zinc-200 dark:border-white/5 bg-gradient-to-r from-emerald-500/10 to-transparent flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                  <Shield className="w-6 h-6 text-emerald-500" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-zinc-900 dark:text-white">El Guardián</h3>
                  <div className="flex items-center gap-1.5">
                    {isOnline ? (
                      <>
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Conciencia Activa</span>
                        <div className="flex items-center gap-0.5 ml-1">
                          {[1, 2, 3].map((lvl) => (
                            <div 
                              key={lvl}
                              className={`w-1.5 h-1.5 rounded-full transition-colors ${
                                lvl <= detailLevel ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-800'
                              }`}
                              title={`Nivel de profundidad: ${lvl}`}
                            />
                          ))}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                        <span className="text-[10px] text-amber-500 font-bold uppercase tracking-widest">Modo Offline</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {/* Bucket Phi: backend chip — surfaces which engine answered the
                    last query (online Gemini vs. on-device SLM). Cleared on next
                    send. Hidden until the first response. */}
                {lastBackend && (
                  <span
                    className={`text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-full border ${
                      lastBackend === 'gemini'
                        ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
                        : 'bg-amber-500/10 text-amber-500 border-amber-500/20'
                    }`}
                    title={`Respuesta servida por: ${lastBackend}`}
                  >
                    {lastBackend === 'gemini' ? 'online' : 'offline'}
                  </span>
                )}
                {/* Bucket Phi: pending-count badge — shown only when the offline
                    queue actually has entries waiting to be reconciled. */}
                {pendingCount > 0 && (
                  <span
                    className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-500 border border-amber-500/20"
                    title={`${pendingCount} consulta(s) pendiente(s) de sincronizar`}
                  >
                    {pendingCount} pend.
                  </span>
                )}
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-2 hover:bg-zinc-200 dark:hover:bg-white/5 rounded-full transition-colors text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Bucket ZZ: banner emergencia offline. Se muestra solo cuando
                detectamos offline Y existe un offlineService activo, para no
                prometer respuestas que no podemos entregar. */}
            {!isOnline && offlineService && (
              <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 text-[11px] text-amber-700 dark:text-amber-300 leading-relaxed">
                Estás sin conexión. El Guardián tiene respuestas básicas de
                emergencia disponibles (sangrado, evacuación, RCP, gas, sismo).
              </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin scrollbar-thumb-zinc-300 dark:scrollbar-thumb-zinc-800 scrollbar-track-transparent">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`flex gap-3 max-w-[85%] ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border border-zinc-200 dark:border-white/5 ${
                      msg.role === 'assistant' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
                    }`}>
                      {msg.role === 'assistant' ? <Bot className="w-5 h-5" /> : <User className="w-5 h-5" />}
                    </div>
                    <div className={`p-3 rounded-2xl text-sm leading-relaxed ${
                      msg.role === 'assistant' 
                        ? 'bg-zinc-50 dark:bg-zinc-800/50 text-zinc-800 dark:text-zinc-200 border border-zinc-200 dark:border-white/5' 
                        : 'bg-emerald-500 text-white font-medium'
                    }`}>
                      <div className="markdown-body prose dark:prose-invert prose-sm max-w-none">
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>
                      
                      {msg.role === 'assistant' && !msg.isOffline && (
                        <div className="mt-3 pt-3 border-t border-zinc-200 dark:border-white/5 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1">
                            <Tooltip content="Ãštil">
                              <button
                                onClick={() => handleFeedback(msg.id, msg.content, 'up')}
                                aria-label="Marcar respuesta como útil"
                                className={`p-1 rounded-md transition-all ${messageFeedback[msg.id] === 'up' ? 'text-emerald-500 bg-emerald-500/10' : 'text-zinc-400 hover:text-emerald-500 hover:bg-emerald-500/10'}`}
                              >
                                <ThumbsUp className="w-3 h-3" />
                              </button>
                            </Tooltip>
                            <Tooltip content="No útil">
                              <button
                                onClick={() => handleFeedback(msg.id, msg.content, 'down')}
                                aria-label="Marcar respuesta como no útil"
                                className={`p-1 rounded-md transition-all ${messageFeedback[msg.id] === 'down' ? 'text-rose-500 bg-rose-500/10' : 'text-zinc-400 hover:text-rose-500 hover:bg-rose-500/10'}`}
                              >
                                <ThumbsDown className="w-3 h-3" />
                              </button>
                            </Tooltip>
                          </div>
                          <button
                            onClick={() => handleSaveToRiskNetwork(msg.content, lastTopic)}
                            disabled={savedNodeId !== null}
                            className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-widest transition-all ${
                              savedNodeId ? 'bg-emerald-500/20 text-emerald-500' : 'bg-zinc-200 dark:bg-white/5 text-zinc-500 hover:bg-zinc-300 dark:hover:bg-white/10 hover:text-zinc-900 dark:hover:text-white'
                            }`}
                          >
                            {savedNodeId ? (
                              <>
                                <CheckCircle2 className="w-3 h-3" />
                                Guardado en Pizarra
                              </>
                            ) : (
                              <>
                                <Save className="w-3 h-3" />
                                Guardar en Pizarra
                              </>
                            )}
                          </button>
                        </div>
                      )}

                      {msg.isOffline && (
                        <div className="mt-2 flex items-center gap-1 text-[10px] text-amber-500 font-bold uppercase tracking-widest">
                          <WifiOff className="w-3 h-3" />
                          Respuesta Offline
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="flex gap-3 max-w-[85%]">
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-500 flex items-center justify-center border border-zinc-200 dark:border-white/5">
                      <Bot className="w-5 h-5" />
                    </div>
                    <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/5">
                      <Loader2 className="w-4 h-4 text-emerald-500 animate-spin" />
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <form onSubmit={handleSend} className="p-4 border-t border-zinc-200 dark:border-white/5 bg-zinc-50 dark:bg-zinc-900/50">
              <div className="relative">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Pregunta a El Guardián..."
                  className="w-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-white/10 rounded-2xl py-3 pl-4 pr-12 text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
                />
                <button
                  type="submit"
                  disabled={!input.trim() || loading}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
