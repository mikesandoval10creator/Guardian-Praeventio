// Praeventio Guard — First Responder feed mapping (PURE).
//
// Closes PHASE5-REMEDIATION.md (was BLOCKED "lacking a real responder presence
// feed"). The engine `firstResponderMap.ts` needs `Responder[]`. This module
// maps the REAL brigade roster + REAL last-known positions + an HONEST
// availability flag into that shape. NO fabrication: a roster member with no
// recent position ping is returned with `currentPosition` omitted, which the
// engine treats as `no_position_known` -> unavailable. 100% deterministic,
// zero side effects (CLAUDE.md rule #9 — no Firestore I/O here; the route layer
// fetches, this module maps).

import type {
  Responder,
  ResponderRole,
  AvailabilityState,
} from './firstResponderMap.js';
import type {
  BrigadeMember,
  BrigadeRole,
} from '../emergencyBrigade/emergencyBrigadeService.js';

/**
 * Last-known REAL position for a worker (derived from their own
 * `emergency_alerts` ping: uid + geo{lat,lng} + createdAt). NB: the current
 * SOS source (`emergency.ts` validateGeo) carries only lat/lng — `floor` is
 * accepted here defensively for a future floor-bearing feed but stays
 * `undefined` for today's source. We never synthesize a floor.
 */
export interface LastKnownPosition {
  uid: string;
  lat: number;
  lng: number;
  floor?: number;
  /** ISO-8601 of the ping. */
  seenAt: string;
}

/**
 * Map the brigade-domain role onto first-responder roles. This is a REAL,
 * documented mapping — not an invented certification. A brigade `first_aid`
 * member is, by Chilean DS44/brigade-training definition, a certified first
 * responder; `fire_response` maps to the fire brigade; etc. We never claim a
 * `paramedic`/`site_doctor` that the roster does not assert — those roles are
 * only produced by a future medical roster that carries them explicitly.
 */
export function brigadeRoleToResponderRoles(role: BrigadeRole): ResponderRole[] {
  switch (role) {
    case 'first_aid':
      return ['first_aid_certified'];
    case 'fire_response':
      return ['fire_brigade'];
    case 'brigade_chief':
      // Chief leads response + is first-aid trained per brigade minimums.
      return ['first_aid_certified', 'supervisor'];
    case 'evacuation_coordinator':
      return ['supervisor'];
    case 'communications':
      return ['mutual_contact'];
    default:
      return [];
  }
}

/**
 * Honest availability. A member is only `on_duty` when active AND their
 * training is currently valid (an expired-training brigadist is NOT a
 * deployable certified responder — fail-closed, mirroring
 * buildBrigadeCoverageReport's life-safety guard). Inactive -> `off_site`.
 * Active-but-expired/garbage-training -> `unavailable` (honest, not a
 * fabricated "ready").
 */
export function deriveAvailability(
  member: BrigadeMember,
  nowMs: number,
): AvailabilityState {
  if (!member.active) return 'off_site';
  const trainedMs = Date.parse(member.trainedAt);
  if (Number.isNaN(trainedMs)) return 'unavailable';
  const expiresMs = trainedMs + member.trainingValidYears * 365 * 86_400_000;
  if (expiresMs < nowMs) return 'unavailable';
  return 'on_duty';
}

/**
 * SIF (rescue/height/confined-space) certification is only asserted when the
 * roster genuinely carries a rescue-capable role. We never invent it. Today no
 * brigade role maps to SIF, so this returns false unless a future medical/
 * rescue roster row sets it — honest absence, surfaced by the engine as
 * `sif_cert_required_missing` for fall/confined incidents.
 */
export function deriveSif(_member: BrigadeMember): boolean {
  return false;
}

/**
 * Build one Responder from a roster row + (optional) real last-known position.
 * `position === undefined` => no recent ping => position omitted => engine
 * emits `no_position_known` and the responder is honestly unavailable for
 * dispatch.
 */
export function buildResponderFromRoster(
  member: BrigadeMember,
  name: string,
  position: LastKnownPosition | undefined,
  nowMs: number,
): Responder {
  const availability = deriveAvailability(member, nowMs);
  const responder: Responder = {
    uid: member.workerUid,
    name,
    roles: brigadeRoleToResponderRoles(member.role),
    availability,
    sifCertified: deriveSif(member),
  };
  if (position) {
    responder.currentPosition = {
      lat: position.lat,
      lng: position.lng,
      ...(position.floor != null ? { floor: position.floor } : {}),
    };
    responder.lastSeenAt = position.seenAt;
  }
  return responder;
}

/**
 * Precedence for merging the availability of a worker who holds two brigade
 * roster rows. Lower index = higher signal. Keeps the surfaced availability
 * deterministic regardless of row order.
 */
const AVAILABILITY_PRECEDENCE: AvailabilityState[] = [
  'on_duty',
  'in_response',
  'on_break',
  'unavailable',
  'off_site',
];

function bestAvailability(
  a: AvailabilityState,
  b: AvailabilityState,
): AvailabilityState {
  const ia = AVAILABILITY_PRECEDENCE.indexOf(a);
  const ib = AVAILABILITY_PRECEDENCE.indexOf(b);
  return ia <= ib ? a : b;
}

/**
 * Assemble the full feed. `roster` and `positionsByUid` come from REAL
 * Firestore reads in the route layer; this stays pure. A member with no entry
 * in `positionsByUid` (no recent ping) is mapped honestly as position-less.
 * A worker can hold multiple brigade roles, so duplicate roster rows for the
 * same uid MERGE their responder roles (and keep any known position / the
 * best availability) rather than dropping one.
 */
export function buildResponderFeed(
  roster: ReadonlyArray<BrigadeMember>,
  nameByUid: Readonly<Record<string, string>>,
  positionsByUid: Readonly<Record<string, LastKnownPosition>>,
  now: Date,
): Responder[] {
  const nowMs = now.getTime();
  const byUid = new Map<string, Responder>();
  for (const member of roster) {
    const name = nameByUid[member.workerUid] ?? member.workerUid;
    const pos = positionsByUid[member.workerUid];
    const built = buildResponderFromRoster(member, name, pos, nowMs);
    const existing = byUid.get(member.workerUid);
    if (!existing) {
      byUid.set(member.workerUid, built);
      continue;
    }
    // Same worker, second brigade role -> merge roles, keep best availability
    // and any known position.
    const mergedRoles = Array.from(
      new Set([...existing.roles, ...built.roles]),
    );
    byUid.set(member.workerUid, {
      ...existing,
      roles: mergedRoles,
      availability: bestAvailability(existing.availability, built.availability),
      currentPosition: existing.currentPosition ?? built.currentPosition,
      lastSeenAt: existing.lastSeenAt ?? built.lastSeenAt,
      sifCertified: existing.sifCertified || built.sifCertified,
    });
  }
  return Array.from(byUid.values());
}
