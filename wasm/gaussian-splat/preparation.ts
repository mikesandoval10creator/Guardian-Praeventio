import { toSplatVertexElement } from './renderData.ts';
import { validateSplatInWorker } from './workerClient.ts';

type WorkerOptions = Parameters<typeof validateSplatInWorker>[2];
type Preparation =
  | { ok: true; element: ReturnType<typeof toSplatVertexElement> }
  | Extract<Awaited<ReturnType<typeof validateSplatInWorker>>, { ok: false }>
  | { ok: false; reason: 'outside_render_envelope' };

/** Prepare already-authorized bytes, transferring their ownership to the worker.
 * This function neither loads the trusted module nor authorizes or fetches captures.
 */
export async function prepareSplatForRendering(
  module: WebAssembly.Module,
  bytes: ArrayBuffer,
  options?: WorkerOptions,
): Promise<Preparation> {
  const result = await validateSplatInWorker(module, bytes, options);
  if (options?.signal?.aborted) return { ok: false, reason: 'cancelled' };
  if (!result.ok) return result;
  try {
    return { ok: true, element: toSplatVertexElement(result.bytes, result.count) };
  } catch (error) {
    if (error instanceof RangeError) return { ok: false, reason: 'outside_render_envelope' };
    throw error;
  }
}
