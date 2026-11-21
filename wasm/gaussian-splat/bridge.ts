type Validation =
  | { ok: true; count: number }
  | { ok: false; reason: 'invalid_length' | 'invalid_geometry' | 'input_limit' | 'engine_error' };

const MAX_INPUT = 4 * 1024 * 1024;

/** Create one validator per worker. The artifact must come from the trusted application build. */
export async function createSplatValidator(module: WebAssembly.Module) {
  if (WebAssembly.Module.imports(module).length !== 0) throw new TypeError('Unexpected imports');
  const { exports } = await WebAssembly.instantiate(module);
  const { memory, reserve, validate } = exports;
  if (!(memory instanceof WebAssembly.Memory) || typeof reserve !== 'function' || typeof validate !== 'function') {
    throw new TypeError('Incompatible splat validator ABI');
  }
  return (data: Uint8Array): Validation => {
    if (data.byteLength > MAX_INPUT) return { ok: false, reason: 'input_limit' };
    if (data.byteLength === 0 || data.byteLength % 32 !== 0) return { ok: false, reason: 'invalid_length' };
    try {
      const offset: number = reserve(data.byteLength);
      if (!Number.isInteger(offset) || offset <= 0) return { ok: false, reason: 'engine_error' };
      new Uint8Array(memory.buffer, offset, data.byteLength).set(data);
      const count: number = validate();
      if (count === -2) return { ok: false, reason: 'invalid_geometry' };
      if (count === data.byteLength / 32) return { ok: true, count };
    } catch {
      // A trap or stale memory view is not evidence that the file was validated.
    }
    return { ok: false, reason: 'engine_error' };
  };
}
