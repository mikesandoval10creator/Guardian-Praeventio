// Praeventio Guard — Sprint 44 §108: Desduplicador de Registros.
//
// Cierra §108 de la 2da tanda usuario: detecta registros probablemente
// duplicados (mismo trabajador, mismo equipo, misma faena ingresados
// múltiples veces vía Excel/manual) y sugiere fusiones.
//
// 100% determinístico. Compara registros con varias heurísticas:
//   - Exact match en clave canónica (RUT trabajador, serial equipo)
//   - Fuzzy match (Levenshtein <=2 en nombre normalizado)
//   - Phonetic-ish match (mismas iniciales + último apellido)
//   - Same email / phone normalizado
//
// Output: clusters de candidatos con score de confianza + recomendación
// (merge automático si confidence ≥0.95, sugerir si ≥0.7, ignorar <0.7).

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type RecordKind = 'worker' | 'equipment' | 'project' | 'contractor';

export interface DedupRecord {
  id: string;
  kind: RecordKind;
  /** Nombre human-readable. */
  name: string;
  /** Clave canónica fuerte (RUT, serial, slug) si existe. */
  canonicalKey?: string;
  /** Email normalizado (lowercase). */
  email?: string;
  /** Teléfono normalizado (solo dígitos). */
  phone?: string;
  /** Fecha de creación (registros más antiguos suelen ser "el verdadero"). */
  createdAt: string;
  /** Fields adicionales para tie-breaking. */
  metadata?: Record<string, unknown>;
}

export type MatchReason =
  | 'canonical_key_exact'
  | 'email_exact'
  | 'phone_exact'
  | 'name_fuzzy'
  | 'name_initials'
  | 'name_exact_case_insensitive';

