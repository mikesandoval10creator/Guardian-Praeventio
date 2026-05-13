// Praeventio Guard — Sprint 41 Fase F.23: Versionado de Documentos.
//
// Cierra Plan F.23 "Versionado Documentos (subcollection
// documents/{id}/versions/{vId} con autor, aprobador, diff, replaces)".
//
// Motor puro que razona sobre versiones de documentos:
//   - Cómo construir una nueva versión (semver-style bump)
//   - Cómo detectar cambios entre versiones (diff por campo)
//   - Cómo validar la cadena (no romper la inmutabilidad de versiones
//     firmadas)
//   - Cómo identificar la versión activa
//   - Cómo armar el changelog para mostrar al CPHS

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type VersionStatus = 'draft' | 'in_review' | 'approved' | 'superseded' | 'retired';

export interface DocumentVersion {
  /** ID del documento parent. */
  documentId: string;
  /** Version id (semver: '1.0.0', '1.1.0', '2.0.0'). */
  versionId: string;
  /** Contenido (markdown / texto). */
  content: string;
  /** Hash SHA-256 del content (caller lo calcula). */
  contentHash: string;
  /** Resumen de cambios respecto a la versión anterior. */
  changeNotes?: string;
  status: VersionStatus;
  /** UID del autor. */
  authorUid: string;
  /** ISO-8601 cuando se creó. */
  createdAt: string;
  /** UID del aprobador (CPHS, supervisor). */
  approvedByUid?: string;
  approvedAt?: string;
  /** versionId de la versión a la que reemplaza. */
  replacesVersionId?: string;
  /** Si fue marcada superseded por una versión posterior. */
  supersededByVersionId?: string;
  supersededAt?: string;
}

export interface VersionChain {
  documentId: string;
  versions: DocumentVersion[];
}

// ────────────────────────────────────────────────────────────────────────
// Version bump
// ────────────────────────────────────────────────────────────────────────

export type BumpKind = 'patch' | 'minor' | 'major';

/**
 * Parsea un semver "X.Y.Z" o devuelve null.
 */
export function parseSemver(v: string): { major: number; minor: number; patch: number } | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!m) return null;
  return { major: parseInt(m[1], 10), minor: parseInt(m[2], 10), patch: parseInt(m[3], 10) };
}

export function formatSemver(p: { major: number; minor: number; patch: number }): string {
  return `${p.major}.${p.minor}.${p.patch}`;
}

export function bumpVersion(current: string, kind: BumpKind): string {
  const parsed = parseSemver(current) ?? { major: 0, minor: 0, patch: 0 };
  if (kind === 'major') return formatSemver({ major: parsed.major + 1, minor: 0, patch: 0 });
  if (kind === 'minor') return formatSemver({ major: parsed.major, minor: parsed.minor + 1, patch: 0 });
  return formatSemver({ major: parsed.major, minor: parsed.minor, patch: parsed.patch + 1 });
}

// ────────────────────────────────────────────────────────────────────────
// New version construction
// ────────────────────────────────────────────────────────────────────────

export interface CreateNextVersionInput {
  chain: VersionChain;
  newContent: string;
  newContentHash: string;
  authorUid: string;
  bumpKind: BumpKind;
  changeNotes?: string;
  now?: Date;
}

export class VersionImmutabilityError extends Error {
  constructor(public readonly code: string, msg: string) {
    super(`[${code}] ${msg}`);
    this.name = 'VersionImmutabilityError';
  }
}

/**
 * Construye la siguiente versión SIN mutar la cadena entrante. Returns
 * la nueva versión (caller la persiste).
 */
export function buildNextVersion(input: CreateNextVersionInput): DocumentVersion {
  const now = input.now ?? new Date();
  const chain = input.chain;
  const latest = pickLatestVersion(chain);

  // No se puede crear nueva versión si la última está draft (debería
  // promoverse o descartarse primero).
  if (latest && latest.status === 'draft') {
    throw new VersionImmutabilityError(
      'DRAFT_PENDING',
      `Latest version ${latest.versionId} is still draft. Promote o descartar antes de crear nueva.`,
    );
  }

  const newId = latest ? bumpVersion(latest.versionId, input.bumpKind) : '1.0.0';

  return {
    documentId: chain.documentId,
    versionId: newId,
    content: input.newContent,
    contentHash: input.newContentHash,
    changeNotes: input.changeNotes,
    status: 'draft',
    authorUid: input.authorUid,
    createdAt: now.toISOString(),
    replacesVersionId: latest?.versionId,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Chain helpers
// ────────────────────────────────────────────────────────────────────────

function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return a.localeCompare(b);
  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  return pa.patch - pb.patch;
}

export function pickLatestVersion(chain: VersionChain): DocumentVersion | null {
  if (chain.versions.length === 0) return null;
  return [...chain.versions].sort((a, b) => compareSemver(b.versionId, a.versionId))[0];
}

/**
 * La versión "activa" es la approved más reciente que NO está superseded.
 */
export function pickActiveVersion(chain: VersionChain): DocumentVersion | null {
  const candidates = chain.versions.filter(
    (v) => v.status === 'approved' && !v.supersededByVersionId,
  );
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => compareSemver(b.versionId, a.versionId))[0];
}

