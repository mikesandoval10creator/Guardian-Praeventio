import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  ShieldAlert, Zap, BookOpen, BarChart3, Users, Brain,
  CheckCircle2, ArrowRight, Play, Star, Globe, Lock
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
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10 border-emerald-500/20',
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

const PLANS = [
  { name: 'Gratuito', workers: '10', price: '$0', color: 'border-zinc-700' },
  { name: 'Comité', workers: '25', price: '$10/mes', color: 'border-emerald-500', popular: true },
  { name: 'Departamento', workers: '100', price: '$30/mes', color: 'border-blue-500' },
  { name: 'Enterprise', workers: '250+', price: 'Desde $50/mes', color: 'border-violet-500' },
];

export function LandingPage({ onEnter }: LandingPageProps) {
  const navigate = useNavigate();

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
          <div className="w-8 h-8 rounded-xl bg-[#58D66D] flex items-center justify-center">
            <ShieldAlert className="w-4 h-4 text-zinc-950" />
          </div>
          <span className="font-black text-base tracking-tight">
            <span className="text-[#58D66D]">Guardian</span> Praeventio
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
            className="bg-[#58D66D] hover:bg-[#4bc95e] text-zinc-950 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-colors"
          >
            Entrar
          </button>
        </div>
      </nav>

      {/* ── HERO ────────────────────────────────────────────────────── */}
      <section className="relative pt-32 pb-20 px-5 sm:px-10 flex flex-col items-center text-center overflow-hidden">
        {/* glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-[#58D66D]/10 rounded-full blur-[120px] pointer-events-none" />

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7 }}
          className="relative z-10 max-w-4xl mx-auto"
        >
          <div className="inline-flex items-center gap-2 bg-[#58D66D]/10 border border-[#58D66D]/30 rounded-full px-4 py-1.5 text-[11px] font-black uppercase tracking-widest text-[#58D66D] mb-6">
            <Star className="w-3 h-3 fill-current" />
            Cumplimiento DS 54 · DS 40 · Ley 16.744
          </div>

          <h1 className="text-5xl sm:text-7xl md:text-8xl font-black tracking-tighter leading-none mb-6">
            La revolución de la<br />
            <span className="text-[#58D66D]">prevención de riesgos</span>
          </h1>

          <p className="text-lg sm:text-xl text-zinc-400 max-w-2xl mx-auto mb-10 leading-relaxed">
            IA, emergencias y cumplimiento normativo chileno en una sola app. Para empresas que se toman en serio la seguridad de sus trabajadores.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={handleEnter}
              className="w-full sm:w-auto flex items-center justify-center gap-3 bg-[#58D66D] hover:bg-[#4bc95e] text-zinc-950 px-8 py-4 rounded-2xl text-base font-black uppercase tracking-widest shadow-lg shadow-[#58D66D]/20 transition-all"
            >
              <Play className="w-4 h-4 fill-current" />
              Entrar a la app
            </motion.button>
            <button
              onClick={handleLogin}
              className="w-full sm:w-auto flex items-center justify-center gap-2 border border-white/10 hover:border-white/30 px-8 py-4 rounded-2xl text-base font-bold text-zinc-300 hover:text-white transition-all"
            >
              Comenzar gratis
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          <p className="mt-5 text-xs text-zinc-600 font-bold uppercase tracking-widest">
            Gratis hasta 10 trabajadores · Sin tarjeta de crédito
          </p>
        </motion.div>
      </section>

      {/* ── TRUST BAR ───────────────────────────────────────────────── */}
      <div className="border-y border-white/5 py-5 px-5 sm:px-10">
        <div className="max-w-4xl mx-auto flex flex-wrap items-center justify-center gap-x-10 gap-y-3">
          {['DS 54', 'DS 40', 'Ley 16.744', 'ISO 45001', 'OHSAS 18001', 'SUSESO', 'ISL'].map(label => (
            <div key={label} className="flex items-center gap-2 text-zinc-500">
              <CheckCircle2 className="w-3.5 h-3.5 text-[#58D66D]" />
              <span className="text-xs font-black uppercase tracking-widest">{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── FEATURES ────────────────────────────────────────────────── */}
      <section className="py-20 px-5 sm:px-10">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-black tracking-tighter mb-3">
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
                <div className={`w-11 h-11 rounded-xl border ${f.bg} flex items-center justify-center mb-4`}>
                  <f.icon className={`w-5 h-5 ${f.color}`} />
                </div>
                <h3 className="font-black text-base mb-2">{f.title}</h3>
                <p className="text-sm text-zinc-400 leading-relaxed">{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PRICING ─────────────────────────────────────────────────── */}
      <section className="py-20 px-5 sm:px-10 bg-zinc-900/40">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-black tracking-tighter mb-3">
              Planes para cada empresa
            </h2>
            <p className="text-zinc-400">Escala cuando tu empresa crezca. Empieza gratis hoy.</p>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {PLANS.map((p) => (
              <div
                key={p.name}
                className={`relative bg-zinc-900 border rounded-2xl p-5 flex flex-col gap-3 ${p.color} ${p.popular ? 'ring-2 ring-emerald-500 ring-offset-2 ring-offset-zinc-950' : ''}`}
              >
                {p.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-emerald-500 text-zinc-950 px-3 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider">
                    Popular
                  </div>
                )}
                <p className="font-black text-sm">{p.name}</p>
                <p className="text-2xl font-black tracking-tighter">{p.price}</p>
                <div className="flex items-center gap-1.5 text-zinc-400">
                  <Users className="w-3.5 h-3.5" />
                  <span className="text-xs font-bold">{p.workers} trabajadores</span>
                </div>
              </div>
            ))}
          </div>

          <p className="text-center text-xs text-zinc-600 mt-6 font-bold">
            Planes enterprise hasta 5,000 trabajadores · Precios en USD
          </p>
        </div>
      </section>

      {/* ── CTA FINAL ───────────────────────────────────────────────── */}
      <section className="py-24 px-5 sm:px-10 text-center">
        <div className="max-w-2xl mx-auto">
          <div className="w-16 h-16 rounded-3xl bg-[#58D66D]/10 border border-[#58D66D]/30 flex items-center justify-center mx-auto mb-6">
            <ShieldAlert className="w-8 h-8 text-[#58D66D]" />
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
            className="inline-flex items-center gap-3 bg-[#58D66D] hover:bg-[#4bc95e] text-zinc-950 px-10 py-4 rounded-2xl text-base font-black uppercase tracking-widest shadow-xl shadow-[#58D66D]/20 transition-all"
          >
            <Play className="w-4 h-4 fill-current" />
            Abrir Guardian Praeventio
          </motion.button>
        </div>
      </section>

      {/* ── FOOTER ──────────────────────────────────────────────────── */}
      <footer className="border-t border-white/5 py-8 px-5 sm:px-10">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-[#58D66D] flex items-center justify-center">
              <ShieldAlert className="w-3 h-3 text-zinc-950" />
            </div>
            <span className="text-xs font-black text-zinc-500">GUARDIAN PRAEVENTIO</span>
          </div>
          <div className="flex items-center gap-5">
            <div className="flex items-center gap-1.5 text-zinc-600 text-xs font-bold">
              <Globe className="w-3 h-3" />praeventio.net
            </div>
            <div className="flex items-center gap-1.5 text-zinc-600 text-xs font-bold">
              <Lock className="w-3 h-3" />Datos seguros · Firebase
            </div>
            <button
              onClick={() => navigate('/privacidad')}
              className="text-zinc-600 hover:text-zinc-400 text-xs font-bold transition-colors"
            >
              Privacidad
            </button>
          </div>
          <p className="text-xs text-zinc-700 font-bold">
            © {new Date().getFullYear()} Praeventio · Chile
          </p>
        </div>
      </footer>
    </div>
  );
}
