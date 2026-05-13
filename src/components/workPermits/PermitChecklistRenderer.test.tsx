// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PermitChecklistRenderer } from './PermitChecklistRenderer.js';
import { buildEmptyChecklist } from '../../services/workPermits/permitLifecycleAdvisor.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

describe('<PermitChecklistRenderer />', () => {
  it('renders all canonical items for kind', () => {
    const cl = buildEmptyChecklist('altura');
    render(
      <PermitChecklistRenderer
        kind="altura"
        checklist={cl}
        onToggle={() => {}}
      />,
    );
    const items = screen.getByTestId('permit-checklist-items').querySelectorAll('li');
    expect(items.length).toBe(cl.items.length);
  });

  it('fires onToggle with inverted state when item clicked', () => {
    const cl = buildEmptyChecklist('caliente');
    const onToggle = vi.fn();
    render(
      <PermitChecklistRenderer kind="caliente" checklist={cl} onToggle={onToggle} />,
    );
    const firstId = cl.items[0].id;
    fireEvent.click(screen.getByTestId(`permit-checklist-item-${firstId}`));
    expect(onToggle).toHaveBeenCalledWith(firstId, true);
  });

  it('Issue button disabled until all items checked', () => {
    const cl = buildEmptyChecklist('confinado');
    const { rerender } = render(
      <PermitChecklistRenderer
        kind="confinado"
        checklist={cl}
        onToggle={() => {}}
        onIssue={() => {}}
      />,
    );
    const btn = screen.getByTestId('permit-checklist-issue') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);

    const allChecked = { items: cl.items.map((i) => ({ ...i, checked: true })) };
    rerender(
      <PermitChecklistRenderer
        kind="confinado"
        checklist={allChecked}
        onToggle={() => {}}
        onIssue={() => {}}
      />,
    );
    expect((screen.getByTestId('permit-checklist-issue') as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('progress label reflects completion percentage', () => {
    const cl = buildEmptyChecklist('loto');
    cl.items[0].checked = true;
    cl.items[1].checked = true;
    render(<PermitChecklistRenderer kind="loto" checklist={cl} onToggle={() => {}} />);
    const expectedPct = Math.round((2 / cl.items.length) * 100);
    expect(screen.getByTestId('permit-checklist-progress').textContent).toBe(`${expectedPct}%`);
  });
});
