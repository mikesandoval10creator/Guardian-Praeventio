import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Density = 'comfortable' | 'compact';

interface DensityState {
  density: Density;
  setDensity: (d: Density) => void;
  toggle: () => void;
}

export const useDensityStore = create<DensityState>()(
  persist(
    (set) => ({
      density: 'comfortable',
      setDensity: (density) => set({ density }),
      toggle: () =>
        set((s) => ({ density: s.density === 'comfortable' ? 'compact' : 'comfortable' })),
    }),
    { name: 'praeventio-density' },
  ),
);
