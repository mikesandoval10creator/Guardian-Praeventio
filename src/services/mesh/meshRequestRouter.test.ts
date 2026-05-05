// SPDX-License-Identifier: MIT
//
// Sprint 26 — MeshRequestRouter tests.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildPacket,
  type FileChunkPayload,
  type FileRequestPayload,
  type MeshPacket,
} from './meshPacket';
import { MeshRelayQueue } from './meshRelayQueue';
import { MeshRequestRouter, type FileRequestRecord } from './meshRequestRouter';

// ---------------------------------------------------------------------------
// Fixtures helpers
// ---------------------------------------------------------------------------

const PROJECT = 'proj-A';
const SELF = 'worker-self';
const PEER = 'worker-peer';

function makeRouter(opts: {
  now?: () => number;
  chunkSize?: number;
  localFiles?: Map<string, { blob: Blob; contentHash: string }>;
  onFileComplete?: (r: FileRequestRecord) => void;
} = {}) {
  const queue = new MeshRelayQueue({
    selfUid: SELF,
    projectId: PROJECT,
    now: opts.now,
  });
  const localFiles = opts.localFiles ?? new Map();
  const onFileComplete = opts.onFileComplete ?? (() => {});
  const router = new MeshRequestRouter({
    selfUid: SELF,
    projectId: PROJECT,
    queue,
    localFileLookup: async (nodeId) => localFiles.get(nodeId) ?? null,
    onFileComplete,
    chunkSize: opts.chunkSize,
    now: opts.now,
  });
  return { router, queue, localFiles };
}

function makeFileRequestPacket(opts: {
  fromUid?: string;
  nodeId: string;
  contentHash?: string | null;
  bornAtMs?: number;
  projectId?: string;
}): MeshPacket {
  const payload: FileRequestPayload = {
    requesterUid: opts.fromUid ?? PEER,
    nodeId: opts.nodeId,
    contentHash: opts.contentHash ?? null,
    title: 'demo.bin',
    projectId: opts.projectId ?? PROJECT,
  };
  return buildPacket({
    type: 'file_request',
    fromUid: opts.fromUid ?? PEER,
    toUid: 'broadcast',
    payload,
    bornAtMs: opts.bornAtMs ?? 1_000,
    projectId: payload.projectId,
  });
}

function makeFileChunkPacket(opts: {
  requestId: string;
  chunkIndex: number;
  totalChunks: number;
  data: Uint8Array;
  fromUid?: string;
  bornAtMs?: number;
  contentHash?: string;
}): MeshPacket {
  const payload: FileChunkPayload = {
    requestId: opts.requestId,
    contentHash: opts.contentHash ?? 'hash',
    chunkIndex: opts.chunkIndex,
    totalChunks: opts.totalChunks,
    dataBase64: Buffer.from(opts.data).toString('base64'),
    projectId: PROJECT,
  };
  return buildPacket({
    type: 'file_chunk',
    fromUid: opts.fromUid ?? PEER,
    toUid: SELF,
    payload,
    bornAtMs: opts.bornAtMs ?? 2_000,
    projectId: PROJECT,
  });
}

// ---------------------------------------------------------------------------

