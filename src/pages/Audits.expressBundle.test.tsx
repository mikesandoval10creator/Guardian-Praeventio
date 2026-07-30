// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Audits } from './Audits';

const H = vi.hoisted(() => ({
  buildExpressBundle: vi.fn(),
  nodes: [] as Array<Record<string, unknown>>,
  projectName: 'Faena Norte',
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _key,
  }),
}));

vi.mock('framer-motion', async () => {
  const React = await import('react');
  const motion = new Proxy(
    {},
    {
      get: (_target, tag: string) => React.forwardRef(
        ({ children, ...props }: React.HTMLAttributes<HTMLElement> & Record<string, unknown>, ref) => {
          const {
            initial: _initial,
            animate: _animate,
            exit: _exit,
            transition: _transition,
            whileHover: _whileHover,
            whileTap: _whileTap,
            ...domProps
          } = props;
          return React.createElement(tag, { ...domProps, ref }, children);
        },
      ),
    },
  );
  return { motion, AnimatePresence: ({ children }: { children: React.ReactNode }) => children };
});

vi.mock('../hooks/useRiskEngine', () => ({
  useRiskEngine: () => ({ nodes: H.nodes, loading: false, error: null }),
}));

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({
    selectedProject: {
      id: 'project-1',
      name: H.projectName,
      description: '',
      location: 'Antofagasta',
      industry: 'Minería',
      status: 'active',
      startDate: '2026-01-01',
      riskLevel: 'Alto',
    },
  }),
}));

vi.mock('../contexts/FirebaseContext', () => ({
  useFirebase: () => ({
    user: { uid: 'user-1', displayName: 'Ana González', email: 'ana@example.com' },
    userRole: 'prevencionista',
  }),
}));

vi.mock('../hooks/useExpressBundle', () => ({
  buildExpressBundle: H.buildExpressBundle,
}));

vi.mock('../components/audits/AddAuditModal', () => ({ AddAuditModal: () => null }));
vi.mock('../components/safety/SafetyInspection', () => ({ SafetyInspection: () => null }));
vi.mock('../components/audits/ISOManagement', () => ({ ISOManagement: () => null }));
vi.mock('../components/audits/ISOAudit', () => ({ ISOAudit: () => null }));
vi.mock('../components/shared/DataLoadErrorBanner', () => ({ DataLoadErrorBanner: () => null }));
vi.mock('../components/audits/AuditDetailModal', () => ({ AuditDetailModal: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  H.nodes = [];
  H.projectName = 'Faena Norte';
  H.buildExpressBundle.mockResolvedValue({
    manifest: {
      generatedAt: '2026-07-30T00:00:00.000Z',
      complianceSnapshot: {
        overall: 'yellow',
        byCategory: [],
        score: 50,
        computedAt: '2026-07-30T00:00:00.000Z',
      },
      summary: {
        documentsCount: 0,
        iperItems: 0,
        trainings: { vigentes: 0, vencidos: 0 },
        eppAssignments: 0,
        activeWorkers: 0,
        applicableProtocols: 0,
        photoEvidences: 0,
        recentAuditLogs: 0,
        fileCount: 1,
      },
      indexPdfBase64: 'JVBERi0xLjQK',
    },
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'not_found' }) }));
});

describe('Audits — Auditoría Express', () => {
  it('builds the authenticated real bundle contract and exposes the generated PDF', async () => {
    render(<Audits />);

    fireEvent.click(screen.getByTestId('audit-express-button'));

    await waitFor(() => {
      expect(H.buildExpressBundle).toHaveBeenCalledWith(
        'project-1',
        expect.objectContaining({
          projectName: 'Faena Norte',
          generatedBy: { fullName: 'Ana González', role: 'prevencionista' },
          data: expect.objectContaining({
            documents: expect.any(Array),
            iperMatrix: expect.any(Array),
            trainings: expect.any(Array),
            eppAssignments: expect.any(Array),
            activeWorkers: expect.any(Array),
            applicableProtocols: expect.any(Array),
            photoEvidences: expect.any(Array),
            recentAuditLogs: expect.any(Array),
            complianceSnapshot: expect.any(Object),
          }),
        }),
      );
    });

    const link = await screen.findByTestId('audit-express-ready');
    expect(link).toHaveAttribute('href', 'data:application/pdf;base64,JVBERi0xLjQK');
    expect(link).toHaveAttribute('download', expect.stringMatching(/^Auditoria_Express_Faena_Norte_.*\.pdf$/));
  });

  it('limits generated PDF filename length for very long project names', async () => {
    H.projectName = 'Proyecto '.repeat(80);

    render(<Audits />);
    fireEvent.click(screen.getByTestId('audit-express-button'));

    const link = await screen.findByTestId('audit-express-ready');
    const fileName = link.getAttribute('download') ?? '';
    expect(fileName.endsWith('_2026-07-30.pdf')).toBe(true);
    expect(fileName.length).toBeLessThanOrEqual(120);
  });

  it('includes only schema-valid evidence from the selected project', async () => {
    const common = {
      description: '',
      tags: [],
      connections: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    H.nodes = [
      {
        ...common,
        id: 'doc-1',
        type: 'Documento',
        title: 'RIOHS vigente',
        projectId: 'project-1',
        metadata: { type: 'RIOHS', status: 'Vigente', url: 'https://storage/doc.pdf' },
      },
      {
        ...common,
        id: 'risk-1',
        type: 'Riesgo',
        title: 'Caída de altura',
        projectId: 'project-1',
        metadata: { severity: 'high', mitigation: 'Arnés certificado' },
      },
      {
        ...common,
        id: 'training-1',
        type: 'Capacitación',
        title: 'Trabajo en altura',
        projectId: 'project-1',
        metadata: {
          workerName: 'Pedro López',
          workerRut: '11.111.111-1',
          status: 'vigente',
        },
      },
      {
        ...common,
        id: 'worker-1',
        type: 'Trabajador',
        title: 'Pedro López',
        projectId: 'project-1',
        metadata: { rut: '11.111.111-1', role: 'Operario', status: 'active' },
      },
      {
        ...common,
        id: 'foreign-doc',
        type: 'Documento',
        title: 'Documento de otro proyecto',
        projectId: 'project-2',
        metadata: { type: 'Contrato', status: 'Vigente' },
      },
    ];

    render(<Audits />);
    fireEvent.click(screen.getByTestId('audit-express-button'));

    await waitFor(() => expect(H.buildExpressBundle).toHaveBeenCalledOnce());
    const input = H.buildExpressBundle.mock.calls[0]?.[1];
    expect(input.data.documents).toEqual([
      {
        id: 'doc-1',
        type: 'RIOHS',
        title: 'RIOHS vigente',
        status: 'vigente',
        storageUrl: 'https://storage/doc.pdf',
      },
    ]);
    expect(input.data.iperMatrix).toEqual([
      {
        id: 'risk-1',
        risk: 'Caída de altura',
        severity: 'high',
        mitigation: 'Arnés certificado',
      },
    ]);
    expect(input.data.trainings).toEqual([
      {
        id: 'training-1',
        course: 'Trabajo en altura',
        workerName: 'Pedro López',
        workerRut: '11.111.111-1',
        status: 'vigente',
      },
    ]);
    expect(input.data.activeWorkers).toEqual([
      {
        uid: 'worker-1',
        fullName: 'Pedro López',
        rut: '11.111.111-1',
        role: 'Operario',
      },
    ]);
  });
});
