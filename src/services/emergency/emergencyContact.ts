/**
 * Emergency contact resolution for the SOS human-fallback path.
 *
 * The SOS flow can fail in three ways: the transport fails, the server
 * answers but no responder was reached, or the request never left the
 * device. In all three the worker needs a HUMAN. Before this adapter the
 * only source was `project.phone`; when the project had no phone field the
 * worker was left with a toast telling them to "contact the supervisor" —
 * with no number to contact.
 *
 * The chain is deliberately conservative about what it auto-dials:
 *   1. `project.phone` — the supervisor who knows the site.
 *   2. `supervisorPhones` — an explicit fallback directory (when present).
 *   3. Nothing is auto-dialed from the public emergency numbers: calling
 *      police for a near-miss is a false alarm. Instead the regional
 *      numbers are surfaced as an INSTRUCTION so the worker decides.
 *
 * Pure by construction: no DOM, no network, fully injectable.
 */

import {
  getEmergencyNumbersByCoords,
  getEmergencyNumbersByRegion,
  type EmergencyNumbers,
  type GeoPoint,
} from './emergencyNumbers';

/** Where the chosen contact came from. */
export type EmergencyContactSource = 'project' | 'supervisor';

export interface EmergencyContact {
  /** Dial-ready number (digits only, no `tel:` prefix). */
  number: string;
  source: EmergencyContactSource;
  /** Human label for the toast, e.g. "tu supervisor". */
  label: string;
}

export interface EmergencyContactInput {
  /** `project.phone` from the selected project. */
  projectPhone?: string | null;
  /** Explicit supervisor fallback directory, in priority order. */
  supervisorPhones?: readonly (string | null | undefined)[];
  /** Worker coordinates, when the device could provide them. */
  geo?: GeoPoint | null;
  /** ISO region code, used when no coordinates are available. */
  regionCode?: string | null;
}

export interface EmergencyContactResolution {
  /** The number to auto-dial, or null when only an instruction is possible. */
  contact: EmergencyContact | null;
  /** Regional emergency numbers to show as an instruction. */
  regional: EmergencyNumbers | null;
}

/** Keep only digits and a leading `+`; drop everything else. */
function normalizePhone(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const sanitized = trimmed.replace(/[^\d+]/g, '');
  // A bare "+" or a string with no digits is not a dialable number.
  if (!sanitized || !/\d/.test(sanitized)) return null;
  return sanitized;
}

/**
 * Resolve the emergency contact for the current situation.
 *
 * Never throws: an unusable geo/region degrades to `regional: null`
 * instead of breaking the fallback path it exists to protect.
 */
export function resolveEmergencyContact(
  input: EmergencyContactInput = {},
): EmergencyContactResolution {
  const project = normalizePhone(input.projectPhone);
  if (project) {
    return { contact: { number: project, source: 'project', label: 'tu supervisor' }, regional: null };
  }

  const supervisors = Array.isArray(input.supervisorPhones) ? input.supervisorPhones : [];
  for (const candidate of supervisors) {
    const normalized = normalizePhone(candidate);
    if (normalized) {
      return {
        contact: { number: normalized, source: 'supervisor', label: 'tu supervisor de respaldo' },
        regional: null,
      };
    }
  }

  let regional: EmergencyNumbers | null = null;
  try {
    if (input.geo && typeof input.geo.lat === 'number' && typeof input.geo.lng === 'number') {
      regional = getEmergencyNumbersByCoords(input.geo);
    } else if (typeof input.regionCode === 'string' && input.regionCode.trim()) {
      regional = getEmergencyNumbersByRegion(input.regionCode);
    }
  } catch {
    regional = null;
  }

  return { contact: null, regional };
}

/**
 * Human-readable instruction used when there is no number to dial.
 * Lists the regional numbers so the worker can decide which to call.
 */
export function formatEmergencyInstruction(regional: EmergencyNumbers | null): string {
  if (!regional) {
    return 'Sin canal de teléfono disponible — pedí ayuda de inmediato y avisá a tu supervisor por otro medio.';
  }
  const parts = [`Police ${regional.police}`];
  if (regional.medical && regional.medical !== regional.police) parts.push(`Ambulancia ${regional.medical}`);
  if (regional.fire && regional.fire !== regional.police) parts.push(`Bomberos ${regional.fire}`);
  if (regional.universal) parts.push(`Universal ${regional.universal}`);
  return `Marcá a mano: ${parts.join(' · ')}.`;
}
