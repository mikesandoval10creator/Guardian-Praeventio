import React, { useEffect, useId, useRef, useState } from 'react';
import { z } from 'zod';
import { apiAuthHeader } from '../../lib/apiAuth';
import { humanErrorMessage } from '../../lib/humanError';

// Validate the HTTP boundary; never render arbitrary upstream URLs or HTML.
const resultSchema = z.object({
  method: z.literal('lexical'), scanLimited: z.boolean(),
  reason: z.enum(['invalid_query', 'no_match', 'store_unavailable']).optional(),
  matches: z.array(z.object({
    id: z.string().max(100), lawId: z.string().regex(/^\d{1,20}$/),
    title: z.string().max(1000), excerpt: z.string().max(1200),
    sourceStatus: z.literal('indexed-unverified'),
  })).max(5),
});
type Result = z.infer<typeof resultSchema>;
function validScope(id: string): boolean {
  return id.trim().length > 0 && id.length <= 200 && !id.includes('/') && id !== '.' && id !== '..';
}

/** Explicit opt-in experimental lookup; the page keys this by active project. */
export function NativeNormativeSearch({ projectId, online }: { projectId?: string; online: boolean }) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [tenant, setTenant] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [prepared, setPrepared] = useState('');
  const operation = useRef<AbortController | null>(null);
  const canQuery = query.trim().length >= 4 && query.length <= 2000;
  useEffect(() => () => { operation.current?.abort(); operation.current = null; }, []);
  useEffect(() => {
    if (!online) { operation.current?.abort(); operation.current = null; setBusy(false); setResult(null); setError(''); }
  }, [online]);

  function editQuery(value: string) {
    operation.current?.abort(); operation.current = null; setBusy(false); setQuery(value);
    setResult(null); setError(''); setPrepared('');
  }
  async function search(event: React.FormEvent) {
    event.preventDefault();
    if (!canQuery || !online || busy) return;
    const controller = new AbortController(); operation.current = controller;
    setResult(null); setError(''); setBusy(true);
    const timeout = setTimeout(() => {
      controller.abort();
      if (operation.current === controller) {
        setBusy(false);
        setError('La consulta tardó demasiado. Puedes intentarlo nuevamente.');
      }
    }, 20_000);
    try {
      const auth = await apiAuthHeader();
      if (controller.signal.aborted) return;
      if (!auth) throw new Error('Tu sesión no es válida. Vuelve a iniciar sesión para buscar extractos.');
      const response = await fetch('/api/normatives/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: auth },
        body: JSON.stringify({ query: query.trim() }), signal: controller.signal,
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(response.status === 429
        ? 'Alcanzaste el límite de consultas. Espera un minuto e inténtalo nuevamente.'
        : response.status === 401 ? 'Tu sesión expiró. Vuelve a iniciar sesión.'
        : 'No pudimos consultar el índice normativo. Inténtalo nuevamente; no se usó otro proveedor.');
      }
      const checked = resultSchema.safeParse(await response.json());
      if (!checked.success) throw new Error('No recibimos una respuesta normativa válida. Inténtalo nuevamente.');
      const parsed = checked.data;
      if (parsed.reason === 'store_unavailable' || parsed.reason === 'invalid_query') throw new Error('No pudimos consultar el índice normativo. Revisa la consulta e inténtalo nuevamente.');
      if (!controller.signal.aborted) setResult(parsed);
    } catch (err) {
      if (operation.current === controller && !controller.signal.aborted) setError(humanErrorMessage(err));
    } finally {
      clearTimeout(timeout);
      if (operation.current === controller) {
        setBusy(false);
        if (controller.signal.aborted) setError('La consulta se interrumpió o tardó demasiado. Puedes intentarlo nuevamente.');
      }
    }
  }
  function prepare() {
    if (!canQuery || !projectId || !validScope(projectId) || !validScope(tenant)) return;
    // A reviewable request only. The MCP operator/host must authorize the scope,
    // retrieve context and approve execution. Never infer tenant from project ID.
    setPrepared(JSON.stringify({ method: 'prompts/get', params: {
      name: 'guardian.queryBCN', arguments: { tenantId: tenant, projectId, input: JSON.stringify([query.trim()]) },
    } }, null, 2));
  }
  return <section aria-label="Consulta normativa sin proveedor obligatorio" className="mb-8 rounded-2xl border border-zinc-200 dark:border-white/10 bg-elevated p-5 space-y-3">
    <h2 className="text-lg font-bold text-primary-token">Buscar extractos normativos sin IA</h2>
    <p className="text-sm text-secondary-token">Búsqueda interna experimental, léxica y acotada. Sin LLM ni embeddings de consulta. No certifica cumplimiento ni sustituye revisión profesional.</p>
    <form onSubmit={search} className="space-y-2">
      <label htmlFor={`${id}-query`}>Consulta normativa interna</label>
      <input id={`${id}-query`} value={query} onChange={e => editQuery(e.target.value)} maxLength={2000} className="block w-full rounded border p-2 bg-surface text-primary-token" placeholder="Por ejemplo: DS 44 o ruido ocupacional" />
      <button type="submit" disabled={!canQuery || !online || busy} className="rounded bg-emerald-600 px-4 py-2 text-white disabled:opacity-50">{busy ? 'Buscando extractos…' : 'Buscar extractos sin IA'}</button>
    </form>
    {!online && <p role="status">La búsqueda interna necesita conexión. La biblioteca local sigue disponible.</p>}
    {error && <p role="alert">{humanErrorMessage(error)}</p>}
    {result && <div aria-live="polite" className="space-y-3">
      <p>Extractos indexados: procedencia y vigencia no verificadas. Los enlaces BCN se derivan del identificador, no acreditan validación de la fuente.</p>
      {result.scanLimited && <p>Se consideraron solo los primeros 200 candidatos del índice. No representa todo el corpus.</p>}
      {!result.matches.length && <p>No encontramos extractos para esta consulta. Esto no demuestra que la norma no exista. Prueba otros términos.</p>}
      {result.matches.map(match => <article key={match.id} className="rounded border p-3 space-y-2">
        <h3 className="font-bold">{match.title}</h3><code>{match.id}</code>
        <p className="whitespace-pre-wrap">{match.excerpt}</p>
        <a href={`https://www.bcn.cl/leychile/navegar?idNorma=${match.lawId}`} target="_blank" rel="noopener noreferrer">Consultar referencia BCN</a>
      </article>)}
    </div>}
    <details>
      <summary>Continuar con el modelo de tu cliente MCP</summary>
      <p>Preparación manual, no conexión ni inferencia desde el navegador. Requiere un cliente con MCP prompts y el servidor Guardian configurado por tu operador.</p>
      <p>Al ejecutar guardian.queryBCN, el cliente puede compartir registros del proyecto autorizado con tu modelo. Revisa la consulta y el contexto antes de aprobar. El servidor debe tener habilitado ese tenant/proyecto; escribir un ID aquí no concede acceso. No ingreses claves ni datos personales.</p>
      <label htmlFor={`${id}-tenant`}>Tenant autorizado en tu cliente MCP</label>
      <input id={`${id}-tenant`} value={tenant} maxLength={200} onChange={e => { setTenant(e.target.value); setPrepared(''); }} className="block w-full rounded border p-2 bg-surface text-primary-token" />
      {!projectId && <p>Selecciona un proyecto para preparar una solicitud MCP.</p>}
      <button type="button" onClick={prepare} disabled={!canQuery || !projectId || !validScope(projectId) || !validScope(tenant)} className="rounded border px-4 py-2 disabled:opacity-50">Preparar solicitud MCP</button>
      {prepared && <><p>Solicitud preparada, no ejecutada. Revisa y copia manualmente los argumentos en tu cliente; el formato de invocación depende del host.</p><textarea aria-label="Solicitud MCP preparada" readOnly value={prepared} rows={12} className="block w-full rounded border p-2 bg-surface text-primary-token" /></>}
    </details>
  </section>;
}
