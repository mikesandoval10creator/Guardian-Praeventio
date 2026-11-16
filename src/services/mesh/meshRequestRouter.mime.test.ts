import { describe, expect, it, vi } from 'vitest';
import { MeshRequestRouter } from './meshRequestRouter';
import { MeshRelayQueue } from './meshRelayQueue';
import { computeContentHash } from './fileChunker';
import type { FileChunkPayload, FileRequestPayload } from './meshPacket';
import { signPacket, verifyPacket } from './meshPacketSigner';

function peer(uid: string, local: { blob: Blob; contentHash: string } | null = null) {
  const now = () => 10000;
  const queue = new MeshRelayQueue({ selfUid: uid, projectId: 'project-a', now });
  const complete = vi.fn();
  const router = new MeshRequestRouter({ selfUid: uid, projectId: 'project-a', queue, now,
    localFileLookup: async () => local, onFileComplete: complete, chunkSize: 8 });
  return { router, queue, complete };
}

async function transfer(mimeType = 'application/pdf', hint?: string) {
  // Metadata/byte fixture, not a claim of a full media decoder.
  const blob = new Blob(['%PDF-1.7\nDocumento de prueba'], { type: mimeType });
  const contentHash = await computeContentHash(blob);
  const receiver = peer('receiver');
  const sender = peer('sender', { blob, contentHash });
  await receiver.router.requestFile({ nodeId: 'document-a', contentHash, title: 'document.pdf', mimeType: hint });
  const request = receiver.queue.snapshot()[0];
  await sender.router.processIncomingPackets([request]);
  const chunks = sender.queue.snapshot().filter((p) => p.type === 'file_chunk').map((p) => ({
    ...p, payload: { ...(p.payload as FileChunkPayload) },
  }));
  expect(chunks.length).toBeGreaterThan(1);
  return { receiver, blob, contentHash, request, chunks };
}

async function expectComplete(t: Awaited<ReturnType<typeof transfer>>, mime: string) {
  expect(t.receiver.complete).toHaveBeenCalledTimes(1);
  const result = t.receiver.router.getActiveRequests()[0].reconstructedFile!;
  expect(result.type).toBe(mime);
  expect(await result.text()).toBe(await t.blob.text());
  expect(await computeContentHash(result)).toBe(t.contentHash);
}

