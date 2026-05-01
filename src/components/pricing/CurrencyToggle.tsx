import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { DollarSign, Globe } from 'lucide-react';
import type { Currency } from '../../services/pricing/tiers';

interface CurrencyContextValue {
  currency: Currency;
  setCurrency: (c: Currency) => void;
  toggleCurrency: () => void;
  /** True if the user has manually overridden the geo-detected default */
  isManualOverride: boolean;
}

const CurrencyContext = createContext<CurrencyContextValue | null>(null);

const STORAGE_KEY = 'praeventio:currencyOverride';

/**
 * Best-effort geo detection for default currency.
 * - Honors a manual override stored in localStorage.
 * - Falls back to "es-CL" / Chile timezone heuristic → CLP.
 * - Otherwise USD.
 */
function detectDefaultCurrency(): Currency {
  if (typeof window === 'undefined') return 'CLP';
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    const lang = (typeof navigator !== 'undefined' && navigator.language) || '';
    if (tz.includes('Santiago') || /es-?CL/i.test(lang)) {
      return 'CLP';
    }
  } catch {
    // ignore
  }
  return 'USD';
}

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  const [override, setOverride] = useState<Currency | null>(() => {
    if (typeof window === 'undefined') return null;
    const v = window.localStorage?.getItem(STORAGE_KEY);
    return v === 'CLP' || v === 'USD' ? v : null;
  });

  const [autoDefault] = useState<Currency>(() => detectDefaultCurrency());

  const currency: Currency = override ?? autoDefault;

  const setCurrency = (c: Currency) => {
    setOverride(c);
  };

  const toggleCurrency = () => {
    setCurrency(currency === 'CLP' ? 'USD' : 'CLP');
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (override === null) {
      window.localStorage?.removeItem(STORAGE_KEY);
    } else {
      window.localStorage?.setItem(STORAGE_KEY, override);
    }
  }, [override]);

  const value = useMemo<CurrencyContextValue>(
    () => ({
      currency,
      setCurrency,
      toggleCurrency,
      isManualOverride: override !== null,
    }),
    [currency, override],
  );

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

/**
 * Hook to access the current currency. Returns a safe default (`CLP`) if
 * called outside a provider — useful for unit-testing leaf components.
 */
export function useCurrency(): CurrencyContextValue {
  const ctx = useContext(CurrencyContext);
  if (!ctx) {
    return {
      currency: 'CLP',
      setCurrency: () => {},
      toggleCurrency: () => {},
      isManualOverride: false,
    };
  }
  return ctx;
}

interface CurrencyToggleProps {
  className?: string;
}

export function CurrencyToggle({ className = '' }: CurrencyToggleProps) {
  const { currency, setCurrency } = useCurrency();
  const isCLP = currency === 'CLP';

  return (
    <div
      role="group"
      aria-label="Selector de moneda"
      className={`inline-flex items-center bg-zinc-100 dark:bg-zinc-800 rounded-full p-1 text-xs font-bold ${className}`}
    >
      <button
        type="button"
        aria-pressed={isCLP}
        onClick={() => setCurrency('CLP')}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-colors ${
          isCLP
            ? 'bg-emerald-500 text-white shadow-sm'
            : 'text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white'
        }`}
      >
        <Globe className="w-3.5 h-3.5" />
        CLP
      </button>
      <button
        type="button"
        aria-pressed={!isCLP}
        onClick={() => setCurrency('USD')}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-colors ${
          !isCLP
            ? 'bg-emerald-500 text-white shadow-sm'
            : 'text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white'
        }`}
      >
        <DollarSign className="w-3.5 h-3.5" />
        USD
      </button>
    </div>
  );
}

export default CurrencyToggle;
