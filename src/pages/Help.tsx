import React, { useRef } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
  const faqRef = useRef<HTMLDivElement>(null);
  const faqs = [
    { q: '¿Cómo inicio un análisis IPERC con IA?', a: 'Ve al módulo de Gestión de Riesgos o Matriz IA y presiona el botón "Análisis IA". Describe el peligro y Gemini generará el análisis.' },
    { q: '¿Cómo gestiono múltiples proyectos?', a: 'Utiliza el selector de proyectos en la barra lateral izquierda para cambiar entre tus diferentes espacios de trabajo.' },
    { q: '¿Qué es la Red Neuronal?', a: 'Es nuestro sistema de gestión del conocimiento que conecta nodos de información (trabajadores, riesgos, leyes) para crear inteligencia preventiva.' },
    { q: '¿Cómo descargo reportes de seguridad?', a: 'En cada módulo (Riesgos, Trabajadores, etc.) encontrarás botones de descarga para exportar la información en formatos PDF o Excel.' },
  ];

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold text-primary-token tracking-tight mb-4">{t('help.title', 'Centro de Ayuda')}</h1>
        <p className="text-secondary-token max-w-xl mx-auto">
          {t('help.subtitle', '¿Tienes alguna duda sobre Praeventio Guard? Estamos aquí para ayudarte a construir un entorno de trabajo más seguro.')}
        </p>
      </div>

      <div className="relative mb-12">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-6 h-6 text-muted-token" />
        <input
          type="text"
          placeholder={t('help.searchPlaceholder', 'Busca tutoriales, guías o preguntas frecuentes...')}
          className="w-full bg-surface border border-default-token rounded-3xl py-4 pl-14 pr-6 text-primary-token placeholder:text-muted-token focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all shadow-2xl"
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
            className="bg-surface border border-default-token rounded-3xl p-6 text-center hover:border-emerald-500/30 transition-all group cursor-pointer"
          >
            <div className={`w-14 h-14 ${item.bg} rounded-2xl flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform`}>
              <item.icon className={`w-7 h-7 ${item.color}`} />
            </div>
            <h3 className="font-bold text-primary-token mb-1">{item.title}</h3>
            <p className="text-muted-token text-sm">{item.description}</p>
          </motion.div>
        ))}
      </div>

      <div ref={faqRef} className="bg-surface border border-default-token rounded-3xl p-8 mb-12">
        <h2 className="text-2xl font-bold text-primary-token mb-8 flex items-center gap-3">
          <HelpCircle className="w-6 h-6 text-amber-500" />
          {t('help.faqHeading', 'Preguntas Frecuentes')}
        </h2>
        <div className="space-y-6">
          {faqs.map((faq, i) => (
            <div key={i} className="group cursor-pointer">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-bold text-primary-token group-hover:text-emerald-400 transition-colors">{faq.q}</h4>
                <ChevronRight className="w-4 h-4 text-muted-token group-hover:text-emerald-500 transition-colors" />
              </div>
              <p className="text-muted-token text-sm leading-relaxed">
                {faq.a}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-3xl p-8 text-center">
        <h3 className="text-xl font-bold text-primary-token mb-2">{t('help.needMoreHelp', '¿Aún necesitas ayuda?')}</h3>
        <p className="text-secondary-token mb-6">{t('help.support247', 'Nuestro equipo de soporte técnico está disponible 24/7 para asistirte.')}</p>
        <div className="flex flex-wrap justify-center gap-4">
          <a
            href="mailto:contacto@praeventio.net?subject=Ticket%20de%20Soporte%20Guardian%20Praeventio"
            className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-6 py-2.5 rounded-xl font-bold transition-all shadow-lg shadow-emerald-500/20"
          >
            <Mail className="w-5 h-5" />
            <span>{t('help.sendTicket', 'Enviar Ticket')}</span>
          </a>
          <button
            onClick={() => faqRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            className="flex items-center gap-2 bg-elevated hover:bg-elevated text-primary-token px-6 py-2.5 rounded-xl font-bold transition-all border border-default-token"
          >
            <ExternalLink className="w-5 h-5" />
            <span>{t('help.knowledgeBase', 'Base de Conocimientos')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
