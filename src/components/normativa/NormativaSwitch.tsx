/**
 * `NormativaSwitch` — country-pack picker dropdown + GPS-mismatch banner.
 *
 * Bundled in this file (lift to `src/contexts/` once a second consumer exists):
 *   - `NormativaContext` + `NormativaProvider` — exposes the active pack and a setter.
 *   - `useNormativa()` — consumer hook.
 *   - `NormativaSwitch` — the dropdown UI itself.
 *   - `NormativaMismatchBanner` — non-blocking banner when GPS disagrees with the pack.
 *
 * Styling follows the project's Tailwind + dark-mode conventions
 * (cf. src/components/shared/Modal.tsx).
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Check, ChevronDown, Globe } from 'lucide-react';
import {
  COUNTRY_PACKS,
  getDefaultPack,
  getPackByCode,
  type CountryCode,
  type CountryPack,
} from '../../services/normativa/countryPacks';
import { useGeoCountry } from '../../hooks/useGeoCountry';

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface NormativaContextValue {
  pack: CountryPack;
  setCountry: (code: CountryCode) => void;
  /** Country reported by GPS / language detection (may differ from `pack.code`). */
  detectedCountry: CountryCode;
  detectionSource: 'gps' | 'language' | 'manual' | 'default';
}

const NormativaContext = createContext<NormativaContextValue | undefined>(undefined);

export function NormativaProvider({ children }: { children: React.ReactNode }) {
  const { country: detectedCountry, source, override } = useGeoCountry();
  const [activeCode, setActiveCode] = useState<CountryCode>('ISO');

  // Sync the active code with detection unless the user has already overridden.
  useEffect(() => {
    if (source === 'manual') {
      setActiveCode(detectedCountry);
    } else {
      setActiveCode((prev) => (prev === 'ISO' ? detectedCountry : prev));
    }
  }, [detectedCountry, source]);

  const setCountry = useCallback(
    (code: CountryCode) => {
      setActiveCode(code);
      override(code);
    },
    [override],
  );

  const pack = useMemo<CountryPack>(() => {
    try {
      return getPackByCode(activeCode);
    } catch {
      return getDefaultPack();
    }
  }, [activeCode]);

  const value = useMemo<NormativaContextValue>(
    () => ({ pack, setCountry, detectedCountry, detectionSource: source }),
    [pack, setCountry, detectedCountry, source],
  );

  return <NormativaContext.Provider value={value}>{children}</NormativaContext.Provider>;
}

export function useNormativa(): NormativaContextValue {
  const ctx = useContext(NormativaContext);
  if (!ctx) {
    throw new Error('useNormativa must be used within a NormativaProvider');
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Dropdown
// ---------------------------------------------------------------------------

const ALL_CODES: CountryCode[] = ['CL', 'PE', 'CO', 'MX', 'AR', 'BR', 'ISO'];

export function NormativaSwitch() {
  const { pack, setCountry } = useNormativa();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 text-sm font-medium text-zinc-900 dark:text-white hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors"
      >
        <span className="text-base leading-none" aria-hidden="true">
          {pack.flag}
        </span>
        <span className="truncate max-w-[160px]">{pack.name}</span>
        <ChevronDown className="w-4 h-4 text-zinc-500 dark:text-zinc-400" aria-hidden="true" />
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute right-0 mt-2 w-64 z-40 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 shadow-lg overflow-hidden"
        >
          {ALL_CODES.map((code) => {
            const p = COUNTRY_PACKS[code];
            const selected = p.code === pack.code;
            return (
              <li key={code}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    setCountry(code);
                    setOpen(false);
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-white/5 text-zinc-900 dark:text-white"
                >
                  <span className="text-base leading-none" aria-hidden="true">
                    {p.flag}
                  </span>
                  <span className="flex-1 truncate">{p.name}</span>
                  {selected && (
                    <Check className="w-4 h-4 text-emerald-500" aria-hidden="true" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mismatch banner
// ---------------------------------------------------------------------------

/**
 * Renders a non-blocking banner when GPS detects a country different from the
 * currently-selected pack. The user can accept, dismiss, or open settings.
 */
export function NormativaMismatchBanner({
  onConfigure,
}: {
  onConfigure?: () => void;
}) {
  const { pack, detectedCountry, detectionSource, setCountry } = useNormativa();
  const [dismissed, setDismissed] = useState(false);

  const shouldShow =
    !dismissed &&
    detectionSource === 'gps' &&
    detectedCountry !== pack.code &&
    detectedCountry !== 'ISO';

  if (!shouldShow) return null;

  let detectedPack: CountryPack;
  try {
    detectedPack = getPackByCode(detectedCountry);
  } catch {
    return null;
  }

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-3 px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 text-amber-900 dark:text-amber-100 text-sm"
    >
      <Globe className="w-5 h-5 shrink-0" aria-hidden="true" />
      <p className="flex-1 min-w-[200px]">
        Detectamos que estás en{' '}
        <span className="font-semibold">
          {detectedPack.flag} {detectedPack.name}
        </span>
        . ¿Cambiar normativa de referencia a {detectedPack.name}?
      </p>
      <div className="flex items-center gap-2 ml-auto">
        <button
          type="button"
          onClick={() => {
            setCountry(detectedCountry);
            setDismissed(true);
          }}
          className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold transition-colors"
        >
          Sí, cambiar
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="px-3 py-1.5 rounded-lg bg-white dark:bg-zinc-900 border border-amber-300 dark:border-amber-800 text-xs font-semibold text-amber-900 dark:text-amber-100 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
        >
          No, mantener {pack.name}
        </button>
        {onConfigure && (
          <button
            type="button"
            onClick={onConfigure}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-amber-900 dark:text-amber-100 underline underline-offset-2 hover:opacity-80"
          >
            Configurar
          </button>
        )}
      </div>
    </div>
  );
}
