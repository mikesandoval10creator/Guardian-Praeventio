import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type {
  ImmutablePdfContent,
  ImmutablePdfArtifact,
} from './pdfImmutableService.js';

// ── jsPDF mock ────────────────────────────────────────────────────────────
// `buildImmutablePdf` does `await import('jspdf')` (lazy dynamic import)
// to avoid pako ESM resolution issues in Node/vitest. We intercept it with
// vi.mock so the call succeeds and returns deterministic fake bytes — the
// hash arithmetic then runs against the real @noble/hashes/sha2 path.
//
// The mock must be declared BEFORE any import of the module under test
// (hoisting guarantee in vitest). We expose `__setFakeBytes` so individual
// tests can override the bytes the fake PDF "outputs".

const FAKE_PDF_BYTES_DEFAULT = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"

// Mutable ref read at call-time so per-test overrides propagate correctly.
let _fakePdfBytes: Uint8Array = FAKE_PDF_BYTES_DEFAULT;
let _fakePageCount = 1;

// Controls the bytes that `doc.output('arraybuffer')` returns.
function setFakePdfBytes(b: Uint8Array): void {
  _fakePdfBytes = b;
}

// vi.mock factory runs in hoisted scope — must use `class` (not arrow) so
// `new jsPDF(...)` in production code succeeds.
vi.mock('jspdf', () => {
  class JsPDFStub {
    internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 } };
    setFontSize() { /* no-op */ }
    setTextColor() { /* no-op */ }
    text() { /* no-op */ }
    setLineWidth() { /* no-op */ }
    setDrawColor() { /* no-op */ }
    line() { /* no-op */ }
    splitTextToSize(t: string) { return [t]; }
    addPage() { /* no-op */ }
    setFillColor() { /* no-op */ }
    rect() { /* no-op */ }
    setPage() { /* no-op */ }
    getNumberOfPages() { return _fakePageCount; }
    output(_type: string): ArrayBuffer {
      // Reads _fakePdfBytes at call time — per-test mutations are visible.
      return _fakePdfBytes.buffer.slice(
        _fakePdfBytes.byteOffset,
        _fakePdfBytes.byteOffset + _fakePdfBytes.byteLength,
      ) as ArrayBuffer;
    }
  }
  return { default: JsPDFStub };
});

import {
  buildImmutablePdf,
  downloadImmutablePdf,
  verifyImmutablePdf,
  formatHashForDisplay,
} from './pdfImmutableService.js';

// ── Helpers ───────────────────────────────────────────────────────────────

function makeContent(
  overrides: Partial<ImmutablePdfContent> = {},
): ImmutablePdfContent {
  return {
    kind: 'audit_report',
    title: 'Reporte de Prueba',
    authorUid: 'uid-test-001',
    createdAtIso: '2026-05-31T12:00:00.000Z',
    tenantId: 'tenant-acme',
    sections: [
      {
        heading: 'Sección 1',
        paragraphs: ['Párrafo de prueba.'],
      },
    ],
    ...overrides,
  };
}

// NOTE: `buildImmutablePdf` usa `jsPDF@4.2.1` que en runtime browser
// (donde la app realmente lo invoca) funciona perfectamente. En el
// entorno node de vitest, jsPDF carga `pako@2.x` y la resolución de
// módulos ESM no encuentra `pako/index.js` (pako@2 solo ships `dist/`).
//
// Cubrimos el contrato CRÍTICO de inmutabilidad sin depender de jsPDF
// usando el mock declarado arriba — el hash SHA-256 se computa sobre los
// bytes reales devueltos por el mock, ejerciendo la misma lógica que
// el código de producción.

