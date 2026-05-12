// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReportTemplatePreview } from './ReportTemplatePreview.js';
import { CANONICAL_TEMPLATES } from '../../services/reportsAutomation/reportsAutomation.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

const template = CANONICAL_TEMPLATES[0]; // monthly-client

function fullContents() {
  const c: Record<string, string> = {};
  for (const s of template.sections) if (s.required) c[s.key] = `content ${s.key}`;
  return c;
}

describe('<ReportTemplatePreview />', () => {
  it('renderiza secciones cuando datos completos', () => {
    render(
      <ReportTemplatePreview
        template={template}
        data={{ contents: fullContents() }}
        reportId="r1"
        periodLabel="2026-05"
      />,
    );
    expect(screen.getByTestId('report-preview')).toBeInTheDocument();
    // Cada sección required tiene su data-testid
    for (const s of template.sections) {
      if (s.required) {
        expect(screen.getByTestId(`report-section-${s.key}`)).toBeInTheDocument();
      }
    }
  });

  it('error visible si datos incompletos', () => {
    render(
      <ReportTemplatePreview
        template={template}
        data={{ contents: {} }}
        reportId="r1"
        periodLabel="2026-05"
      />,
    );
    expect(screen.getByTestId('report-preview-error')).toBeInTheDocument();
  });

  it('botón publish dispara onPublish', () => {
    const onPublish = vi.fn();
    render(
      <ReportTemplatePreview
        template={template}
        data={{ contents: fullContents() }}
        reportId="r1"
        periodLabel="2026-05"
        onPublish={onPublish}
      />,
    );
    fireEvent.click(screen.getByTestId('report-publish'));
    expect(onPublish).toHaveBeenCalledTimes(1);
  });
});
