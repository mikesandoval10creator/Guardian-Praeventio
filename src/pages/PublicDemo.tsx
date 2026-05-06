// SPDX-License-Identifier: MIT
//
// PublicDemo — Sprint 30 Bucket LL.
//
// Página /demo accesible **sin login** para Day-1 mundial. Muestra:
//   1. Hero con CTA crear-cuenta + selector de país.
//   2. 3 calculadoras (gas dispersion, dike hydrostatic, scaffold wind
//      suction) que corren puramente con inputs locales (no requieren
//      Firestore ni ProjectContext).
//   3. Vista preview del Digital Twin con mesh sintético estático.
//   4. Banner permanente "Modo demo — no se persiste data".
//
// La ruta se monta en App.tsx ANTES del auth wall (similar a /vault/share)
// para que el bundle no fuerce auth flow.
//
// IMPORTANTE: NO importar nada de FirebaseContext / ProjectContext aquí —
// la página debe funcionar sin providers. Si necesitas regulatory cites,
// usa `cite()` directamente que es puro.

import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Wind,
  Droplets,
  Building2,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Globe,
  ArrowRight,
} from 'lucide-react';
import {
  generateGasDispersionNode,
  generateDikeNode,
  generateScaffoldUpliftNode,
} from '../services/zettelkasten/bernoulli';
import type { JurisdictionCode } from '../services/regulatory/types';

// 12+ países mapeados al regulatory framework. Se mantiene en sync con
// `COUNTRY_TO_JURISDICTION` del registry (Sprint 28 B1 + Sprint 29 EE).
export const DEMO_COUNTRIES: Array<{
  code: string;
  label: string;
  jurisdiction: JurisdictionCode;
  framework: string;
}> = [
  { code: 'CL', label: 'Chile', jurisdiction: 'CL', framework: 'DS 594 / DS 76 / Ley 16.744' },
  { code: 'US', label: 'Estados Unidos', jurisdiction: 'US-OSHA', framework: 'OSHA 29 CFR 1910/1926' },
  { code: 'MX', label: 'México', jurisdiction: 'MX', framework: 'NOM-STPS / LFT' },
  { code: 'BR', label: 'Brasil', jurisdiction: 'BR', framework: 'NR-01 / NR-35' },
  { code: 'UK', label: 'Reino Unido', jurisdiction: 'UK', framework: 'HSE / HSWA 1974' },
  { code: 'CA', label: 'Canadá', jurisdiction: 'CA', framework: 'CSA Z1000 / OHSA' },
  { code: 'AU', label: 'Australia', jurisdiction: 'AU', framework: 'WHS Act 2011' },
  { code: 'ES', label: 'España', jurisdiction: 'EU', framework: 'Directiva 89/391/CEE' },
  { code: 'DE', label: 'Alemania', jurisdiction: 'EU', framework: 'ArbSchG / DGUV' },
  { code: 'FR', label: 'Francia', jurisdiction: 'EU', framework: 'Code du travail L4121' },
  { code: 'IT', label: 'Italia', jurisdiction: 'EU', framework: 'D.Lgs. 81/2008' },
  { code: 'PE', label: 'Perú', jurisdiction: 'ISO-45001', framework: 'Ley 29783 / DS 005-2012' },
  { code: 'CO', label: 'Colombia', jurisdiction: 'ISO-45001', framework: 'Decreto 1072/2015' },
  { code: 'AR', label: 'Argentina', jurisdiction: 'ISO-45001', framework: 'Ley 19.587 / 24.557' },
];

/** Banner permanente — modo demo. */
function DemoBanner() {
  const { t } = useTranslation();
  return (
    <div
      data-testid="demo-banner"
      role="status"
      className="sticky top-0 z-50 bg-amber-500/90 text-amber-950 text-center py-1.5 text-xs font-bold tracking-wider"
    >
      {t('public_demo.banner')}
    </div>
  );
}

function CountrySelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (code: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <label className="block">
      <span className="block text-[11px] font-bold uppercase tracking-widest text-zinc-500 mb-1">
        {t('public_demo.your_country')}
      </span>
      <div className="relative">
        <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
        <select
          data-testid="demo-country-select"
          aria-label={t('public_demo.select_country_aria')}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-white dark:bg-slate-900 border border-zinc-300 dark:border-slate-700 rounded-xl pl-9 pr-3 py-2.5 text-sm text-zinc-900 dark:text-white focus:ring-2 focus:ring-[#4db6ac] outline-none"
        >
          {DEMO_COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
    </label>
  );
}

function FrameworkBadge({ country }: { country: string }) {
  const { t } = useTranslation();
  const meta = DEMO_COUNTRIES.find((c) => c.code === country) ?? DEMO_COUNTRIES[0];
  return (
    <div
      data-testid="demo-framework-badge"
      className="rounded-xl bg-[#4db6ac]/10 border border-[#4db6ac]/30 p-3"
    >
      <p className="text-[10px] uppercase tracking-widest text-[#4db6ac] font-black">
        {t('public_demo.regulatory_framework')}
      </p>
      <p className="text-sm font-bold text-zinc-900 dark:text-white mt-0.5">
        {meta.label} · {meta.jurisdiction}
      </p>
      <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5">
        {meta.framework}
      </p>
    </div>
  );
}

function NodeResult({
  node,
}: {
  node: { severity: string; title: string; description: string } | null;
}) {
  const { t } = useTranslation();
  if (!node) {
    return (
      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 flex items-center gap-2">
        <CheckCircle2 className="w-4 h-4 text-emerald-500" />
        <p className="text-xs text-emerald-700 dark:text-emerald-300">
          {t('public_demo.no_alerts')}
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
      <div className="flex items-center gap-2 mb-1">
        <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
        <p className="text-sm font-semibold text-amber-700 dark:text-amber-200">
          {node.title}
        </p>
      </div>
      <pre className="whitespace-pre-wrap text-[11px] leading-snug font-mono text-amber-700 dark:text-amber-300">
        {node.description}
      </pre>
    </div>
  );
}

/** Gas dispersion calculator standalone (no project context). */
function GasDispersionCalcDemo() {
  const { t } = useTranslation();
  const [releaseRate, setReleaseRate] = useState(0.5);
  const [windKmh, setWindKmh] = useState(10);

  const node = useMemo(
    () =>
      generateGasDispersionNode(
        { id: 'demo-leak', releaseRateKgS: releaseRate, idlhMgM3: 30, relativeDensity: 2.5 },
        { windKmh, pasquillStability: 'F' as const },
        { id: 'demo-terrain', roughnessM: 0.05 },
      ),
    [releaseRate, windKmh],
  );

  return (
    <div
      data-testid="demo-calc-gas"
      className="bg-white dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-700/50 p-4 space-y-3"
    >
      <div className="flex items-center gap-3">
        <Wind className="w-5 h-5 text-[#4db6ac]" />
        <div>
          <h4 className="text-sm font-bold text-slate-900 dark:text-white">
            {t('public_demo.gas.title')}
          </h4>
          <p className="text-[10px] text-slate-500">{t('public_demo.gas.subtitle')}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="block text-[11px] text-slate-600 dark:text-slate-300 mb-1">
            {t('public_demo.gas.release_rate')}
          </span>
          <input
            data-testid="demo-gas-rate"
            type="number"
            step={0.01}
            value={releaseRate}
            onChange={(e) => setReleaseRate(Number(e.target.value) || 0)}
            className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-900 dark:text-white"
          />
        </label>
        <label className="block">
          <span className="block text-[11px] text-slate-600 dark:text-slate-300 mb-1">
            {t('public_demo.wind_kmh')}
          </span>
          <input
            data-testid="demo-gas-wind"
            type="number"
            step={1}
            value={windKmh}
            onChange={(e) => setWindKmh(Number(e.target.value) || 0)}
            className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-900 dark:text-white"
          />
        </label>
      </div>
      <NodeResult node={node} />
    </div>
  );
}

/** Dike hydrostatic standalone. */
function DikeCalcDemo() {
  const { t } = useTranslation();
  const [heightM, setHeightM] = useState(30);
  const [pressureKpa, setPressureKpa] = useState(280);

  const node = useMemo(
    () =>
      generateDikeNode(
        { id: 'demo-dike', heightM, fluidDensityKgM3: 1500 },
        [
          { id: 'demo-pz-1', depthM: 10, measuredPressurePa: 80000 },
          { id: 'demo-pz-2', depthM: 20, measuredPressurePa: pressureKpa * 1000 },
        ],
      ),
    [heightM, pressureKpa],
  );

  return (
    <div
      data-testid="demo-calc-dike"
      className="bg-white dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-700/50 p-4 space-y-3"
    >
      <div className="flex items-center gap-3">
        <Droplets className="w-5 h-5 text-[#4db6ac]" />
        <div>
          <h4 className="text-sm font-bold text-slate-900 dark:text-white">
            {t('public_demo.dike.title')}
          </h4>
          <p className="text-[10px] text-slate-500">DS 594 Art. 41</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="block text-[11px] text-slate-600 dark:text-slate-300 mb-1">
            {t('public_demo.dike.height')}
          </span>
          <input
            data-testid="demo-dike-h"
            type="number"
            step={0.1}
            value={heightM}
            onChange={(e) => setHeightM(Number(e.target.value) || 0)}
            className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-900 dark:text-white"
          />
        </label>
        <label className="block">
          <span className="block text-[11px] text-slate-600 dark:text-slate-300 mb-1">
            {t('public_demo.dike.piezometer_kpa')}
          </span>
          <input
            type="number"
            step={10}
            value={pressureKpa}
            onChange={(e) => setPressureKpa(Number(e.target.value) || 0)}
            className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-900 dark:text-white"
          />
        </label>
      </div>
      <NodeResult node={node} />
    </div>
  );
}

/** Scaffold wind suction standalone. */
function ScaffoldCalcDemo() {
  const { t } = useTranslation();
  const [areaM2, setAreaM2] = useState(50);
  const [windKmh, setWindKmh] = useState(90);

  const node = useMemo(
    () =>
      generateScaffoldUpliftNode(
        { id: 'demo-scaffold', areaM2, pressureCoefficient: -1.5 },
        { windKmh },
        { ratedCapacityN: 1000, anchorCount: 4 },
      ),
    [areaM2, windKmh],
  );

  return (
    <div
      data-testid="demo-calc-scaffold"
      className="bg-white dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-700/50 p-4 space-y-3"
    >
      <div className="flex items-center gap-3">
        <Building2 className="w-5 h-5 text-[#4db6ac]" />
        <div>
          <h4 className="text-sm font-bold text-slate-900 dark:text-white">
            {t('public_demo.scaffold.title')}
          </h4>
          <p className="text-[10px] text-slate-500">DS 594 Art. 53 / OSHA 1926.451</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="block text-[11px] text-slate-600 dark:text-slate-300 mb-1">
            {t('public_demo.scaffold.area_m2')}
          </span>
          <input
            data-testid="demo-scaffold-area"
            type="number"
            step={1}
            value={areaM2}
            onChange={(e) => setAreaM2(Number(e.target.value) || 0)}
            className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-900 dark:text-white"
          />
        </label>
        <label className="block">
          <span className="block text-[11px] text-slate-600 dark:text-slate-300 mb-1">
            {t('public_demo.wind_kmh')}
          </span>
          <input
            type="number"
            step={1}
            value={windKmh}
            onChange={(e) => setWindKmh(Number(e.target.value) || 0)}
            className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-900 dark:text-white"
          />
        </label>
      </div>
      <NodeResult node={node} />
    </div>
  );
}

/** Estatico SVG mock del Digital Twin para no requerir three.js. */
function DigitalTwinPreview() {
  const { t } = useTranslation();
  return (
    <div
      data-testid="demo-twin-preview"
      className="rounded-xl border border-zinc-200 dark:border-slate-700 bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-900 dark:to-slate-800 aspect-video relative overflow-hidden"
    >
      <svg viewBox="0 0 400 225" className="w-full h-full" aria-label={t('public_demo.twin.aria')}>
        <rect x="20" y="160" width="360" height="50" fill="#94a3b8" opacity="0.4" />
        <rect x="60" y="80" width="80" height="80" fill="#4db6ac" opacity="0.6" />
        <rect x="160" y="50" width="100" height="110" fill="#4db6ac" opacity="0.8" />
        <rect x="280" y="100" width="60" height="60" fill="#4db6ac" opacity="0.5" />
        <circle cx="100" cy="170" r="6" fill="#dc2626" />
        <circle cx="210" cy="170" r="6" fill="#dc2626" />
        <circle cx="310" cy="170" r="6" fill="#16a34a" />
        <text x="200" y="30" fill="#475569" fontSize="12" fontWeight="bold" textAnchor="middle">
          {t('public_demo.twin.svg_label')}
        </text>
      </svg>
    </div>
  );
}

export function PublicDemo() {
  const { t } = useTranslation();
  const [country, setCountry] = useState<string>('CL');

  const handleSignup = () => {
    // Sin auth — redirige a la landing/login para que el visitante cree cuenta.
    window.location.href = '/login';
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900">
      <DemoBanner />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-8">
        {/* Hero */}
        <section className="text-center space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#4db6ac]/10 border border-[#4db6ac]/30 text-[#4db6ac] text-[10px] font-black uppercase tracking-widest">
            <ShieldCheck className="w-3 h-3" />
            {t('public_demo.hero.eyebrow')}
          </div>
          <h1 className="text-3xl sm:text-5xl font-black text-zinc-900 dark:text-white tracking-tight">
            {t('public_demo.hero.title')}
          </h1>
          <p className="text-sm sm:text-base text-zinc-600 dark:text-zinc-400 max-w-2xl mx-auto">
            {t('public_demo.hero.subtitle')}
          </p>
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-center pt-2">
            <button
              data-testid="demo-cta-signup"
              onClick={handleSignup}
              className="px-5 py-3 rounded-xl bg-[#4db6ac] hover:bg-[#3fa39a] text-white font-bold text-sm flex items-center justify-center gap-2 transition-colors"
            >
              {t('public_demo.hero.cta_signup')}
              <ArrowRight className="w-4 h-4" />
            </button>
            <a
              href="/privacidad"
              className="px-5 py-3 rounded-xl border border-zinc-300 dark:border-slate-700 text-zinc-700 dark:text-zinc-300 font-bold text-sm hover:bg-zinc-100 dark:hover:bg-slate-800 transition-colors text-center"
            >
              {t('public_demo.hero.privacy_link')}
            </a>
          </div>
        </section>

        {/* Country + framework */}
        <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <CountrySelector value={country} onChange={setCountry} />
          <FrameworkBadge country={country} />
        </section>

        {/* Calculadoras */}
        <section className="space-y-4">
          <h2 className="text-lg font-bold text-zinc-900 dark:text-white">
            {t('public_demo.calculators_heading')}
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <GasDispersionCalcDemo />
            <DikeCalcDemo />
            <ScaffoldCalcDemo />
          </div>
        </section>

        {/* Digital Twin preview */}
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-zinc-900 dark:text-white">
            {t('public_demo.twin.heading')}
          </h2>
          <DigitalTwinPreview />
          <p className="text-xs text-zinc-500">
            {t('public_demo.twin.note')}
          </p>
        </section>
      </main>
    </div>
  );
}

export default PublicDemo;
