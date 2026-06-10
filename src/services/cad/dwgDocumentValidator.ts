// SPDX-License-Identifier: MIT
// Sprint 50 E.5 P2 H1 — DWG document validator (pre-upload).
//
// Pure, deterministic motor that validates DWG/DXF/DWF metadata BEFORE
// the bytes are uploaded to the LibreDWG Cloud Run converter (see ADR
// 0008). The goal is to reject obviously-broken uploads at the edge so
// we don't burn Cloud Run quota / GCS egress on malformed input, and to
// attach a stable upload identifier for idempotency / audit log.
//
// This module is INTENTIONALLY isolated from `dwgAdapter.ts` (the
// network-bound Cloud Run client) and `dxfAdapter.ts` (the parsed-DXF
// shaper). It performs zero I/O, zero parsing of the file bytes
// themselves — only the user-declared metadata.
//
// Wired into `src/server/routes/cad.ts` upload endpoint when present.

/** What the caller asserts about the file being uploaded. */
export interface DwgValidationInput {
  filename: string;
  byteSize: number;
  uploadedByUid: string;
  projectId: string;
  declaredKind:
    | 'site_plan'
    | 'electrical'
    | 'mechanical'
    | 'piping'
    | 'structural'
    | 'as_built'
    | 'concept';
  /** Optional semver X.Y.Z (e.g. "1.2.3"). */
  declaredVersion?: string;
  /** Optional architectural scale "1:N" with N > 0 (e.g. "1:100"). */
  declaredScale?: string;
}

export type DwgValidationKind =
  | 'extension_invalid'
  | 'size_zero'
  | 'size_negative'
  | 'size_too_large'
  | 'filename_path_traversal'
  | 'filename_null_byte'
  | 'filename_empty'
  | 'kind_invalid'
  | 'version_invalid'
  | 'scale_invalid'
  | 'project_id_empty'
  | 'uploaded_by_uid_empty';

export interface DwgValidationFinding {
  kind: DwgValidationKind;
  detail: string;
}

export interface DwgValidationResult {
  valid: boolean;
  findings: DwgValidationFinding[];
  warnings: string[];
  sanitizedMetadata: DwgValidationInput & {
    uploadId: string;
    uploadedAt: string;
  };
}

const ALLOWED_EXTENSIONS: ReadonlyArray<string> = ['.dwg', '.dxf', '.dwf'];

const ALLOWED_KINDS: ReadonlyArray<DwgValidationInput['declaredKind']> = [
  'site_plan',
  'electrical',
  'mechanical',
  'piping',
  'structural',
  'as_built',
  'concept',
];

/** 50 MB hard cap; the Cloud Run converter envelope is 100 MB but we
 *  enforce a tighter limit so single-shot signed-PUT uploads finish in a
 *  reasonable mobile-network window. Aligned with H1 spec. */
export const DWG_MAX_BYTE_SIZE = 50 * 1024 * 1024;
/** 1 KB minimum — anything smaller is almost certainly empty/truncated. */
export const DWG_MIN_BYTE_SIZE = 1024;

const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const SCALE_RE = /^1:\d+$/;

const QUALITY_WARNING_TOKENS: ReadonlyArray<string> = [
  'final',
  'last',
  'latest',
];

/** Stable sha256 hex of a UTF-8 string. Synchronous, no DOM/Node API
 *  imports — uses a tiny pure JS sha256 (~80 LOC) so the validator stays
 *  deterministic and bundle-safe (browser + Node + workers). */
function sha256Hex(message: string): string {
  // FIPS 180-4 sha256. Pure JS, no deps. Lifted from public-domain
  // reference (Mozilla MDN / RFC 6234). Adapted to TypeScript with
  // bitwise ops on 32-bit unsigned ints.
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  // Encode message as UTF-8 bytes.
  const bytes: number[] = [];
  for (let i = 0; i < message.length; i++) {
    const c = message.charCodeAt(i);
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) {
      bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c < 0xd800 || c >= 0xe000) {
      bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    } else {
      // surrogate pair
      i++;
      const c2 = message.charCodeAt(i);
      const cp = 0x10000 + (((c & 0x3ff) << 10) | (c2 & 0x3ff));
      bytes.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f)
      );
    }
  }
  const l = bytes.length;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const bitLen = l * 8;
  // 64-bit big-endian length (top 32 bits zero — messages <512MB).
  bytes.push(0, 0, 0, 0);
  bytes.push(
    (bitLen >>> 24) & 0xff,
    (bitLen >>> 16) & 0xff,
    (bitLen >>> 8) & 0xff,
    bitLen & 0xff
  );

  const H = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ];
  const w = new Array<number>(64);
  for (let chunk = 0; chunk < bytes.length; chunk += 64) {
    for (let i = 0; i < 16; i++) {
      const j = chunk + i * 4;
      w[i] =
        (bytes[j] << 24) |
        (bytes[j + 1] << 16) |
        (bytes[j + 2] << 8) |
        bytes[j + 3];
      w[i] >>>= 0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 =
        rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 =
        rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const mj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + mj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }
  return H.map((x) => x.toString(16).padStart(8, '0')).join('');
}

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

function hasExtension(filename: string): string | null {
  const lower = filename.toLowerCase();
  for (const ext of ALLOWED_EXTENSIONS) {
    if (lower.endsWith(ext)) return ext;
  }
  return null;
}

function isPathTraversal(filename: string): boolean {
  // Reject ../ , ..\ , raw backslash (Windows separators), absolute-ish
  // prefixes. We deliberately reject ANY backslash because filenames
  // arriving from a web upload should already be basename-only.
  if (filename.includes('../') || filename.includes('..\\')) return true;
  if (filename.includes('\\')) return true;
  if (filename.startsWith('/')) return true;
  return false;
}

