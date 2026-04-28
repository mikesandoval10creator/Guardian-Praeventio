/**
 * Single source of truth for the role identifiers used by:
 *   - Firebase Auth custom claims (request.auth.token.role)
 *   - Firestore documents (users/{uid}.role)
 *   - firestore.rules (isValidRole, isWorkerRole, isAdmin, isSupervisor, isDoctor)
 *
 * Any change here MUST be mirrored in firestore.rules. The
 * scripts/verify-roles-sync.cjs script verifies that both files
 * declare the same role identifiers and is wired into CI.
 *
 * Historical note: server.ts previously declared a different list
 * ('medico' vs 'medico_ocupacional', 'trabajador' vs 'worker') which
 * caused silent RBAC mismatches at the rules layer.
 */

export const ADMIN_ROLES = ['admin', 'gerente'] as const;

export const SUPERVISOR_ROLES = [
  'supervisor',
  'prevencionista',
  'director_obra',
  'medico_ocupacional',
] as const;

// medico_ocupacional grants both supervisor and doctor permissions
// in firestore.rules (see isDoctor() helper).
export const DOCTOR_ROLES = ['medico_ocupacional'] as const;

export const WORKER_ROLES = [
  'topografo',
  'pintor',
  'maquinista',
  'electrico',
  'soldador',
  'mecanico',
  'operario',
  'contratista',
  'worker',
] as const;

const _allUnique = [
  ...ADMIN_ROLES,
  ...SUPERVISOR_ROLES,
  ...DOCTOR_ROLES,
  ...WORKER_ROLES,
] as const;

export const ALL_ROLES: readonly string[] = Array.from(new Set(_allUnique));

export type AdminRole = typeof ADMIN_ROLES[number];
export type SupervisorRole = typeof SUPERVISOR_ROLES[number];
export type DoctorRole = typeof DOCTOR_ROLES[number];
export type WorkerRole = typeof WORKER_ROLES[number];
export type Role = AdminRole | SupervisorRole | DoctorRole | WorkerRole;

export function isAdminRole(role: unknown): role is AdminRole {
  return typeof role === 'string' && (ADMIN_ROLES as readonly string[]).includes(role);
}

export function isSupervisorRole(role: unknown): role is SupervisorRole {
  return typeof role === 'string' && (SUPERVISOR_ROLES as readonly string[]).includes(role);
}

export function isDoctorRole(role: unknown): role is DoctorRole {
  return typeof role === 'string' && (DOCTOR_ROLES as readonly string[]).includes(role);
}

export function isWorkerRole(role: unknown): role is WorkerRole {
  return typeof role === 'string' && (WORKER_ROLES as readonly string[]).includes(role);
}

export function isValidRole(role: unknown): role is Role {
  return typeof role === 'string' && ALL_ROLES.includes(role);
}