describe('verifyImmutablePdf — contrato de integridad', () => {
  it('hash matching: valid=true', () => {
    const bytes = new TextEncoder().encode('contenido del PDF de prueba');
    const expectedHash = bytesToHex(sha256(bytes));
    const result = verifyImmutablePdf(bytes, expectedHash);
    expect(result.valid).toBe(true);
    expect(result.actualHashHex).toBe(expectedHash);
  });

  it('hash uppercase en expected: normaliza a lowercase', () => {
    const bytes = new TextEncoder().encode('test bytes');
    const expectedHash = bytesToHex(sha256(bytes));
    const result = verifyImmutablePdf(bytes, expectedHash.toUpperCase());
    expect(result.valid).toBe(true);
  });

  it('bytes tampered: valid=false con reason hash_mismatch', () => {
    const original = new TextEncoder().encode('original content');
    const tampered = new TextEncoder().encode('TAMPERED content');
    const expectedHash = bytesToHex(sha256(original));
    const result = verifyImmutablePdf(tampered, expectedHash);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('hash_mismatch');
    expect(result.actualHashHex).not.toBe(expectedHash);
  });

  it('un solo byte modificado: detect tamper', () => {
    const bytes = new Uint8Array(100).fill(0xab);
    const expectedHash = bytesToHex(sha256(bytes));
    const tampered = new Uint8Array(bytes);
    tampered[50] = 0xff;
    const result = verifyImmutablePdf(tampered, expectedHash);
    expect(result.valid).toBe(false);
  });

  it('bytes vacíos con hash no-vacío: falla', () => {
    const result = verifyImmutablePdf(new Uint8Array(0), 'a'.repeat(64));
    expect(result.valid).toBe(false);
  });

  it('hash vacío correcto: pass (edge case — bytes vacíos tienen hash conocido)', () => {
    const emptyHash = bytesToHex(sha256(new Uint8Array(0)));
    const result = verifyImmutablePdf(new Uint8Array(0), emptyHash);
    expect(result.valid).toBe(true);
  });

  it('result expone actualHashHex + expectedHashHex para audit log', () => {
    const bytes = new TextEncoder().encode('audit content');
    const wrongHash = 'a'.repeat(64);
    const result = verifyImmutablePdf(bytes, wrongHash);
    expect(result.actualHashHex).toBeTruthy();
    expect(result.expectedHashHex).toBe(wrongHash);
  });
});

describe('formatHashForDisplay', () => {
  it('formato chunks de 4 chars separados por espacios', () => {
    expect(formatHashForDisplay('a1b2c3d4e5f60718')).toBe(
      'a1b2 c3d4 e5f6 0718',
    );
  });

  it('hash SHA-256 completo (64 chars) formateado en 16 grupos', () => {
    const hex = bytesToHex(sha256(new TextEncoder().encode('test')));
    const formatted = formatHashForDisplay(hex);
    const groups = formatted.split(' ');
    expect(groups).toHaveLength(16);
    expect(groups.every((g) => g.length === 4)).toBe(true);
  });

  it('hex vacío devuelve string vacío', () => {
    expect(formatHashForDisplay('')).toBe('');
  });

  it('hex con longitud no múltiplo de 4: último grupo más corto', () => {
    expect(formatHashForDisplay('abc')).toBe('abc');
    expect(formatHashForDisplay('abcde')).toBe('abcd e');
  });
});

// ── buildImmutablePdf ─────────────────────────────────────────────────────

