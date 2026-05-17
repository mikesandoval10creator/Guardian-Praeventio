// Praeventio Guard — §201-210 Bloques de Foco (core).
//
// Cierra: spec usuario "§201-210 — Agenda bloques foco".
//
// Bloques de foco protegidos para el prevencionista: tiempo blockeado en
// agenda para inspección, capacitación, auditoría o tareas administrativas
// críticas (cierre de hallazgos, redacción de informe, etc.).
//
// Distinto de `agenda/agendaScheduler.ts`:
//   - agendaScheduler maneja recordatorios + digests + DND.
//   - focusBlocks es el modelo de bloque per-se (creación, listado,
//     persistencia Firestore) — orquesta el qué, no el cómo notificar.
//
// El servicio expone:
//
//   - `createFocusBlock({ uid, startsAt, endsAt, kind })`: crea bloque,
//     valida coherencia mínima (start < end, kind soportado), persiste a
//     Firestore en `users/{uid}/focus_blocks/{id}`.
//   - `listUpcoming(uid)`: lee Firestore con `where('endsAt','>=',now)`
//     ordenado por `startsAt`. Devuelve array tipado.
//   - `deriveStatus(block, now)`: helper puro `upcoming | active | past`.
//   - `validateInputs(...)`: pure function — útil para forms y para tests
//     sin levantar Firestore.
//
// Sin endpoint server (puro client-side directo a Firestore con las
// reglas existentes para `users/{uid}/**`).

import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  setDoc,
  where,
  Timestamp,
} from 'firebase/firestore';

import { db } from '../firebase';
import { logger } from '../../utils/logger';
import { randomId } from '../../utils/randomId';

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type FocusBlockKind = 'inspection' | 'training' | 'audit' | 'admin';

/** Tipos válidos — para validación en runtime y en forms. */
export const FOCUS_BLOCK_KINDS: readonly FocusBlockKind[] = [
  'inspection',
  'training',
  'audit',
  'admin',
] as const;

export interface FocusBlock {
  id: string;
  uid: string;
  startsAt: string; // ISO 8601
  endsAt: string; // ISO 8601
  kind: FocusBlockKind;
  /** Marca opcional de notas/título corto. */
  note?: string;
  /** Cuándo se creó el bloque en el cliente — útil para audit. */
  createdAt: string;
}

export interface CreateFocusBlockInput {
  uid: string;
  startsAt: string | Date;
  endsAt: string | Date;
  kind: FocusBlockKind;
  note?: string;
  /** Sólo para tests: ID determinístico. */
  id?: string;
}

export type FocusBlockStatus = 'upcoming' | 'active' | 'past';

// ────────────────────────────────────────────────────────────────────────
// Pure helpers (testables sin Firestore)
// ────────────────────────────────────────────────────────────────────────

function toIso(value: string | Date): string {
  if (value instanceof Date) return value.toISOString();
  // Acepta cualquier string que `Date` entienda; lanza si no parsea.
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`focusBlocks: timestamp inválido "${value}"`);
  }
  return d.toISOString();
}

export interface ValidationResult {
  ok: boolean;
  /** Errores legibles en español (UI los muestra directo). */
  errors: string[];
}

/**
 * Valida los inputs SIN tocar Firestore. Garantiza:
 *   - uid no vacío
 *   - kind soportado
 *   - startsAt < endsAt
 *   - duración > 0 y ≤ 12h (límite del usuario por bloque de foco)
 *   - nota ≤ 280 caracteres si está presente
 */
