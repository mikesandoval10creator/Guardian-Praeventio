// SPDX-License-Identifier: MIT
// Praeventio Guard — Plan 2026-05-24 §MOC — role-gating tests for
// ChangeWorkflowActions. Verifica que cada combinación de status + role
// muestre exactamente los botones correctos.
//
// Esto es el "smoke test" del UI gate — el service ya tiene tests
// granulares de las transiciones; acá validamos que el componente NO
// muestre botones que llevarían a llamadas ilegales.

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChangeWorkflowActions } from './ChangeWorkflowActions';
import type { OperationalChange } from '../../services/changeMgmt/operationalChangeService';

// Mock react-i18next to avoid wiring i18n setup in unit tests.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, defaultValue?: string) =>
      typeof defaultValue === 'string' ? defaultValue : _key,
  }),
}));

function makeChange(overrides: Partial<OperationalChange> = {}): OperationalChange {
  return {
    id: 'c-1',
    projectId: 'p-1',
    kind: 'procedure',
    whatChanged: 'Test change',
    previousValue: 'A',
    newValue: 'B',
    rationale: 'Razón suficientemente larga para test',
    impact: 'medium',
    affectedWorkerUids: ['w-1'],
    declaredByUid: 'creator-1',
    declaredByRole: 'supervisor',
    effectiveFrom: '2026-05-23T08:00:00Z',
    declaredAt: '2026-05-23T07:00:00Z',
    acknowledgments: [],
    status: 'draft',
    approvals: [],
    ...overrides,
  };
}

const noop = vi.fn();

function commonProps(over: Partial<Parameters<typeof ChangeWorkflowActions>[0]> = {}) {
  return {
    userUid: 'u-1',
    userRole: 'operador' as const,
    hasAcked: false,
    onSubmitForReview: noop,
    onApprove: noop,
    onReject: noop,
    onActivate: noop,
    onVerify: noop,
    onAcknowledge: noop,
    onRevert: noop,
    ...over,
  };
}

beforeEach(() => {
  noop.mockClear();
});

describe('ChangeWorkflowActions — status badge always visible', () => {
  it('renderiza badge "Borrador" para draft', () => {
    render(<ChangeWorkflowActions change={makeChange()} {...commonProps()} />);
    expect(screen.getByText('Borrador')).toBeTruthy();
  });

  it('renderiza badge "En vigor" para in_effect', () => {
    render(
      <ChangeWorkflowActions
        change={makeChange({ status: 'in_effect' })}
        {...commonProps()}
      />,
    );
    expect(screen.getByText('En vigor')).toBeTruthy();
  });

  it('renderiza badge "Verificado" + "Efectivo" tag', () => {
    render(
      <ChangeWorkflowActions
        change={makeChange({
          status: 'verified',
          verification: {
            verifierUid: 'hse-1',
            verifiedAt: '2026-05-24T00:00:00Z',
            effective: true,
            observations: 'OK observaciones largas suficientes',
          },
        })}
        {...commonProps()}
      />,
    );
    expect(screen.getByText('Verificado')).toBeTruthy();
    expect(screen.getByText('Efectivo')).toBeTruthy();
  });

  it('renderiza tag "Requiere acción correctiva" cuando verification.effective=false', () => {
    render(
      <ChangeWorkflowActions
        change={makeChange({
          status: 'in_effect',
          verification: {
            verifierUid: 'hse-1',
            verifiedAt: '2026-05-24T00:00:00Z',
            effective: false,
            observations: 'No funcionó, hacer X',
          },
        })}
        {...commonProps()}
      />,
    );
    expect(screen.getByText('Requiere acción correctiva')).toBeTruthy();
  });
});

describe('ChangeWorkflowActions — draft state gates', () => {
  it('creator ve "Enviar a revisión" en draft', () => {
    render(
      <ChangeWorkflowActions
        change={makeChange()}
        {...commonProps({ userUid: 'creator-1', userRole: 'supervisor' })}
      />,
    );
    expect(screen.getByText('Enviar a revisión')).toBeTruthy();
  });

  it('non-creator non-approver NO ve "Enviar a revisión"', () => {
    render(
      <ChangeWorkflowActions
        change={makeChange()}
        {...commonProps({ userUid: 'random-user', userRole: 'operador' })}
      />,
    );
    expect(screen.queryByText('Enviar a revisión')).toBeNull();
  });

  it('approver NO creator también puede enviar a revisión (asistencia HSE)', () => {
    render(
      <ChangeWorkflowActions
        change={makeChange()}
        {...commonProps({ userUid: 'hse-1', userRole: 'prevencionista' })}
      />,
    );
    expect(screen.getByText('Enviar a revisión')).toBeTruthy();
  });
});

describe('ChangeWorkflowActions — pending_review state gates', () => {
  it('approver ve "Aprobar" + "Rechazar" en pending_review', () => {
    render(
      <ChangeWorkflowActions
        change={makeChange({ status: 'pending_review' })}
        {...commonProps({ userUid: 'hse-1', userRole: 'prevencionista' })}
      />,
    );
    expect(screen.getByText('Aprobar')).toBeTruthy();
    expect(screen.getByText('Rechazar')).toBeTruthy();
  });

  it('operador NO ve botones de aprobación', () => {
    render(
      <ChangeWorkflowActions
        change={makeChange({ status: 'pending_review' })}
        {...commonProps({ userUid: 'op-1', userRole: 'operador' })}
      />,
    );
    expect(screen.queryByText('Aprobar')).toBeNull();
    expect(screen.queryByText('Rechazar')).toBeNull();
  });

  it('approver que YA decidió NO ve botones (idempotency)', () => {
    render(
      <ChangeWorkflowActions
        change={makeChange({
          status: 'pending_review',
          approvals: [
            {
              approverUid: 'hse-1',
              approverRole: 'prevencionista',
              decision: 'approved',
              decidedAt: '2026-05-23T10:00:00Z',
              comment: 'OK desde HSE',
            },
          ],
        })}
        {...commonProps({ userUid: 'hse-1', userRole: 'prevencionista' })}
      />,
    );
    expect(screen.queryByText('Aprobar')).toBeNull();
  });
});

