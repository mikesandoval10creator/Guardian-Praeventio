// SPDX-License-Identifier: MIT
// Sprint 50 E.5 P2 H1 — tests for DWG document validator.

import { describe, it, expect } from 'vitest';
import {
  validateDwgUpload,
  DWG_MAX_BYTE_SIZE,
  DWG_MIN_BYTE_SIZE,
  __internal,
  type DwgValidationInput,
} from './dwgDocumentValidator';

const NOW = new Date('2026-05-13T12:00:00.000Z');

function happy(over: Partial<DwgValidationInput> = {}): DwgValidationInput {
  return {
    filename: 'planta-electrica.dwg',
    byteSize: 256 * 1024,
    uploadedByUid: 'uid-abc-123',
    projectId: 'proj-xyz-789',
    declaredKind: 'electrical',
    declaredVersion: '1.2.3',
    declaredScale: '1:100',
    ...over,
  };
}

describe('validateDwgUpload — happy path', () => {
  it('accepts a well-formed DWG with all optional fields', () => {
    const r = validateDwgUpload(happy(), NOW);
    expect(r.valid).toBe(true);
    expect(r.findings).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
    expect(r.sanitizedMetadata.uploadId).toMatch(/^dwg-[0-9a-f]{64}$/);
    expect(r.sanitizedMetadata.uploadedAt).toBe(NOW.toISOString());
  });

  it('accepts .dxf and .dwf extensions (case insensitive)', () => {
    expect(validateDwgUpload(happy({ filename: 'plan.DXF' }), NOW).valid).toBe(
      true
    );
    expect(validateDwgUpload(happy({ filename: 'plan.dwf' }), NOW).valid).toBe(
      true
    );
    expect(validateDwgUpload(happy({ filename: 'plan.DWG' }), NOW).valid).toBe(
      true
    );
  });

  it('accepts upload without optional version/scale', () => {
    const r = validateDwgUpload(
      happy({ declaredVersion: undefined, declaredScale: undefined }),
      NOW
    );
    expect(r.valid).toBe(true);
  });
});

describe('validateDwgUpload — extension', () => {
  it('rejects unknown extensions like .pdf and .zip', () => {
    const pdf = validateDwgUpload(happy({ filename: 'plan.pdf' }), NOW);
    expect(pdf.valid).toBe(false);
    expect(pdf.findings.map((f) => f.kind)).toContain('extension_invalid');
    const zip = validateDwgUpload(happy({ filename: 'archive.zip' }), NOW);
    expect(zip.valid).toBe(false);
    expect(zip.findings.map((f) => f.kind)).toContain('extension_invalid');
  });

  it('rejects filename with no extension', () => {
    const r = validateDwgUpload(happy({ filename: 'noextension' }), NOW);
    expect(r.valid).toBe(false);
    expect(r.findings.map((f) => f.kind)).toContain('extension_invalid');
  });
});

describe('validateDwgUpload — byteSize', () => {
  it('rejects byteSize = 0', () => {
    const r = validateDwgUpload(happy({ byteSize: 0 }), NOW);
    expect(r.valid).toBe(false);
    expect(r.findings.map((f) => f.kind)).toContain('size_zero');
  });

  it('rejects negative byteSize', () => {
    const r = validateDwgUpload(happy({ byteSize: -1 }), NOW);
    expect(r.valid).toBe(false);
    expect(r.findings.map((f) => f.kind)).toContain('size_negative');
  });

  it('rejects byteSize above the 50 MB cap', () => {
    const r = validateDwgUpload(
      happy({ byteSize: DWG_MAX_BYTE_SIZE + 1 }),
      NOW
    );
    expect(r.valid).toBe(false);
    const sizeTooLarge = r.findings.find((f) => f.kind === 'size_too_large');
    expect(sizeTooLarge).toBeDefined();
    expect(sizeTooLarge?.detail).toContain('50 MB');
  });

  it('rejects byteSize below 1 KB minimum', () => {
    const r = validateDwgUpload(
      happy({ byteSize: DWG_MIN_BYTE_SIZE - 1 }),
      NOW
    );
    expect(r.valid).toBe(false);
    expect(r.findings.map((f) => f.kind)).toContain('size_zero');
  });

  it('accepts byteSize exactly at the cap', () => {
    const r = validateDwgUpload(happy({ byteSize: DWG_MAX_BYTE_SIZE }), NOW);
    expect(r.valid).toBe(true);
  });
});

