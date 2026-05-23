import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';
import { get, set } from 'idb-keyval';

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

function computeIsDark(mode: ThemeMode): boolean {
  if (mode === 'dark') return true;
  if (mode === 'light') return false;
  if (mode === 'auto') {
    const hour = new Date().getHours();
    return hour < 6 || hour >= 18;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeMode, setThemeModeState] = useState<ThemeMode>('system');
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isDayTime, setIsDayTime] = useState(getIsDayTime);

  const applyTheme = useCallback((mode: ThemeMode) => {
    const dark = computeIsDark(mode);
    setIsDarkMode(dark);
    setIsDayTime(getIsDayTime());
    const root = window.document.documentElement;
    if (dark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, []);

  // Load preference from IndexedDB on mount
  useEffect(() => {
    get('theme_preference').then((pref) => {
      const mode = (pref as ThemeMode) || 'system';
      setThemeModeState(mode);
      applyTheme(mode);
    });
  }, [applyTheme]);

  // React to mode changes + system media query + hourly tick
  useEffect(() => {
    applyTheme(themeMode);

    const handlePrefChange = async () => {
      const pref = await get('theme_preference');
      const mode = (pref as ThemeMode) || 'system';
      setThemeModeState(mode);
      applyTheme(mode);
    };
    window.addEventListener('theme_preference_changed', handlePrefChange);

    let mediaQuery: MediaQueryList | null = null;
    let interval: NodeJS.Timeout | null = null;

    if (themeMode === 'system') {
      mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      mediaQuery.addEventListener('change', () => applyTheme(themeMode));
    } else if (themeMode === 'auto') {
      interval = setInterval(() => applyTheme(themeMode), 60_000);
    } else {
      // For fixed light/dark, still tick hourly to update isDayTime for cross-inversion
      interval = setInterval(() => setIsDayTime(getIsDayTime()), 60_000);
    }

    return () => {
      window.removeEventListener('theme_preference_changed', handlePrefChange);
      if (mediaQuery) mediaQuery.removeEventListener('change', () => applyTheme(themeMode));
      if (interval) clearInterval(interval);
    };
  }, [themeMode, applyTheme]);

  const setThemeMode = useCallback(async (mode: ThemeMode) => {
    setThemeModeState(mode);
    await set('theme_preference', mode);
    window.dispatchEvent(new Event('theme_preference_changed'));
  }, []);

  const toggleTheme = useCallback(async () => {
    const newMode: ThemeMode = isDarkMode ? 'light' : 'dark';
    await setThemeMode(newMode);
  }, [isDarkMode, setThemeMode]);

  // Plan 2026-05-23 perf — memoize el value. ToggleTheme y setThemeMode
  // ya están en useCallback (líneas 89-98) así que sus refs son estables
  // mientras isDarkMode no cambia → useMemo solo invalida cuando un
  // campo del value efectivamente muta. Sin esto, todos los useContext
  // del ThemeContext (sidebar, topbar, varias pages) re-renderizaban
  // cuando *cualquier ancestor* del Provider re-renderizaba.
  const contextValue = useMemo(
    () => ({ isDarkMode, isDayTime, themeMode, toggleTheme, setThemeMode }),
    [isDarkMode, isDayTime, themeMode, toggleTheme, setThemeMode],
  );

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
