// Praeventio Guard — public, no-login emergency access (prototype-recovery #1).
//
// Founder vision: a person in crisis reaches life-saving help from the PUBLIC
// landing page WITHOUT logging in. The landing renders OUTSIDE <AppProviders>,
// so this component is fully SELF-CONTAINED — it depends only on i18n (global,
// initialised in main.tsx before any component) and on FirstAidCards /
// SurvivalMode (which use sensor hooks, never the AppMode/Emergency/Project/
// Firebase contexts). One tap opens: direct `tel:` calls to the LOCAL emergency
// services (country explicitly selected by the caller) + offline FirstAidCards (CPR
// metronome) + the offline SurvivalMode. No network, no auth — works on first
// paint, which is exactly the point: life-safety must never sit behind a login
// wall (CLAUDE.md #11).
//
// i18n: uses react-i18next `defaultValue` (Spanish-CL) so the copy is real
// without churning the large shared locale files; promote to keys later if
// desired.

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { ShieldAlert, Phone, HeartPulse, LifeBuoy, ArrowLeft, X } from 'lucide-react';
import { FirstAidCards } from './FirstAidCards';
import { SurvivalMode } from './SurvivalMode';
import { PublicDeaFinder } from './PublicDeaFinder';
import {
  listSupportedCountries,
  toTelUri,
  type EmergencyNumbers,
} from '../../services/emergency/emergencyNumbers';

type View = 'menu' | 'firstaid' | 'survival' | 'dea';
const countries = listSupportedCountries();

export function PublicEmergencyButton() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('menu');
  // Approximate GPS bounding boxes can overlap countries. A caller must
  // confirm the current country; missing location must never imply Chile.
  const [regionCode, setRegionCode] = useState('');
  const numbers = countries.find(country => country.regionCode === regionCode);

  const calls: Array<{ key: keyof EmergencyNumbers; label: string; number: string }> = numbers ? [
    { key: 'medical', label: t('emergency.public_call_medical', 'Ambulancia'), number: numbers.medical },
    { key: 'fire', label: t('emergency.public_call_fire', 'Bomberos'), number: numbers.fire },
    { key: 'police', label: numbers.regionCode === 'CL'
      ? t('emergency.public_call_police', 'Carabineros')
      : t('emergency.public_call_police_generic', 'Policía'), number: numbers.police },
  ] : [];

  return (
    <>
      <button
        type="button"
        data-testid="public-emergency-trigger"
        onClick={() => {
          setView('menu');
          setRegionCode('');
          setOpen(true);
        }}
        aria-label={t('emergency.public_button', 'Emergencia')}
        className="fixed bottom-5 right-5 z-[90] flex items-center gap-2 rounded-full bg-red-600 px-5 py-4 text-white font-black uppercase tracking-widest shadow-[0_0_30px_rgba(220,38,38,0.6)] hover:bg-red-500 focus:outline-none focus-visible:ring-4 focus-visible:ring-red-300"
      >
        <ShieldAlert className="h-6 w-6" aria-hidden="true" />
        <span className="hidden sm:inline">{t('emergency.public_button', 'Emergencia')}</span>
      </button>

      <AnimatePresence>
        {open && view !== 'survival' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[95] flex flex-col overflow-y-auto bg-zinc-950/95 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-label={t('emergency.public_title', 'Ayuda de emergencia')}
          >
            <div className="flex items-center justify-between p-4">
              {view !== 'menu' ? (
                <button
                  type="button"
                  onClick={() => setView('menu')}
                  className="flex items-center gap-1 text-white/80 hover:text-white"
                >
                  <ArrowLeft className="h-5 w-5" /> {t('emergency.public_back', 'Volver')}
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t('emergency.public_close', 'Cerrar')}
                className="text-white/80 hover:text-white"
              >
                <X className="h-7 w-7" />
              </button>
            </div>

            {view === 'menu' && (
              <div className="mx-auto w-full max-w-xl flex-1 px-5 pb-10">
                <h2 className="mb-1 text-center text-3xl font-black text-white">
                  {t('emergency.public_title', 'Ayuda de emergencia')}
                </h2>
                <p className="mb-6 text-center text-sm text-white/70">
                  {t(
                    'emergency.public_subtitle',
                    'Llama directo o usa las guías sin conexión. No necesitas iniciar sesión.',
                  )}
                </p>
                <label className="mb-4 block text-sm font-bold text-white">
                  {t('emergency.public_country', 'País donde estás')}
                  <select
                    value={regionCode}
                    onChange={event => setRegionCode(event.target.value)}
                    className="mt-2 block min-h-12 w-full rounded-xl border border-white/30 bg-zinc-900 px-4 py-3 text-base text-white"
                  >
                    <option value="">{t('emergency.public_select_country', 'Selecciona tu país')}</option>
                    {countries.map(country => (
                      <option key={country.regionCode} value={country.regionCode}>{country.countryName}</option>
                    ))}
                  </select>
                </label>
                <div className="space-y-3">
                  {calls.map((c) => (
                    <a
                      key={c.key}
                      href={toTelUri(c.number)}
                      className="flex items-center justify-between gap-3 rounded-2xl bg-red-600 px-5 py-4 font-bold text-white hover:bg-red-500"
                    >
                      <span className="flex items-center gap-3">
                        <Phone className="h-6 w-6" /> {c.label}
                      </span>
                      <span className="font-mono text-2xl">{c.number}</span>
                    </a>
                  ))}
                </div>
                <div className="mt-6 grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setView('firstaid')}
                    className="flex flex-col items-center gap-2 rounded-2xl bg-white/10 px-4 py-5 text-white hover:bg-white/20"
                  >
                    <HeartPulse className="h-7 w-7" />
                    <span className="text-sm font-bold">{t('emergency.public_first_aid', 'Primeros auxilios')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setView('survival')}
                    className="flex flex-col items-center gap-2 rounded-2xl bg-white/10 px-4 py-5 text-white hover:bg-white/20"
                  >
                    <LifeBuoy className="h-7 w-7" />
                    <span className="text-sm font-bold">{t('emergency.public_survival', 'Modo supervivencia')}</span>
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setView('dea')}
                  data-testid="public-emergency-dea"
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600/90 px-4 py-4 font-bold text-white hover:bg-emerald-500"
                >
                  <HeartPulse className="h-6 w-6" />
                  {t('emergency.public_find_dea', 'Desfibrilador (DEA) más cercano')}
                </button>
              </div>
            )}

            {view === 'firstaid' && (
              <div className="flex-1 px-2 pb-10">
                <FirstAidCards />
              </div>
            )}

            {view === 'dea' && (
              <div className="flex-1 px-5 pb-10">
                <PublicDeaFinder />
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* SurvivalMode renders its own full-screen overlay; closing returns to the menu. */}
      {open && view === 'survival' && <SurvivalMode onClose={() => setView('menu')} />}
    </>
  );
}
