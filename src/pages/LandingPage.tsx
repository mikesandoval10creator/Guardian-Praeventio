import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  ShieldAlert, Zap, BookOpen, BarChart3, Users, Brain,
  CheckCircle2, ArrowRight, Play, Star, Globe, Lock,
  FileSpreadsheet, FileText, Mail, Activity, Mic
} from 'lucide-react';

interface LandingPageProps {
  onEnter: () => void;
}

const FEATURES = [
  {
    icon: ShieldAlert,
    color: 'text-rose-400',
    bg: 'bg-rose-500/10 border-rose-500/20',
    title: 'Respuesta a Emergencias',
    desc: 'Botón de pánico, geolocalización en tiempo real y alertas masivas a todo el equipo en segundos.',
  },
  {
    icon: Brain,
    color: 'text-violet-400',
    bg: 'bg-violet-500/10 border-violet-500/20',
    title: 'Inteligencia Artificial',
    desc: 'Gemini Pro genera PTS automáticos, evalúa riesgos y te guía con normativa DS 54, DS 40 y Ley 16.744.',
  },
  {
    icon: BookOpen,
    color: 'text-amber-400',
    bg: 'bg-amber-500/10 border-amber-500/20',
    title: 'Capacitaciones',
    desc: 'Videos, quizzes y gamificación. Registra capacitaciones y obtén certificados digitales automáticamente.',
  },
  {
    icon: BarChart3,
    color: 'text-blue-400',
    bg: 'bg-blue-500/10 border-blue-500/20',
    title: 'Auditorías ISO',
    desc: 'Checklist ISO 45001, OHSAS 18001 y reportes SUSESO generados en PDF con un clic.',
  },
  {
    icon: Users,
    color: 'text-[#d4af37]',
    bg: 'bg-[#4db6ac]/10 border-[#4db6ac]/20',
    title: 'Gestión de Equipos',
    desc: 'Roles por proyecto (gerente, prevencionista, supervisor), invitaciones por email y multi-empresa.',
  },
  {
    icon: Zap,
    color: 'text-orange-400',
    bg: 'bg-orange-500/10 border-orange-500/20',
    title: 'Dashboard Ejecutivo',
    desc: 'KPIs en tiempo real, accidentabilidad, tasa de siniestralidad y cumplimiento por proyecto.',
  },
];

interface Plan {
  name: string;
  workers: string;
  price: string;
  color: string;
  popular?: boolean;
  recommended?: boolean;
}

const PLANS: Plan[] = [
  { name: 'Gratuito', workers: '10', price: '$0', color: 'border-zinc-700' },
  { name: 'Comité', workers: '25', price: '$10/mes', color: 'border-[#4db6ac]', popular: true },
  { name: 'Departamento', workers: '100', price: '$30/mes', color: 'border-blue-500', recommended: true },
  { name: 'Enterprise', workers: '250+', price: 'Desde $50/mes', color: 'border-violet-500' },
];

const COMPLIANCE_BADGES = ['DS 54', 'DS 40', 'Ley 16.744', 'ISO 45001', 'OHSAS 18001', 'SUSESO', 'ISL', 'ACHS', 'IST'];

const HOW_STEPS = [
  {
    n: 1,
    title: 'Registra',
    desc: 'Reporta riesgos e incidentes desde cualquier dispositivo. Web, móvil, voz.',
    icon: Mic,
  },
  {
    n: 2,
    title: 'La IA analiza',
    desc: 'El asistente Guardian con Gemini AI detecta patrones, sugiere medidas correctivas y prioriza por severidad.',
    icon: Brain,
  },
  {
    n: 3,
    title: 'Cumplimiento automático',
    desc: 'DIAT, libros de obra, actas CPHS y reportes SUSESO generados en segundos.',
    icon: FileText,
  },
];

