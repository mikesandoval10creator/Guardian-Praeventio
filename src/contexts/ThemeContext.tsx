/**
 * ThemeContext — thin shim over AppModeContext.
 *
 * AppModeContext owns the `dark` class on <html> and persists `appearance`
 * in localStorage. ThemeContext was a separate system (IndexedDB store +
 * independent DOM writes) that could race with AppModeContext. This shim
 * removes the conflict by reading from AppModeContext and forwarding writes.
 *
 * Migration note: the `theme_preference` IndexedDB key is no longer written
 * to. Existing stored values are intentionally ignored — the canonical store
 * is `gp.appmode.v1` (localStorage) managed by AppModeContext.
 */
import { useCallback, useEffect, useMemo, useState, createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { useAppMode } from './AppModeContext';

type ThemeMode = 'light' | 'dark' | 'system' | 'auto';

interface ThemeContextValue {
  isDarkMode: boolean;
  isDayTime: boolean;
  themeMode: ThemeMode;
  toggleTheme: () => Promise<void>;
  setThemeMode: (mode: ThemeMode) => Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getIsDayTime(): boolean {
  const hour = new Date().getHours();
  return hour >= 6 && hour < 20;
}

function appearanceToThemeMode(appearance: string): ThemeMode {
  if (appearance === 'light' || appearance === 'dark') return appearance;
  return 'auto';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { appearance, setAppearance } = useAppMode();
  const [isDayTime, setIsDayTime] = useState(getIsDayTime);

  // Tick hourly to refresh isDayTime (used by WeatherBulletin, SunTracker).
  useEffect(() => {
    const id = setInterval(() => setIsDayTime(getIsDayTime()), 60_000);
    return () => clearInterval(id);
  }, []);

  const isDarkMode =
    appearance === 'dark' ||
    (appearance === 'auto' &&
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);

  const setThemeMode = useCallback(
    async (mode: ThemeMode) => {
      // Map ThemeMode → AppAppearance: 'system' and 'auto' both mean 'auto'.
      const a = mode === 'light' || mode === 'dark' ? mode : 'auto';
      setAppearance(a);
    },
    [setAppearance],
  );

  const toggleTheme = useCallback(async () => {
    setAppearance(isDarkMode ? 'light' : 'dark');
  }, [isDarkMode, setAppearance]);

  const themeMode = appearanceToThemeMode(appearance);

  const contextValue = useMemo(
    () => ({ isDarkMode, isDayTime, themeMode, toggleTheme, setThemeMode }),
    [isDarkMode, isDayTime, themeMode, toggleTheme, setThemeMode],
  );

  return <ThemeContext.Provider value={contextValue}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
