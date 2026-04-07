import React, { useState } from 'react';
import { Send, ShieldAlert, Loader2, Crosshair } from 'lucide-react';
import { GoogleGenAI } from '@google/genai';

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

export function Asesor() {
  const [query, setQuery] = useState('');
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);

  const handleAsk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || !API_KEY) return;

    setLoading(true);
    try {
      const ai = new GoogleGenAI({ apiKey: API_KEY });
      const result = await ai.models.generateContent({
        model: 'gemini-3.1-flash-preview',
        contents: query,
        config: {
          systemInstruction: `Eres El Asesor, un estratega veterano en seguridad industrial y respuesta a emergencias.
          Tu objetivo es salvar vidas y estabilizar el caos.
          REGLAS ESTRICTAS:
          1. Responde SOLO con planes de acción inmediatos y tácticos.
          2. Usa viñetas cortas y directas.
          3. Cero explicaciones largas, cero saludos, cero gráficos.
          4. Ve directo al grano. Ejemplo: "- Evacuar zona norte. - Cortar suministro eléctrico. - Aislar material."`,
          temperature: 0.2
        }
      });
      setResponse(result.text || '');
    } catch (error) {
      console.error('Error asking Asesor:', error);
      setResponse('Error de comunicación con el Asesor. Proceda con protocolo estándar de emergencia.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-zinc-50 dark:bg-zinc-900/50 border border-rose-500/20 rounded-3xl p-6 flex flex-col h-full">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 bg-rose-500/10 rounded-2xl flex items-center justify-center border border-rose-500/20 shrink-0">
          <Crosshair className="w-6 h-6 text-rose-500" />
        </div>
        <div>
          <h3 className="text-xl font-black text-zinc-900 dark:text-white uppercase tracking-tight">El Asesor</h3>
          <p className="text-[10px] text-rose-500 dark:text-rose-400 font-bold uppercase tracking-widest">Estratega Táctico Zero-Shot</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto mb-4 min-h-[200px] max-h-[400px] bg-white dark:bg-black/40 rounded-2xl p-4 border border-zinc-200 dark:border-white/5 custom-scrollbar">
        {response ? (
          <div className="prose prose-invert max-w-none">
            <div className="text-emerald-600 dark:text-emerald-400 font-mono text-sm sm:text-base whitespace-pre-wrap leading-relaxed">
              {response}
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-zinc-500 py-8">
            <ShieldAlert className="w-12 h-12 mb-3 opacity-20" />
            <p className="text-xs uppercase tracking-widest font-bold text-center px-4">Esperando reporte de situación para emitir plan táctico...</p>
          </div>
        )}
      </div>

      <form onSubmit={handleAsk} className="relative mt-auto">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Describa la emergencia (ej. 'Derrame de ácido en bodega 3')..."
          className="w-full bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-white/10 rounded-xl pl-4 pr-12 py-4 text-sm text-zinc-900 dark:text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-rose-500/50"
        />
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-rose-500 hover:bg-rose-600 text-white rounded-lg transition-colors disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </form>
    </div>
  );
}