describe('mesh file MIME producer to consumer', () => {
  it('covers MIME with the existing HMAC across JSON serialization', async () => {
    const t = await transfer();
    const key = { keyId: 'mime-test-fixture', key: await crypto.subtle.importKey(
      'raw', new Uint8Array(32).fill(23), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
    ) };
    const packet = t.chunks[0];
    const signed = { ...packet, ...await signPacket(packet, key) };
    expect(await verifyPacket(JSON.parse(JSON.stringify(signed)), key)).toBe(true);
    const tampered = { ...signed, payload: { ...signed.payload, mimeType: 'image/png' } };
    expect(await verifyPacket(tampered, key)).toBe(false);
  });

  it.each(['application/pdf', 'image/png', 'image/jpeg', 'text/plain', 'audio/mpeg', 'video/mp4'])(
    'preserves %s through reversed chunks and a JSON boundary', async (mime) => {
      const t = await transfer(mime);
      for (const c of t.chunks) expect(c.payload.mimeType).toBe(mime);
      const wire = t.chunks.map((c) => JSON.parse(JSON.stringify(c)) as typeof c);
      await t.receiver.router.processIncomingPackets(wire.reverse());
      await expectComplete(t, mime);
    });

  it('uses the responder Blob, not the requester MIME hint', async () => {
    const t = await transfer('application/pdf', 'image/png');
    expect((t.request.payload as FileRequestPayload).mimeType).toBe('image/png');
    expect(t.chunks.every((c) => c.payload.mimeType === 'application/pdf')).toBe(true);
    await t.receiver.router.processIncomingPackets(t.chunks);
    await expectComplete(t, 'application/pdf');
  });

  it('accepts a legacy stream with no MIME as a generic download', async () => {
    const t = await transfer();
    for (const c of t.chunks) delete c.payload.mimeType;
    await t.receiver.router.processIncomingPackets(t.chunks);
    await expectComplete(t, 'application/octet-stream');
  });

  it('mixes legacy and modern chunks without overwriting the declaration', async () => {
    const t = await transfer();
    delete t.chunks[0].payload.mimeType;
    delete t.chunks.at(-1)!.payload.mimeType;
    await t.receiver.router.processIncomingPackets(t.chunks);
    await expectComplete(t, 'application/pdf');
  });

  it.each(['text/html', 'image/svg+xml', 'application/x-unknown', '', 'x'.repeat(101)])(
    'keeps unsupported local MIME %s as a generic download', async (mime) => {
      const t = await transfer(mime);
      expect(t.chunks.every((c) => c.payload.mimeType === 'application/octet-stream')).toBe(true);
      await t.receiver.router.processIncomingPackets(t.chunks);
      await expectComplete(t, 'application/octet-stream');
    });

  it.each(['text/html', 'image/svg+xml', 123, null, 'application/pdf\r\nX-Injection: yes'])(
    'bounds untrusted wire MIME %s to a generic download', async (mime) => {
      const t = await transfer();
      for (const c of t.chunks) Reflect.set(c.payload, 'mimeType', mime);
      await t.receiver.router.processIncomingPackets(t.chunks);
      await expectComplete(t, 'application/octet-stream');
    });

  it('ignores conflicting MIME before adding bytes and accepts a correct retry', async () => {
    const t = await transfer();
    await t.receiver.router.processIncomingPackets([t.chunks[0]]);
    const conflict = { ...t.chunks[1], payload: { ...t.chunks[1].payload, mimeType: 'image/png' } };
    await t.receiver.router.processIncomingPackets([conflict]);
    expect(t.receiver.router.getActiveRequests()[0].receivedChunks.size).toBe(1);
    expect(t.receiver.complete).not.toHaveBeenCalled();
    await t.receiver.router.processIncomingPackets(t.chunks.slice(1));
    await expectComplete(t, 'application/pdf');
    await t.receiver.router.processIncomingPackets(t.chunks);
    expect(t.receiver.complete).toHaveBeenCalledTimes(1);
  });

  it('does not let a duplicate legacy chunk inject a new MIME declaration', async () => {
    const t = await transfer();
    const legacy = { ...t.chunks[0], payload: { ...t.chunks[0].payload } };
    delete legacy.payload.mimeType;
    await t.receiver.router.processIncomingPackets([legacy]);
    await t.receiver.router.processIncomingPackets([{ ...legacy, payload: { ...legacy.payload, mimeType: 'image/png' } }]);
    expect(t.receiver.router.getActiveRequests()[0].receivedMimeType).toBeNull();
    await t.receiver.router.processIncomingPackets(t.chunks.slice(1));
    await expectComplete(t, 'application/pdf');
  });

  it('does not pin MIME when base64 decoding rejects the bytes', async () => {
    const t = await transfer();
    const bad = { ...t.chunks[0], payload: { ...t.chunks[0].payload, mimeType: 'image/png' } };
    Reflect.deleteProperty(bad.payload, 'dataBase64');
    await expect(t.receiver.router.processIncomingPackets([bad])).rejects.toThrow();
    expect(t.receiver.router.getActiveRequests()[0].receivedMimeType).toBeNull();
    await t.receiver.router.processIncomingPackets(t.chunks);
    await expectComplete(t, 'application/pdf');
  });

  it('clears MIME after a bad hash before accepting a valid retry', async () => {
    const t = await transfer();
    const bad = t.chunks.map((c) => ({ ...c, payload: { ...c.payload, mimeType: 'image/png' } }));
    bad[0].payload.dataBase64 = Buffer.from('wrong').toString('base64');
    await t.receiver.router.processIncomingPackets(bad);
    expect(t.receiver.complete).not.toHaveBeenCalled();
    expect(t.receiver.router.getActiveRequests()[0].receivedMimeType).toBeNull();
    await t.receiver.router.processIncomingPackets(t.chunks);
    await expectComplete(t, 'application/pdf');
  });
});