describe('validateDwgUpload — filename safety', () => {
  it('rejects path traversal "../"', () => {
    const r = validateDwgUpload(
      happy({ filename: '../etc/passwd.dwg' }),
      NOW
    );
    expect(r.valid).toBe(false);
    expect(r.findings.map((f) => f.kind)).toContain('filename_path_traversal');
  });

  it('rejects path traversal with backslash', () => {
    const r = validateDwgUpload(
      happy({ filename: '..\\windows\\plan.dwg' }),
      NOW
    );
    expect(r.valid).toBe(false);
    expect(r.findings.map((f) => f.kind)).toContain('filename_path_traversal');
  });

  it('rejects absolute-path-style filename', () => {
    const r = validateDwgUpload(happy({ filename: '/etc/plan.dwg' }), NOW);
    expect(r.valid).toBe(false);
    expect(r.findings.map((f) => f.kind)).toContain('filename_path_traversal');
  });

  it('rejects NUL byte in filename', () => {
    const r = validateDwgUpload(
      happy({ filename: `plan${String.fromCharCode(0)}.dwg` }),
      NOW
    );
    expect(r.valid).toBe(false);
    expect(r.findings.map((f) => f.kind)).toContain('filename_null_byte');
  });

  it('rejects empty filename', () => {
    const r = validateDwgUpload(happy({ filename: '   ' }), NOW);
    expect(r.valid).toBe(false);
    expect(r.findings.map((f) => f.kind)).toContain('filename_empty');
  });
});

describe('validateDwgUpload — declaredKind', () => {
  it('rejects kind not in enum', () => {
    const r = validateDwgUpload(
      // @ts-expect-error — intentionally invalid kind
      happy({ declaredKind: 'unknown_kind' }),
      NOW
    );
    expect(r.valid).toBe(false);
    expect(r.findings.map((f) => f.kind)).toContain('kind_invalid');
  });

  it('accepts every kind in the enum', () => {
    for (const k of __internal.ALLOWED_KINDS) {
      const r = validateDwgUpload(happy({ declaredKind: k }), NOW);
      expect(r.valid, `kind ${k} should be valid`).toBe(true);
    }
  });
});

describe('validateDwgUpload — declaredVersion (semver)', () => {
  it('rejects malformed semver "1.2"', () => {
    const r = validateDwgUpload(happy({ declaredVersion: '1.2' }), NOW);
    expect(r.valid).toBe(false);
    expect(r.findings.map((f) => f.kind)).toContain('version_invalid');
  });

  it('rejects non-numeric semver "v1.0.0"', () => {
    const r = validateDwgUpload(happy({ declaredVersion: 'v1.0.0' }), NOW);
    expect(r.valid).toBe(false);
    expect(r.findings.map((f) => f.kind)).toContain('version_invalid');
  });

  it('accepts well-formed semver "0.0.0" and "10.20.30"', () => {
    expect(
      validateDwgUpload(happy({ declaredVersion: '0.0.0' }), NOW).valid
    ).toBe(true);
    expect(
      validateDwgUpload(happy({ declaredVersion: '10.20.30' }), NOW).valid
    ).toBe(true);
  });
});

describe('validateDwgUpload — declaredScale', () => {
  it('rejects scale "1:0"', () => {
    const r = validateDwgUpload(happy({ declaredScale: '1:0' }), NOW);
    expect(r.valid).toBe(false);
    expect(r.findings.map((f) => f.kind)).toContain('scale_invalid');
  });

  it('rejects scale "1:abc"', () => {
    const r = validateDwgUpload(happy({ declaredScale: '1:abc' }), NOW);
    expect(r.valid).toBe(false);
    expect(r.findings.map((f) => f.kind)).toContain('scale_invalid');
  });

  it('rejects scale "2:100"', () => {
    const r = validateDwgUpload(happy({ declaredScale: '2:100' }), NOW);
    expect(r.valid).toBe(false);
    expect(r.findings.map((f) => f.kind)).toContain('scale_invalid');
  });

  it('accepts scales like 1:50, 1:100, 1:1000', () => {
    for (const s of ['1:50', '1:100', '1:1000']) {
      expect(validateDwgUpload(happy({ declaredScale: s }), NOW).valid).toBe(
        true
      );
    }
  });
});

