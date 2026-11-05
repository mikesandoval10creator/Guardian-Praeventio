/** Binary envelope for the existing SQLCipher JSON rows; not a new plaintext store. */
export interface NativeBlobV1 {
  version: 1;
  encoding: 'base64';
  size: number;
  mime: string;
  base64: string;
  name?: string;
  lastModified?: number;
}
const MAX_BYTES = 50 * 1024 * 1024;
export async function encodeNativeBlob(blob: Blob): Promise<NativeBlobV1> {
  if (blob.size > MAX_BYTES) throw new Error('native_binary_size_limit');
  const buffer = typeof blob.arrayBuffer === 'function'
    ? await blob.arrayBuffer()
    : await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => reader.result instanceof ArrayBuffer ? resolve(reader.result) : reject(new Error('native_binary_read_failed'));
      reader.onerror = () => reject(new Error('native_binary_read_failed'));
      reader.readAsArrayBuffer(blob);
    });
  const bytes = new Uint8Array(buffer);
  let binary = '';
  // Avoid a stack-overflowing spread of a whole PDF into fromCharCode.
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return { version: 1, encoding: 'base64', size: bytes.length, mime: blob.type, base64: btoa(binary),
    ...(typeof File !== 'undefined' && blob instanceof File ? { name: blob.name, lastModified: blob.lastModified } : {}) };
}
export function decodeNativeBlob(value: unknown): Blob | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const data = value as Record<string, unknown>;
  if (data.version !== 1 || data.encoding !== 'base64' || !Number.isInteger(data.size) ||
      typeof data.size !== 'number' || data.size < 0 || data.size > MAX_BYTES ||
      typeof data.mime !== 'string' || data.mime.length > 255 || typeof data.base64 !== 'string' ||
      data.base64.length > Math.ceil(MAX_BYTES / 3) * 4 || data.base64.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(data.base64)) return undefined;
  try {
    const binary = atob(data.base64);
    if (binary.length !== data.size || btoa(binary) !== data.base64) return undefined;
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    if (typeof data.name === 'string' && data.name.length <= 1024 &&
        typeof data.lastModified === 'number' && Number.isFinite(data.lastModified)) {
      return new File([bytes], data.name, { type: data.mime, lastModified: data.lastModified });
    }
    return new Blob([bytes], { type: data.mime });
  } catch { return undefined; }
}
export function decodeNativeFile(value: unknown): File | undefined {
  const blob = decodeNativeBlob(value);
  return blob instanceof File ? blob : undefined;
}