function hasNullByte(filename: string): boolean {
  // Reject ASCII NUL (0x00) anywhere in the filename - classic null-byte injection.
  return filename.indexOf(String.fromCharCode(0)) !== -1;
}

function hasQualityWarningToken(filename: string): string | null {
  const lower = filename.toLowerCase();
  for (const token of QUALITY_WARNING_TOKENS) {
    // Match the token as a substring but only when bounded by non-alpha
    // (so "finalist.dwg" doesn't trigger; "plant-final.dwg" does).
    const re = new RegExp(`(^|[^a-z])${token}([^a-z]|$)`, 'i');
    if (re.test(lower)) return token;
  }
  return null;
}

/**
 * Validate a DWG/DXF/DWF upload's declared metadata. Pure & deterministic —
 * does NOT inspect file bytes. `now` is injectable so callers can pin
 * `uploadedAt` for tests / deterministic replay.
 */
export function validateDwgUpload(
  input: DwgValidationInput,
  now: Date = new Date()
): DwgValidationResult {
  const findings: DwgValidationFinding[] = [];
  const warnings: string[] = [];

  // --- filename ---
  const filename = (input.filename ?? '').trim();
  if (filename.length === 0) {
    findings.push({
      kind: 'filename_empty',
      detail: 'filename is required and must be non-empty',
    });
  } else {
    if (hasNullByte(filename)) {
      findings.push({
        kind: 'filename_null_byte',
        detail: 'filename contains a NUL byte',
      });
    }
    if (isPathTraversal(filename)) {
      findings.push({
        kind: 'filename_path_traversal',
        detail: 'filename contains path traversal or directory separator',
      });
    }
    if (!hasExtension(filename)) {
      findings.push({
        kind: 'extension_invalid',
        detail: `filename must end with one of ${ALLOWED_EXTENSIONS.join(', ')}`,
      });
    }
  }

  // --- byteSize ---
  if (typeof input.byteSize !== 'number' || !Number.isFinite(input.byteSize)) {
    findings.push({
      kind: 'size_negative',
      detail: 'byteSize must be a finite number',
    });
  } else if (input.byteSize < 0) {
    findings.push({
      kind: 'size_negative',
      detail: `byteSize ${input.byteSize} is negative`,
    });
  } else if (input.byteSize === 0) {
    findings.push({
      kind: 'size_zero',
      detail: 'byteSize is 0 — file appears empty',
    });
  } else if (input.byteSize < DWG_MIN_BYTE_SIZE) {
    findings.push({
      kind: 'size_zero',
      detail: `byteSize ${input.byteSize} below minimum ${DWG_MIN_BYTE_SIZE} bytes`,
    });
  } else if (input.byteSize > DWG_MAX_BYTE_SIZE) {
    findings.push({
      kind: 'size_too_large',
      detail: `byteSize ${input.byteSize} exceeds max ${DWG_MAX_BYTE_SIZE} bytes (50 MB)`,
    });
  }

  // --- declaredKind ---
  if (!input.declaredKind || !ALLOWED_KINDS.includes(input.declaredKind)) {
    findings.push({
      kind: 'kind_invalid',
      detail: `declaredKind must be one of ${ALLOWED_KINDS.join(', ')}`,
    });
  }

  // --- declaredVersion (optional) ---
  if (input.declaredVersion != null && input.declaredVersion !== '') {
    if (!SEMVER_RE.test(input.declaredVersion)) {
      findings.push({
        kind: 'version_invalid',
        detail: `declaredVersion "${input.declaredVersion}" must match X.Y.Z`,
      });
    }
  }

  // --- declaredScale (optional) ---
  if (input.declaredScale != null && input.declaredScale !== '') {
    if (!SCALE_RE.test(input.declaredScale)) {
      findings.push({
        kind: 'scale_invalid',
        detail: `declaredScale "${input.declaredScale}" must match 1:N with N>0`,
      });
    } else {
      const n = Number(input.declaredScale.slice(2));
      if (n <= 0) {
        findings.push({
          kind: 'scale_invalid',
          detail: `declaredScale "${input.declaredScale}" denominator must be > 0`,
        });
      }
    }
  }

  // --- project / uid ---
  if (!input.projectId || input.projectId.trim().length === 0) {
    findings.push({
      kind: 'project_id_empty',
      detail: 'projectId is required',
    });
  }
  if (!input.uploadedByUid || input.uploadedByUid.trim().length === 0) {
    findings.push({
      kind: 'uploaded_by_uid_empty',
      detail: 'uploadedByUid is required',
    });
  }

  // --- quality warnings (non-fatal) ---
  const token = hasQualityWarningToken(filename);
  if (token) {
    warnings.push(
      `filename contains "${token}" — prefer semver via declaredVersion (e.g. 1.2.3) instead of "${token}" suffixes`
    );
  }

  // --- sanitized metadata + stable upload id ---
  const uploadedAt = now.toISOString();
  const hashSeed = [
    input.projectId ?? '',
    input.filename ?? '',
    input.uploadedByUid ?? '',
    uploadedAt,
  ].join('|');
  const uploadId = `dwg-${sha256Hex(hashSeed)}`;

  return {
    valid: findings.length === 0,
    findings,
    warnings,
    sanitizedMetadata: {
      filename,
      byteSize: input.byteSize,
      uploadedByUid: input.uploadedByUid,
      projectId: input.projectId,
      declaredKind: input.declaredKind,
      declaredVersion: input.declaredVersion,
      declaredScale: input.declaredScale,
      uploadId,
      uploadedAt,
    },
  };
}

/** Exposed for tests / debugging. */
export const __internal = {
  sha256Hex,
  ALLOWED_EXTENSIONS,
  ALLOWED_KINDS,
};