describe('buildImmutablePdf — artifact shape', () => {
  beforeEach(() => {
    setFakePdfBytes(FAKE_PDF_BYTES_DEFAULT);
    _fakePageCount = 1;
  });

  it('devuelve ImmutablePdfArtifact con todos los campos requeridos', async () => {
    const content = makeContent();
    const artifact = await buildImmutablePdf(content);

    expect(artifact).toHaveProperty('pdfBytes');
    expect(artifact).toHaveProperty('contentHashHex');
    expect(artifact).toHaveProperty('sizeBytes');
    expect(artifact).toHaveProperty('metadata');
    expect(artifact).toHaveProperty('filename');
  });

  it('pdfBytes es Uint8Array con contenido no vacío', async () => {
    const artifact = await buildImmutablePdf(makeContent());
    expect(artifact.pdfBytes).toBeInstanceOf(Uint8Array);
    expect(artifact.pdfBytes.length).toBeGreaterThan(0);
  });

  it('contentHashHex es SHA-256 hex de 64 chars (solo lowercase hex)', async () => {
    const artifact = await buildImmutablePdf(makeContent());
    expect(artifact.contentHashHex).toHaveLength(64);
    expect(artifact.contentHashHex).toMatch(/^[0-9a-f]{64}$/);
  });

  it('contentHashHex coincide con sha256 real de los pdfBytes devueltos', async () => {
    setFakePdfBytes(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    const artifact = await buildImmutablePdf(makeContent());
    const expectedHash = bytesToHex(sha256(artifact.pdfBytes));
    expect(artifact.contentHashHex).toBe(expectedHash);
  });

  it('sizeBytes === pdfBytes.length', async () => {
    const artifact = await buildImmutablePdf(makeContent());
    expect(artifact.sizeBytes).toBe(artifact.pdfBytes.length);
  });

  it('filename tiene formato praeventio-{kind}-{hashPrefix}.pdf', async () => {
    const artifact = await buildImmutablePdf(makeContent({ kind: 'audit_report' }));
    expect(artifact.filename).toMatch(/^praeventio-audit_report-[0-9a-f]{12}\.pdf$/);
  });

  it('filename hashPrefix son los primeros 12 chars del contentHashHex', async () => {
    const artifact = await buildImmutablePdf(makeContent());
    const prefix = artifact.contentHashHex.slice(0, 12);
    expect(artifact.filename).toContain(prefix);
  });

  it('filename cambia con kind diferente', async () => {
    const a1 = await buildImmutablePdf(makeContent({ kind: 'audit_report' }));
    const a2 = await buildImmutablePdf(makeContent({ kind: 'compliance_certificate' }));
    expect(a1.filename).toContain('audit_report');
    expect(a2.filename).toContain('compliance_certificate');
  });

  it('metadata.kind refleja el content.kind', async () => {
    const artifact = await buildImmutablePdf(makeContent({ kind: 'inspection_log' }));
    expect(artifact.metadata.kind).toBe('inspection_log');
  });

  it('metadata.title refleja content.title', async () => {
    const artifact = await buildImmutablePdf(makeContent({ title: 'Mi Reporte Especial' }));
    expect(artifact.metadata.title).toBe('Mi Reporte Especial');
  });

  it('metadata.authorUid refleja content.authorUid', async () => {
    const artifact = await buildImmutablePdf(makeContent({ authorUid: 'uid-999' }));
    expect(artifact.metadata.authorUid).toBe('uid-999');
  });

  it('metadata.tenantId refleja content.tenantId', async () => {
    const artifact = await buildImmutablePdf(makeContent({ tenantId: 'tenant-xyz' }));
    expect(artifact.metadata.tenantId).toBe('tenant-xyz');
  });

  it('metadata.createdAtIso refleja content.createdAtIso', async () => {
    const ts = '2026-01-15T08:30:00.000Z';
    const artifact = await buildImmutablePdf(makeContent({ createdAtIso: ts }));
    expect(artifact.metadata.createdAtIso).toBe(ts);
  });

  it('metadata.generatedAtIso es un ISO timestamp válido generado en runtime', async () => {
    const before = Date.now();
    const artifact = await buildImmutablePdf(makeContent());
    const after = Date.now();
    const generatedAt = new Date(artifact.metadata.generatedAtIso).getTime();
    expect(generatedAt).toBeGreaterThanOrEqual(before);
    expect(generatedAt).toBeLessThanOrEqual(after);
  });

  it('metadata.projectId es undefined cuando content.projectId no está set', async () => {
    const content = makeContent();
    delete (content as Partial<ImmutablePdfContent>).projectId;
    const artifact = await buildImmutablePdf(content);
    expect(artifact.metadata.projectId).toBeUndefined();
  });

  it('metadata.projectId refleja content.projectId cuando está set', async () => {
    const artifact = await buildImmutablePdf(makeContent({ projectId: 'proj-42' }));
    expect(artifact.metadata.projectId).toBe('proj-42');
  });
});

describe('buildImmutablePdf — integridad hash end-to-end', () => {
  beforeEach(() => {
    setFakePdfBytes(FAKE_PDF_BYTES_DEFAULT);
    _fakePageCount = 1;
  });

  it('mismo input + mismos bytes falsos → mismo contentHashHex (determinismo)', async () => {
    setFakePdfBytes(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
    const content = makeContent();
    const r1 = await buildImmutablePdf(content);
    const r2 = await buildImmutablePdf(content);
    expect(r1.contentHashHex).toBe(r2.contentHashHex);
  });

  it('bytes distintos → hashes distintos', async () => {
    setFakePdfBytes(new Uint8Array([0x01, 0x02]));
    const r1 = await buildImmutablePdf(makeContent());

    setFakePdfBytes(new Uint8Array([0x03, 0x04]));
    const r2 = await buildImmutablePdf(makeContent());

    expect(r1.contentHashHex).not.toBe(r2.contentHashHex);
  });

  it('artifact pasa verifyImmutablePdf con su propio hash → valid=true', async () => {
    setFakePdfBytes(new Uint8Array([0xca, 0xfe, 0xba, 0xbe]));
    const artifact = await buildImmutablePdf(makeContent());
    const verification = verifyImmutablePdf(artifact.pdfBytes, artifact.contentHashHex);
    expect(verification.valid).toBe(true);
  });

  it('artifact tamperado no pasa verifyImmutablePdf → valid=false', async () => {
    setFakePdfBytes(new Uint8Array([0x10, 0x20, 0x30, 0x40]));
    const artifact = await buildImmutablePdf(makeContent());
    const tampered = new Uint8Array(artifact.pdfBytes);
    tampered[0] ^= 0xff; // flip first byte
    const verification = verifyImmutablePdf(tampered, artifact.contentHashHex);
    expect(verification.valid).toBe(false);
    expect(verification.reason).toBe('hash_mismatch');
  });

  it('content con sección con tabla: no lanza y produce artifact', async () => {
    setFakePdfBytes(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
    const content = makeContent({
      sections: [
        {
          heading: 'Riesgos',
          paragraphs: ['Riesgo identificado.'],
          tables: [
            {
              headers: ['Factor', 'Nivel', 'Medida'],
              rows: [
                ['Ruido', 'Alto', 'EPP auditivo'],
                ['Polvo', 'Medio', 'Mascarilla'],
              ],
            },
          ],
        },
      ],
    });
    const artifact = await buildImmutablePdf(content);
    expect(artifact.contentHashHex).toHaveLength(64);
    expect(artifact.filename).toMatch(/^praeventio-audit_report-[0-9a-f]{12}\.pdf$/);
  });

  it('content con subtitle + verifyUrl + webAuthnSignatureBase64: produce artifact', async () => {
    setFakePdfBytes(new Uint8Array([0xaa, 0xbb]));

    const content = makeContent({
      subtitle: 'Periodo: Enero 2026',
      verifyUrl: 'https://praeventio.cl/verify',
      webAuthnSignatureBase64: 'AAABBBCCCDDDEEEFFF0001112223334445',
      authorName: 'Juan Pérez',
    });
    const artifact = await buildImmutablePdf(content);
    expect(artifact.metadata.title).toBe('Reporte de Prueba');
    expect(artifact.contentHashHex).toHaveLength(64);
  });

  it('todos los ImmutablePdfKind producen filename con el kind correcto', async () => {
    const kinds = [
      'audit_report',
      'incident_summary',
      'compliance_certificate',
      'inspection_log',
      'training_record',
      'custom',
    ] as const;

    for (const kind of kinds) {
      setFakePdfBytes(new Uint8Array([kind.charCodeAt(0)]));
      const artifact = await buildImmutablePdf(makeContent({ kind }));
      expect(artifact.filename).toContain(kind);
      expect(artifact.metadata.kind).toBe(kind);
    }
  });

  it('multi-page (getNumberOfPages=3): no lanza y produce artifact', async () => {
    _fakePageCount = 3;
    setFakePdfBytes(new Uint8Array([0x01, 0x02, 0x03]));

    const artifact = await buildImmutablePdf(makeContent());
    expect(artifact.sizeBytes).toBe(3);
    expect(artifact.contentHashHex).toHaveLength(64);
  });
});

// ── downloadImmutablePdf ──────────────────────────────────────────────────

describe('downloadImmutablePdf — browser DOM stubs', () => {
  // downloadImmutablePdf uses document, Blob, URL.createObjectURL.
  // We stub the minimal DOM surface in this node environment.

  let revokeObjectURLMock: ReturnType<typeof vi.fn>;
  let createObjectURLMock: ReturnType<typeof vi.fn>;
  let anchorClickMock: ReturnType<typeof vi.fn>;
  let createdAnchor: {
    href: string;
    download: string;
    click: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    revokeObjectURLMock = vi.fn();
    createObjectURLMock = vi.fn(() => 'blob:http://localhost/fake-object-url');
    anchorClickMock = vi.fn();

    createdAnchor = { href: '', download: '', click: anchorClickMock };

    // Stub global URL methods.
    globalThis.URL = {
      ...globalThis.URL,
      createObjectURL: createObjectURLMock,
      revokeObjectURL: revokeObjectURLMock,
    } as unknown as typeof URL;

    // Stub document.createElement to intercept <a> creation.
    globalThis.document = {
      createElement: vi.fn((_tag: string) => createdAnchor),
    } as unknown as Document;

    // Stub Blob constructor.
    globalThis.Blob = class FakeBlob {
      constructor(
        public parts: unknown[],
        public opts?: Record<string, unknown>,
      ) {}
    } as unknown as typeof Blob;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function makeArtifact(
    overrides: Partial<ImmutablePdfArtifact> = {},
  ): ImmutablePdfArtifact {
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    return {
      pdfBytes,
      contentHashHex: bytesToHex(sha256(pdfBytes)),
      sizeBytes: pdfBytes.length,
      filename: 'praeventio-audit_report-abcdef012345.pdf',
      metadata: {
        kind: 'audit_report',
        title: 'Test',
        authorUid: 'uid-1',
        createdAtIso: '2026-05-31T00:00:00.000Z',
        tenantId: 'tenant-1',
        generatedAtIso: '2026-05-31T00:00:01.000Z',
      },
      ...overrides,
    };
  }

  it('invoca URL.createObjectURL con un Blob', () => {
    downloadImmutablePdf(makeArtifact());
    expect(createObjectURLMock).toHaveBeenCalledOnce();
    const arg: unknown = createObjectURLMock.mock.calls[0]?.[0];
    expect(arg).toBeDefined();
  });

  it('asigna href con la object URL creada', () => {
    downloadImmutablePdf(makeArtifact());
    expect(createdAnchor.href).toBe('blob:http://localhost/fake-object-url');
  });

  it('asigna download con artifact.filename', () => {
    const artifact = makeArtifact({ filename: 'mi-reporte-abc.pdf' });
    downloadImmutablePdf(artifact);
    expect(createdAnchor.download).toBe('mi-reporte-abc.pdf');
  });

  it('dispara click() en el anchor', () => {
    downloadImmutablePdf(makeArtifact());
    expect(anchorClickMock).toHaveBeenCalledOnce();
  });

  it('revoca la object URL tras 1000ms (setTimeout)', () => {
    downloadImmutablePdf(makeArtifact());
    expect(revokeObjectURLMock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:http://localhost/fake-object-url');
  });
});
