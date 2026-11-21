const RECORD_BYTES = 32;
const MAX_RECORDS = (4 * 1024 * 1024) / RECORD_BYTES;
const SH_C0 = 0.28209479177387814;
// Conservative render envelope, not a claim about capture accuracy or units.
const MAX_MAGNITUDE = 1_000_000;
const NAMES = [
  'x', 'y', 'z', 'scale_0', 'scale_1', 'scale_2',
  'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity_linear',
  'rot_0', 'rot_1', 'rot_2', 'rot_3',
];

/** Convert bytes already accepted by the WASM validator into one GSplatData vertex element. */
export function toSplatVertexElement(bytes: ArrayBuffer, count: number) {
  if (!Number.isInteger(count) || count < 1 || count > MAX_RECORDS || bytes.byteLength !== count * RECORD_BYTES) {
    throw new RangeError('Inconsistent splat record count');
  }
  const view = new DataView(bytes);
  const properties = NAMES.map((name) => ({ name, type: 'float', byteSize: 4, storage: new Float32Array(count) }));
  for (let i = 0; i < count; i++) {
    const offset = i * RECORD_BYTES;
    for (let field = 0; field < 6; field++) {
      const value = view.getFloat32(offset + field * 4, true);
      if (!Number.isFinite(value) || Math.abs(value) > MAX_MAGNITUDE || (field >= 3 && value <= 0)) {
        throw new RangeError('Splat coordinate or scale outside render envelope');
      }
      properties[field].storage[i] = field < 3 ? value : Math.log(value);
    }
    for (let channel = 0; channel < 3; channel++) {
      properties[6 + channel].storage[i] = (view.getUint8(offset + 24 + channel) / 255 - 0.5) / SH_C0;
    }
    properties[9].storage[i] = view.getUint8(offset + 27) / 255;
    const w = view.getUint8(offset + 28) - 128;
    const x = view.getUint8(offset + 29) - 128;
    const y = view.getUint8(offset + 30) - 128;
    const z = view.getUint8(offset + 31) - 128;
    const length = Math.hypot(w, x, y, z);
    if (length === 0) throw new RangeError('Degenerate splat rotation');
    properties[10].storage[i] = w / length;
    properties[11].storage[i] = x / length;
    properties[12].storage[i] = y / length;
    properties[13].storage[i] = z / length;
  }
  return { name: 'vertex', count, properties };
}
