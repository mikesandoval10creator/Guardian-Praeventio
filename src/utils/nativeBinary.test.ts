// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { encodeNativeBlob, decodeNativeBlob, decodeNativeFile } from './nativeBinary';
function bytes(blob: Blob): Promise<Uint8Array> { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer)); reader.onerror = reject; reader.readAsArrayBuffer(blob); }); }
describe('native SQLCipher JSON binary envelope', () => {
  it('retains binary zeros and high bytes across JSON, MIME/name/date and multiple chunks', async () => {
    const input = Uint8Array.from({ length: 32769 }, (_value, index) => index % 256);
    const envelope = await encodeNativeBlob(new File([input], 'fixture.pdf', { type: 'application/pdf', lastModified: 42 }));
    const decoded = decodeNativeFile(JSON.parse(JSON.stringify(envelope)));
    expect(decoded).toBeInstanceOf(File); if (!decoded) throw new Error('decoded fixture missing');
    expect(decoded.name).toBe('fixture.pdf'); expect(decoded.type).toBe('application/pdf'); expect(decoded.lastModified).toBe(42);
    expect(await bytes(decoded)).toEqual(input);
  });
  it('restores a plain Bunker Blob without inventing a filename', async () => {
    const decoded = decodeNativeBlob(await encodeNativeBlob(new Blob(['%PDF-fixture'], { type: 'application/pdf' })));
    expect(decoded).toBeInstanceOf(Blob); expect(decoded).not.toBeInstanceOf(File);
  });
  it('fails before reading an oversized source rather than allocating it', async () => {
    const read = () => { throw new Error('must not read'); };
    await expect(encodeNativeBlob({ size: 50 * 1024 * 1024 + 1, arrayBuffer: read } as unknown as Blob)).rejects.toThrow('size_limit');
  });
  it.each([null, {}, { version: 2 }, { version: 1, encoding: 'base64', size: 1, mime: 'application/pdf', base64: '%%==' }, { version: 1, encoding: 'base64', size: 99, mime: 'application/pdf', base64: 'QQ==' }, { version: 1, encoding: 'base64', size: 1, mime: 'application/pdf', base64: 'QQ===' }])('does not fabricate bytes from a malformed or unsupported payload', (value) => { expect(decodeNativeBlob(value)).toBeUndefined(); expect(decodeNativeFile(value)).toBeUndefined(); });
});
