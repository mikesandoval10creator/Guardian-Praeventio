// @vitest-environment jsdom
//
// Sprint 13 — Site25DPanel render & overlay tests.
//
// We mock `@react-google-maps/api` so the test does not depend on the
// google object or network, and we mock the Firestore subscription so we
// can drive `features` deterministically. The hazmat overlay logic itself
// is exercised through `projectWindSuction` with canned wind values.

import React, { act } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// We can't import `screen` (peer `@testing-library/dom` is not installed and
// "no new deps" is a sprint constraint). Use container queries instead.
function $all(container: HTMLElement, sel: string): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(sel));
}
function $one(container: HTMLElement, sel: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(sel);
  if (!el) throw new Error(`No element matched ${sel}`);
  return el;
}

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('@react-google-maps/api', () => {
  const Stub = ({ children, ...rest }: any) =>
    React.createElement(
      'div',
      { 'data-stub': rest['data-stub'] ?? 'gmap-stub', ...rest },
      children,
    );
  return {
    useJsApiLoader: () => ({ isLoaded: true }),
    GoogleMap: ({ children, tilt, mapTypeId }: any) =>
      React.createElement(
        'div',
        {
          'data-testid': 'google-map',
          'data-tilt': String(tilt),
          'data-map-type': mapTypeId,
        },
        children,
      ),
    Polygon: (props: any) =>
      React.createElement('div', {
        'data-testid': 'polygon',
        'data-fill': props.options?.fillColor ?? '',
      }),
    Marker: (props: any) =>
      React.createElement('div', {
        'data-testid': 'marker',
        title: props.title ?? '',
      }),
    Circle: (props: any) =>
      React.createElement('div', {
        'data-testid': 'wind-halo',
        'data-radius': String(props.radius ?? 0),
      }),
    Polyline: () =>
      React.createElement('div', { 'data-testid': 'wind-line' }),
    DrawingManager: () => null,
    InfoWindow: ({ children }: any) =>
      React.createElement('div', { 'data-testid': 'infowindow' }, children),
  };
});

// Capture the subscribe callback so we can drive feature updates.
let lastSubscribeCb: ((f: any[]) => void) | null = null;
vi.mock('../../services/digitalTwin/siteGeometryStore', () => ({
  subscribeSiteGeometry: (
    _t: string,
    _p: string,
    cb: (f: any[]) => void,
  ) => {
    lastSubscribeCb = cb;
    return () => {
      lastSubscribeCb = null;
    };
  },
  savePolygon: vi.fn(),
}));

// Universal knowledge mock: lets each test set the wind snapshot.
const universalState: { windSpeed: number; windDirection?: number } = {
  windSpeed: 30,
  windDirection: 270,
};
vi.mock('../../contexts/UniversalKnowledgeContext', () => ({
  useUniversalKnowledge: () => ({
    environment: {
      weather: {
        windSpeed: universalState.windSpeed,
        windDirection: universalState.windDirection,
      },
    },
  }),
}));

vi.mock('../../contexts/ProjectContext', () => ({
  useProject: () => ({
    selectedProject: {
      id: 'proj-1',
      name: 'Faena Test',
      coordinates: { lat: -33.45, lng: -70.66 },
    },
  }),
}));

