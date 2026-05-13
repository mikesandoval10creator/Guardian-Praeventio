// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PortableHistoryPreview } from './PortableHistoryPreview.js';
import type {
  PortableWorkerHistory,
  SerializedExport,
} from '../../services/workerHistory/portableHistoryExporter.js';

const baseHistory: PortableWorkerHistory = {
  schemaVersion: '1.0.0',
  exportedAt: '2026-05-01T00:00:00Z',
  redactionLevel: 'employer',
  includesMedical: false,
  requestedBy: { uid: 'u1', role: 'employer' },
  identity: {
    fullName: 'Juan Pérez',
    rutHash: 'a'.repeat(64),
    rut: '12345678-9',
    birthYear: 1985,
  },
  employmentSpans: [
    {
      employerName: 'Constructora X',
      startDate: '2020-01-01',
      endDate: null,
      position: 'Maestro',
      industry: 'construcción',
    },
  ],
  completedTrainings: [],
  certifications: [],
  eppHistory: [],
  exposureLog: [],
  medicalContext: 'REDACTED',
  disclaimer: 'Praeventio nunca diagnostica.',
};

const serialized: SerializedExport = {
  body: '{}',
  checksum: 'b'.repeat(64),
  contentType: 'application/json',
};

describe('<PortableHistoryPreview />', () => {
  it('renderiza identidad y conteos', () => {
    render(
      <PortableHistoryPreview history={baseHistory} serialized={serialized} />,
    );
    expect(screen.getByTestId('workerHistory.preview')).toBeInTheDocument();
    expect(screen.getByTestId('workerHistory.fullName').textContent).toMatch(/Juan Pérez/);
    expect(screen.getByTestId('workerHistory.count.employments').textContent).toMatch(/1/);
    expect(screen.getByTestId('workerHistory.redactionLevel').textContent).toMatch(/employer/);
  });

  it('marca contexto médico cuando includesMedical', () => {
    render(
      <PortableHistoryPreview
        history={{ ...baseHistory, includesMedical: true, redactionLevel: 'medical' }}
        serialized={serialized}
      />,
    );
    expect(screen.getByTestId('workerHistory.medicalFlag')).toBeInTheDocument();
  });

  it('dispara onDownload', () => {
    const handler = vi.fn();
    render(
      <PortableHistoryPreview
        history={baseHistory}
        serialized={serialized}
        onDownload={handler}
      />,
    );
    fireEvent.click(screen.getByTestId('workerHistory.downloadBtn'));
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
