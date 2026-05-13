// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExternalAuditPortalCard } from './ExternalAuditPortalCard.js';
import type { AuditPortalConfig } from '../../services/auditPortal/externalAuditPortal.js';

const basePortal: AuditPortalConfig = {
  id: 'p1',
  accessToken: 'abcdef1234567890deadbeef',
  createdByUid: 'u1',
  createdAt: '2026-05-01T00:00:00Z',
  expiresAt: '2026-05-30T00:00:00Z',
  auditorName: 'Inspector SUSESO',
  auditorAffiliation: 'suseso',
  scopeProjectIds: ['proj-a'],
  scopeModules: ['documents', 'iper_matrix', 'incidents'],
};

describe('<ExternalAuditPortalCard />', () => {
  it('renderiza nombre, afiliación y módulos', () => {
    render(
      <ExternalAuditPortalCard portal={basePortal} status="active" accessCount={3} />,
    );
    expect(screen.getByTestId('auditPortal.card.title')).toHaveTextContent(
      'Inspector SUSESO',
    );
    expect(screen.getByTestId('auditPortal.card.affiliation')).toHaveTextContent('suseso');
    expect(screen.getByTestId('auditPortal.card.modules')).toHaveTextContent('3');
    expect(screen.getByTestId('auditPortal.card.status')).toHaveTextContent('Activo');
    expect(screen.getByTestId('auditPortal.card.access')).toHaveTextContent('3');
  });

  it('muestra motivo cuando está revocado', () => {
    render(
      <ExternalAuditPortalCard
        portal={{
          ...basePortal,
          revokedAt: '2026-05-05T00:00:00Z',
          revokedReason: 'Auditoría finalizada',
        }}
        status="revoked"
      />,
    );
    const reason = screen.getByTestId('auditPortal.card.revokedReason');
    expect(reason).toBeInTheDocument();
    expect(reason.textContent).toContain('Auditoría finalizada');
  });
});
