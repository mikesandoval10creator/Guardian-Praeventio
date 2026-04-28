import { describe, it, expect } from 'vitest';
import {
  ADMIN_ROLES,
  SUPERVISOR_ROLES,
  DOCTOR_ROLES,
  WORKER_ROLES,
  ALL_ROLES,
  isAdminRole,
  isSupervisorRole,
  isDoctorRole,
  isWorkerRole,
  isValidRole,
} from './roles';

describe('roles — source of truth for RBAC', () => {
  it('ALL_ROLES contains every admin/supervisor/worker role', () => {
    for (const r of [...ADMIN_ROLES, ...SUPERVISOR_ROLES, ...WORKER_ROLES]) {
      expect(ALL_ROLES).toContain(r);
    }
  });

  it('ALL_ROLES has no duplicates', () => {
    expect(ALL_ROLES.length).toBe(new Set(ALL_ROLES).size);
  });

  it('isAdminRole accepts admin and gerente only', () => {
    expect(isAdminRole('admin')).toBe(true);
    expect(isAdminRole('gerente')).toBe(true);
    expect(isAdminRole('supervisor')).toBe(false);
    expect(isAdminRole('worker')).toBe(false);
    expect(isAdminRole(undefined)).toBe(false);
  });

  it('isSupervisorRole accepts supervisor / prevencionista / director_obra / medico_ocupacional', () => {
    expect(isSupervisorRole('supervisor')).toBe(true);
    expect(isSupervisorRole('prevencionista')).toBe(true);
    expect(isSupervisorRole('director_obra')).toBe(true);
    expect(isSupervisorRole('medico_ocupacional')).toBe(true);
    expect(isSupervisorRole('admin')).toBe(false);
    expect(isSupervisorRole('worker')).toBe(false);
  });

  it('isDoctorRole only accepts medico_ocupacional', () => {
    expect(isDoctorRole('medico_ocupacional')).toBe(true);
    expect(isDoctorRole('medico')).toBe(false); // historic typo from server.ts:227
    expect(isDoctorRole('supervisor')).toBe(false);
  });

  it('isWorkerRole accepts every trade subtype', () => {
    for (const r of WORKER_ROLES) {
      expect(isWorkerRole(r)).toBe(true);
    }
    expect(isWorkerRole('trabajador')).toBe(false); // historic typo from server.ts:227
    expect(isWorkerRole('admin')).toBe(false);
  });

  it('isValidRole rejects empty / null / non-string / historic-mismatch roles', () => {
    expect(isValidRole('')).toBe(false);
    expect(isValidRole(null)).toBe(false);
    expect(isValidRole(undefined)).toBe(false);
    expect(isValidRole('medico')).toBe(false);
    expect(isValidRole('trabajador')).toBe(false);
    expect(isValidRole(123)).toBe(false);
    expect(isValidRole({})).toBe(false);
  });

  it('isValidRole accepts every role in ALL_ROLES', () => {
    for (const r of ALL_ROLES) {
      expect(isValidRole(r)).toBe(true);
    }
  });

  // ---- Structural invariants (H-roles-3) ---------------------------------

  it('every DOCTOR_ROLES entry is also in SUPERVISOR_ROLES', () => {
    // Doctors currently inherit supervisor permissions; if this changes,
    // firestore.rules helpers and this test must be revisited together.
    expect(SUPERVISOR_ROLES).toEqual(expect.arrayContaining([...DOCTOR_ROLES]));
  });

  it('ALL_ROLES has no duplicate entries (Set size matches array length)', () => {
    expect(new Set(ALL_ROLES).size).toBe(ALL_ROLES.length);
  });

  it('ALL_ROLES includes every DOCTOR_ROLES entry (regression guard for H-roles-1)', () => {
    // If a doctor-only role is ever added that is NOT also a supervisor,
    // ALL_ROLES must still accept it via isValidRole.
    expect(ALL_ROLES).toEqual(expect.arrayContaining([...DOCTOR_ROLES]));
  });
});