export function validateInputs(input: CreateFocusBlockInput): ValidationResult {
  const errors: string[] = [];
  if (!input.uid || input.uid.trim() === '') {
    errors.push('uid requerido');
  }
  if (!FOCUS_BLOCK_KINDS.includes(input.kind)) {
    errors.push(`kind inválido (esperado: ${FOCUS_BLOCK_KINDS.join('|')})`);
  }
  let startsIso = '';
  let endsIso = '';
  try {
    startsIso = toIso(input.startsAt);
  } catch (err) {
    errors.push(`startsAt inválido: ${(err as Error).message}`);
  }
  try {
    endsIso = toIso(input.endsAt);
  } catch (err) {
    errors.push(`endsAt inválido: ${(err as Error).message}`);
  }
  if (startsIso && endsIso) {
    const startMs = Date.parse(startsIso);
    const endMs = Date.parse(endsIso);
    if (startMs >= endMs) {
      errors.push('startsAt debe ser anterior a endsAt');
    } else {
      const durMs = endMs - startMs;
      const durH = durMs / 3_600_000;
      if (durH > 12) {
        errors.push('Duración máxima por bloque: 12 horas');
      }
    }
  }
  if (input.note !== undefined && input.note.length > 280) {
    errors.push('Nota máxima 280 caracteres');
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Deriva el estado del bloque relativo a `now`. Pure — no toca side
 * effects ni Firestore.
 */
export function deriveStatus(
  block: Pick<FocusBlock, 'startsAt' | 'endsAt'>,
  now: Date = new Date(),
): FocusBlockStatus {
  const nowMs = now.getTime();
  const startMs = Date.parse(block.startsAt);
  const endMs = Date.parse(block.endsAt);
  if (nowMs < startMs) return 'upcoming';
  if (nowMs > endMs) return 'past';
  return 'active';
}

/**
 * Verifica si dos bloques se solapan en el tiempo. Útil para advertencias
 * en la UI antes de crear un bloque sobre otro existente.
 */
export function overlaps(
  a: Pick<FocusBlock, 'startsAt' | 'endsAt'>,
  b: Pick<FocusBlock, 'startsAt' | 'endsAt'>,
): boolean {
  const aStart = Date.parse(a.startsAt);
  const aEnd = Date.parse(a.endsAt);
  const bStart = Date.parse(b.startsAt);
  const bEnd = Date.parse(b.endsAt);
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Agrupa bloques por día (clave `YYYY-MM-DD` UTC), ordenando dentro de cada
 * día por `startsAt` ascendente.
 */
export function groupByDay(
  blocks: readonly FocusBlock[],
): Map<string, FocusBlock[]> {
  const out = new Map<string, FocusBlock[]>();
  for (const b of blocks) {
    const day = b.startsAt.slice(0, 10);
    let list = out.get(day);
    if (!list) {
      list = [];
      out.set(day, list);
    }
    list.push(b);
  }
  for (const list of out.values()) {
    list.sort((x, y) => x.startsAt.localeCompare(y.startsAt));
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────
// Firestore I/O
// ────────────────────────────────────────────────────────────────────────

function collectionRef(uid: string) {
  return collection(db, 'users', uid, 'focus_blocks');
}

/**
 * Crea un bloque de foco y lo persiste a Firestore. Si la validación
 * falla, lanza `Error` con la lista de errores legible — el caller (form)
 * los muestra al usuario. Si la red está caída, el caché persistente de
 * Firestore (configurado en `services/firebase.ts`) lo almacenará offline
 * y sincronizará después.
 */
export async function createFocusBlock(
  input: CreateFocusBlockInput,
): Promise<FocusBlock> {
  const v = validateInputs(input);
  if (!v.ok) {
    throw new Error(`focusBlocks.createFocusBlock: ${v.errors.join('; ')}`);
  }
  const id = input.id ?? randomId();
  const block: FocusBlock = {
    id,
    uid: input.uid,
    startsAt: toIso(input.startsAt),
    endsAt: toIso(input.endsAt),
    kind: input.kind,
    note: input.note,
    createdAt: new Date().toISOString(),
  };
  try {
    await setDoc(doc(collectionRef(input.uid), id), block);
    logger.info('focusBlocks.createFocusBlock: persisted', { id, uid: input.uid });
    return block;
  } catch (err) {
    logger.warn('focusBlocks.createFocusBlock: write failed', {
      err: String(err),
      uid: input.uid,
    });
    throw err;
  }
}

/**
 * Lee los bloques próximos del usuario (endsAt >= now), ordenados por
 * startsAt ascendente. Devuelve array vacío si no hay ninguno o si la
 * consulta falla (degraded reads — la UI debe manejar el caso).
 */
export async function listUpcoming(
  uid: string,
  now: Date = new Date(),
): Promise<FocusBlock[]> {
  if (!uid) return [];
  try {
    const nowIso = now.toISOString();
    const q = query(
      collectionRef(uid),
      where('endsAt', '>=', nowIso),
      orderBy('endsAt', 'asc'),
    );
    const snap = await getDocs(q);
    const out: FocusBlock[] = [];
    snap.forEach((d) => {
      const data = d.data() as FocusBlock;
      // Normaliza Timestamp Firestore → ISO si el doc fue creado con
      // serverTimestamp en alguna versión histórica.
      if ((data.startsAt as unknown) instanceof Timestamp) {
        data.startsAt = (data.startsAt as unknown as Timestamp).toDate().toISOString();
      }
      if ((data.endsAt as unknown) instanceof Timestamp) {
        data.endsAt = (data.endsAt as unknown as Timestamp).toDate().toISOString();
      }
      out.push(data);
    });
    // Resort defensivo por startsAt (la query ordena por endsAt).
    out.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    return out;
  } catch (err) {
    logger.warn('focusBlocks.listUpcoming: query failed', {
      err: String(err),
      uid,
    });
    return [];
  }
}

// ────────────────────────────────────────────────────────────────────────
// Helpers UI (semana actual)
// ────────────────────────────────────────────────────────────────────────

/**
 * Devuelve las 7 fechas (UTC, hora 00:00) de la semana que contiene `ref`.
 * Lunes-domingo (ISO). Útil para la vista semanal de la página.
 */
export function weekDates(ref: Date = new Date()): Date[] {
  const day = ref.getUTCDay(); // 0 dom .. 6 sáb
  // Convertir a "días desde lunes" → 0 lun .. 6 dom
  const offsetFromMonday = (day + 6) % 7;
  const monday = new Date(
    Date.UTC(
      ref.getUTCFullYear(),
      ref.getUTCMonth(),
      ref.getUTCDate() - offsetFromMonday,
    ),
  );
  return Array.from({ length: 7 }, (_, i) => {
    return new Date(monday.getTime() + i * 24 * 3_600_000);
  });
}
