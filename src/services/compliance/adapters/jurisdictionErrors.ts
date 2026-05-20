// Praeventio Guard — Bloque 7: Errores compartidos por adapters jurisdiccionales.
//
// Generaliza el error class que ds67Service tenía para los 2 docs chilenos
// (DS67/DS76). Ahora cubre cualquier framework de cualquier país: RIDDOR
// (UK), Form 7 (CA), Notifiable Incident (AU), 労働者死傷病報告 (JP),
// Industrial Accident Investigation (KR), Form 18 (IN), etc.

export type CountryCodeISO =
  | 'CL'
  | 'UK'
  | 'CA'
  | 'AU'
  | 'JP'
  | 'KR'
  | 'IN'
  | 'US'
  | 'BR'
  | 'AR'
  | 'PE'
  | 'CO'
  | 'MX';

/**
 * Error que un adapter jurisdiccional lanza cuando se invoca un generator
 * todavía no implementado para ese país. Permite a la UI ramificar a:
 *   - "Próximamente — disponible en plan Enterprise Global"
 *   - Caer a flujo manual JSON export
 *   - Sugerir contacto@praeventio.net
 */
export class AdapterNotImplementedError extends Error {
  readonly code = 'adapter_not_implemented_yet' as const;
  readonly country: CountryCodeISO;
  readonly reason: string;

  constructor(country: CountryCodeISO, reason: string) {
    super(`Adapter ${country} no implementado completamente: ${reason}`);
    this.name = 'AdapterNotImplementedError';
    this.country = country;
    this.reason = reason;
  }
}