// Sprint 26 Bucket YY.1 — Site25DPanel ahora se envuelve con
// <TwinAccessGuard>. En tests stub-eamos el guard para que renderice
// directamente sus children (mock granted state). El test del guard real
// vive en useTwinAccess.test.ts.
vi.mock('./TwinAccessGuard', () => ({
  TwinAccessGuard: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock('../../contexts/FirebaseContext', () => ({
  useFirebase: () => ({
    user: {
      uid: 'test-uid',
      email: 'test@example.com',
      emailVerified: true,
    },
  }),
}));

vi.mock('../../services/firebase', () => ({
  auth: { currentUser: { tenantId: 'tenant-x' } },
  db: {},
  doc: vi.fn(),
  getDoc: vi.fn(async () => ({
    exists: () => true,
    data: () => ({ members: ['test-uid'] }),
  })),
  collection: vi.fn(),
  onSnapshot: vi.fn(() => () => {}),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
}));

vi.mock('../../utils/logger', () => ({
  logger: { error: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

// ─── Imports under test (after mocks) ──────────────────────────────────────
import { Site25DPanel } from './Site25DPanel';

// Helper: build a minimal hazard polygon feature.
// Polygon size is ~5m × 5m (≈25 m² footprint, ≈10 m² exposed). Kept
// intentionally tiny so projectWindSuction's radius cap (250 m) does not
// saturate at both 30 km/h and 120 km/h wind speeds — the wind-reactivity
// test needs the radius to actually scale with v².
function hazardFeature(id: string) {
  return {
    type: 'Feature' as const,
    id,
    properties: { id, label: 'Tanque', type: 'hazard' as const, heightM: 0 },
    geometry: {
      type: 'Polygon' as const,
      coordinates: [[
        [-70.66000, -33.45000],
        [-70.65995, -33.45000],
        [-70.65995, -33.44995],
        [-70.66000, -33.44995],
        [-70.66000, -33.45000],
      ] as [number, number][]],
    },
  };
}

afterEach(() => {
  cleanup();
  lastSubscribeCb = null;
});

// TODO(sprint-19): rebuild these tests with stable react-google-maps mocks.
// The current mock surface returns div placeholders that the assertions look
// up via `data-testid='polygon'`/'marker'; in CI the rerender path doesn't
// flush React commits before the queries run, leading to flaky `expected 0
// to be greater than or equal to 1`. Skipping until we replace with a
// MutationObserver-based `findAllByTestId` (will need @testing-library/dom
// peer which already ships in PR #21). Component itself is rendered fine
// in the live preview; this only affects test parity.
describe('Site25DPanel — Bucket YY.1 wrap (TwinAccessGuard)', () => {
  it('renders the inner panel when the guard mock returns children directly', () => {
    // El TwinAccessGuard mockeado pasa-through children. Verifica que el
    // inner panel monta y dibuja el GoogleMap stub (granted path).
    const { container } = render(<Site25DPanel />);
    const map = $one(container, '[data-testid="google-map"]');
    expect(map).toBeTruthy();
    expect(map.getAttribute('data-tilt')).toBe('45');
  });

  it('still propaga el subscribe callback al inner panel', () => {
    render(<Site25DPanel />);
    // El inner panel ejecuta `subscribeSiteGeometry` en el mount, lo que
    // captura `lastSubscribeCb` para los tests legacy. Verifica que el
    // wrap por TwinAccessGuard NO impide ese flujo.
    expect(typeof lastSubscribeCb).toBe('function');
  });
});

// Sprint 39 P0.3 follow-up: previously this whole describe was `.skip`'d
// with the note "flaky CI mocks, see TODO" — the real root cause was
// invoking `lastSubscribeCb` synchronously without wrapping in React's
// `act()`, so the state update was scheduled but not flushed by the time
// the DOM queries ran (`expected 0 to be >= 1`). React 18+ batches state
// updates and only flushes them inside `act()` or at the next microtask;
// the fix is to wrap every state-changing callback call.
describe('Site25DPanel — features + wind reactivity', () => {
  beforeEach(() => {
    universalState.windSpeed = 30;
    universalState.windDirection = 270;
  });

  it('mounts the Google Map with tilt=45 and hybrid layer', () => {
    const { container } = render(<Site25DPanel />);
    const map = $one(container, '[data-testid="google-map"]');
    expect(map.getAttribute('data-tilt')).toBe('45');
    expect(map.getAttribute('data-map-type')).toBe('hybrid');
  });

  it('renders hazard polygons and a wind halo when features are pushed', () => {
    const { container } = render(<Site25DPanel />);
    expect(lastSubscribeCb).toBeTruthy();

    // Push features through React's batched-commit gate so the
    // hazard-polygon useEffect actually runs before we query the DOM.
    act(() => {
      lastSubscribeCb!([hazardFeature('h1')]);
    });

    const polys = $all(container, '[data-testid="polygon"]');
    expect(polys.length).toBeGreaterThanOrEqual(1);

    const halos = $all(container, '[data-testid="wind-halo"]');
    expect(halos.length).toBe(1);
    const radius = Number(halos[0].getAttribute('data-radius'));
    expect(radius).toBeGreaterThan(0);
  });

  it('updates the wind halo radius when the wind snapshot changes', () => {
    const { container, rerender } = render(<Site25DPanel />);
    act(() => {
      lastSubscribeCb!([hazardFeature('h1')]);
    });
    const radiusLow = Number(
      $all(container, '[data-testid="wind-halo"]')[0].getAttribute('data-radius'),
    );

    // Strong wind → radius scales with v² via windLoadOnSurface.
    universalState.windSpeed = 120;
    act(() => {
      rerender(<Site25DPanel />);
    });
    const radiusHigh = Number(
      $all(container, '[data-testid="wind-halo"]')[0].getAttribute('data-radius'),
    );

    expect(radiusHigh).toBeGreaterThan(radiusLow);
  });
});
