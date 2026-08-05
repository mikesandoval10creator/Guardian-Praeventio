// Praeventio Guard — auth helpers para el ciclo RLHF (tarea P1).
//
// Tres bugs que este módulo cierra:
//   1. POST /feedback usaba req.user.uid como "tenantId" — un usuario
//      que pertenece a dos tenants o sin claims.tenantId hacía
//      que el agregador resumiera por uid en lugar de por tenant.
//   2. GET /feedback/summary exigía req.user.admin===true mientras
//      el sistema promueve por custom claim `role: admin|gerente`.
//      Un admin legitimo recibía 403.
//   3. Scheduler: el job aggregate-ai-feedback no se creaba en
//      deploy (arreglado en .github/workflows/deploy.yml).
//
// Estas funciones PURAS son la red de seguridad: cualquier otra ruta
// que necesite auth de feedback importa de acá.

export interface FeedbackUser {
  uid: string;
  email: string | null;
  /**
   * Custom claims de Firebase Auth (decodificados del Bearer).
   * Estructura canónica:
   *   { role: 'admin' | 'gerente' | 'worker' | ..., tenantId: string }
   * Compatibilidad: tokens viejos con `admin: true` flag también pasan.
   */
  claims: Record<string, unknown>;
  /**
   * Flag legacy `admin: true` (Boolean en el user, no en claims).
   * La compat hacia atrás con tokens viejos exige leerlo. Varios
   * usuarios en producción lo tienen.
   */
  admin?: boolean;
}

/**
 * Resuelve el tenantId REAL del usuario, no el uid.
 *
 *   1. claims.tenantId → partícula real (servidor→servidor identity)
 *   2. fallback al uid (no silent user→tenant colapsing)
 *   3. si nada, throw — nunca inventa un tenant
 */
export function resolveFeedbackTenantId(user: FeedbackUser): string {
  const tenantId = user.claims.tenantId;
  if (typeof tenantId === 'string' && tenantId.length > 0) {
    return tenantId;
  }
  if (user.uid && user.uid.length > 0) {
    return user.uid;
  }
  throw new Error('ai_feedback: cannot resolve tenantId (no claims.tenantId, no uid)');
}

/**
 * Decide si el user puede LEER el resumen RLHF.
 *
 *   1. claim `role: admin|gerente` → reader (canónico)
 *   2. claim legacy `admin: true` boolean → reader (compat)
 *   3. cualquier otro → no reader
 */
export function isFeedbackReader(user: FeedbackUser): boolean {
  const role = user.claims.role;
  if (role === 'admin' || role === 'gerente') return true;
  if (user.claims.admin === true) return true;
  if (user.admin === true) return true;
  return false;
}
