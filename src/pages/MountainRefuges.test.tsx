// @vitest-environment jsdom
//
// Praeventio Guard — audit follow-up 2026-05-17.
//
// El audit 2026-05-15 marcó esta página como fake life-critical: 3
// refugios ("Alfa, Beta, Gamma") posicionados con `Math.cos(angle)*15`.
// PR #274 (Sprint C) reemplazó los mocks con el catálogo real en
// `src/services/refuges/mountainRefuges.ts` pero NO añadió tests al
// wrapper de página. Este archivo cierra esa brecha:
//
//   1. Render del catálogo real (no mocks): tarjeta para cada refugio
//      vecino tiene su `data-testid` único, derivado del id del catálogo.
//   2. Ordenamiento por distancia ascendente (Haversine) — la primera
//      tarjeta es siempre la más cercana al usuario.
//   3. Teléfono de contacto renderiza como `tel:` link clickable — el
//      navegador móvil activa el dialer. En montaña la voz sobrevive
//      antes que los datos.
//   4. Última inspección visible para que el usuario pondere frescura.
//   5. Cuando el proyecto seleccionado tiene `coordinates`, la página
//      las usa como punto de partida (no el default Santiago) — para
//      una faena en Pucón, los refugios sur deben aparecer primero.
//
// El test mockea solo `react-i18next` y `ProjectContext`. Geolocation
// se neutraliza eliminando `navigator.geolocation` en el setup para
// que el componente no intente pedirla (evita ruido async).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MountainRefuges } from './MountainRefuges';
import { MOUNTAIN_REFUGES_CHILE } from '../services/refuges/mountainRefuges';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      _k: string,
      fallback?: string | Record<string, unknown>,
      opts?: Record<string, unknown>,
    ) => {
      const interpolate = (str: string, vars: Record<string, unknown>) => {
        let out = str;
        for (const [k, v] of Object.entries(vars)) {
          out = out.replace(`{{${k}}}`, String(v));
        }
        return out;
      };
      if (typeof fallback === 'string') {
        if (opts && typeof opts === 'object') return interpolate(fallback, opts);
        return fallback;
      }
      if (fallback && typeof fallback === 'object') {
        const def = (fallback as { defaultValue?: string }).defaultValue;
        if (typeof def === 'string') return interpolate(def, fallback);
      }
      return _k;
    },
  }),
}));

// Mock del contexto Project. Reset entre tests via `beforeEach`.
let mockSelectedProject:
  | {
      id: string;
      name: string;
      coordinates?: { lat: number; lng: number };
      geo?: { lat: number; lng: number };
    }
  | null = null;

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));

beforeEach(() => {
  mockSelectedProject = null;
  // Neutraliza geolocation para que el componente no la pida en cada
  // test. Si quedaba colgada llamando `getCurrentPosition`, el cleanup
  // de @testing-library entre tests podía soltar warnings async.
  Object.defineProperty(globalThis.navigator, 'geolocation', {
    value: undefined,
    configurable: true,
  });
});

