// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CphsCommitteeStatusCard } from './CphsCommitteeStatusCard.js';
import type {
  CphsCommittee,
  CphsMeeting,
  CphsMember,
} from '../../services/cphs/types.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function m(
  uid: string,
  side: 'employer' | 'worker',
  role: CphsMember['role'] = 'representative',
  elected = side === 'worker',
): CphsMember {
  return { uid, fullName: `Member ${uid}`, role, side, elected };
}

function committee(members: CphsMember[]): CphsCommittee {
  return {
    id: 'c1',
    projectId: 'p1',
    period: { start: '2026-01-01', end: '2028-01-01' },
    members,
    status: 'active',
    iso45001Compliance: true,
    createdAt: '2026-01-01T00:00:00Z',
    createdBy: 'admin',
  };
}

function meeting(
  id: string,
  status: CphsMeeting['status'],
  signed: boolean = false,
): CphsMeeting {
  return {
    id,
    committeeId: 'c1',
    scheduledAt: '2026-05-15T10:00:00Z',
    attendees: [],
    agenda: [],
    minutes: status === 'held' ? 'minutes text' : undefined,
    resolutions: [],
    signatures: signed
      ? [
          {
            uid: 'u1',
            signedAt: '2026-05-15T11:00:00Z',
            credentialId: 'cred',
            signature: 'sig',
          },
        ]
      : [],
    status,
  };
}

const validMembers: CphsMember[] = [
  m('e1', 'employer', 'chair', false),
  m('e2', 'employer', 'secretary', false),
  m('e3', 'employer'),
  m('w1', 'worker', 'representative', true),
  m('w2', 'worker', 'representative', true),
  m('w3', 'worker', 'representative', true),
];

describe('<CphsCommitteeStatusCard />', () => {
  it('renderiza con comité válido', () => {
    render(
      <CphsCommitteeStatusCard
        committee={committee(validMembers)}
        meetings={[]}
      />,
    );
    expect(screen.getByTestId('cphs-status-card')).toBeInTheDocument();
    expect(screen.getByTestId('cphs-status-badge').textContent).toMatch(/active/);
    expect(screen.getByTestId('cphs-employer-count').textContent).toMatch(/3/);
    expect(screen.getByTestId('cphs-worker-count').textContent).toMatch(/3/);
  });

  it('muestra warning si quórum insuficiente', () => {
    const insuficiente = validMembers.slice(0, 4); // solo 4 miembros
    render(
      <CphsCommitteeStatusCard
        committee={{ ...committee(insuficiente), iso45001Compliance: false }}
        meetings={[]}
      />,
    );
    expect(screen.getByTestId('cphs-warn-quorum')).toBeInTheDocument();
  });

  it('muestra warning si representantes trabajadores no son electos', () => {
    const noElectos: CphsMember[] = validMembers.map((memb) =>
      memb.side === 'worker' ? { ...memb, elected: false } : memb,
    );
    render(
      <CphsCommitteeStatusCard
        committee={{ ...committee(noElectos), iso45001Compliance: false }}
        meetings={[]}
      />,
    );
    expect(screen.getByTestId('cphs-warn-elected')).toBeInTheDocument();
  });

  it('cuenta reuniones agendadas y sin firma', () => {
    const meetings = [
      meeting('m1', 'scheduled'),
      meeting('m2', 'held', true), // firmada
      meeting('m3', 'held', false), // sin firma
      meeting('m4', 'held', false), // sin firma
    ];
    render(
      <CphsCommitteeStatusCard
        committee={committee(validMembers)}
        meetings={meetings}
      />,
    );
    expect(screen.getByTestId('cphs-meetings-scheduled').textContent).toMatch(/1/);
    expect(screen.getByTestId('cphs-meetings-unsigned').textContent).toMatch(/2/);
  });
});
