// Praeventio Guard — Sprint K: Mapa Comunicación + Escalamiento + Contactabilidad + Radio + Plan B.
//
// Cierra: Documento usuario "§216-221"
//
// Cadena de comunicación operacional:
//   - Mapa de canales: radio, fono, app, WhatsApp por rol
//   - Test mensual de contactabilidad (ping ↔ pong)
//   - Cobertura radio: zonas con/sin señal
//   - Plan B si falla canal primario
//   - Escalamiento por minutos sin respuesta
//
// Determinístico, sin LLM.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type CommunicationChannel = 'radio_uhf' | 'radio_vhf' | 'phone_cell' | 'phone_satellite' | 'app_push' | 'whatsapp' | 'face_to_face';

export interface ContactInfo {
  workerUid: string;
  role: string;
  /** Canales ordenados por preferencia. */
  channels: CommunicationChannel[];
  /** Frecuencia de radio si aplica. */
  radioChannel?: number;
  /** ISO-8601 último contactability test exitoso. */
  lastReachableAt?: string;
}

// ────────────────────────────────────────────────────────────────────────
// Channel availability map
// ────────────────────────────────────────────────────────────────────────

export interface ZoneCoverage {
  zoneId: string;
  /** Canales con cobertura confirmada en la zona. */
  availableChannels: CommunicationChannel[];
}

export function bestChannelForZone(
  contact: ContactInfo,
  zone: ZoneCoverage,
): CommunicationChannel | null {
  for (const c of contact.channels) {
    if (zone.availableChannels.includes(c)) return c;
  }
  return null;
}

export function detectDeadZones(
  zones: ZoneCoverage[],
  requiredChannels: CommunicationChannel[],
): ZoneCoverage[] {
  return zones.filter(
    (z) => !requiredChannels.some((c) => z.availableChannels.includes(c)),
  );
}

// ────────────────────────────────────────────────────────────────────────
// Escalation chain (§217)
// ────────────────────────────────────────────────────────────────────────

export interface EscalationLevel {
  level: number;
  /** UIDs a notificar en este nivel. */
  uids: string[];
  /** Cuántos minutos esperar antes de subir al siguiente nivel. */
  waitMinutes: number;
}

export interface EscalationDecision {
  currentLevel: number;
  recipientsToNotify: string[];
  shouldEscalate: boolean;
  nextLevelInMinutes?: number;
}

export function computeEscalation(
  chain: EscalationLevel[],
  minutesSinceTrigger: number,
): EscalationDecision {
  let cumulativeMinutes = 0;
  for (let i = 0; i < chain.length; i++) {
    const level = chain[i];
    if (minutesSinceTrigger >= cumulativeMinutes) {
      // Está en este nivel o ya pasó
      const nextLevel = chain[i + 1];
      const willEscalate =
        nextLevel && minutesSinceTrigger >= cumulativeMinutes + level.waitMinutes;
      if (willEscalate) {
        cumulativeMinutes += level.waitMinutes;
        continue; // sube al siguiente
      }
      return {
        currentLevel: level.level,
        recipientsToNotify: level.uids,
        shouldEscalate: false,
        nextLevelInMinutes: nextLevel
          ? cumulativeMinutes + level.waitMinutes - minutesSinceTrigger
          : undefined,
      };
    }
    cumulativeMinutes += level.waitMinutes;
  }
  // Llegamos al final sin parar — todos los niveles ya activados
  const last = chain[chain.length - 1];
  return {
    currentLevel: last?.level ?? 0,
    recipientsToNotify: last?.uids ?? [],
    shouldEscalate: false,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Monthly contactability test (§219)
// ────────────────────────────────────────────────────────────────────────

export interface ContactabilityTest {
  workerUid: string;
  testedAt: string;
  /** True si respondió en el tiempo esperado. */
  reachable: boolean;
  /** Canal que respondió. */
  channelUsed?: CommunicationChannel;
  /** Tiempo de respuesta (segundos). */
  responseSeconds?: number;
}

export interface ContactabilityReport {
  totalTested: number;
  reachable: number;
  unreachable: number;
  reachabilityPercent: number;
  /** UIDs unreachable. */
  unreachableUids: string[];
}

export function buildContactabilityReport(tests: ContactabilityTest[]): ContactabilityReport {
  const reachableTests = tests.filter((t) => t.reachable);
  const unreachableUids = tests.filter((t) => !t.reachable).map((t) => t.workerUid);
  const reachabilityPercent =
    tests.length > 0 ? Math.round((reachableTests.length / tests.length) * 100) : 0;
  return {
    totalTested: tests.length,
    reachable: reachableTests.length,
    unreachable: unreachableUids.length,
    reachabilityPercent,
    unreachableUids,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Plan B: primary channel failure (§221)
// ────────────────────────────────────────────────────────────────────────

export interface ChannelFailoverDecision {
  primaryChannel: CommunicationChannel;
  primaryAvailable: boolean;
  fallbackChannel: CommunicationChannel | null;
  fallbackAvailable: boolean;
  recommendedChannel: CommunicationChannel | null;
}

export function planChannelFailover(
  contact: ContactInfo,
  zone: ZoneCoverage,
  isPrimaryDown: boolean,
): ChannelFailoverDecision {
  const primary = contact.channels[0] ?? null;
  if (!primary) {
    return {
      primaryChannel: 'face_to_face',
      primaryAvailable: false,
      fallbackChannel: null,
      fallbackAvailable: false,
      recommendedChannel: null,
    };
  }
  const primaryAvailable = !isPrimaryDown && zone.availableChannels.includes(primary);
  // Buscar primer fallback que NO sea el primary, con cobertura en zona
  const fallback = contact.channels.slice(1).find((c) => zone.availableChannels.includes(c)) ?? null;
  const fallbackAvailable = fallback !== null && zone.availableChannels.includes(fallback);

  const recommendedChannel = primaryAvailable
    ? primary
    : fallbackAvailable
      ? fallback
      : null;

  return {
    primaryChannel: primary,
    primaryAvailable,
    fallbackChannel: fallback,
    fallbackAvailable,
    recommendedChannel,
  };
}