describe('<MountainRefuges /> audit-follow-up tests (2026-05-17)', () => {
  it('renderiza la página principal con el catálogo real (no mocks)', () => {
    render(<MountainRefuges />);
    expect(screen.getByTestId('mountain-refuges-page')).toBeInTheDocument();
    // Default es Santiago. El componente pide los 5 más cercanos, así
    // que el primero debería ser un refugio central (Plantat o
    // Federación, ambos ~30 km en el Cordón Plomo).
    const firstCard = screen.getByTestId('mountain-refuge-card-refugio-plantat');
    expect(firstCard).toBeInTheDocument();
  });

  it('los refugios renderizados pertenecen al catálogo real (no IDs ficticios "alfa/beta/gamma")', () => {
    render(<MountainRefuges />);
    // El audit original quemaba refugios "Alfa, Beta, Gamma" — verificar
    // que NO existan en el DOM.
    expect(screen.queryByTestId('mountain-refuge-card-alfa')).toBeNull();
    expect(screen.queryByTestId('mountain-refuge-card-beta')).toBeNull();
    expect(screen.queryByTestId('mountain-refuge-card-gamma')).toBeNull();
    // En cambio, debería haber tarjetas cuyo id existe en el catálogo
    // canónico.
    const realIds = new Set(MOUNTAIN_REFUGES_CHILE.map((r) => r.id));
    const cards = screen.getAllByTestId(/^mountain-refuge-card-/);
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      const testid = card.getAttribute('data-testid') ?? '';
      const id = testid.replace('mountain-refuge-card-', '');
      expect(realIds.has(id)).toBe(true);
    }
  });

  it('ordena las tarjetas por distancia ascendente (Haversine)', () => {
    render(<MountainRefuges />);
    const distances = screen
      .getAllByTestId(/^mountain-refuge-distance-/)
      .map((el) => Number.parseFloat(el.textContent ?? '0'));
    expect(distances.length).toBeGreaterThan(1);
    for (let i = 1; i < distances.length; i++) {
      expect(distances[i]).toBeGreaterThanOrEqual(distances[i - 1]!);
    }
  });

  it('renderiza el teléfono de contacto como `tel:` link clickable', () => {
    render(<MountainRefuges />);
    // Tomamos el primer refugio renderizado con teléfono (todos en el
    // catálogo tienen). Buscamos por testid-prefijo.
    const phoneLinks = screen.getAllByTestId(/^mountain-refuge-phone-/);
    expect(phoneLinks.length).toBeGreaterThan(0);
    const first = phoneLinks[0]!;
    expect(first.tagName).toBe('A');
    const href = first.getAttribute('href');
    expect(href).toBeTruthy();
    expect(href).toMatch(/^tel:\+\d{6,}/);
  });

  it('muestra la fecha de última inspección de cada refugio', () => {
    render(<MountainRefuges />);
    const inspections = screen.getAllByTestId(/^mountain-refuge-inspected-/);
    expect(inspections.length).toBeGreaterThan(0);
    // Cada celda debería tener una fecha ISO (YYYY-MM-DD).
    for (const el of inspections) {
      expect(el.textContent ?? '').toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('usa las coordenadas del proyecto seleccionado para ordenar (faena en Pucón → refugios sur primero)', () => {
    // Coordenadas de Pucón. Esperamos que el refugio más cercano sea
    // uno de los del sur (Monte Elena o Volcán Villarrica), NO uno
    // central como Plantat.
    mockSelectedProject = {
      id: 'p-pucon',
      name: 'Faena Pucón',
      coordinates: { lat: -39.27, lng: -71.95 },
    };
    render(<MountainRefuges />);
    const cards = screen.getAllByTestId(/^mountain-refuge-card-/);
    expect(cards.length).toBeGreaterThan(0);
    const firstId = cards[0]!
      .getAttribute('data-testid')!
      .replace('mountain-refuge-card-', '');
    const firstRefuge = MOUNTAIN_REFUGES_CHILE.find((r) => r.id === firstId);
    expect(firstRefuge).toBeDefined();
    expect(firstRefuge!.region).toBe('sur');
  });

  it('cae al default Santiago cuando el proyecto no tiene coordenadas', () => {
    mockSelectedProject = { id: 'p-no-geo', name: 'Sin coord' };
    render(<MountainRefuges />);
    // Sin coordenadas, el orden default es Santiago → refugios
    // centrales primero.
    const cards = screen.getAllByTestId(/^mountain-refuge-card-/);
    expect(cards.length).toBeGreaterThan(0);
    const firstId = cards[0]!
      .getAttribute('data-testid')!
      .replace('mountain-refuge-card-', '');
    const firstRefuge = MOUNTAIN_REFUGES_CHILE.find((r) => r.id === firstId);
    expect(firstRefuge).toBeDefined();
    expect(firstRefuge!.region).toBe('central');
  });
});