export interface DuplicateCandidate {
  /** ID del registro "ancla" (creado primero). */
  primaryId: string;
  /** IDs de duplicados sospechosos. */
  duplicateIds: string[];
  /** Score 0..1 de confianza de que son el mismo. */
  confidence: number;
  reasons: MatchReason[];
  recommendedAction: 'auto_merge' | 'suggest_merge' | 'review_only';
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Levenshtein distance (capped — devuelve cap+1 si excede). */
function levenshtein(a: string, b: string, cap = 5): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const dp = new Array(b.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = i;
    let prevDiag = i - 1;
    for (let j = 1; j <= b.length; j++) {
      const curr = dp[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(prev + 1, dp[j] + 1, prevDiag + cost);
      prev = dp[j];
      prevDiag = curr;
    }
    if (Math.min(...dp) > cap) return cap + 1;
  }
  return dp[b.length];
}

function initialsKey(name: string): string {
  const tokens = normalizeName(name).split(' ').filter(Boolean);
  if (tokens.length === 0) return '';
  const lastToken = tokens[tokens.length - 1]!;
  const firstInitial = (tokens[0] ?? '')[0] ?? '';
  return `${firstInitial}.${lastToken}`;
}

// ────────────────────────────────────────────────────────────────────────
// Pair scoring
// ────────────────────────────────────────────────────────────────────────

interface PairMatch {
  confidence: number;
  reasons: MatchReason[];
}

function scorePair(a: DedupRecord, b: DedupRecord): PairMatch | null {
  if (a.kind !== b.kind) return null;
  const reasons: MatchReason[] = [];
  let confidence = 0;

  if (a.canonicalKey && b.canonicalKey && a.canonicalKey === b.canonicalKey) {
    return { confidence: 1, reasons: ['canonical_key_exact'] };
  }

  if (a.email && b.email && normalizeEmail(a.email) === normalizeEmail(b.email)) {
    confidence = Math.max(confidence, 0.85);
    reasons.push('email_exact');
  }

  if (a.phone && b.phone) {
    const pa = normalizePhone(a.phone);
    const pb = normalizePhone(b.phone);
    // Match en últimos 9 dígitos (cubre country code prefix) y require
    // al menos 8 dígitos en ambos para evitar matches espurios.
    if (pa.length >= 8 && pb.length >= 8) {
      const tailLen = Math.min(pa.length, pb.length, 9);
      const ta = pa.slice(-tailLen);
      const tb = pb.slice(-tailLen);
      if (ta === tb) {
        confidence = Math.max(confidence, 0.8);
        reasons.push('phone_exact');
      }
    }
  }

  const na = normalizeName(a.name);
  const nb = normalizeName(b.name);
  if (na && nb) {
    if (na === nb) {
      confidence = Math.max(confidence, 0.7);
      reasons.push('name_exact_case_insensitive');
    } else {
      const dist = levenshtein(na, nb, 3);
      if (dist <= 2 && Math.min(na.length, nb.length) >= 5) {
        confidence = Math.max(confidence, 0.65);
        reasons.push('name_fuzzy');
      } else if (initialsKey(a.name) === initialsKey(b.name) && initialsKey(a.name).length >= 3) {
        confidence = Math.max(confidence, 0.5);
        reasons.push('name_initials');
      }
    }
  }

  // Cumulative boost: si dos señales fuertes coinciden, sube confianza.
  if (reasons.length >= 2) {
    confidence = Math.min(1, confidence + 0.1);
  }

  if (confidence === 0) return null;
  return { confidence, reasons };
}

// ────────────────────────────────────────────────────────────────────────
// Cluster builder
// ────────────────────────────────────────────────────────────────────────

export interface DedupOptions {
  /** Umbral mínimo para reportar candidato (default 0.5). */
  reviewThreshold?: number;
  /** Umbral para sugerir merge (default 0.7). */
  suggestThreshold?: number;
  /** Umbral para auto-merge (default 0.95). */
  autoMergeThreshold?: number;
}

export function detectDuplicates(
  records: ReadonlyArray<DedupRecord>,
  options: DedupOptions = {},
): DuplicateCandidate[] {
  const review = options.reviewThreshold ?? 0.5;
  const suggest = options.suggestThreshold ?? 0.7;
  const auto = options.autoMergeThreshold ?? 0.95;

  // Union-find por kind+anchor
  const byId = new Map(records.map((r) => [r.id, r] as const));
  const parent = new Map<string, string>();
  const matches = new Map<string, { confidence: number; reasons: Set<MatchReason> }>();
  for (const r of records) parent.set(r.id, r.id);

  function find(x: string): string {
    while (parent.get(x) !== x) {
      const p = parent.get(x)!;
      parent.set(x, parent.get(p)!);
      x = parent.get(x)!;
    }
    return x;
  }

  function union(a: string, b: string, match: PairMatch): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) {
      // El más antiguo gana como root (createdAt asc).
      const recA = byId.get(ra)!;
      const recB = byId.get(rb)!;
      const root =
        Date.parse(recA.createdAt) <= Date.parse(recB.createdAt) ? ra : rb;
      const other = root === ra ? rb : ra;
      parent.set(other, root);

      const prev = matches.get(root) ?? { confidence: 0, reasons: new Set() };
      const next = {
        confidence: Math.max(prev.confidence, match.confidence),
        reasons: new Set([...prev.reasons, ...match.reasons]),
      };
      matches.set(root, next);
      matches.delete(other);
    } else {
      const prev = matches.get(ra) ?? { confidence: 0, reasons: new Set() };
      prev.confidence = Math.max(prev.confidence, match.confidence);
      match.reasons.forEach((r) => prev.reasons.add(r));
      matches.set(ra, prev);
    }
  }

  for (let i = 0; i < records.length; i++) {
    for (let j = i + 1; j < records.length; j++) {
      const m = scorePair(records[i]!, records[j]!);
      if (m && m.confidence >= review) {
        union(records[i]!.id, records[j]!.id, m);
      }
    }
  }

  // Reagrupar por raíz
  const groups = new Map<string, string[]>();
  for (const r of records) {
    const root = find(r.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(r.id);
  }

  const candidates: DuplicateCandidate[] = [];
  for (const [root, ids] of groups) {
    if (ids.length < 2) continue;
    const match = matches.get(root) ?? { confidence: 0, reasons: new Set() };
    const recommendedAction: DuplicateCandidate['recommendedAction'] =
      match.confidence >= auto
        ? 'auto_merge'
        : match.confidence >= suggest
          ? 'suggest_merge'
          : 'review_only';
    candidates.push({
      primaryId: root,
      duplicateIds: ids.filter((id) => id !== root),
      confidence: Math.round(match.confidence * 100) / 100,
      reasons: [...match.reasons],
      recommendedAction,
    });
  }

  return candidates.sort((a, b) => b.confidence - a.confidence);
}

// ────────────────────────────────────────────────────────────────────────
// Merge plan
// ────────────────────────────────────────────────────────────────────────

export interface MergePlan {
  primaryId: string;
  duplicateIds: string[];
  /** Campos a copiar del duplicado al primary si están vacíos en primary. */
  fieldsToPromote: string[];
  /** Edges (links Zettelkasten) que se reasignan al primary. */
  edgeReassignmentCount: number;
}

export function buildMergePlan(
  candidate: DuplicateCandidate,
  records: ReadonlyArray<DedupRecord>,
  edgesOnDuplicates: Record<string, number> = {},
): MergePlan {
  const primary = records.find((r) => r.id === candidate.primaryId);
  const fieldsToPromote: string[] = [];
  if (primary) {
    if (!primary.email && candidate.duplicateIds.some((id) => records.find((r) => r.id === id)?.email)) {
      fieldsToPromote.push('email');
    }
    if (!primary.phone && candidate.duplicateIds.some((id) => records.find((r) => r.id === id)?.phone)) {
      fieldsToPromote.push('phone');
    }
    if (!primary.canonicalKey && candidate.duplicateIds.some((id) => records.find((r) => r.id === id)?.canonicalKey)) {
      fieldsToPromote.push('canonicalKey');
    }
  }
  const edgeReassignmentCount = candidate.duplicateIds.reduce(
    (s, id) => s + (edgesOnDuplicates[id] ?? 0),
    0,
  );
  return {
    primaryId: candidate.primaryId,
    duplicateIds: candidate.duplicateIds,
    fieldsToPromote,
    edgeReassignmentCount,
  };
}
