// SPDX-License-Identifier: MIT
//
// Sprint 25 — Privacy by Design (ADR 0010) — ShiftWindow guard
//
// Cualquier lectura de datos de salud DEBE estar enmarcada dentro de
// un ShiftWindow activo. Fuera del turno, las funciones de salud
// retornan null/[] o lanzan ShiftWindowError. Sin excepciones.
//
// Este módulo es el guard arquitectónico que enforce el principio
// del ADR 0010: "datos íntimos del trabajador son sagrados; la app
// solo opera dentro del perímetro físico y temporal de faena".

export interface ShiftWindow {
  /** Inicio del turno (fichado entrada), epoch ms. */
  startMs: number;
  /** Fin del turno (fichado salida), epoch ms. Puede estar en el futuro
   *  si el turno está aún activo (use `endMs > Date.now()`). */
  endMs: number;
  /** Proyecto al que pertenece el turno. */
  projectId: string;
  /** UID del trabajador. */
  workerUid: string;
}

export class ShiftWindowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShiftWindowError';
  }
}

/**
 * Verifica que un range temporal cae completamente dentro del turno.
 * Si el range escapa al turno, throws ShiftWindowError.
 */
export function assertWithinShift(
  shift: ShiftWindow | null | undefined,
  rangeStartMs: number,
  rangeEndMs: number,
): asserts shift is ShiftWindow {
  if (!shift) {
    throw new ShiftWindowError(
      'No active shift — health data reads are forbidden outside faena. ' +
        'See ADR 0010.',
    );
  }
  if (rangeStartMs < shift.startMs) {
    throw new ShiftWindowError(
      `Read range [${rangeStartMs}, ${rangeEndMs}] starts before shift ` +
        `(${shift.startMs}). Datos pre-turno son privados (ADR 0010).`,
    );
  }
  if (rangeEndMs > shift.endMs) {
    throw new ShiftWindowError(
      `Read range [${rangeStartMs}, ${rangeEndMs}] ends after shift ` +
        `(${shift.endMs}). Datos post-turno son privados (ADR 0010).`,
    );
  }
}

/**
 * Versión soft: retorna boolean en vez de throw. Útil cuando queremos
 * esconder UI silenciosamente.
 */
export function isWithinShift(
  shift: ShiftWindow | null | undefined,
  rangeStartMs: number,
  rangeEndMs: number,
): boolean {
  try {
    assertWithinShift(shift, rangeStartMs, rangeEndMs);
    return true;
  } catch {
    return false;
  }
}

/**
 * Clamp un range temporal al ShiftWindow. Si el range queda vacío
 * después del clamp, retorna null. Útil para queries best-effort
 * que no deben bloquear UI con throw.
 *
 * @example
 * const clamped = clampToShift(shift, requestedStart, requestedEnd);
 * if (!clamped) return [];  // fuera de turno
 * return facade.getHeartRate(clamped.startMs, clamped.endMs);
 */
export function clampToShift(
  shift: ShiftWindow | null | undefined,
  rangeStartMs: number,
  rangeEndMs: number,
): { startMs: number; endMs: number } | null {
  if (!shift) return null;
  const startMs = Math.max(rangeStartMs, shift.startMs);
  const endMs = Math.min(rangeEndMs, shift.endMs);
  if (endMs <= startMs) return null;
  return { startMs, endMs };
}

/**
 * Verifica si un timestamp dado está dentro del shift activo.
 */
export function isTimestampInShift(
  shift: ShiftWindow | null | undefined,
  timestampMs: number,
): boolean {
  if (!shift) return false;
  return timestampMs >= shift.startMs && timestampMs <= shift.endMs;
}

/**
 * Filtra un array de samples (con timestamp) al rango del shift.
 * Útil cuando un facade nativo retorna datos crudos de un range
 * más amplio del que pedimos — el guard final corre acá.
 */
export function filterSamplesToShift<T extends { timestampMs: number }>(
  shift: ShiftWindow | null | undefined,
  samples: T[],
): T[] {
  if (!shift) return [];
  return samples.filter(
    (s) => s.timestampMs >= shift.startMs && s.timestampMs <= shift.endMs,
  );
}
