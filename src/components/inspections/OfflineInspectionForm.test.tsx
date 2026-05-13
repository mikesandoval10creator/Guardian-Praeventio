// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OfflineInspectionForm } from './OfflineInspectionForm.js';
import {
  recordObservation,
  startInspection,
  type InspectionTemplate,
} from '../../services/inspections/offlineInspectionService.js';

const template: InspectionTemplate = {
  id: 'tpl',
  title: 'Inspección F.6',
  items: [
    { id: 'epp', label: 'EPP completo', kind: 'yes_no' },
    { id: 'rating', label: 'Estado general', kind: 'rating' },
    { id: 'note', label: 'Nota opcional', kind: 'text', required: false },
  ],
};

const ctx = {
  projectId: 'p',
  workerUid: 'w',
  startedAt: '2026-05-12T10:00:00.000Z',
};

describe('OfflineInspectionForm', () => {
  it('renders title, counter and offline status when offline', () => {
    const session = startInspection(template.id, ctx);
    render(
      <OfflineInspectionForm
        template={template}
        session={session}
        isOnline={false}
        onRecord={() => {}}
        onSubmit={() => {}}
      />,
    );
    expect(screen.getByText('Inspección F.6')).toBeTruthy();
    expect(screen.getByTestId('online-status').textContent).toMatch(/Sin señal/);
    expect(screen.getByTestId('answered-counter').textContent).toMatch(/0\s*\/\s*2/);
  });

  it('calls onRecord when yes_no button clicked', () => {
    const onRecord = vi.fn();
    const session = startInspection(template.id, ctx);
    render(
      <OfflineInspectionForm
        template={template}
        session={session}
        isOnline
        onRecord={onRecord}
        onSubmit={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Sí' }));
    expect(onRecord).toHaveBeenCalledWith('epp', true);
  });

  it('disables submit until all required answered, then enables', () => {
    const onSubmit = vi.fn();
    let session = startInspection(template.id, ctx);
    const { rerender } = render(
      <OfflineInspectionForm
        template={template}
        session={session}
        isOnline
        onRecord={() => {}}
        onSubmit={onSubmit}
      />,
    );
    const submit = screen.getByTestId('submit-inspection') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    session = recordObservation(session, 'epp', true);
    session = recordObservation(session, 'rating', 4);
    rerender(
      <OfflineInspectionForm
        template={template}
        session={session}
        isOnline
        onRecord={() => {}}
        onSubmit={onSubmit}
      />,
    );
    const submit2 = screen.getByTestId('submit-inspection') as HTMLButtonElement;
    expect(submit2.disabled).toBe(false);
    fireEvent.click(submit2);
    expect(onSubmit).toHaveBeenCalled();
  });

  it('shows online label and proper submit copy when online', () => {
    const session = startInspection(template.id, ctx);
    render(
      <OfflineInspectionForm
        template={template}
        session={session}
        isOnline
        onRecord={() => {}}
        onSubmit={() => {}}
      />,
    );
    expect(screen.getByTestId('online-status').textContent).toMatch(/En línea/);
    expect(screen.getByTestId('submit-inspection').textContent).toMatch(/Enviar/);
  });
});
