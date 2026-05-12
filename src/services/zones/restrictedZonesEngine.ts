// Praeventio Guard — Sprint 39 Fase G.9: Zonas restringidas.
//
// Cierra: Documento usuario "Recomendaciones nuevas §21, §22"
//         Plan integral Top 15 #9
//
// Definir zonas dentro de una faena con reglas específicas y alertar
// cuando un trabajador intenta entrar sin cumplir requisitos.

export type ZoneKind =
  | 'hot' // trabajo en caliente
  | 'confined' // espacio confinado
  | 'atex' // atmósfera explosiva
  | 'lifting' // izaje en curso
  | 'heavy_traffic' // tránsito pesado
  | 'exclusion' // exclusión total
  | 'high_voltage' // alta tensión
  | 'biohazard';

export interface RestrictedZone {
  id: string;
  kind: ZoneKind;
  name: string;
  /** Coords del perímetro (lng/lat). Para detección por GPS. */
  perimeter?: Array<[number, number]>;
  /** Reglas que el trabajador debe cumplir para entrar. */
  rules: {
    /** EPP labels obligatorios. */
    requiredEpp: string[];
    /** Training codes obligatorios. */
    requiredTrainings: string[];
    /** Si requiere permit activo del kind correspondiente. */
    requiresPermit?: boolean;
    /** UID del responsable (supervisor). */
    responsibleUid: string;
  };
  /** Vigencia de la restricción. */
  activeFrom: string;
  activeUntil?: string;
}

export interface ZoneEntryCheckInput {
  workerUid: string;
  workerEppLabels: string[];
  workerTrainings: string[];
  /** Permits activos del worker en este momento. */
  workerActivePermitKinds: string[];
  zone: RestrictedZone;
  now: Date;
}

export interface ZoneEntryResult {
  allowed: boolean;
  missing: string[];
  warnings: string[];
}

export function checkZoneEntry(input: ZoneEntryCheckInput): ZoneEntryResult {
  const missing: string[] = [];
  const warnings: string[] = [];

  // Zona vigente?
  const t = input.now.getTime();
  if (Date.parse(input.zone.activeFrom) > t) {
    return { allowed: true, missing: [], warnings: ['Zona aún no activa'] };
  }
  if (input.zone.activeUntil && Date.parse(input.zone.activeUntil) < t) {
    return { allowed: true, missing: [], warnings: ['Zona expirada (sin restricción)'] };
  }

  for (const epp of input.zone.rules.requiredEpp) {
    if (!input.workerEppLabels.includes(epp)) missing.push(`EPP: ${epp}`);
  }
  for (const tr of input.zone.rules.requiredTrainings) {
    if (!input.workerTrainings.includes(tr)) missing.push(`Training: ${tr}`);
  }
  if (input.zone.rules.requiresPermit) {
    const permitKind = mapZoneToPermitKind(input.zone.kind);
    if (permitKind && !input.workerActivePermitKinds.includes(permitKind)) {
      missing.push(`Permit activo: ${permitKind}`);
    }
  }

  return { allowed: missing.length === 0, missing, warnings };
}

function mapZoneToPermitKind(kind: ZoneKind): string | null {
  switch (kind) {
    case 'hot':
      return 'caliente';
    case 'confined':
      return 'confinado';
    case 'lifting':
      return 'izaje_critico';
    case 'high_voltage':
      return 'loto';
    default:
      return null;
  }
}
