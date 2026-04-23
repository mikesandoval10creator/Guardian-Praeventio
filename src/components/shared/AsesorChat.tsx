import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare, X, Send, Brain, Loader2, Bot, User, Sparkles, WifiOff, Wifi, Shield, Save, CheckCircle2 } from 'lucide-react';
import { useRiskEngine } from '../../hooks/useRiskEngine';
import { useProject } from '../../contexts/ProjectContext';
import ReactMarkdown from 'react-markdown';
import { getOfflineResponse, savePendingOfflineQuery, getPendingOfflineQueries, clearPendingOfflineQueries } from '../../utils/offlineKnowledge';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { auth } from '../../services/firebase';

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
      content: 'Hola, soy El Guardián. ¿En qué puedo asesorarte hoy sobre la seguridad y salud de tu proyecto?',
      timestamp: new Date()
    }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [detailLevel, setDetailLevel] = useState(1);
  const [lastTopic, setLastTopic] = useState('');
  const [savedNodeId, setSavedNodeId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { nodes, addNode } = useRiskEngine();
  const { selectedProject } = useProject();

  const handleSaveToRiskNetwork = async (content: string, topic: string) => {
    if (!selectedProject) return;
    
    try {
      const newNode = await addNode({
        title: `Asesoría: ${topic || 'Consulta IA'}`,
        description: content,
        type: 'normative' as any,
        tags: ['ia-advice', 'chat-capture', topic].filter(Boolean),
        projectId: selectedProject.id,
        connections: [],
        metadata: {
          source: 'chat-bot',
          capturedAt: new Date().toISOString()
        }
      });
      setSavedNodeId(newNode.id);
      setTimeout(() => setSavedNodeId(null), 3000);
    } catch (error) {
      console.error('Error saving to Risk Network:', error);
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
          content: `**¡Conexión Restaurada!** 🌐\n\nHe notado que tenías consultas pendientes mientras estabas offline:\n\n${pendingQueries.map(q => `- "${q}"`).join('\n')}\n\n¿Te gustaría que analice alguna de estas consultas ahora con toda mi capacidad?`,
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

    if (!isOnline) {
      // Handle Offline Mode
      setTimeout(async () => {
        const offlineResponse = getOfflineResponse(currentInput, nodes);
        const assistantMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: offlineResponse,
          timestamp: new Date(),
          isOffline: true
        };
        setMessages(prev => [...prev, assistantMessage]);
        setPendingQueries(prev => [...prev, currentInput]);
        await savePendingOfflineQuery(currentInput);
        setLoading(false);
      }, 600);
      return;
    }

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

      const token = auth.currentUser ? await auth.currentUser.getIdToken() : null;
      const response = await fetch('/api/ask-guardian', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          query: searchQuery,
          projectId: selectedProject?.id,
          stream: true
        })
      });

      if (!response.ok) {
        throw new Error('Network response was not ok');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let assistantMessageContent = '';

      const assistantMessageId = (Date.now() + 1).toString();
      setMessages(prev => [...prev, {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        timestamp: new Date()
      }]);

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n\n');
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const dataStr = line.slice(6);
              if (dataStr === '[DONE]') break;
              
              try {
                const data = JSON.parse(dataStr);
                assistantMessageContent += data.text;
                
                setMessages(prev => prev.map(m => 
                  m.id === assistantMessageId 
                    ? { ...m, content: assistantMessageContent }
                    : m
                ));
              } catch (e) {
                console.error("Error parsing SSE data", e);
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('Error in chat:', error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Lo siento, he tenido un problema al procesar tu consulta. Por favor, intenta de nuevo.',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
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
              <button 
                onClick={() => setIsOpen(false)}
                className="p-2 hover:bg-zinc-200 dark:hover:bg-white/5 rounded-full transition-colors text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

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
                        <div className="mt-3 pt-3 border-t border-zinc-200 dark:border-white/5 flex justify-end">
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
