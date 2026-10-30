// @vitest-environment jsdom
import React from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const H = vi.hoisted(() => ({ legacy: vi.fn(), auth: vi.fn(), online: true, project: { id: 'project-1', industry: 'Minería' } as { id: string; industry: string } | null }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../contexts/ProjectContext', () => ({ useProject: () => ({ selectedProject: H.project }) }));
vi.mock('../hooks/useFirestoreCollection', () => ({ useFirestoreCollection: () => ({ data: [], loading: false }) }));
vi.mock('../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => H.online }));
vi.mock('../hooks/useToast', () => ({ useToast: () => ({ toasts: [], show: vi.fn(), dismiss: vi.fn() }) }));
vi.mock('../components/shared/ToastContainer', () => ({ ToastContainer: () => null }));
vi.mock('../components/regulatory/Iso45001Catalog', () => ({ Iso45001Catalog: () => null }));
vi.mock('idb-keyval', () => ({ get: vi.fn(async () => []), set: vi.fn() }));
vi.mock('../services/geminiService', () => ({ suggestNormativesWithAI: H.legacy, downloadSpecificNormative: vi.fn() }));
vi.mock('../lib/apiAuth', () => ({ apiAuthHeader: H.auth }));
import { Normatives } from './Normatives';
const hit = { id: 'law-1234-chunk-0', lawId: '1234', title: 'DS 44', excerpt: 'Extracto de prueba: prevención de riesgos.', sourceUrl: 'https://www.bcn.cl/leychile/navegar?idNorma=1234', matchedTerms: ['44'], sourceStatus: 'indexed-unverified' };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  H.project = { id: 'project-1', industry: 'Minería' }; H.online = true; H.legacy.mockReset(); H.legacy.mockResolvedValue([]); H.auth.mockReset(); H.auth.mockResolvedValue('Bearer test');
  fetchMock = vi.fn(async () => response({ method: 'lexical', matches: [hit], scanLimited: true })); vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function query(value = 'DS 44') { fireEvent.change(screen.getByLabelText('Consulta normativa interna'), { target: { value } }); }
function submit() { fireEvent.click(screen.getByRole('button', { name: 'Buscar extractos sin IA' })); }
describe('Normatives native search and explicit MCP handoff', () => {
  it('does not call Google or search on mount; performs explicit authenticated native search', async () => {
    render(<Normatives />); expect(H.legacy).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
    query(); submit();
    await screen.findByText(hit.excerpt);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/normatives/search', expect.objectContaining({ method: 'POST', body: JSON.stringify({ query: 'DS 44' }), headers: expect.objectContaining({ Authorization: 'Bearer test' }) }));
    expect(H.legacy).not.toHaveBeenCalled(); expect(screen.getByText(hit.id)).toBeTruthy();
    expect(screen.getByText(/procedencia y vigencia no verificadas/i)).toBeTruthy(); expect(screen.getByText(/primeros 200/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Consultar referencia BCN/i }).getAttribute('href')).toBe(hit.sourceUrl);
  });
  it('keeps legacy suggestions explicit, not automatic', async () => {
    render(<Normatives />); fireEvent.click(screen.getByRole('button', { name: /Solicitar sugerencias IA heredada/i }));
    await waitFor(() => expect(H.legacy).toHaveBeenCalledExactlyOnceWith('Minería'));
  });
  it('reports empty evidence without a generated answer', async () => {
    fetchMock.mockResolvedValue(response({ method: 'lexical', matches: [], scanLimited: false, reason: 'no_match' }));
    render(<Normatives />); query(); submit(); await screen.findByText(/No encontramos extractos/i); expect(H.legacy).not.toHaveBeenCalled();
  });
  it('keeps offline search disabled without a fallback request', () => {
    H.online = false; render(<Normatives />); query();
    expect((screen.getByRole('button', { name: 'Buscar extractos sin IA' }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled(); expect(H.legacy).not.toHaveBeenCalled();
  });
  it('does not prepare MCP without a selected project or with malformed tenant scope', () => {
    H.project = null; const view = render(<Normatives />); query();
    fireEvent.change(screen.getByLabelText('Tenant autorizado en tu cliente MCP'), { target: { value: 'tenant-01' } });
    expect((screen.getByRole('button', { name: 'Preparar solicitud MCP' }) as HTMLButtonElement).disabled).toBe(true);
    H.project = { id: 'project-1', industry: 'Minería' }; view.rerender(<Normatives />); query();
    fireEvent.change(screen.getByLabelText('Tenant autorizado en tu cliente MCP'), { target: { value: 'tenant/foreign' } });
    expect((screen.getByRole('button', { name: 'Preparar solicitud MCP' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('ignores late legacy suggestions after switching project', async () => {
    let resolve!: (rows: unknown[]) => void;
    H.legacy.mockReturnValue(new Promise<unknown[]>(r => { resolve = r; }));
    const view = render(<Normatives />);
    fireEvent.click(screen.getByRole('button', { name: /Solicitar sugerencias IA heredada/i }));
    H.project = { id: 'project-2', industry: 'Construcción' }; view.rerender(<Normatives />);
    resolve([{ title: 'Stale mining suggestion', description: 'Old project' }]);
    await new Promise(r => setTimeout(r, 0));
    expect(screen.queryByText('Stale mining suggestion')).toBeNull();
  });
  it('reports store error without echoing upstream errors or falling back', async () => {
    fetchMock.mockResolvedValue(response({ error: 'private-token-details' }, 503));
    render(<Normatives />); query(); submit(); await screen.findByRole('alert');
    expect(screen.getByRole('alert').textContent).not.toContain('private-token'); expect(H.legacy).not.toHaveBeenCalled();
  });
  it('does not send an unauthenticated query', async () => {
    H.auth.mockResolvedValue(null); render(<Normatives />); query(); submit(); await screen.findByRole('alert'); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('clears old results when editing the query', async () => {
    render(<Normatives />); query(); submit(); await screen.findByText(hit.excerpt); query('ruido ocupacional'); expect(screen.queryByText(hit.excerpt)).toBeNull();
  });
  it('discards a late result after the active project changes', async () => {
    let resolve!: (res: Response) => void; fetchMock.mockReturnValue(new Promise<Response>(r => { resolve = r; }));
    const view = render(<Normatives />); query(); submit(); await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    H.project = { id: 'project-2', industry: 'Construcción' }; view.rerender(<Normatives />);
    resolve(response({ method: 'lexical', matches: [hit], scanLimited: false }));
    await waitFor(() => expect((screen.getByLabelText('Consulta normativa interna') as HTMLInputElement).value).toBe(''));
    expect(screen.queryByText(hit.excerpt)).toBeNull(); expect(H.legacy).not.toHaveBeenCalled();
  });
  it('does not display a response that settles after the query was edited', async () => {
    let resolve!: (res: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>(r => { resolve = r; }));
    render(<Normatives />); query(); submit(); await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    query('ruido ocupacional'); resolve(response({ method: 'lexical', matches: [hit], scanLimited: false }));
    await new Promise(r => setTimeout(r, 0));
    expect(screen.queryByText(hit.excerpt)).toBeNull(); expect(screen.queryByRole('alert')).toBeNull();
  });
  it('does not expose validation internals for malformed responses', async () => {
    fetchMock.mockResolvedValue(response({ method: 'lexical', matches: [{ secret: 'private-raw-data' }], scanLimited: false }));
    render(<Normatives />); query(); submit();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/respuesta normativa válida/i); expect(alert.textContent).not.toMatch(/invalid_type|expected|private-raw-data/);
  });
  it('ends the busy state when authentication stalls past the deadline', async () => {
    vi.useFakeTimers();
    let resolveAuth!: (value: string) => void;
    H.auth.mockReturnValue(new Promise<string>(r => { resolveAuth = r; }));
    try {
      render(<Normatives />); query(); submit();
      await vi.advanceTimersByTimeAsync(20_001);
      expect(screen.getByRole('alert').textContent).toMatch(/tardó demasiado/i);
      expect((screen.getByRole('button', { name: 'Buscar extractos sin IA' }) as HTMLButtonElement).disabled).toBe(false);
      resolveAuth('Bearer test'); await vi.advanceTimersByTimeAsync(0); expect(fetchMock).not.toHaveBeenCalled();
    } finally { resolveAuth('Bearer test'); vi.useRealTimers(); }
  });
  it('prepares reviewable prompts/get with literal IDs, no fetch or clipboard side effect', () => {
    const clipboard = vi.fn(); Object.defineProperty(navigator, 'clipboard', { value: { writeText: clipboard }, configurable: true });
    render(<Normatives />); query('ruido ocupacional');
    fireEvent.change(screen.getByLabelText('Tenant autorizado en tu cliente MCP'), { target: { value: 'tenant-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preparar solicitud MCP' }));
    const payload = JSON.parse((screen.getByLabelText('Solicitud MCP preparada') as HTMLTextAreaElement).value);
    expect(payload).toEqual({ method: 'prompts/get', params: { name: 'guardian.queryBCN', arguments: { tenantId: 'tenant-01', projectId: 'project-1', input: '["ruido ocupacional"]' } } });
    expect(fetchMock).not.toHaveBeenCalled(); expect(clipboard).not.toHaveBeenCalled(); expect(screen.getByText(/puede compartir registros/i)).toBeTruthy();
    query('otra consulta'); expect(screen.queryByLabelText('Solicitud MCP preparada')).toBeNull();
  });
});
