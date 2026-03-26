import React from 'react';
import { motion } from 'framer-motion';
import { 
  HelpCircle, 
  Book, 
  MessageCircle, 
  Video, 
  FileText, 
  Search, 
  ChevronRight,
  ExternalLink,
  Mail
} from 'lucide-react';

export function Help() {
  const faqs = [
    { q: '¿Cómo inicio un análisis IPERC con IA?', a: 'Ve al módulo de Gestión de Riesgos o Matriz IA y presiona el botón "Análisis IA". Describe el peligro y Gemini generará el análisis.' },
    { q: '¿Cómo gestiono múltiples proyectos?', a: 'Utiliza el selector de proyectos en la barra lateral izquierda para cambiar entre tus diferentes espacios de trabajo.' },
    { q: '¿Qué es la Red Neuronal?', a: 'Es nuestro sistema de gestión del conocimiento que conecta nodos de información (trabajadores, riesgos, leyes) para crear inteligencia preventiva.' },
    { q: '¿Cómo descargo reportes de seguridad?', a: 'En cada módulo (Riesgos, Trabajadores, etc.) encontrarás botones de descarga para exportar la información en formatos PDF o Excel.' },
  ];

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold text-white tracking-tight mb-4">Centro de Ayuda</h1>
        <p className="text-zinc-400 max-w-xl mx-auto">
          ¿Tienes alguna duda sobre Praeventio Guard? Estamos aquí para ayudarte a construir un entorno de trabajo más seguro.
        </p>
      </div>

      <div className="relative mb-12">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-6 h-6 text-zinc-500" />
        <input
          type="text"
          placeholder="Busca tutoriales, guías o preguntas frecuentes..."
          className="w-full bg-zinc-900/50 border border-white/10 rounded-3xl py-4 pl-14 pr-6 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all shadow-2xl"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
        {[
          { title: 'Documentación', icon: Book, description: 'Guías detalladas de uso.', color: 'text-blue-500', bg: 'bg-blue-500/10' },
          { title: 'Video Tutoriales', icon: Video, description: 'Aprende visualmente.', color: 'text-rose-500', bg: 'bg-rose-500/10' },
          { title: 'Soporte Directo', icon: MessageCircle, description: 'Habla con un experto.', color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
        ].map((item, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="bg-zinc-900/50 border border-white/10 rounded-3xl p-6 text-center hover:border-emerald-500/30 transition-all group cursor-pointer"
          >
            <div className={`w-14 h-14 ${item.bg} rounded-2xl flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform`}>
              <item.icon className={`w-7 h-7 ${item.color}`} />
            </div>
            <h3 className="font-bold text-white mb-1">{item.title}</h3>
            <p className="text-zinc-500 text-sm">{item.description}</p>
          </motion.div>
        ))}
      </div>

      <div className="bg-zinc-900/50 border border-white/10 rounded-3xl p-8 mb-12">
        <h2 className="text-2xl font-bold text-white mb-8 flex items-center gap-3">
          <HelpCircle className="w-6 h-6 text-amber-500" />
          Preguntas Frecuentes
        </h2>
        <div className="space-y-6">
          {faqs.map((faq, i) => (
            <div key={i} className="group cursor-pointer">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-bold text-white group-hover:text-emerald-400 transition-colors">{faq.q}</h4>
                <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-emerald-500 transition-colors" />
              </div>
              <p className="text-zinc-500 text-sm leading-relaxed">
                {faq.a}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-3xl p-8 text-center">
        <h3 className="text-xl font-bold text-white mb-2">¿Aún necesitas ayuda?</h3>
        <p className="text-zinc-400 mb-6">Nuestro equipo de soporte técnico está disponible 24/7 para asistirte.</p>
        <div className="flex flex-wrap justify-center gap-4">
          <button className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-6 py-2.5 rounded-xl font-bold transition-all shadow-lg shadow-emerald-500/20">
            <Mail className="w-5 h-5" />
            <span>Enviar Ticket</span>
          </button>
          <button className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-white px-6 py-2.5 rounded-xl font-bold transition-all border border-white/5">
            <ExternalLink className="w-5 h-5" />
            <span>Base de Conocimientos</span>
          </button>
        </div>
      </div>
    </div>
  );
}
