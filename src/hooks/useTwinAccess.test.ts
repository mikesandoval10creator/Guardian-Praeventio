// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useTwinAccess } from './useTwinAccess';

const VERIFIED_USER = { uid: 'w1', email: 'w@e.cl', emailVerified: true };
const UNVERIFIED_USER = { uid: 'w2', email: 'w2@e.cl', emailVerified: false };

describe('useTwinAccess (ADR 0011 triple-gate)', () => {
  it('Gate 1: unauthenticated → state unauthenticated', async () => {
    const { result } = renderHook(() =>
      useTwinAccess('p1', {
        fakers: {
          getCurrentUser: () => null,
          isProjectMember: async () => false,
        },
      }),
    );
    await waitFor(() => expect(result.current.state).toBe('unauthenticated'));
    expect(result.current.workerUid).toBeNull();
  });

  it('Gate 2: email unverified → state email_unverified', async () => {
    const { result } = renderHook(() =>
      useTwinAccess('p1', {
        fakers: {
          getCurrentUser: () => UNVERIFIED_USER,
          isProjectMember: async () => true,
        },
      }),
    );
    await waitFor(() => expect(result.current.state).toBe('email_unverified'));
  });

  it('Gate 1.5: not project member → state not_member', async () => {
    const { result } = renderHook(() =>
      useTwinAccess('p1', {
        fakers: {
          getCurrentUser: () => VERIFIED_USER,
          isProjectMember: async () => false,
        },
      }),
    );
    await waitFor(() => expect(result.current.state).toBe('not_member'));
    expect(result.current.workerUid).toBe('w1');
  });

  it('Gates 1+2 ok → state biometric_required (Gate 3 pending)', async () => {
    const { result } = renderHook(() =>
      useTwinAccess('p1', {
        fakers: {
          getCurrentUser: () => VERIFIED_USER,
          isProjectMember: async () => true,
          isDemoProject: () => false,
        },
      }),
    );
    await waitFor(() => expect(result.current.state).toBe('biometric_required'));
  });

  it('Gate 3 success → state granted with timestamp', async () => {
    const fixedNow = 1_000_000;
    const { result } = renderHook(() =>
      useTwinAccess('p1', {
        fakers: {
          getCurrentUser: () => VERIFIED_USER,
          isProjectMember: async () => true,
          isDemoProject: () => false,
          runBiometric: async () => ({ ok: true, method: 'fingerprint' }),
          now: () => fixedNow,
        },
      }),
    );
    await waitFor(() => expect(result.current.state).toBe('biometric_required'));
    await act(async () => {
      await result.current.requestStepUp();
    });
    expect(result.current.state).toBe('granted');
    expect(result.current.grantedAtMs).toBe(fixedNow);
  });

  it('Gate 3 failure → state biometric_failed', async () => {
    const { result } = renderHook(() =>
      useTwinAccess('p1', {
        fakers: {
          getCurrentUser: () => VERIFIED_USER,
          isProjectMember: async () => true,
          isDemoProject: () => false,
          runBiometric: async () => ({ ok: false, method: 'fingerprint' }),
        },
      }),
    );
    await waitFor(() => expect(result.current.state).toBe('biometric_required'));
    await act(async () => {
      await result.current.requestStepUp();
    });
    expect(result.current.state).toBe('biometric_failed');
    expect(result.current.grantedAtMs).toBeNull();
  });

  it('Gate 3 unavailable → state biometric_unavailable', async () => {
    const { result } = renderHook(() =>
      useTwinAccess('p1', {
        fakers: {
          getCurrentUser: () => VERIFIED_USER,
          isProjectMember: async () => true,
          isDemoProject: () => false,
          runBiometric: async () => ({ ok: false, method: 'unavailable' }),
        },
      }),
    );
    await waitFor(() => expect(result.current.state).toBe('biometric_required'));
    await act(async () => {
      await result.current.requestStepUp();
    });
    expect(result.current.state).toBe('biometric_unavailable');
  });

  it('Demo project skips Gate 3 only — auto-granted when Gates 1+2 pass', async () => {
    const fixedNow = 5_000_000;
    const { result } = renderHook(() =>
      useTwinAccess('demo-faena-praeventio', {
        fakers: {
          getCurrentUser: () => VERIFIED_USER,
          isProjectMember: async () => true,
          isDemoProject: (id) => id === 'demo-faena-praeventio',
          now: () => fixedNow,
        },
      }),
    );
    await waitFor(() => expect(result.current.state).toBe('granted'));
    expect(result.current.grantedAtMs).toBe(fixedNow);
  });

  it('Demo project still requires Gate 1 (auth) and Gate 2 (member)', async () => {
    const { result } = renderHook(() =>
      useTwinAccess('demo-faena-praeventio', {
        fakers: {
          getCurrentUser: () => null,
          isProjectMember: async () => false,
          isDemoProject: () => true,
        },
      }),
    );
    await waitFor(() => expect(result.current.state).toBe('unauthenticated'));
  });

  it('revoke() resets to biometric_required', async () => {
    const { result } = renderHook(() =>
      useTwinAccess('p1', {
        fakers: {
          getCurrentUser: () => VERIFIED_USER,
          isProjectMember: async () => true,
          isDemoProject: () => false,
          runBiometric: async () => ({ ok: true, method: 'fingerprint' }),
        },
      }),
    );
    await waitFor(() => expect(result.current.state).toBe('biometric_required'));
    await act(async () => {
      await result.current.requestStepUp();
    });
    expect(result.current.state).toBe('granted');
    act(() => result.current.revoke());
    expect(result.current.state).toBe('biometric_required');
    expect(result.current.grantedAtMs).toBeNull();
  });

  it('exposes ping() for inactivity tracking', async () => {
    const { result } = renderHook(() =>
      useTwinAccess('p1', {
        fakers: {
          getCurrentUser: () => VERIFIED_USER,
          isProjectMember: async () => true,
          isDemoProject: () => false,
          runBiometric: async () => ({ ok: true, method: 'fingerprint' }),
        },
      }),
    );
    await waitFor(() => expect(result.current.state).toBe('biometric_required'));
    expect(typeof result.current.ping).toBe('function');
    expect(() => result.current.ping()).not.toThrow();
  });

  it('stepUpTtlMs default 30 min', async () => {
    const { result } = renderHook(() =>
      useTwinAccess('p1', {
        fakers: {
          getCurrentUser: () => VERIFIED_USER,
          isProjectMember: async () => false,
        },
      }),
    );
    await waitFor(() => expect(result.current.state).toBe('not_member'));
    expect(result.current.stepUpTtlMs).toBe(30 * 60 * 1000);
  });

  it('stepUpTtlMs override respected', async () => {
    const { result } = renderHook(() =>
      useTwinAccess('p1', {
        fakers: {
          getCurrentUser: () => VERIFIED_USER,
          isProjectMember: async () => false,
        },
        stepUpTtlMs: 5 * 60 * 1000,
      }),
    );
    await waitFor(() => expect(result.current.state).toBe('not_member'));
    expect(result.current.stepUpTtlMs).toBe(5 * 60 * 1000);
  });
});
