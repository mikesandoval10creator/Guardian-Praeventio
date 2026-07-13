import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Bot, User, Loader2, Shield, Trophy, Flame, Star } from 'lucide-react';
import { useFirebase } from '../contexts/FirebaseContext';
import { useProject } from '../contexts/ProjectContext';
import { auth } from '../services/firebase';
import ReactMarkdown from 'react-markdown';
import { useTranslation } from 'react-i18next';

interface Message {
  id: string;
  role: 'user' | 'coach';
  content: string;
  timestamp: Date;
}

interface UserStats {
  points: number;
  medals: string[];
  loginStreak: number;
}

export function SafetyCoach() {
  const { t } = useTranslation();
  const { user } = useFirebase();
  const { selectedProject } = useProject();
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'coach',
      content: '¡Hola! Soy **Praeventio AI Coach**, tu mentor personal de seguridad. Puedo responderte dudas sobre normativas, ayudarte a entender riesgos y motivarte a mantener tu racha de seguridad. ¿En qué puedo ayudarte hoy?',
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [userStats, setUserStats] = useState<UserStats | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Load user stats from Firestore via API (read user_stats doc)
  useEffect(() => {
    if (!user) return;
    import('../services/firebase').then(({ db, doc, getDoc }) => {
      // @ts-ignore — dynamic import pattern
      getDoc(doc(db, 'user_stats', user.uid)).then((snap: any) => {
        if (snap.exists()) setUserStats(snap.data() as UserStats);
        else setUserStats({ points: 0, medals: [], loginStreak: 0 });
      });
    });
  }, [user]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      // §2.20 (2026-05-23) — apiAuthHeader unified.
      const { apiAuthHeader } = await import('../lib/apiAuth');
      const authHeader = await apiAuthHeader();
      const res = await fetch('/api/coach/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authHeader ? { Authorization: authHeader } : {}),
        },
        body: JSON.stringify({
          message: text,
          projectContext: selectedProject ? { id: selectedProject.id, name: selectedProject.name } : undefined,
        }),
      });

      if (!res.ok) throw new Error('Error del servidor');
      const data = await res.json();

      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: 'coach',
          content: data.response || 'Lo siento, no pude generar una respuesta.',
          timestamp: new Date(),
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: 'coach',
          content: 'Hubo un error al conectar con el coach. Por favor intenta nuevamente.',
          timestamp: new Date(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-zinc-50 dark:bg-zinc-900">
      {/* Header */}
      <div className="px-5 py-4 border-b border-default-token bg-surface flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center shrink-0">
          <Shield className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="font-bold text-primary-token">{t('safetyCoach.title', 'Praeventio AI Coach')}</h1>
          <p className="text-xs text-muted-token">{t('safetyCoach.subtitle', 'Mentor personal de seguridad laboral')}</p>
        </div>

        {/* User stats chips */}
        {userStats && (
          <div className="flex gap-2">
            <div className="flex items-center gap-1 px-2 py-1 bg-amber-100 dark:bg-amber-500/20 rounded-full text-xs text-amber-700 dark:text-amber-300 font-medium">
              <Star className="w-3 h-3" />
              {userStats.points} pts
            </div>
            <div className="flex items-center gap-1 px-2 py-1 bg-orange-100 dark:bg-orange-500/20 rounded-full text-xs text-orange-700 dark:text-orange-300 font-medium">
              <Flame className="w-3 h-3" />
              {userStats.loginStreak}d
            </div>
            {userStats.medals.length > 0 && (
              <div className="flex items-center gap-1 px-2 py-1 bg-purple-100 dark:bg-purple-500/20 rounded-full text-xs text-purple-700 dark:text-purple-300 font-medium">
                <Trophy className="w-3 h-3" />
                {userStats.medals.length}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <AnimatePresence initial={false}>
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
            >
              <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                msg.role === 'coach'
                  ? 'bg-gradient-to-br from-emerald-400 to-teal-600'
                  : 'bg-zinc-200 dark:bg-zinc-700'
              }`}>
                {msg.role === 'coach' ? (
                  <Bot className="w-4 h-4 text-white" />
                ) : (
                  <User className="w-4 h-4 text-secondary-token" />
                )}
              </div>
              <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm ${
                msg.role === 'coach'
                  ? 'bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-100 rounded-tl-sm shadow-sm'
                  : 'bg-emerald-600 text-white rounded-tr-sm'
              }`}>
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                </div>
                <p className={`text-[10px] mt-1 opacity-50 ${msg.role === 'user' ? 'text-right' : ''}`}>
                  {msg.timestamp.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {loading && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4 text-white" />
            </div>
            <div className="bg-white dark:bg-zinc-800 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
              <Loader2 className="w-4 h-4 animate-spin text-emerald-500" />
            </div>
          </motion.div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Quick prompts */}
      <div className="px-4 pb-2 flex gap-2 overflow-x-auto scrollbar-none">
        {[
          '¿Qué dice el DS 594 sobre ruido?',
          '¿Cómo mejorar mi racha?',
          '¿Qué EPP necesito hoy?',
          'Explícame la Ley 16.744',
        ].map((prompt) => (
          <button
            key={prompt}
            onClick={() => { setInput(prompt); }}
            className="shrink-0 text-xs px-3 py-1.5 rounded-full border border-default-token bg-surface text-secondary-token hover:bg-emerald-50 dark:hover:bg-emerald-500/10 hover:border-emerald-300 dark:hover:border-emerald-600 transition-colors"
          >
            {prompt}
          </button>
        ))}
      </div>

      {/* Input */}
      <div className="p-4 border-t border-default-token bg-surface">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
            placeholder={t('safetyCoach.input.placeholder', 'Pregunta al coach de seguridad…')}
            disabled={loading}
            className="flex-1 px-4 py-2.5 rounded-xl border border-default-token bg-elevated text-sm text-primary-token placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || loading}
            className="w-10 h-10 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 flex items-center justify-center transition-colors"
          >
            <Send className="w-4 h-4 text-white" />
          </button>
        </div>
      </div>
    </div>
  );
}
