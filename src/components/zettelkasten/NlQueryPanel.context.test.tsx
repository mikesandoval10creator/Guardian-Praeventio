// @vitest-environment jsdom
//
// m31 — NlQueryPanel: aislamiento de contexto (proyecto / identidad / sesión).
//
// Contexto de la misión (M:/Guardian-Praeventio-audit/parallel-debt-20261105/
// m31-nlquery-mission.md): el panel mantiene results/citations/matches/error en
// estado local sin invalidación por proyecto/sesión, y aplica respuestas
// tardías tras `await` sin epoch/context guard.
//
// Estos tests son EVIDENCIA FRONTEND con dobles. La autorización reside en
// el servidor (`verifyAuth` y `assertProjectMember`); estos dobles no
// certifican el aislamiento real del backend.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const H = vi.hoisted(() => ({
  project: { current: null as { id: string; name: string } | null },
  auth: {
    current: {
      user: { uid: 'u-1' } as { uid: string } | null,
      isAuthReady: true,
    },
  },
  fetchMock: vi.fn(),
  loggerError: vi.fn(),
  // `apiAuthHeader` controlable: permite simular que las CREDENCIALES
  // tardan (identidad/proyecto cambian mientras se esperan).
  apiAuthHeader: vi.fn(),
}));

vi.mock('../../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: H.project.current }),
}));

vi.mock('../../contexts/FirebaseContext', () => ({
  useFirebase: () => H.auth.current,
}));

vi.mock('../../lib/apiAuth', () => ({
  apiAuthHeader: H.apiAuthHeader,
}));

