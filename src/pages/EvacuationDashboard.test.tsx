// @vitest-environment jsdom
//
// Phase 5 arista C1 — asistencia ⇄ evacuación. Verifica que el tablero de
// evacuación pre-pobla la nómina con la asistencia REAL de HOY del proyecto
// (`projects/{id}/attendance`, escrita por Attendance.tsx) en vez de los 5
// trabajadores ficticios: muestra los NOMBRES de los faltantes y los mueve a
// seguros al registrarlos. El modo demo queda como fallback EXPLÍCITO solo
// cuando no hay asistencia hoy (o la lectura falla).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';

const h = vi.hoisted(() => ({
  getDocs: vi.fn(),
  collection: vi.fn((_db: unknown, path: string) => ({ path })),
  query: vi.fn((col: unknown, ..._clauses: unknown[]) => col),
  where: vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
  idbGet: vi.fn(),
  idbSet: vi.fn(),
}));

vi.mock('idb-keyval', () => ({
  get: h.idbGet,
  set: h.idbSet,
}));

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: { id: 'proj-1', name: 'Faena Norte' } }),
}));

vi.mock('../contexts/FirebaseContext', () => ({
  useFirebase: () => ({ user: { uid: 'sup-1', email: 'sup@faena.cl' } }),
}));

vi.mock('../services/firebase', () => ({
  db: {},
  collection: h.collection,
  query: h.query,
  where: h.where,
  getDocs: h.getDocs,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>, vars?: Record<string, unknown>) => {
      if (typeof fallback !== 'string') return _k;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(vars?.[name] ?? ''));
    },
  }),
}));

import { EvacuationDashboard } from './EvacuationDashboard';

/** ISO de hace `secAgo` segundos — siempre HOY salvo corrida exacta a medianoche. */
function isoAgo(secAgo: number): string {
  return new Date(Date.now() - secAgo * 1000).toISOString();
}

function attendanceDocs(records: Array<Record<string, unknown>>) {
  return { docs: records.map((r) => ({ data: () => r })) };
}

const TODAY_ATTENDANCE = [
  {
    workerId: 'w-ana',
    workerName: 'Ana Soto',
    type: 'Check-In',
    timestamp: isoAgo(150),
    location: 'Torniquete Principal',
    projectId: 'proj-1',
  },
  {
    workerId: 'w-bruno',
    workerName: 'Bruno Díaz',
    type: 'Check-In',
    timestamp: isoAgo(90),
    location: 'Torniquete Principal',
    projectId: 'proj-1',
  },
  // Carla entró y salió ANTES de la emergencia → no debe aparecer.
  {
    workerId: 'w-carla',
    workerName: 'Carla Mena',
    type: 'Check-In',
    timestamp: isoAgo(300),
    projectId: 'proj-1',
  },
  {
    workerId: 'w-carla',
    workerName: 'Carla Mena',
    type: 'Check-Out',
    timestamp: isoAgo(120),
    projectId: 'proj-1',
  },
];

beforeEach(() => {
  cleanup();
  h.getDocs.mockReset().mockResolvedValue(attendanceDocs(TODAY_ATTENDANCE));
  h.collection.mockClear();
  h.query.mockClear();
  h.where.mockClear();
  h.idbGet.mockReset().mockResolvedValue(undefined);
  h.idbSet.mockReset().mockResolvedValue(undefined);
});

describe('<EvacuationDashboard /> — nómina real desde asistencia del día', () => {
  it('al iniciar emergencia real consulta la asistencia de HOY del proyecto y lista a los faltantes POR NOMBRE', async () => {
    render(<EvacuationDashboard />);

    fireEvent.click(await screen.findByTestId('evac-start-real'));

    await waitFor(() => expect(h.getDocs).toHaveBeenCalledTimes(1));
    expect(h.collection).toHaveBeenCalledWith(expect.anything(), 'projects/proj-1/attendance');

    // Faltantes nominales: Ana y Bruno marcaron ingreso y no han salido.
    const missing = await screen.findByTestId('evac-missing-list');
    expect(within(missing).getByText('Ana Soto')).toBeTruthy();
    expect(within(missing).getByText('Bruno Díaz')).toBeTruthy();
    // Carla salió antes → NO está en la nómina.
    expect(screen.queryByText('Carla Mena')).toBeNull();
    // Es emergencia real, no demo.
    expect(screen.queryByTestId('evac-demo-badge')).toBeNull();
  });

  it('marcar seguro a un faltante lo mueve a la lista de seguros', async () => {
    render(<EvacuationDashboard />);
    fireEvent.click(await screen.findByTestId('evac-start-drill'));

    const missing = await screen.findByTestId('evac-missing-list');
    fireEvent.click(
      within(missing).getByRole('button', { name: 'Marcar a Ana Soto como seguro' }),
    );

    const safe = await screen.findByTestId('evac-safe-list');
    expect(within(safe).getByText('Ana Soto')).toBeTruthy();
    // Bruno sigue faltando.
    expect(within(screen.getByTestId('evac-missing-list')).getByText('Bruno Díaz')).toBeTruthy();
    // El drill (con el scan) se persistió localmente.
    expect(h.idbSet).toHaveBeenCalled();
  });

  it('sin asistencia hoy → NO inventa nómina: ofrece el modo demo como fallback explícito', async () => {
    h.getDocs.mockResolvedValue(attendanceDocs([]));
    render(<EvacuationDashboard />);

    // El botón demo no está a la vista antes de intentar con datos reales.
    expect(screen.queryByTestId('evac-start-demo')).toBeNull();

    fireEvent.click(await screen.findByTestId('evac-start-drill'));

    expect(await screen.findByTestId('evac-no-attendance')).toBeTruthy();
    const demoBtn = screen.getByTestId('evac-start-demo');
    fireEvent.click(demoBtn);

    // Demo arranca con los 5 ficticios y queda rotulado como demo.
    const missing = await screen.findByTestId('evac-missing-list');
    expect(within(missing).getByText('Trabajador Demo 1')).toBeTruthy();
    expect(screen.getByTestId('evac-demo-badge')).toBeTruthy();
  });

  it('si la lectura de asistencia falla → error visible + fallback demo disponible', async () => {
    h.getDocs.mockRejectedValue(new Error('offline'));
    render(<EvacuationDashboard />);

    fireEvent.click(await screen.findByTestId('evac-start-real'));

    expect(await screen.findByTestId('evac-attendance-error')).toBeTruthy();
    expect(screen.getByTestId('evac-start-demo')).toBeTruthy();
  });
});