describe('validateDwgUpload — required scopes', () => {
  it('rejects empty projectId', () => {
    const r = validateDwgUpload(happy({ projectId: '' }), NOW);
    expect(r.valid).toBe(false);
    expect(r.findings.map((f) => f.kind)).toContain('project_id_empty');
  });

  it('rejects empty uploadedByUid', () => {
    const r = validateDwgUpload(happy({ uploadedByUid: '' }), NOW);
    expect(r.valid).toBe(false);
    expect(r.findings.map((f) => f.kind)).toContain('uploaded_by_uid_empty');
  });
});

describe('validateDwgUpload — quality warnings', () => {
  it('warns when filename contains "final"', () => {
    const r = validateDwgUpload(happy({ filename: 'planta-final.dwg' }), NOW);
    expect(r.valid).toBe(true);
    expect(r.warnings.length).toBe(1);
    expect(r.warnings[0]).toContain('final');
    expect(r.warnings[0]).toContain('semver');
  });

  it('warns when filename contains "last" or "latest"', () => {
    const r1 = validateDwgUpload(happy({ filename: 'plan-last.dwg' }), NOW);
    expect(r1.warnings.length).toBe(1);
    const r2 = validateDwgUpload(happy({ filename: 'plan-latest.dwg' }), NOW);
    expect(r2.warnings.length).toBe(1);
  });

  it('does NOT warn on innocent substrings like "finalist"', () => {
    const r = validateDwgUpload(happy({ filename: 'finalist.dwg' }), NOW);
    expect(r.warnings.length).toBe(0);
  });
});

describe('validateDwgUpload — uploadId stability', () => {
  it('produces the same uploadId for the same (project, filename, uid, now)', () => {
    const a = validateDwgUpload(happy(), NOW);
    const b = validateDwgUpload(happy(), NOW);
    expect(a.sanitizedMetadata.uploadId).toBe(b.sanitizedMetadata.uploadId);
  });

  it('produces different uploadIds for different projects', () => {
    const a = validateDwgUpload(happy({ projectId: 'proj-A' }), NOW);
    const b = validateDwgUpload(happy({ projectId: 'proj-B' }), NOW);
    expect(a.sanitizedMetadata.uploadId).not.toBe(b.sanitizedMetadata.uploadId);
  });

  it('produces different uploadIds for different timestamps', () => {
    const a = validateDwgUpload(happy(), new Date('2026-01-01T00:00:00Z'));
    const b = validateDwgUpload(happy(), new Date('2026-01-01T00:00:01Z'));
    expect(a.sanitizedMetadata.uploadId).not.toBe(b.sanitizedMetadata.uploadId);
  });

  it('uploadId is sha256-shaped (dwg-<64 hex>)', () => {
    const r = validateDwgUpload(happy(), NOW);
    expect(r.sanitizedMetadata.uploadId).toMatch(/^dwg-[0-9a-f]{64}$/);
  });
});

describe('validateDwgUpload — sha256 implementation sanity', () => {
  it('matches the FIPS 180-4 known answer for "abc"', () => {
    expect(__internal.sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });

  it('matches the known answer for empty string', () => {
    expect(__internal.sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
  });
});

describe('validateDwgUpload — combined failures', () => {
  it('returns multiple findings when several rules fail', () => {
    const r = validateDwgUpload(
      {
        filename: '../bad.zip',
        byteSize: 0,
        uploadedByUid: '',
        projectId: '',
        declaredKind: 'electrical',
        declaredVersion: 'not-semver',
        declaredScale: 'nope',
      },
      NOW
    );
    expect(r.valid).toBe(false);
    const kinds = r.findings.map((f) => f.kind);
    expect(kinds).toContain('filename_path_traversal');
    expect(kinds).toContain('extension_invalid');
    expect(kinds).toContain('size_zero');
    expect(kinds).toContain('uploaded_by_uid_empty');
    expect(kinds).toContain('project_id_empty');
    expect(kinds).toContain('version_invalid');
    expect(kinds).toContain('scale_invalid');
  });
});
