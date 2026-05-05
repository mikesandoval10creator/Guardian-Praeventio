// @vitest-environment jsdom
//
// Praeventio Guard — Sprint 28 Bucket B5: CPHS module UI tests.
//
// Cubre los flujos críticos:
//   1. Validación de quórum DS 54 en el form (≥3 empleador + ≥3 trabajadores).
//   2. Render de la cabecera regulatoria (cita ISO 45001 §5.4 + DS 54 art. 66).
//   3. Render de la lista vacía y de un comité con su badge ISO 45001.
//   4. SignMinutesButton: invoca onSign con la ceremony stub y bloquea
//      cuando el uid no está en attendees.

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import {
  CphsModule,
  CphsRegulatoryHeader,
  SignMinutesButton,
  validateCommitteeDraft,
} from './CphsModule';
import type { CphsCommittee, CphsMeeting, CphsMember } from '../services/cphs/types';

afterEach(() => cleanup());

function quorumMembers(): CphsMember[] {
  return [
    { uid: 'e1', fullName: 'E1', role: 'chair', side: 'employer', elected: false },
    { uid: 'e2', fullName: 'E2', role: 'representative', side: 'employer', elected: false },
    { uid: 'e3', fullName: 'E3', role: 'representative', side: 'employer', elected: false },
    { uid: 'w1', fullName: 'W1', role: 'secretary', side: 'worker', elected: true },
    { uid: 'w2', fullName: 'W2', role: 'representative', side: 'worker', elected: true },
    { uid: 'w3', fullName: 'W3', role: 'representative', side: 'worker', elected: true },
  ];
}

describe('CphsRegulatoryHeader', () => {
  it('cita DS 54 art. 66 e ISO 45001 §5.4', () => {
    render(<CphsRegulatoryHeader />);
    expect(screen.getByText(/DS 54 art\. 66/)).toBeTruthy();
    expect(screen.getByText(/ISO 45001:2018 §5\.4/)).toBeTruthy();
  });
});

describe('validateCommitteeDraft', () => {
  it('falla cuando faltan trabajadores', () => {
    const draft = {
      members: quorumMembers().filter((m) => m.side !== 'worker' || m.uid === 'w1'),
      period: { start: '2026-01-01', end: '2028-01-01' },
    };
    const r = validateCommitteeDraft(draft);
    expect(r.ok).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/quórum/i);
  });

  it('aprueba con quórum DS 54 + período válido + trabajadores elegidos', () => {
    const r = validateCommitteeDraft({
      members: quorumMembers(),
      period: { start: '2026-01-01', end: '2028-01-01' },
    });
    expect(r.ok).toBe(true);
  });
});

describe('CphsModule (presentational)', () => {
  it('muestra mensaje empty cuando no hay comités', () => {
    render(
      <CphsModule
        committees={[]}
        meetingsByCommittee={{}}
        candidateMembers={[]}
        currentUid="u1"
        onCreateCommittee={async () => undefined}
        onScheduleMeeting={async () => undefined}
        onSignMinutes={async () => undefined}
        onExportPdf={() => undefined}
      />,
    );
    expect(screen.getByText(/no hay comités constituidos/i)).toBeTruthy();
  });

  it('muestra el badge ISO 45001 §5.4 ✓ cuando iso45001Compliance=true', () => {
    const c: CphsCommittee = {
      id: 'c1',
      projectId: 'p1',
      period: { start: '2026-01-01', end: '2028-01-01' },
      members: quorumMembers(),
      status: 'active',
      iso45001Compliance: true,
      createdAt: '2026-01-01',
      createdBy: 'admin',
    };
    render(
      <CphsModule
        committees={[c]}
        meetingsByCommittee={{ c1: [] }}
        candidateMembers={[]}
        currentUid="u1"
        onCreateCommittee={async () => undefined}
        onScheduleMeeting={async () => undefined}
        onSignMinutes={async () => undefined}
        onExportPdf={() => undefined}
      />,
    );
    expect(screen.getByText(/ISO 45001 §5\.4/)).toBeTruthy();
  });
});

describe('SignMinutesButton', () => {
  function meetingFixture(overrides: Partial<CphsMeeting> = {}): CphsMeeting {
    return {
      id: 'm1',
      committeeId: 'c1',
      scheduledAt: new Date().toISOString(),
      heldAt: new Date().toISOString(),
      attendees: ['u1'],
      agenda: ['x'],
      resolutions: [],
      signatures: [],
      status: 'held',
      ...overrides,
    };
  }

  it('invoca onSign con el resultado de la ceremonia stub cuando el uid es attendee', async () => {
    const onSign = vi.fn().mockResolvedValue(undefined);
    const ceremony = vi.fn().mockResolvedValue({ credentialId: 'cred-x', signature: 'sig-x' });
    render(
      <SignMinutesButton
        meeting={meetingFixture()}
        uid="u1"
        onSign={onSign}
        ceremony={ceremony}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /firmar acta/i }));
    await waitFor(() => expect(ceremony).toHaveBeenCalled());
    await waitFor(() => expect(onSign).toHaveBeenCalledWith({ credentialId: 'cred-x', signature: 'sig-x' }));
  });

  it('queda deshabilitado si el uid no está en attendees', () => {
    render(
      <SignMinutesButton
        meeting={meetingFixture({ attendees: ['otro'] })}
        uid="u1"
        onSign={vi.fn()}
        ceremony={vi.fn()}
      />,
    );
    const btn = screen.getByRole('button', { name: /firmar acta/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
