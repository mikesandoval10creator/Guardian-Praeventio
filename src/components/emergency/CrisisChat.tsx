import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Send, 
  User, 
  AlertTriangle, 
  Clock, 
  MoreVertical, 
  Phone,
  MessageSquare,
  ShieldAlert
} from 'lucide-react';

interface Message {
  id: string;
  sender: string;
  role: string;
  text: string;
  timestamp: string;
  type: 'info' | 'alert' | 'emergency';
}

export function CrisisChat() {
  const [messages, setMessages] = useState<Message[]>([
    { id: '1', sender: 'Sistema', role: 'Seguridad', text: 'Protocolo de Emergencia Activado. Todos los trabajadores deben reportar su estado.', timestamp: '10:45 AM', type: 'emergency' },
    { id: '2', sender: 'Juan Pérez', role: 'Operador', text: 'Estoy a salvo en el punto de encuentro A.', timestamp: '10:46 AM', type: 'info' },
    { id: '3', sender: 'Carlos Ruiz', role: 'Mantenimiento', text: 'Humo detectado en Sector B - Planta 2. Necesito apoyo.', timestamp: '10:48 AM', type: 'emergency' },
    { id: '4', sender: 'Seguridad Central', role: 'Admin', text: 'Equipo de respuesta en camino al Sector B.', timestamp: '10:49 AM', type: 'alert' },
  ]);
  const [newMessage, setNewMessage] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim()) return;

    const msg: Message = {
      id: Date.now().toString(),
      sender: 'Yo',
      role: 'Usuario',
      text: newMessage,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      type: 'info'
    };

    setMessages([...messages, msg]);
    setNewMessage('');
  };

  return (
    <div className="flex flex-col h-[600px] bg-zinc-900/80 border border-white/10 rounded-3xl overflow-hidden backdrop-blur-xl">
      {/* Header */}
      <div className="p-4 border-b border-white/5 bg-rose-500/10 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-rose-500 flex items-center justify-center text-white shadow-lg shadow-rose-500/20">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-sm font-black text-white uppercase tracking-tight">Canal de Crisis</h3>
            <p className="text-[10px] text-rose-500 font-bold uppercase tracking-widest animate-pulse">Comunicación Crítica Activa</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className="p-2 hover:bg-white/5 rounded-lg text-zinc-400 transition-colors">
            <Phone className="w-4 h-4" />
          </button>
          <button className="p-2 hover:bg-white/5 rounded-lg text-zinc-400 transition-colors">
            <MoreVertical className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Messages Area */}
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-hide"
      >
        <AnimatePresence initial={false}>
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              className={`flex flex-col ${msg.sender === 'Yo' ? 'items-end' : 'items-start'}`}
            >
              <div className={`max-w-[85%] p-4 rounded-2xl space-y-2 ${
                msg.type === 'emergency' ? 'bg-rose-500 text-white shadow-lg shadow-rose-500/20' :
                msg.type === 'alert' ? 'bg-amber-500 text-black shadow-lg shadow-amber-500/20' :
                msg.sender === 'Yo' ? 'bg-white text-black' : 'bg-zinc-800 text-white'
              }`}>
                <div className="flex items-center justify-between gap-4 mb-1">
                  <span className={`text-[8px] font-black uppercase tracking-widest ${
                    msg.type === 'emergency' ? 'text-white/80' :
                    msg.type === 'alert' ? 'text-black/60' :
                    msg.sender === 'Yo' ? 'text-black/60' : 'text-zinc-500'
                  }`}>
                    {msg.sender} • {msg.role}
                  </span>
                  <span className={`text-[8px] font-bold uppercase tracking-widest ${
                    msg.type === 'emergency' ? 'text-white/60' :
                    msg.type === 'alert' ? 'text-black/40' :
                    msg.sender === 'Yo' ? 'text-black/40' : 'text-zinc-600'
                  }`}>
                    {msg.timestamp}
                  </span>
                </div>
                <p className="text-sm font-medium leading-relaxed">{msg.text}</p>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Input Area */}
      <form 
        onSubmit={handleSendMessage}
        className="p-4 bg-black/20 border-t border-white/5 flex items-center gap-3"
      >
        <input
          type="text"
          placeholder="Escribe un mensaje crítico..."
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          className="flex-1 bg-zinc-800 border border-white/5 rounded-xl py-3 px-4 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-rose-500/50 transition-all"
        />
        <button 
          type="submit"
          disabled={!newMessage.trim()}
          className="w-12 h-12 bg-rose-500 text-white rounded-xl flex items-center justify-center shadow-lg shadow-rose-500/20 hover:bg-rose-600 transition-all active:scale-95 disabled:opacity-50 disabled:grayscale"
        >
          <Send className="w-5 h-5" />
        </button>
      </form>

      {/* Quick Actions Footer */}
      <div className="px-4 py-2 bg-rose-500/5 border-t border-white/5 flex items-center gap-4 overflow-x-auto scrollbar-hide">
        <button className="whitespace-nowrap px-3 py-1.5 bg-rose-500/10 border border-rose-500/20 rounded-lg text-[9px] font-black text-rose-500 uppercase tracking-widest hover:bg-rose-500 hover:text-white transition-all">
          Reportar Fuego
        </button>
        <button className="whitespace-nowrap px-3 py-1.5 bg-rose-500/10 border border-rose-500/20 rounded-lg text-[9px] font-black text-rose-500 uppercase tracking-widest hover:bg-rose-500 hover:text-white transition-all">
          Solicitar Médico
        </button>
        <button className="whitespace-nowrap px-3 py-1.5 bg-rose-500/10 border border-rose-500/20 rounded-lg text-[9px] font-black text-rose-500 uppercase tracking-widest hover:bg-rose-500 hover:text-white transition-all">
          Evacuación Completa
        </button>
      </div>
    </div>
  );
}
