import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  ShieldAlert, Zap, BookOpen, BarChart3, Users, Brain,
  CheckCircle2, ArrowRight, Play, Star, Globe, Lock,
  FileSpreadsheet, FileText, Mail, Activity, Mic
} from 'lucide-react';
import { PublicEmergencyButton } from '../components/emergency/PublicEmergencyButton';

interface LandingPageProps {
  onEnter: () => void;
}

// Feature cards. User-facing copy lives in i18n under `landing.features.<id>.{title,desc}`.
const FEATURES = [
  { icon: ShieldAlert, color: 'text-rose-400', bg: 'bg-rose-500/10 border-rose-500/20', id: 'emergency' },
  { icon: Brain, color: 'text-violet-400', bg: 'bg-violet-500/10 border-violet-500/20', id: 'ai' },
  { icon: BookOpen, color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20', id: 'training' },
  { icon: BarChart3, color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20', id: 'iso' },
  { icon: Users, color: 'text-[#d4af37]', bg: 'bg-[#4db6ac]/10 border-[#4db6ac]/20', id: 'teams' },
  { icon: Zap, color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/20', id: 'dashboard' },
];

interface Plan {
  id: string;
  workers: string;
  color: string;
  popular?: boolean;
  recommended?: boolean;
}

// Plan name + price copy in i18n under `landing.pricing.plans.<id>.{name,price}`.
const PLANS: Plan[] = [
  { id: 'free', workers: '10', color: 'border-zinc-700' },
  { id: 'committee', workers: '25', color: 'border-[#4db6ac]', popular: true },
  { id: 'department', workers: '100', color: 'border-blue-500', recommended: true },
  { id: 'enterprise', workers: '250+', color: 'border-violet-500' },
];

const COMPLIANCE_BADGES = ['DS 54', 'DS 44/2024', 'Ley 16.744', 'ISO 45001', 'OHSAS 18001', 'SUSESO', 'ISL', 'ACHS', 'IST'];

// Steps. Copy in i18n under `landing.how.<id>.{title,desc}`.
const HOW_STEPS = [
  { n: 1, id: 'step1', icon: Mic },
  { n: 2, id: 'step2', icon: Brain },
  { n: 3, id: 'step3', icon: FileText },
];

const sectionMotion = {
  initial: { opacity: 0, y: 20 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-50px' },
  transition: { duration: 0.5 },
};

export function LandingPage({ onEnter }: LandingPageProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  useEffect(() => {
    const previousTitle = document.title;
    document.title = t('landing.meta.title');

    const description = t('landing.meta.description');
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

      {/* Public, no-login emergency access (prototype-recovery #1): a person in
          crisis reaches first-aid + call-for-help in one tap from the public
          landing, BEFORE "Entrar". Self-contained — renders outside AppProviders. */}
      <PublicEmergencyButton />

      {/* Skip link — primer foco al pulsar Tab. Visible solo cuando recibe
          foco gracias a `sr-only focus:not-sr-only`. WCAG 2.1 (2.4.1). */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:px-4 focus:py-2 focus:rounded-xl focus:bg-teal-400 focus:text-zinc-950 focus:font-black focus:text-xs focus:uppercase focus:tracking-widest focus:shadow-2xl"
      >
        {t('landing.skip_to_content')}
      </a>

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
            {t('landing.nav.login')}
          </button>
          <button
            onClick={handleEnter}
            className="bg-teal-400 hover:bg-teal-500 text-zinc-950 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-colors"
          >
            {t('landing.nav.enter')}
          </button>
        </div>
      </nav>

      <main id="main-content" tabIndex={-1}>

      {/* ── HERO ────────────────────────────────────────────────────── */}
      <motion.section
        {...sectionMotion}
        className="relative pt-32 pb-20 px-5 sm:px-10 flex flex-col items-center text-center overflow-hidden"
      >
        {/* glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-teal-400/5 rounded-full blur-[120px] pointer-events-none" aria-hidden="true" />

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7 }}
          className="relative z-10 max-w-4xl mx-auto"
        >
          {/* Guardián mascot — Sprint B PR #520 wire.
              Codex P1 3311249150 fix: anonymous landing renders OUTSIDE
              <AppProviders> (App.tsx:378-381) so <GuardianMascot> would
              throw via its useAppMode() call (AppModeContext.tsx:254
              throws when context is null). Solution: render the same
              asset as a raw <img> here, bypassing context entirely.
              Hardcoded default mood (calm professional shield — the
              right tone for first contact) and the xl 192×192 size that
              matches GuardianMascot's SIZE_MAP['xl']. No emergency/
              driving edge cases apply on anon landing. */}
          <div className="flex justify-center mb-6">
            <img
              src="/mascots/guardian-default.png"
              alt="Guardian Praeventio"
              className="w-48 h-48 object-contain select-none"
              draggable={false}
            />
          </div>

          <div className="inline-flex items-center gap-2 bg-teal-400/10 border border-teal-400/30 rounded-full px-4 py-1.5 text-[11px] font-black uppercase tracking-widest text-teal-400 mb-6">
            <Star className="w-3 h-3 fill-current" aria-hidden="true" />
            {t('landing.hero.compliance_badge')}
          </div>

          <h1 className="text-5xl sm:text-7xl md:text-8xl font-black tracking-tighter leading-none mb-6">
            {t('landing.hero.title_line_1')}<br />
            <span className="text-teal-400">{t('landing.hero.title_line_2')}</span>
          </h1>

          <p className="text-lg sm:text-xl text-zinc-300 max-w-2xl mx-auto mb-4 leading-relaxed font-semibold">
            {t('landing.hero.subtitle')}
          </p>

          <p className="text-base sm:text-lg text-zinc-400 max-w-2xl mx-auto mb-10 leading-relaxed">
            {t('landing.hero.description')}
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={handleEnter}
              className="w-full sm:w-auto flex items-center justify-center gap-3 bg-teal-400 hover:bg-teal-500 text-zinc-950 px-8 py-4 rounded-2xl text-base font-black uppercase tracking-widest shadow-lg shadow-teal-400/20 transition-all"
            >
              <Play className="w-4 h-4 fill-current" aria-hidden="true" />
              {t('landing.hero.cta_primary')}
            </motion.button>
            <button
              onClick={handleLogin}
              className="w-full sm:w-auto flex items-center justify-center gap-2 border border-white/10 hover:border-white/30 px-8 py-4 rounded-2xl text-base font-bold text-zinc-300 hover:text-white transition-all"
            >
              {t('landing.hero.cta_secondary')}
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>

          <p className="mt-5 text-xs text-zinc-600 font-bold uppercase tracking-widest">
            {t('landing.hero.free_tier_note')}
          </p>
        </motion.div>
      </motion.section>

      {/* ── TRUST BAR ───────────────────────────────────────────────── */}
      <div className="border-y border-white/5 py-5 px-5 sm:px-10">
        <ul className="max-w-5xl mx-auto flex flex-wrap items-center justify-center gap-x-8 gap-y-3 list-none p-0">
          {COMPLIANCE_BADGES.map(label => {
            // Highlight the international standard with gold = prestige
            const isInternational = label === 'ISO 45001';
            return (
              <li
                key={label}
                className={
                  isInternational
                    ? 'flex items-center gap-2 px-3 py-1 rounded-full bg-gradient-to-r from-petroleum-700 to-petroleum-900 border border-gold-400/30 text-gold-400'
                    : 'flex items-center gap-2 px-3 py-1 rounded-full bg-gradient-to-r from-petroleum-700 to-petroleum-900 text-zinc-500'
                }
              >
                <CheckCircle2
                  className={isInternational ? 'w-3.5 h-3.5 text-gold-400' : 'w-3.5 h-3.5 text-teal-400'}
                  aria-hidden="true"
                />
                <span className="text-xs font-black uppercase tracking-widest">{label}</span>
              </li>
            );
          })}
        </ul>
      </div>

      {/* ── POR QUÉ GUARDIAN (pain point) ────────────────────────────── */}
      <motion.section {...sectionMotion} className="relative py-20 px-5 sm:px-10">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" aria-hidden="true" />
        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div>
            <p className="text-[11px] font-black uppercase tracking-widest text-teal-400 mb-3">{t('landing.problem.eyebrow')}</p>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-tighter mb-5 leading-tight">
              {t('landing.problem.title')}
            </h2>
            <p className="text-base sm:text-lg text-zinc-300 leading-relaxed">
              {t('landing.problem.body')}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* BEFORE */}
            <div className="bg-zinc-900/60 border border-white/5 rounded-2xl p-5 opacity-70">
              <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-4">{t('landing.problem.before_label')}</p>
              <ul className="space-y-3 list-none p-0">
                {[
                  { icon: FileSpreadsheet, id: 'excel' },
                  { icon: FileText, id: 'paperwork' },
                  { icon: Mail, id: 'email' },
                ].map(item => (
                  <li key={item.id} className="flex items-center gap-2.5 text-zinc-500">
                    <div className="w-7 h-7 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center">
                      <item.icon className="w-3.5 h-3.5" aria-hidden="true" />
                    </div>
                    <span className="text-sm font-bold line-through decoration-zinc-600">{t(`landing.problem.before_${item.id}`)}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* AFTER */}
            <div className="bg-teal-400/5 border border-teal-400/30 rounded-2xl p-5 shadow-lg shadow-teal-400/5">
              <p className="text-[10px] font-black uppercase tracking-widest text-teal-400 mb-4">{t('landing.problem.after_label')}</p>
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle2 className="w-4 h-4 text-teal-400" aria-hidden="true" />
                <span className="text-sm font-black text-white">{t('landing.problem.realtime')}</span>
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
                <span className="text-xs font-bold">{t('landing.problem.ai_patterns')}</span>
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
              {t('landing.features.title')}
            </h2>
            <p className="text-zinc-400 max-w-xl mx-auto">
              {t('landing.features.subtitle')}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((f, i) => (
              <motion.div
                key={f.id}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.07 }}
                className="bg-zinc-900 border border-white/5 rounded-2xl p-6 hover:border-white/10 transition-colors"
              >
                <div className={`w-11 h-11 rounded-xl border ${f.bg} flex items-center justify-center mb-4`} aria-hidden="true">
                  <f.icon className={`w-5 h-5 ${f.color}`} />
                </div>
                <h3 className="font-black text-lg mb-2 tracking-tight">{t(`landing.features.${f.id}.title`)}</h3>
                <p className="text-sm text-zinc-400 leading-relaxed">{t(`landing.features.${f.id}.desc`)}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </motion.section>

      {/* ── CÓMO FUNCIONA ───────────────────────────────────────────── */}
      <motion.section {...sectionMotion} className="py-20 px-5 sm:px-10 bg-zinc-900/30 border-y border-white/5">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-[11px] font-black uppercase tracking-widest text-teal-400 mb-3">{t('landing.how.eyebrow')}</p>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-tighter mb-3">
              {t('landing.how.title')}
            </h2>
            <p className="text-zinc-400 max-w-xl mx-auto">
              {t('landing.how.subtitle')}
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
                <h3 className="font-black text-xl tracking-tight mt-2">{t(`landing.how.${s.id}.title`)}</h3>
                <p className="text-sm text-zinc-400 leading-relaxed">{t(`landing.how.${s.id}.desc`)}</p>
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
              {t('landing.pricing.title')}
            </h2>
            <p className="text-zinc-400">{t('landing.pricing.subtitle')}</p>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {PLANS.map((p) => (
              <a
                key={p.id}
                href="/login"
                onClick={(e) => { e.preventDefault(); handleLogin(); }}
                className={`relative bg-zinc-900 border rounded-2xl p-5 flex flex-col gap-3 ${p.color} ${p.popular ? 'ring-2 ring-[#4db6ac] ring-offset-2 ring-offset-zinc-950' : ''} hover:border-white/30 transition-colors`}
                aria-label={t('landing.pricing.choose_plan', { name: t(`landing.pricing.plans.${p.id}.name`) })}
              >
                {p.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#4db6ac] text-zinc-950 px-3 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider">
                    {t('landing.pricing.popular_badge')}
                  </div>
                )}
                {p.recommended && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gold-400 text-petroleum-900 px-3 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider">
                    {t('landing.pricing.recommended_badge')}
                  </div>
                )}
                <p className="font-black text-sm">{t(`landing.pricing.plans.${p.id}.name`)}</p>
                <p className="text-2xl font-black tracking-tighter">{t(`landing.pricing.plans.${p.id}.price`)}</p>
                <div className="flex items-center gap-1.5 text-zinc-400">
                  <Users className="w-3.5 h-3.5" aria-hidden="true" />
                  <span className="text-xs font-bold">{p.workers} {t('landing.pricing.workers_suffix')}</span>
                </div>
              </a>
            ))}
          </div>

          <p className="text-center text-xs text-zinc-600 mt-6 font-bold">
            {t('landing.pricing.footnote')}
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
            {t('landing.final_cta.title_line_1')}<br />{t('landing.final_cta.title_line_2')}
          </h2>
          <p className="text-zinc-400 mb-8">
            {t('landing.final_cta.subtitle')}
          </p>
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={handleEnter}
            className="inline-flex items-center gap-3 bg-teal-400 hover:bg-teal-500 text-zinc-950 px-10 py-4 rounded-2xl text-base font-black uppercase tracking-widest shadow-xl shadow-teal-400/20 transition-all"
          >
            <Play className="w-4 h-4 fill-current" aria-hidden="true" />
            {t('landing.final_cta.button')}
          </motion.button>
        </div>
      </motion.section>

      </main>

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
              {t('landing.footer.tagline')}
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
                  {t('landing.footer.link_history')}
                </a>
              </li>
              <li>
                <a
                  href="https://www.praeventio.net/equipo"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-bold text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  {t('landing.footer.link_team')}
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
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-3">{t('landing.footer.col_contact')}</p>
            <ul className="space-y-2 list-none p-0">
              <li>
                <a
                  href="mailto:contacto@praeventio.net"
                  className="text-xs font-bold text-zinc-500 hover:text-zinc-300 transition-colors inline-flex items-center gap-1.5"
                >
                  <Mail className="w-3 h-3" aria-hidden="true" />contacto@praeventio.net
                </a>
              </li>
              <li className="text-xs font-bold text-zinc-600">{t('landing.footer.location')}</li>
            </ul>
          </div>

          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-3">{t('landing.footer.col_legal')}</p>
            <ul className="space-y-2 list-none p-0">
              <li>
                <button
                  onClick={() => navigate('/privacidad')}
                  className="text-xs font-bold text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  {t('landing.footer.link_privacy')}
                </button>
              </li>
              <li className="text-xs font-bold text-zinc-600 inline-flex items-center gap-1">
                <Lock className="w-3 h-3" aria-hidden="true" />{t('landing.footer.data_secure')}
              </li>
            </ul>
          </div>
        </div>

        <div className="max-w-6xl mx-auto pt-6 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-zinc-700 font-bold">
            {t('landing.footer.copyright')}
          </p>
          <p className="text-[10px] text-zinc-700 font-bold uppercase tracking-widest">
            {t('landing.footer.made_in')}
          </p>
        </div>
      </footer>
    </div>
  );
}