const sectionMotion = {
  initial: { opacity: 0, y: 20 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-50px' },
  transition: { duration: 0.5 },
};

export function LandingPage({ onEnter }: LandingPageProps) {
  const navigate = useNavigate();

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Guardian Praeventio — Prevención de riesgos en la palma de la mano';

    const description =
      'Gestión de riesgos, bienestar del equipo y cumplimiento normativo — todo en una sola plataforma con IA';
    let meta = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;
    let created = false;
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'description';
      document.head.appendChild(meta);
      created = true;
    }
    const previousDescription = meta.content;
    meta.content = description;

    return () => {
      document.title = previousTitle;
      if (meta) {
        if (created) {
          meta.remove();
        } else {
          meta.content = previousDescription;
        }
      }
    };
  }, []);

  const handleEnter = () => {
    onEnter();
  };

  const handleLogin = () => {
    onEnter();
    setTimeout(() => navigate('/login'), 50);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white font-sans overflow-x-hidden">

      {/* ── NAV ─────────────────────────────────────────────────────── */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-5 sm:px-10 py-4 bg-zinc-950/90 backdrop-blur-xl border-b border-white/5">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-teal-400 flex items-center justify-center" aria-hidden="true">
            <ShieldAlert className="w-4 h-4 text-zinc-950" />
          </div>
          <span className="font-black text-base tracking-tight">
            <span className="text-teal-400">Guardian</span> Praeventio
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleLogin}
            className="text-xs font-bold text-zinc-400 hover:text-white transition-colors hidden sm:block"
          >
            Iniciar sesión
          </button>
          <button
            onClick={handleEnter}
            className="bg-teal-400 hover:bg-teal-500 text-zinc-950 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-colors"
          >
            Entrar
          </button>
        </div>
      </nav>

      {/* ── HERO ────────────────────────────────────────────────────── */}
      <motion.section
        {...sectionMotion}
        className="relative pt-32 pb-20 px-5 sm:px-10 flex flex-col items-center text-center overflow-hidden"
      >
        {/* glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-teal-400/10 rounded-full blur-[120px] pointer-events-none" aria-hidden="true" />

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7 }}
          className="relative z-10 max-w-4xl mx-auto"
        >
          <div className="inline-flex items-center gap-2 bg-teal-400/10 border border-teal-400/30 rounded-full px-4 py-1.5 text-[11px] font-black uppercase tracking-widest text-teal-400 mb-6">
            <Star className="w-3 h-3 fill-current" aria-hidden="true" />
            Cumplimiento DS 54 · DS 40 · Ley 16.744
          </div>

          <h1 className="text-5xl sm:text-7xl md:text-8xl font-black tracking-tighter leading-none mb-6">
            La revolución de la<br />
            <span className="text-teal-400">prevención de riesgos</span>
          </h1>

          <p className="text-lg sm:text-xl text-zinc-300 max-w-2xl mx-auto mb-4 leading-relaxed font-semibold">
            Gestión de riesgos, bienestar del equipo y cumplimiento normativo — todo en una sola plataforma con IA
          </p>

          <p className="text-base sm:text-lg text-zinc-400 max-w-2xl mx-auto mb-10 leading-relaxed">
            IA, emergencias y cumplimiento normativo chileno en una sola app. Para empresas que se toman en serio la seguridad de sus trabajadores.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={handleEnter}
              className="w-full sm:w-auto flex items-center justify-center gap-3 bg-teal-400 hover:bg-teal-500 text-zinc-950 px-8 py-4 rounded-2xl text-base font-black uppercase tracking-widest shadow-lg shadow-teal-400/20 transition-all"
            >
              <Play className="w-4 h-4 fill-current" aria-hidden="true" />
              Entrar a la app
            </motion.button>
            <button
              onClick={handleLogin}
              className="w-full sm:w-auto flex items-center justify-center gap-2 border border-white/10 hover:border-white/30 px-8 py-4 rounded-2xl text-base font-bold text-zinc-300 hover:text-white transition-all"
            >
              Comenzar gratis
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>

          <p className="mt-5 text-xs text-zinc-600 font-bold uppercase tracking-widest">
            Gratis hasta 10 trabajadores · Sin tarjeta de crédito
          </p>
        </motion.div>
      </motion.section>

      {/* ── TRUST BAR ───────────────────────────────────────────────── */}
      <div className="border-y border-white/5 py-5 px-5 sm:px-10">
        <ul className="max-w-5xl mx-auto flex flex-wrap items-center justify-center gap-x-8 gap-y-3 list-none p-0">
          {COMPLIANCE_BADGES.map(label => (
            <li key={label} className="flex items-center gap-2 text-zinc-500">
              <CheckCircle2 className="w-3.5 h-3.5 text-teal-400" aria-hidden="true" />
              <span className="text-xs font-black uppercase tracking-widest">{label}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* ── POR QUÉ GUARDIAN (pain point) ────────────────────────────── */}
      <motion.section {...sectionMotion} className="relative py-20 px-5 sm:px-10">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" aria-hidden="true" />
        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div>
            <p className="text-[11px] font-black uppercase tracking-widest text-teal-400 mb-3">El problema</p>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-tighter mb-5 leading-tight">
              Por qué Guardian
            </h2>
            <p className="text-base sm:text-lg text-zinc-300 leading-relaxed">
              La prevención de riesgos en Chile sigue atrapada en hojas de cálculo y papeleo. Guardian digitiza el reporte de incidentes, las capacitaciones del equipo, y usa IA para detectar patrones antes de que ocurran accidentes.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* BEFORE */}
            <div className="bg-zinc-900/60 border border-white/5 rounded-2xl p-5 opacity-70">
              <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-4">Antes</p>
              <ul className="space-y-3 list-none p-0">
                {[
                  { icon: FileSpreadsheet, label: 'Excel' },
                  { icon: FileText, label: 'Papeleo' },
                  { icon: Mail, label: 'Email' },
                ].map(item => (
                  <li key={item.label} className="flex items-center gap-2.5 text-zinc-500">
                    <div className="w-7 h-7 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center">
                      <item.icon className="w-3.5 h-3.5" aria-hidden="true" />
                    </div>
                    <span className="text-sm font-bold line-through decoration-zinc-600">{item.label}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* AFTER */}
            <div className="bg-teal-400/5 border border-teal-400/30 rounded-2xl p-5 shadow-lg shadow-teal-400/5">
              <p className="text-[10px] font-black uppercase tracking-widest text-teal-400 mb-4">Con Guardian</p>
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle2 className="w-4 h-4 text-teal-400" aria-hidden="true" />
                <span className="text-sm font-black text-white">Tiempo real</span>
              </div>
              {/* mini mock chart */}
              <div className="flex items-end gap-1 h-14 mb-3" aria-hidden="true">
                {[40, 65, 50, 80, 60, 90, 75].map((h, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-t bg-gradient-to-t from-teal-400/40 to-teal-400"
                    style={{ height: `${h}%` }}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2 text-zinc-300">
                <Activity className="w-3.5 h-3.5 text-teal-400" aria-hidden="true" />
                <span className="text-xs font-bold">Patrones detectados por IA</span>
              </div>
            </div>
          </div>
        </div>
      </motion.section>

      {/* ── FEATURES ────────────────────────────────────────────────── */}
      <motion.section {...sectionMotion} className="py-20 px-5 sm:px-10">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-tighter mb-3">
              Todo lo que necesitas para cumplir la ley
            </h2>
            <p className="text-zinc-400 max-w-xl mx-auto">
              Diseñado para empresas chilenas. Todas las herramientas que exige la normativa, sin papel.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((f, i) => (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.07 }}
                className="bg-zinc-900 border border-white/5 rounded-2xl p-6 hover:border-white/10 transition-colors"
              >
                <div className={`w-11 h-11 rounded-xl border ${f.bg} flex items-center justify-center mb-4`} aria-hidden="true">
                  <f.icon className={`w-5 h-5 ${f.color}`} />
                </div>
                <h3 className="font-black text-lg mb-2 tracking-tight">{f.title}</h3>
                <p className="text-sm text-zinc-400 leading-relaxed">{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </motion.section>

      {/* ── CÓMO FUNCIONA ───────────────────────────────────────────── */}
      <motion.section {...sectionMotion} className="py-20 px-5 sm:px-10 bg-zinc-900/30 border-y border-white/5">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-[11px] font-black uppercase tracking-widest text-teal-400 mb-3">Flujo simple</p>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-tighter mb-3">
              Cómo funciona
            </h2>
            <p className="text-zinc-400 max-w-xl mx-auto">
              Del reporte al cumplimiento en tres pasos.
            </p>
          </div>

          <div className="relative grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* connector line — desktop only */}
            <div
              className="hidden md:block absolute top-[34px] left-[16%] right-[16%] h-px bg-gradient-to-r from-teal-400/0 via-teal-400/40 to-teal-400/0"
              aria-hidden="true"
            />

            {HOW_STEPS.map((s, i) => (
              <div
                key={s.n}
                className="relative bg-zinc-900 border border-white/5 rounded-2xl p-6 flex flex-col items-start gap-3"
              >
                <div className="flex items-center gap-3 w-full">
                  <div className="w-12 h-12 rounded-full bg-teal-400 text-zinc-950 font-black text-lg flex items-center justify-center shadow-lg shadow-teal-400/30 flex-shrink-0" aria-hidden="true">
                    {s.n}
                  </div>
                  <s.icon className="w-5 h-5 text-teal-400" aria-hidden="true" />
                  {i < HOW_STEPS.length - 1 && (
                    <ArrowRight className="hidden md:block w-5 h-5 text-teal-400/40 ml-auto" aria-hidden="true" />
                  )}
                </div>
                <h3 className="font-black text-xl tracking-tight mt-2">{s.title}</h3>
                <p className="text-sm text-zinc-400 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </motion.section>

      {/* ── PRICING ─────────────────────────────────────────────────── */}
      <motion.section {...sectionMotion} className="py-20 px-5 sm:px-10 bg-zinc-900/40">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-tighter mb-3">
              Planes para cada empresa
            </h2>
            <p className="text-zinc-400">Escala cuando tu empresa crezca. Empieza gratis hoy.</p>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {PLANS.map((p) => (
              <a
                key={p.name}
                href="/login"
                onClick={(e) => { e.preventDefault(); handleLogin(); }}
                className={`relative bg-zinc-900 border rounded-2xl p-5 flex flex-col gap-3 ${p.color} ${p.popular ? 'ring-2 ring-[#4db6ac] ring-offset-2 ring-offset-zinc-950' : ''} hover:border-white/30 transition-colors`}
                aria-label={`Elegir plan ${p.name}`}
              >
                {p.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#4db6ac] text-zinc-950 px-3 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider">
                    Popular
                  </div>
                )}
                {p.recommended && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-500 text-white px-3 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider">
                    Recomendado
                  </div>
                )}
                <p className="font-black text-sm">{p.name}</p>
                <p className="text-2xl font-black tracking-tighter">{p.price}</p>
                <div className="flex items-center gap-1.5 text-zinc-400">
                  <Users className="w-3.5 h-3.5" aria-hidden="true" />
                  <span className="text-xs font-bold">{p.workers} trabajadores</span>
                </div>
              </a>
            ))}
          </div>

          <p className="text-center text-xs text-zinc-600 mt-6 font-bold">
            Planes enterprise hasta 5,000 trabajadores · Precios en USD
          </p>
        </div>
      </motion.section>

      {/* ── CTA FINAL ───────────────────────────────────────────────── */}
      <motion.section {...sectionMotion} className="py-24 px-5 sm:px-10 text-center">
        <div className="max-w-2xl mx-auto">
          <div className="w-16 h-16 rounded-3xl bg-teal-400/10 border border-teal-400/30 flex items-center justify-center mx-auto mb-6" aria-hidden="true">
            <ShieldAlert className="w-8 h-8 text-teal-400" />
          </div>
          <h2 className="text-3xl sm:text-5xl font-black tracking-tighter mb-4">
            Empieza hoy.<br />Es gratis.
          </h2>
          <p className="text-zinc-400 mb-8">
            Crea tu cuenta, agrega tu empresa y cumple la normativa chilena desde el primer día.
          </p>
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={handleEnter}
            className="inline-flex items-center gap-3 bg-teal-400 hover:bg-teal-500 text-zinc-950 px-10 py-4 rounded-2xl text-base font-black uppercase tracking-widest shadow-xl shadow-teal-400/20 transition-all"
          >
            <Play className="w-4 h-4 fill-current" aria-hidden="true" />
            Abrir Guardian Praeventio
          </motion.button>
        </div>
      </motion.section>

      {/* ── FOOTER ──────────────────────────────────────────────────── */}
      <footer className="border-t border-white/5 py-10 px-5 sm:px-10">
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-6 h-6 rounded-lg bg-teal-400 flex items-center justify-center" aria-hidden="true">
                <ShieldAlert className="w-3 h-3 text-zinc-950" />
              </div>
              <span className="text-xs font-black text-zinc-300">GUARDIAN PRAEVENTIO</span>
            </div>
            <p className="text-xs text-zinc-600 leading-relaxed">
              Prevención de riesgos en la palma de la mano.
            </p>
          </div>

          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-3">Praeventio</p>
            <ul className="space-y-2 list-none p-0">
              <li>
                <a
                  href="https://www.praeventio.net/historia"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-bold text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  Historia
                </a>
              </li>
              <li>
                <a
                  href="https://www.praeventio.net/equipo"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-bold text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  Equipo
                </a>
              </li>
              <li>
                <a
                  href="https://www.praeventio.net"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-bold text-zinc-500 hover:text-zinc-300 transition-colors inline-flex items-center gap-1"
                >
                  <Globe className="w-3 h-3" aria-hidden="true" />praeventio.net
                </a>
              </li>
            </ul>
          </div>

          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-3">Contacto</p>
            <ul className="space-y-2 list-none p-0">
              <li>
                <a
                  href="mailto:contacto@praeventio.net"
                  className="text-xs font-bold text-zinc-500 hover:text-zinc-300 transition-colors inline-flex items-center gap-1.5"
                >
                  <Mail className="w-3 h-3" aria-hidden="true" />contacto@praeventio.net
                </a>
              </li>
              <li className="text-xs font-bold text-zinc-600">Santiago, Chile</li>
            </ul>
          </div>

          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-3">Legal</p>
            <ul className="space-y-2 list-none p-0">
              <li>
                <button
                  onClick={() => navigate('/privacidad')}
                  className="text-xs font-bold text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  Privacidad
                </button>
              </li>
              <li className="text-xs font-bold text-zinc-600 inline-flex items-center gap-1">
                <Lock className="w-3 h-3" aria-hidden="true" />Datos seguros · Firebase
              </li>
            </ul>
          </div>
        </div>

        <div className="max-w-6xl mx-auto pt-6 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-zinc-700 font-bold">
            © 2026 Praeventio · Chile
          </p>
          <p className="text-[10px] text-zinc-700 font-bold uppercase tracking-widest">
            Hecho en Chile
          </p>
        </div>
      </footer>
    </div>
  );
}