describe('ChangeWorkflowActions — approved state gates', () => {
  const pastEffectiveFrom = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const futureEffectiveFrom = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  it('supervisor ve "Activar" si effectiveFrom <= now', () => {
    render(
      <ChangeWorkflowActions
        change={makeChange({ status: 'approved', effectiveFrom: pastEffectiveFrom })}
        {...commonProps({ userUid: 'sup-1', userRole: 'supervisor' })}
      />,
    );
    expect(screen.getByText('Activar')).toBeTruthy();
  });

  it('NO muestra "Activar" si effectiveFrom > now', () => {
    render(
      <ChangeWorkflowActions
        change={makeChange({ status: 'approved', effectiveFrom: futureEffectiveFrom })}
        {...commonProps({ userUid: 'sup-1', userRole: 'supervisor' })}
      />,
    );
    expect(screen.queryByText('Activar')).toBeNull();
  });

  it('HSE NO puede activar (solo supervisor/gerente/admin)', () => {
    render(
      <ChangeWorkflowActions
        change={makeChange({ status: 'approved', effectiveFrom: pastEffectiveFrom })}
        {...commonProps({ userUid: 'hse-1', userRole: 'prevencionista' })}
      />,
    );
    expect(screen.queryByText('Activar')).toBeNull();
  });
});

describe('ChangeWorkflowActions — in_effect state gates', () => {
  it('HSE ve "Verificar efectividad" en in_effect', () => {
    render(
      <ChangeWorkflowActions
        change={makeChange({ status: 'in_effect' })}
        {...commonProps({ userUid: 'hse-1', userRole: 'prevencionista' })}
      />,
    );
    expect(screen.getByText('Verificar efectividad')).toBeTruthy();
  });

  it('worker afectado SIN ack ve "Confirmo lectura"', () => {
    render(
      <ChangeWorkflowActions
        change={makeChange({ status: 'in_effect', affectedWorkerUids: ['w-1'] })}
        {...commonProps({ userUid: 'w-1', userRole: 'operador', hasAcked: false })}
      />,
    );
    expect(screen.getByText('Confirmo lectura')).toBeTruthy();
  });

  it('worker afectado CON ack NO ve "Confirmo lectura"', () => {
    render(
      <ChangeWorkflowActions
        change={makeChange({ status: 'in_effect', affectedWorkerUids: ['w-1'] })}
        {...commonProps({ userUid: 'w-1', userRole: 'operador', hasAcked: true })}
      />,
    );
    expect(screen.queryByText('Confirmo lectura')).toBeNull();
  });

  it('worker NO afectado NO ve "Confirmo lectura"', () => {
    render(
      <ChangeWorkflowActions
        change={makeChange({ status: 'in_effect', affectedWorkerUids: ['w-1'] })}
        {...commonProps({ userUid: 'w-extranio', userRole: 'operador', hasAcked: false })}
      />,
    );
    expect(screen.queryByText('Confirmo lectura')).toBeNull();
  });

  it('approver ve "Revertir" desde in_effect', () => {
    render(
      <ChangeWorkflowActions
        change={makeChange({ status: 'in_effect' })}
        {...commonProps({ userUid: 'sup-1', userRole: 'supervisor' })}
      />,
    );
    expect(screen.getByText('Revertir')).toBeTruthy();
  });
});

describe('ChangeWorkflowActions — terminal states', () => {
  it('rejected NO muestra acciones operativas', () => {
    render(
      <ChangeWorkflowActions
        change={makeChange({ status: 'rejected' })}
        {...commonProps({ userUid: 'sup-1', userRole: 'supervisor' })}
      />,
    );
    expect(screen.queryByText('Aprobar')).toBeNull();
    expect(screen.queryByText('Activar')).toBeNull();
    expect(screen.queryByText('Revertir')).toBeNull();
    expect(screen.queryByText('Verificar efectividad')).toBeNull();
  });

  it('reverted NO muestra acciones operativas', () => {
    render(
      <ChangeWorkflowActions
        change={makeChange({ status: 'reverted', revertedAt: '2026-05-23T10:00:00Z' })}
        {...commonProps({ userUid: 'sup-1', userRole: 'supervisor' })}
      />,
    );
    expect(screen.queryByText('Aprobar')).toBeNull();
    expect(screen.queryByText('Revertir')).toBeNull();
  });

  it('verified PERMITE revertir (último escape valve)', () => {
    render(
      <ChangeWorkflowActions
        change={makeChange({
          status: 'verified',
          verification: {
            verifierUid: 'hse-1',
            verifiedAt: '2026-05-24T00:00:00Z',
            effective: true,
            observations: 'OK',
          },
        })}
        {...commonProps({ userUid: 'sup-1', userRole: 'supervisor' })}
      />,
    );
    expect(screen.getByText('Revertir')).toBeTruthy();
  });
});