describe('MeshRequestRouter', () => {
  let nowMs: number;
  beforeEach(() => {
    nowMs = 10_000;
  });
  const now = () => nowMs;

  it('1. requestFile crea record + enqueues file_request packet', async () => {
    const { router, queue } = makeRouter({ now });
    const { requestId } = await router.requestFile({
      nodeId: 'node-1',
      contentHash: null,
      title: 'doc.pdf',
    });

    expect(requestId).toBeTruthy();
    expect(queue.size()).toBe(1);

    const snapshot = queue.snapshot();
    expect(snapshot[0].type).toBe('file_request');
    expect((snapshot[0].payload as FileRequestPayload).nodeId).toBe('node-1');

    const active = router.getActiveRequests();
    expect(active).toHaveLength(1);
    expect(active[0].state).toBe('pending');
    expect(active[0].requestId).toBe(requestId);
  });

  it('2. recibir file_request peer + tener archivo local → chunkear + enviar response', async () => {
    const blob = new Blob([new Uint8Array(1300).fill(7)]);
    const localFiles = new Map([
      ['node-A', { blob, contentHash: 'hash-A' }],
    ]);
    const { router, queue } = makeRouter({
      now,
      chunkSize: 512,
      localFiles,
    });

    const incoming = makeFileRequestPacket({ nodeId: 'node-A' });
    await router.processIncomingPackets([incoming]);

    // 1300 bytes / 512 = 3 chunks.
    const chunks = queue
      .snapshot()
      .filter((p) => p.type === 'file_chunk');
    expect(chunks).toHaveLength(3);
    const indices = chunks.map(
      (c) => (c.payload as FileChunkPayload).chunkIndex,
    );
    expect(indices.sort()).toEqual([0, 1, 2]);
    for (const c of chunks) {
      expect((c.payload as FileChunkPayload).totalChunks).toBe(3);
      expect((c.payload as FileChunkPayload).requestId).toBe(incoming.id);
    }
  });

  it('3. recibir file_request peer + NO tener archivo → no responder', async () => {
    const { router, queue } = makeRouter({ now });
    const incoming = makeFileRequestPacket({ nodeId: 'unknown-node' });
    await router.processIncomingPackets([incoming]);

    expect(queue.size()).toBe(0);
  });

  it('4. recibir file_chunk con requestId conocido → acumular', async () => {
    const { router } = makeRouter({ now });
    const { requestId } = await router.requestFile({
      nodeId: 'node-2',
      contentHash: null,
      title: 'x',
    });

    await router.processIncomingPackets([
      makeFileChunkPacket({
        requestId,
        chunkIndex: 0,
        totalChunks: 2,
        data: new Uint8Array([1, 2, 3]),
      }),
    ]);

    const [rec] = router.getActiveRequests();
    expect(rec.state).toBe('in_transit');
    expect(rec.totalChunks).toBe(2);
    expect(rec.receivedChunks.size).toBe(1);
  });

  it('5. recibir todos los chunks → reconstrucción + state=complete + callback', async () => {
    const completed: FileRequestRecord[] = [];
    const { router } = makeRouter({
      now,
      onFileComplete: (r) => completed.push(r),
    });
    const { requestId } = await router.requestFile({
      nodeId: 'node-3',
      contentHash: null,
      title: 'x',
    });

    const c0 = new Uint8Array([1, 2, 3]);
    const c1 = new Uint8Array([4, 5, 6, 7]);
    await router.processIncomingPackets([
      makeFileChunkPacket({
        requestId,
        chunkIndex: 0,
        totalChunks: 2,
        data: c0,
      }),
      makeFileChunkPacket({
        requestId,
        chunkIndex: 1,
        totalChunks: 2,
        data: c1,
        bornAtMs: 2_001,
      }),
    ]);

    expect(completed).toHaveLength(1);
    expect(completed[0].state).toBe('complete');
    expect(completed[0].reconstructedFile).toBeInstanceOf(Blob);
    const buf = new Uint8Array(
      await completed[0].reconstructedFile!.arrayBuffer(),
    );
    expect(Array.from(buf)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('6. cancelRequest → state=cancelled', async () => {
    const { router } = makeRouter({ now });
    const { requestId } = await router.requestFile({
      nodeId: 'n',
      contentHash: null,
      title: 't',
    });
    router.cancelRequest(requestId);
    expect(router.getActiveRequests()[0].state).toBe('cancelled');

    // Cancel doble es no-op.
    router.cancelRequest(requestId);
    router.cancelRequest('unknown');
    expect(router.getActiveRequests()[0].state).toBe('cancelled');
  });

  it('7. cleanup expira requests con TTL agotado', async () => {
    const { router } = makeRouter({ now });
    await router.requestFile({
      nodeId: 'n',
      contentHash: null,
      title: 't',
    });

    nowMs += 25 * 60 * 60 * 1000; // > 24h default lifetime
    router.cleanup();

    expect(router.getActiveRequests()[0].state).toBe('expired');
  });

  it('8. dedup: mismo file_chunk recibido 2x no rompe reconstrucción', async () => {
    const onComplete = vi.fn();
    const { router } = makeRouter({ now, onFileComplete: onComplete });
    const { requestId } = await router.requestFile({
      nodeId: 'n',
      contentHash: null,
      title: 't',
    });

    const dup = makeFileChunkPacket({
      requestId,
      chunkIndex: 0,
      totalChunks: 2,
      data: new Uint8Array([10]),
    });
    const second = makeFileChunkPacket({
      requestId,
      chunkIndex: 1,
      totalChunks: 2,
      data: new Uint8Array([20]),
      bornAtMs: 2_001,
    });

    await router.processIncomingPackets([dup, dup, second]);

    expect(onComplete).toHaveBeenCalledTimes(1);
    const rec = onComplete.mock.calls[0][0] as FileRequestRecord;
    const buf = new Uint8Array(await rec.reconstructedFile!.arrayBuffer());
    expect(Array.from(buf)).toEqual([10, 20]);
  });

  it('9. chunkSize parametrizable se aplica al chunkear respuesta', async () => {
    const blob = new Blob([new Uint8Array(100).fill(1)]);
    const localFiles = new Map([
      ['node-X', { blob, contentHash: 'hash-X' }],
    ]);
    const { router, queue } = makeRouter({
      now,
      chunkSize: 25,
      localFiles,
    });

    await router.processIncomingPackets([
      makeFileRequestPacket({ nodeId: 'node-X' }),
    ]);

    const chunks = queue
      .snapshot()
      .filter((p) => p.type === 'file_chunk');
    // 100 / 25 = 4
    expect(chunks).toHaveLength(4);
    for (const c of chunks) {
      expect((c.payload as FileChunkPayload).totalChunks).toBe(4);
    }
  });

  it('10. processIncomingPackets dispatcha por tipo correctamente', async () => {
    const blob = new Blob([new Uint8Array(50).fill(9)]);
    const localFiles = new Map([
      ['node-D', { blob, contentHash: 'hash-D' }],
    ]);
    const { router, queue } = makeRouter({
      now,
      chunkSize: 512,
      localFiles,
    });
    const { requestId } = await router.requestFile({
      nodeId: 'node-self',
      contentHash: null,
      title: 't',
    });

    // Mix: file_request + file_chunk + un tipo no relacionado (gps_breadcrumb)
    const fileReq = makeFileRequestPacket({ nodeId: 'node-D' });
    const chunk = makeFileChunkPacket({
      requestId,
      chunkIndex: 0,
      totalChunks: 1,
      data: new Uint8Array([99]),
    });
    const gps = buildPacket({
      type: 'gps_breadcrumb',
      fromUid: PEER,
      toUid: 'supervisors',
      payload: {
        workerUid: PEER,
        lat: 0,
        lng: 0,
        accuracyM: 5,
        capturedAtMs: nowMs,
        projectId: PROJECT,
      },
      bornAtMs: nowMs,
      projectId: PROJECT,
    });

    await router.processIncomingPackets([fileReq, chunk, gps]);

    // file_request → respondió con 1 chunk (50 bytes < 512).
    const responses = queue
      .snapshot()
      .filter(
        (p) =>
          p.type === 'file_chunk' &&
          (p.payload as FileChunkPayload).requestId === fileReq.id,
      );
    expect(responses).toHaveLength(1);

    // file_chunk para nuestro request → record completado.
    const rec = router
      .getActiveRequests()
      .find((r) => r.requestId === requestId)!;
    expect(rec.state).toBe('complete');

    // gps_breadcrumb fue ignorado por el router (no genera más packets ni
    // estado cambiado).
    expect(router.getActiveRequests()).toHaveLength(1);
  });

  it('extra: file_request con contentHash mismatch no responde', async () => {
    const blob = new Blob([new Uint8Array(50).fill(1)]);
    const localFiles = new Map([
      ['node-Y', { blob, contentHash: 'real-hash' }],
    ]);
    const { router, queue } = makeRouter({ now, localFiles });

    await router.processIncomingPackets([
      makeFileRequestPacket({
        nodeId: 'node-Y',
        contentHash: 'wrong-hash',
      }),
    ]);
    expect(queue.size()).toBe(0);
  });
});
