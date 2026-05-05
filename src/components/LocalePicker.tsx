// SPDX-License-Identifier: MIT
//
// Sprint 28 B2 — Global launch foundation.
//
// LocalePicker: a single dropdown listing every locale Praeventio Guard
// ships, with native names + flag emoji. Wraps `useLanguage()` so the
// chosen locale propagates through the whole app (i18next + Firestore
// user doc + RTL `<html dir>`).
//
// Render this in any settings or onboarding view that needs a language
// switch. The component is fully controlled by the LanguageProvider —
// no local state, no side effects beyond `setLanguage(...)`.

import React, { useId } from 'react';
import {
  LOCALE_DISPLAY,
  SUPPORTED_LOCALES,
  useLanguage,
  type SupportedLocale,
} from '../contexts/LanguageProvider';

export interface LocalePickerProps {
  /** Optional className passthrough for layout overrides. */
  className?: string;
  /** Optional label override. Defaults to "Idioma / Language". */
  label?: string;
}

export function LocalePicker({ className = '', label }: LocalePickerProps) {
  const { language, setLanguage } = useLanguage();
  const id = useId();

  return (
    <div className={className}>
      <label
        htmlFor={id}
        className="text-[10px] font-bold text-zinc-700 dark:text-zinc-500 uppercase tracking-widest"
      >
        {label ?? 'Idioma / Language'}
      </label>
      <select
        id={id}
        value={language}
        onChange={(e) => {
          void setLanguage(e.target.value as SupportedLocale);
        }}
        className="mt-1 w-full bg-white/50 dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-xl px-4 py-2 text-sm text-zinc-900 dark:text-white focus:border-emerald-500 outline-none"
      >
        {SUPPORTED_LOCALES.map((tag) => {
          const meta = LOCALE_DISPLAY[tag];
          return (
            <option key={tag} value={tag}>
              {meta.flag} {meta.native}
            </option>
          );
        })}
      </select>
    </div>
  );
}
