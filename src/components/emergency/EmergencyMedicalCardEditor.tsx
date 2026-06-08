// Praeventio Guard — emergency medical card editor (#2 step 1).
//
// Where the worker fills their card ONCE: blood type + allergies + an explicit
// opt-in to share it during an emergency. Stored on-device only. The consent
// copy is deliberately concrete so the authorization is informed (it will be
// shown to responders on the TriageBeacon and broadcast over the mesh).
//
// Educational/non-diagnostic: this only records data the worker enters — no
// inference, no diagnosis (ADR 0012).

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HeartPulse, Check } from 'lucide-react';
import {
  useEmergencyMedicalCard,
  BLOOD_TYPES,
  type BloodType,
} from '../../hooks/useEmergencyMedicalCard';

export function EmergencyMedicalCardEditor() {
  const { t } = useTranslation();
  const { card, saveCard, loading } = useEmergencyMedicalCard();

  const [bloodType, setBloodType] = useState<BloodType | undefined>(undefined);
  const [allergies, setAllergies] = useState('');
  const [shareConsent, setShareConsent] = useState(false);
  const [saved, setSaved] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Seed local form from the persisted card once it loads.
  if (!loading && !hydrated) {
    setBloodType(card.bloodType);
    setAllergies(card.allergies ?? '');
    setShareConsent(card.shareConsent);
    setHydrated(true);
  }

  const onSave = async () => {
    await saveCard({ bloodType, allergies: allergies.trim() || undefined, shareConsent });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <section
      aria-label={t('emergency.medical_card.title', 'Ficha médica de emergencia')}
      className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-5"
    >
      <header className="mb-1 flex items-center gap-2">
        <HeartPulse className="h-5 w-5 text-rose-400" aria-hidden="true" />
        <h3 className="text-base font-black">
          {t('emergency.medical_card.title', 'Ficha médica de emergencia')}
        </h3>
      </header>
      <p className="mb-4 text-xs text-zinc-400">
        {t(
          'emergency.medical_card.subtitle',
          'Solo en tu dispositivo. Se muestra a los rescatistas únicamente si lo autorizas, para acelerar tu atención en una emergencia.',
        )}
      </p>

      {/* Blood type */}
      <fieldset className="mb-4">
        <legend className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-300">
          {t('emergency.medical_card.blood_type', 'Tipo de sangre')}
        </legend>
        <div className="grid grid-cols-4 gap-2">
          {BLOOD_TYPES.map((bt) => (
            <button
              key={bt}
              type="button"
              aria-pressed={bloodType === bt}
              onClick={() => setBloodType(bloodType === bt ? undefined : bt)}
              className={`rounded-xl py-2 font-mono font-bold transition-colors ${
                bloodType === bt
                  ? 'bg-rose-600 text-white'
                  : 'bg-white/5 text-zinc-300 hover:bg-white/10'
              }`}
            >
              {bt}
            </button>
          ))}
        </div>
      </fieldset>

      {/* Allergies */}
      <div className="mb-4">
        <label htmlFor="emc-allergies" className="mb-2 block text-xs font-bold uppercase tracking-wider text-zinc-300">
          {t('emergency.medical_card.allergies', 'Alergias')}
        </label>
        <input
          id="emc-allergies"
          type="text"
          value={allergies}
          onChange={(e) => setAllergies(e.target.value)}
          placeholder={t('emergency.medical_card.allergies_placeholder', 'Ej: Penicilina, látex')}
          className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-500"
        />
      </div>

      {/* Consent — the gate that allows sharing */}
      <label className="mb-4 flex cursor-pointer items-start gap-3 rounded-xl bg-white/5 p-3">
        <input
          type="checkbox"
          checked={shareConsent}
          onChange={(e) => setShareConsent(e.target.checked)}
          className="mt-1 h-4 w-4 accent-rose-600"
        />
        <span className="text-xs text-zinc-300">
          {t(
            'emergency.medical_card.consent',
            'Autorizo compartir esta ficha en una emergencia (a los rescatistas y por la red mesh Bluetooth) para acelerar mi atención.',
          )}
        </span>
      </label>

      <button
        type="button"
        onClick={onSave}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-rose-600 py-3 font-bold text-white hover:bg-rose-500"
      >
        {saved ? <Check className="h-5 w-5" /> : null}
        {saved
          ? t('emergency.medical_card.saved', 'Guardado')
          : t('emergency.medical_card.save', 'Guardar ficha')}
      </button>
    </section>
  );
}