// ────────────────────────────────────────────────────────────────────────
// Validation
// ────────────────────────────────────────────────────────────────────────

export interface ChainValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateChain(chain: VersionChain): ChainValidationResult {
  const errors: string[] = [];
  const ids = new Set<string>();
  const sortedAsc = [...chain.versions].sort((a, b) =>
    compareSemver(a.versionId, b.versionId),
  );

  for (const v of sortedAsc) {
    if (ids.has(v.versionId)) {
      errors.push(`Duplicate versionId ${v.versionId}`);
    }
    ids.add(v.versionId);
    if (!parseSemver(v.versionId)) {
      errors.push(`Invalid semver ${v.versionId}`);
    }
    if (v.status === 'approved' && !v.approvedByUid) {
      errors.push(`Version ${v.versionId} approved sin approvedByUid`);
    }
  }

  // replacesVersionId debe apuntar a una versión existente (excepto 1.0.0)
  for (const v of sortedAsc) {
    if (v.replacesVersionId && !ids.has(v.replacesVersionId)) {
      errors.push(`Version ${v.versionId} replaces unknown ${v.replacesVersionId}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// ────────────────────────────────────────────────────────────────────────
// Diff (field-level)
// ────────────────────────────────────────────────────────────────────────

export interface VersionDiff {
  fromVersionId: string;
  toVersionId: string;
  /** Si el content_hash cambió. */
  contentChanged: boolean;
  /** Líneas agregadas (texto). */
  addedLines: string[];
  /** Líneas eliminadas. */
  removedLines: string[];
  /** Tamaño del cambio (chars). */
  charsAdded: number;
  charsRemoved: number;
}

export function diffVersions(a: DocumentVersion, b: DocumentVersion): VersionDiff {
  const aLines = a.content.split('\n');
  const bLines = b.content.split('\n');

  // Codex P2 PR #104: multiset-aware diff. La versión Set-based colapsa
  // duplicados: 'A\nB' → 'A\nB\nB' reportaba 0 added lines aunque
  // contentChanged=true. Usamos Map<line, count> y restamos.
  function countLines(lines: string[]): Map<string, number> {
    const m = new Map<string, number>();
    for (const l of lines) m.set(l, (m.get(l) ?? 0) + 1);
    return m;
  }
  const aRemaining = countLines(aLines);
  const addedLines: string[] = [];
  for (const l of bLines) {
    const r = aRemaining.get(l) ?? 0;
    if (r > 0) aRemaining.set(l, r - 1);
    else addedLines.push(l);
  }
  const bRemaining = countLines(bLines);
  const removedLines: string[] = [];
  for (const l of aLines) {
    const r = bRemaining.get(l) ?? 0;
    if (r > 0) bRemaining.set(l, r - 1);
    else removedLines.push(l);
  }

  const charsAdded = addedLines.reduce((s, l) => s + l.length, 0);
  const charsRemoved = removedLines.reduce((s, l) => s + l.length, 0);

  return {
    fromVersionId: a.versionId,
    toVersionId: b.versionId,
    contentChanged: a.contentHash !== b.contentHash,
    addedLines,
    removedLines,
    charsAdded,
    charsRemoved,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Changelog
// ────────────────────────────────────────────────────────────────────────

export interface ChangelogEntry {
  versionId: string;
  date: string;
  authorUid: string;
  changeNotes: string;
  status: VersionStatus;
}

export function buildChangelog(chain: VersionChain): ChangelogEntry[] {
  return [...chain.versions]
    .sort((a, b) => compareSemver(b.versionId, a.versionId))
    .map((v) => ({
      versionId: v.versionId,
      date: v.createdAt,
      authorUid: v.authorUid,
      changeNotes: v.changeNotes ?? '(sin notas)',
      status: v.status,
    }));
}