vi.mock('../../utils/logger', () => ({
  logger: { error: H.loggerError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { NlQueryPanel } from './NlQueryPanel';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
};

const settled: Deferred<unknown>[] = [];

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const d = { promise, resolve, reject } as Deferred<T>;
  settled.push(d as unknown as Deferred<unknown>);
  return d;
}

function okJson(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  };
}

function errJson(status: number, body: unknown) {
  return {
    ok: false,
    status,
    json: async () => body,
  };
}

const NL_BODY = {
  results: [
    {
      incidentId: 'inc-A',
      projectId: 'p-A',
      summary: 'Caída en pasarela sin arnés',
      occurredAt: '2026-10-01',
    },
  ],
  citations: ['inc-A'],
};

const STRUCTURED_BODY = {
  pattern: '(:Control)-[:mitigates]->(:Riesgo)',
  count: 1,
  matches: [
    {
      from: { id: 'c-1', type: 'Control', title: 'Arnés', severity: 'critical' },
      to: { id: 'r-1', type: 'Riesgo', title: 'Caída', severity: 'critical' },
      via: 'mitigates',
      direction: 'outgoing' as const,
      edgeType: 'mitigates',
    },
  ],
};

/** Fetch que ignora el `signal` (transporte hostil: no aborta). */
function ignoringFetch(pending: Deferred<unknown>) {
  H.fetchMock.mockImplementation(() => pending.promise);
}

/** Fetch que respeta el `signal` (aborta como un fetch real). */
function abortableFetch(pending: Deferred<unknown>) {
  H.fetchMock.mockImplementation((_url: string, init: { signal: AbortSignal }) => {
    return new Promise((res, rej) => {
      init.signal.addEventListener('abort', () =>
        rej(new DOMException('Aborted', 'AbortError')),
      );
      pending.promise.then(res, rej);
    });
  });
}

/**
 * Fetch que RESUELVE la respuesta pero difiere el CUERPO JSON.
 * Permite simular que el cuerpo llega tarde (después de un cambio de
 * contexto). Devuelve el deferred para poder resolverlo a mano.
 */
function delayedBodyFetch(status: number, _body: unknown) {
  const bodyDeferred = deferred<unknown>();
  H.fetchMock.mockImplementation(async () => ({
    ok: status < 400,
    status,
    json: () => bodyDeferred.promise,
  }));
  return bodyDeferred;
}

/** `apiAuthHeader` que NO resuelve: la petición queda esperando credenciales. */
function pendingCredentials() {
  const creds = deferred<string | null>();
  H.apiAuthHeader.mockImplementation(() => creds.promise);
  return creds;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function setProject(p: { id: string; name: string } | null) {
  H.project.current = p;
}

beforeEach(() => {
  H.fetchMock.mockReset();
  H.loggerError.mockReset();
  H.apiAuthHeader.mockReset();
  H.apiAuthHeader.mockResolvedValue('Bearer test-token');
  vi.stubGlobal('fetch', H.fetchMock);
  setProject({ id: 'p-A', name: 'Proyecto A' });
  H.auth.current = { user: { uid: 'u-1' }, isAuthReady: true };
});

afterEach(async () => {
  // Sella las promesas diferidas pendientes: sin esto el detector de leaks
  // de Vitest (`detectAsyncLeaks: true`) marca la promesa no resuelta.
  while (settled.length > 0) {
    const d = settled.pop();
    try {
      d?.resolve(okJson({ results: [], citations: [], matches: [], count: 0 }));
    } catch {
      /* ya resuelta */
    }
  }
  await flush();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('<NlQueryPanel /> aislamiento de contexto', () => {
  it('cancels the deadline on unmount even when transport never settles', async () => {
    vi.useFakeTimers();
    const pending = deferred<unknown>();
    ignoringFetch(pending);
    const view = render(<NlQueryPanel />);
    fireEvent.change(screen.getByTestId('nl-query-input'), { target: { value: 'fixture' } });
    fireEvent.click(screen.getByTestId('nl-query-submit'));
    await flush();
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['semantic', 'structured'] as const)('clears the private %s draft at logout', async (mode) => {
    const view = render(<NlQueryPanel />);
    if (mode === 'structured') fireEvent.click(screen.getByTestId('nl-query-mode-structured'));
    const input = mode === 'semantic' ? 'nl-query-input' : 'structured-query-input';
    fireEvent.change(screen.getByTestId(input), { target: { value: 'private synthetic draft' } });
    H.auth.current = { user: null, isAuthReady: true };
    view.rerender(<NlQueryPanel />);
    expect(screen.getByTestId(input)).toHaveValue('');
  });
  it('muestra la etiqueta de contexto con datos reales del proyecto', async () => {
    render(<NlQueryPanel />);
    const label = screen.getByTestId('nl-query-context');
    expect(label).toHaveTextContent('Proyecto A');
    expect(label).toHaveTextContent('p-A');
    // No inventar membresías/roles.
    expect(label.textContent ?? '').not.toMatch(/miembro|membership|admin|rol:/i);
  });

  it('al cambiar de proyecto descarta los resultados del proyecto anterior', async () => {
    H.fetchMock.mockImplementation(async () => okJson(NL_BODY));
    const { rerender } = render(<NlQueryPanel />);
    fireEvent.change(screen.getByTestId('nl-query-input'), {
      target: { value: 'caídas de altura' },
    });
    fireEvent.click(screen.getByTestId('nl-query-submit'));
    await flush();
    expect(screen.getByTestId('nl-query-results')).toBeInTheDocument();

    setProject({ id: 'p-B', name: 'Proyecto B' });
    rerender(<NlQueryPanel />);
    await flush();

    expect(screen.queryAllByTestId('nl-query-results')).toHaveLength(0);
  });

  it('A -> B -> A no revive los resultados antiguos de A', async () => {
    H.fetchMock.mockImplementation(async () => okJson(NL_BODY));
    const { rerender } = render(<NlQueryPanel />);
    fireEvent.change(screen.getByTestId('nl-query-input'), {
      target: { value: 'caídas de altura' },
    });
    fireEvent.click(screen.getByTestId('nl-query-submit'));
    await flush();
    expect(screen.getByTestId('nl-query-results')).toBeInTheDocument();

    setProject({ id: 'p-B', name: 'Proyecto B' });
    rerender(<NlQueryPanel />);
    await flush();
    expect(screen.queryAllByTestId('nl-query-results')).toHaveLength(0);

    setProject({ id: 'p-A', name: 'Proyecto A' });
    rerender(<NlQueryPanel />);
    await flush();
    expect(screen.queryAllByTestId('nl-query-results')).toHaveLength(0);
  });

  it('ignora una respuesta tardía del proyecto anterior (A -> B)', async () => {
    const pending = deferred<unknown>();
    ignoringFetch(pending);
    const { rerender } = render(<NlQueryPanel />);
    fireEvent.change(screen.getByTestId('nl-query-input'), {
      target: { value: 'caídas de altura' },
    });
    fireEvent.click(screen.getByTestId('nl-query-submit'));
    await flush();

    setProject({ id: 'p-B', name: 'Proyecto B' });
    rerender(<NlQueryPanel />);
    await flush();

    pending.resolve(okJson(NL_BODY));
    await flush();

    expect(screen.queryAllByTestId('nl-query-results')).toHaveLength(0);
  });

  it('ignora una respuesta tardía aunque el transporte ignore el abort', async () => {
    const pending = deferred<unknown>();
    ignoringFetch(pending);
    const { rerender } = render(<NlQueryPanel />);
    fireEvent.change(screen.getByTestId('nl-query-input'), {
      target: { value: 'caídas de altura' },
    });
    fireEvent.click(screen.getByTestId('nl-query-submit'));
    await flush();

    // Cambio de identidad: el mismo fetch sigue "vivo" en el transporte.
    H.auth.current = { user: { uid: 'u-2' }, isAuthReady: true };
    rerender(<NlQueryPanel />);
    await flush();

    pending.resolve(okJson(NL_BODY));
    await flush();

    expect(screen.queryAllByTestId('nl-query-results')).toHaveLength(0);
  });

  it('descarta los resultados cuando cambia la identidad', async () => {
    H.fetchMock.mockImplementation(async () => okJson(NL_BODY));
    const { rerender } = render(<NlQueryPanel />);
    fireEvent.change(screen.getByTestId('nl-query-input'), {
      target: { value: 'caídas de altura' },
    });
    fireEvent.click(screen.getByTestId('nl-query-submit'));
    await flush();
    expect(screen.getByTestId('nl-query-results')).toBeInTheDocument();

    H.auth.current = { user: { uid: 'u-2' }, isAuthReady: true };
    rerender(<NlQueryPanel />);
    await flush();

    expect(screen.queryAllByTestId('nl-query-results')).toHaveLength(0);
  });

  it('oculta el proyecto anterior y bloquea consultas durante el cambio de identidad', async () => {
    H.fetchMock.mockImplementation(async () => okJson(NL_BODY));
    const { rerender } = render(<NlQueryPanel />);
    expect(screen.getByTestId('nl-query-context')).toHaveTextContent('p-A');

    // Firebase puede conservar isAuthReady=true durante el cambio de cuenta;
    // ProjectContext aún conserva la selección anterior hasta el nuevo snapshot.
    H.auth.current = { user: { uid: 'u-2' }, isAuthReady: true };
    rerender(<NlQueryPanel />);
    await flush();
    expect(screen.getByTestId('nl-query-context')).not.toHaveTextContent('p-A');
    expect(screen.getByTestId('nl-query-context')).toHaveTextContent('Actualizando contexto');

    fireEvent.change(screen.getByTestId('nl-query-input'), {
      target: { value: 'consulta del usuario nuevo' },
    });
    fireEvent.click(screen.getByTestId('nl-query-submit'));
    await flush();
    expect(H.fetchMock).not.toHaveBeenCalled();

    // ProjectContext confirma el nuevo usuario al publicar su selección actual.
    setProject({ id: 'p-B', name: 'Proyecto B' });
    rerender(<NlQueryPanel />);
    await flush();
    expect(screen.getByTestId('nl-query-context')).toHaveTextContent('p-B');
    fireEvent.change(screen.getByTestId('nl-query-input'), {
      target: { value: 'consulta del usuario nuevo' },
    });
    fireEvent.click(screen.getByTestId('nl-query-submit'));
    await flush();
    expect(H.fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = H.fetchMock.mock.calls[0] as [string, { body: string }];
    expect(JSON.parse(init.body).projectId).toBe('p-B');
  });

  it('logout (user -> null) descarta los resultados y no consulta sin identidad', async () => {
    H.fetchMock.mockImplementation(async () => okJson(NL_BODY));
    const { rerender } = render(<NlQueryPanel />);
    fireEvent.change(screen.getByTestId('nl-query-input'), {
      target: { value: 'caídas de altura' },
    });
    fireEvent.click(screen.getByTestId('nl-query-submit'));
    await flush();
    expect(screen.getByTestId('nl-query-results')).toBeInTheDocument();

    H.auth.current = { user: null, isAuthReady: true };
    rerender(<NlQueryPanel />);
    await flush();
    expect(screen.queryAllByTestId('nl-query-results')).toHaveLength(0);

    H.fetchMock.mockClear();
    fireEvent.click(screen.getByTestId('nl-query-submit'));
    await flush();
    expect(H.fetchMock).not.toHaveBeenCalled();
  });

  it('modo estructurado: el cambio de proyecto descarta los matches', async () => {
    H.fetchMock.mockImplementation(async () => okJson(STRUCTURED_BODY));
    const { rerender } = render(<NlQueryPanel />);
    fireEvent.click(screen.getByTestId('nl-query-mode-structured'));
    fireEvent.change(screen.getByTestId('structured-query-input'), {
      target: { value: '(:Control)-[:mitigates]->(:Riesgo)' },
    });
    fireEvent.click(screen.getByTestId('structured-query-submit'));
    await flush();
    expect(screen.getByTestId('structured-query-results')).toBeInTheDocument();

    setProject({ id: 'p-B', name: 'Proyecto B' });
    rerender(<NlQueryPanel />);
    await flush();

    expect(screen.queryAllByTestId('structured-query-results')).toHaveLength(0);
  });

  it('modo estructurado: Enter no abre una segunda petición mientras carga', async () => {
    const pending = deferred<unknown>();
    ignoringFetch(pending);
    render(<NlQueryPanel />);
    fireEvent.click(screen.getByTestId('nl-query-mode-structured'));
    fireEvent.change(screen.getByTestId('structured-query-input'), {
      target: { value: '(:Control)-[:mitigates]->(:Riesgo)' },
    });
    fireEvent.click(screen.getByTestId('structured-query-submit'));
    await flush();
    expect(H.fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(screen.getByTestId('structured-query-input'), { key: 'Enter' });
    await flush();

    expect(H.fetchMock).toHaveBeenCalledTimes(1);
  });

  it('en competencia: la respuesta tardía de A no pisa el éxito válido de B', async () => {
    const a = deferred<unknown>();
    const b = deferred<unknown>();
    let call = 0;
    H.fetchMock.mockImplementation(() => {
      call += 1;
      return call === 1 ? a.promise : b.promise;
    });

    const { rerender } = render(<NlQueryPanel />);
    fireEvent.change(screen.getByTestId('nl-query-input'), {
      target: { value: 'caídas de altura' },
    });
    fireEvent.click(screen.getByTestId('nl-query-submit'));
    await flush();

    setProject({ id: 'p-B', name: 'Proyecto B' });
    rerender(<NlQueryPanel />);
    await flush();
    fireEvent.click(screen.getByTestId('nl-query-submit'));
    await flush();

    b.resolve(okJson({ results: [{ ...NL_BODY.results[0], incidentId: 'inc-B' }], citations: ['inc-B'] }));
    await flush();
    expect(screen.getByTestId('nl-query-results')).toHaveTextContent('inc-B');

    a.resolve(okJson(NL_BODY));
    await flush();
    expect(screen.getByTestId('nl-query-results')).toHaveTextContent('inc-B');
    expect(screen.getByTestId('nl-query-results')).not.toHaveTextContent('inc-A');
  });

  it('403: muestra un mensaje accionable y libera el spinner', async () => {
    H.fetchMock.mockImplementation(async () => errJson(403, { error: 'forbidden' }));
    render(<NlQueryPanel />);
    fireEvent.change(screen.getByTestId('nl-query-input'), {
      target: { value: 'caídas de altura' },
    });
    fireEvent.click(screen.getByTestId('nl-query-submit'));
    await flush();

    expect(screen.getByText(/permiso/i)).toBeInTheDocument();
    expect(screen.getByTestId('nl-query-submit')).not.toHaveTextContent('Buscando');
  });

  it('timeout: informa la espera y libera el spinner', async () => {
    vi.useFakeTimers();
    const pending = deferred<unknown>();
    H.fetchMock.mockImplementation((_url: string, init: { signal: AbortSignal }) => {
      return new Promise((_res, rej) => {
        init.signal.addEventListener('abort', () =>
          rej(new DOMException('Aborted', 'AbortError')),
        );
        pending.promise.then((v) => _res(v), (e) => rej(e));
      });
    });
    render(<NlQueryPanel />);
    fireEvent.change(screen.getByTestId('nl-query-input'), {
      target: { value: 'caídas de altura' },
    });
    fireEvent.click(screen.getByTestId('nl-query-submit'));
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
    });

    expect(screen.getByText(/tardó demasiado|tDemasiado/i)).toBeInTheDocument();
    expect(screen.getByTestId('nl-query-submit')).not.toHaveTextContent('Buscando');
  });

  it('unmount: aborta la petición en vuelo y no actualiza estado', async () => {
    const pending = deferred<unknown>();
    const captured: { signal?: AbortSignal } = {};
    H.fetchMock.mockImplementation((_url: string, init: { signal: AbortSignal }) => {
      captured.signal = init.signal;
      return pending.promise;
    });
    const { unmount } = render(<NlQueryPanel />);
    fireEvent.change(screen.getByTestId('nl-query-input'), {
      target: { value: 'caídas de altura' },
    });
    fireEvent.click(screen.getByTestId('nl-query-submit'));
    await flush();

    expect(captured.signal).toBeDefined();
    unmount();
    expect(captured.signal?.aborted).toBe(true);

    pending.resolve(okJson(NL_BODY));
    await flush();
    // Sin estado post-unmount: el DOM ya no tiene el panel.
    expect(screen.queryAllByTestId('nl-query-results')).toHaveLength(0);
  });

  it('preserva el éxito válido: un error posterior no borra el resultado mostrado', async () => {
    H.fetchMock
      .mockImplementationOnce(async () => okJson(NL_BODY))
      .mockImplementationOnce(async () => errJson(403, { error: 'forbidden' }));
    render(<NlQueryPanel />);
    fireEvent.change(screen.getByTestId('nl-query-input'), {
      target: { value: 'caídas de altura' },
    });
    fireEvent.click(screen.getByTestId('nl-query-submit'));
    await flush();
    expect(screen.getByTestId('nl-query-results')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('nl-query-submit'));
    await flush();

    expect(screen.getByTestId('nl-query-results')).toBeInTheDocument();
    expect(screen.getByText(/permiso/i)).toBeInTheDocument();
  });
});

// ── m31 (slice final) — regresiones de contexto durante la fase de CREDENCIALES,
// del CUERPO tardío y del ABORT en ambos modos ────────────────────────────────

describe('<NlQueryPanel /> regresiones de identidad/proyecto en vuelo', () => {
  it('modo estructurado: cambiar la identidad mientras se esperan credenciales no emite la consulta', async () => {
    const creds = pendingCredentials();
    const { rerender } = render(<NlQueryPanel />);
    fireEvent.click(screen.getByTestId('nl-query-mode-structured'));
    fireEvent.change(screen.getByTestId('structured-query-input'), {
      target: { value: '(:Control)-[:mitigates]->(:Riesgo)' },
    });
    fireEvent.click(screen.getByTestId('structured-query-submit'));
    await flush();
    // Todavía esperando credenciales: no se ha issued ninguna petición.
    expect(H.fetchMock).not.toHaveBeenCalled();

    // La identidad cambia MIENTRAS se esperan las credenciales.
    H.auth.current = { user: { uid: 'u-2' }, isAuthReady: true };
    rerender(<NlQueryPanel />);
    await flush();

    // Las credenciales llegan tarde: la petición de la identidad anterior
    // no debe salir a la red con el contexto viejo.
    creds.resolve('Bearer test-token');
    await flush();

    expect(H.fetchMock).not.toHaveBeenCalled();
    expect(screen.queryAllByTestId('structured-query-results')).toHaveLength(0);
  });

  it('modo estructurado: cambiar el proyecto mientras se esperan credenciales no emite la consulta', async () => {
    const creds = pendingCredentials();
    const { rerender } = render(<NlQueryPanel />);
    fireEvent.click(screen.getByTestId('nl-query-mode-structured'));
    fireEvent.change(screen.getByTestId('structured-query-input'), {
      target: { value: '(:Control)-[:mitigates]->(:Riesgo)' },
    });
    fireEvent.click(screen.getByTestId('structured-query-submit'));
    await flush();
    expect(H.fetchMock).not.toHaveBeenCalled();

    setProject({ id: 'p-B', name: 'Proyecto B' });
    rerender(<NlQueryPanel />);
    await flush();

    creds.resolve('Bearer test-token');
    await flush();

    expect(H.fetchMock).not.toHaveBeenCalled();
    expect(screen.queryAllByTestId('structured-query-results')).toHaveLength(0);
  });

  it.each(['semantic', 'structured'] as const)(
    'modo %s: un cuerpo JSON tardío tras cambiar de proyecto no se aplica',
    async (mode) => {
      const body = delayedBodyFetch(200, mode === 'semantic' ? NL_BODY : STRUCTURED_BODY);
      const { rerender } = render(<NlQueryPanel />);
      if (mode === 'structured') fireEvent.click(screen.getByTestId('nl-query-mode-structured'));
      const input = mode === 'semantic' ? 'nl-query-input' : 'structured-query-input';
      const submit = mode === 'semantic' ? 'nl-query-submit' : 'structured-query-submit';
      fireEvent.change(screen.getByTestId(input), { target: { value: 'consulta' } });
      fireEvent.click(screen.getByTestId(submit));
      await flush();
      // La respuesta llegó, pero el cuerpo todavía no.
      expect(H.fetchMock).toHaveBeenCalledTimes(1);

      setProject({ id: 'p-B', name: 'Proyecto B' });
      rerender(<NlQueryPanel />);
      await flush();

      body.resolve(mode === 'semantic' ? NL_BODY : STRUCTURED_BODY);
      await flush();

      expect(screen.queryAllByTestId('nl-query-results')).toHaveLength(0);
      expect(screen.queryAllByTestId('structured-query-results')).toHaveLength(0);
    },
  );

  it.each(['semantic', 'structured'] as const)(
    'modo %s: un cuerpo de ERROR tardío tras cambiar de identidad no se muestra',
    async (mode) => {
      const body = delayedBodyFetch(403, { error: 'forbidden' });
      const { rerender } = render(<NlQueryPanel />);
      if (mode === 'structured') fireEvent.click(screen.getByTestId('nl-query-mode-structured'));
      const input = mode === 'semantic' ? 'nl-query-input' : 'structured-query-input';
      const submit = mode === 'semantic' ? 'nl-query-submit' : 'structured-query-submit';
      fireEvent.change(screen.getByTestId(input), { target: { value: 'consulta' } });
      fireEvent.click(screen.getByTestId(submit));
      await flush();
      expect(H.fetchMock).toHaveBeenCalledTimes(1);

      H.auth.current = { user: { uid: 'u-2' }, isAuthReady: true };
      rerender(<NlQueryPanel />);
      await flush();

      body.resolve({ error: 'forbidden' });
      await flush();

      expect(screen.queryByText(/permiso/i)).not.toBeInTheDocument();
      expect(H.loggerError).not.toHaveBeenCalled();
    },
  );

  it.each(['semantic', 'structured'] as const)(
    'modo %s: un AbortError del transporte no se muestra como error tras cambiar de identidad',
    async (mode) => {
      const pending = deferred<unknown>();
      abortableFetch(pending);
      const { rerender } = render(<NlQueryPanel />);
      if (mode === 'structured') fireEvent.click(screen.getByTestId('nl-query-mode-structured'));
      const input = mode === 'semantic' ? 'nl-query-input' : 'structured-query-input';
      const submit = mode === 'semantic' ? 'nl-query-submit' : 'structured-query-submit';
      fireEvent.change(screen.getByTestId(input), { target: { value: 'consulta' } });
      fireEvent.click(screen.getByTestId(submit));
      await flush();

      H.auth.current = { user: { uid: 'u-2' }, isAuthReady: true };
      rerender(<NlQueryPanel />);
      await flush();

      expect(screen.queryByText(/abort/i)).not.toBeInTheDocument();
      expect(H.loggerError).not.toHaveBeenCalled();
    },
  );

  it.each(['semantic', 'structured'] as const)(
    'modo %s: cambiar la identidad aborta la señal de la petición en vuelo',
    async (mode) => {
      const pending = deferred<unknown>();
      const captured: { signal?: AbortSignal } = {};
      H.fetchMock.mockImplementation((_url: string, init: { signal: AbortSignal }) => {
        captured.signal = init.signal;
        return pending.promise;
      });
      const { rerender } = render(<NlQueryPanel />);
      if (mode === 'structured') fireEvent.click(screen.getByTestId('nl-query-mode-structured'));
      const input = mode === 'semantic' ? 'nl-query-input' : 'structured-query-input';
      const submit = mode === 'semantic' ? 'nl-query-submit' : 'structured-query-submit';
      fireEvent.change(screen.getByTestId(input), { target: { value: 'consulta' } });
      fireEvent.click(screen.getByTestId(submit));
      await flush();
      expect(captured.signal).toBeDefined();
      expect(captured.signal?.aborted).toBe(false);

      H.auth.current = { user: { uid: 'u-2' }, isAuthReady: true };
      rerender(<NlQueryPanel />);
      await flush();

      expect(captured.signal?.aborted).toBe(true);
    },
  );

  it('modo estructurado: el unmount aborta la señal y cancela el deadline', async () => {
    vi.useFakeTimers();
    const pending = deferred<unknown>();
    const captured: { signal?: AbortSignal } = {};
    H.fetchMock.mockImplementation((_url: string, init: { signal: AbortSignal }) => {
      captured.signal = init.signal;
      return pending.promise;
    });
    const view = render(<NlQueryPanel />);
    fireEvent.click(screen.getByTestId('nl-query-mode-structured'));
    fireEvent.change(screen.getByTestId('structured-query-input'), {
      target: { value: '(:Control)-[:mitigates]->(:Riesgo)' },
    });
    fireEvent.click(screen.getByTestId('structured-query-submit'));
    await flush();
    expect(captured.signal?.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(1);

    view.unmount();
    expect(captured.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});

// ── m31 (slice final) — privacidad del rótulo de contexto ───────────────────

describe('<NlQueryPanel /> privacidad del contexto', () => {
  it.each(['semantic', 'structured'] as const)('fails closed when readiness is absent in %s mode', async (mode) => {
    Reflect.deleteProperty(H.auth.current, 'isAuthReady');
    render(<NlQueryPanel />);
    if (mode === 'structured') fireEvent.click(screen.getByTestId('nl-query-mode-structured'));
    fireEvent.change(screen.getByTestId(mode === 'semantic' ? 'nl-query-input' : 'structured-query-input'), { target: { value: 'consulta' } });
    fireEvent.click(screen.getByTestId(mode === 'semantic' ? 'nl-query-submit' : 'structured-query-submit'));
    await flush();
    expect(H.fetchMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('nl-query-context')).not.toHaveTextContent('p-A');
  });
  it('con identidad: el rótulo muestra el nombre y el id del proyecto', async () => {
    render(<NlQueryPanel />);
    const label = screen.getByTestId('nl-query-context');
    expect(label).toHaveTextContent('Proyecto A');
    expect(label).toHaveTextContent('p-A');
  });

  it('logout: el rótulo deja de exponer el nombre y el id del proyecto privado', async () => {
    const { rerender } = render(<NlQueryPanel />);
    expect(screen.getByTestId('nl-query-context')).toHaveTextContent('p-A');

    H.auth.current = { user: null, isAuthReady: true };
    rerender(<NlQueryPanel />);
    await flush();

    const label = screen.getByTestId('nl-query-context');
    expect(label.textContent ?? '').not.toContain('p-A');
    expect(label.textContent ?? '').not.toContain('Proyecto A');
  });

  it('logout: no quedan resultados ni coincidencias del contexto anterior', async () => {
    H.fetchMock.mockImplementation(async () => okJson(STRUCTURED_BODY));
    const { rerender } = render(<NlQueryPanel />);
    fireEvent.click(screen.getByTestId('nl-query-mode-structured'));
    fireEvent.change(screen.getByTestId('structured-query-input'), {
      target: { value: '(:Control)-[:mitigates]->(:Riesgo)' },
    });
    fireEvent.click(screen.getByTestId('structured-query-submit'));
    await flush();
    expect(screen.getByTestId('structured-query-results')).toBeInTheDocument();

    H.auth.current = { user: null, isAuthReady: true };
    rerender(<NlQueryPanel />);
    await flush();

    expect(screen.queryAllByTestId('structured-query-results')).toHaveLength(0);
    expect(screen.queryAllByTestId('nl-query-results')).toHaveLength(0);
  });
});
