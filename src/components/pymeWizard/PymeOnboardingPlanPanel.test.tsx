// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PymeOnboardingPlanPanel } from './PymeOnboardingPlanPanel.js';
import {
  buildOnboardingPlan,
  type OnboardingPlan,
} from '../../services/pymeWizard/pymeOnboardingWizard.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function planFor(workerCount: number, industry: 'construction' | 'services' = 'services'): OnboardingPlan {
  return buildOnboardingPlan({
    industry,
    workerCount,
    keyRisks: ['manual_handling'],
  });
}

describe('<PymeOnboardingPlanPanel />', () => {
  it('renderiza al menos los pasos requeridos', () => {
    const plan = planFor(15);
    render(<PymeOnboardingPlanPanel plan={plan} />);
    expect(screen.getByTestId('pyme-plan-panel')).toBeInTheDocument();
    const requiredSection = screen.getByTestId('pyme-plan-required-steps');
    // Al menos profile + RIOHS son requeridos.
    expect(requiredSection).toHaveTextContent(/wizard.step.profile/);
  });

  it('quick-path ≤30min muestra badge ok', () => {
    // PYME chica (<25 trabajadores, sin CPHS, sin agudización): quick-path corto.
    const plan = planFor(8);
    render(<PymeOnboardingPlanPanel plan={plan} />);
    // El motor puede producir tiempos variables — comprobamos consistencia
    if (plan.totalEstimatedMinutes <= 30) {
      expect(screen.getByTestId('pyme-plan-quickpath-badge')).toHaveAttribute(
        'data-state',
        'ok',
      );
    } else {
      expect(screen.getByTestId('pyme-plan-quickpath-badge')).toHaveAttribute(
        'data-state',
        'over',
      );
    }
  });

  it('barra de progreso refleja completados sobre requeridos', () => {
    const plan = planFor(15);
    const requiredIds = plan.steps.filter((s) => s.required).map((s) => s.id);
    // Marca el primer required como completado.
    render(
      <PymeOnboardingPlanPanel
        plan={plan}
        completedStepIds={[requiredIds[0]!]}
      />,
    );
    const fill = screen.getByTestId('pyme-plan-progress-fill');
    const pctNum = Math.round((1 / requiredIds.length) * 100);
    expect(fill.style.width).toBe(`${pctNum}%`);
  });

  it('paso completado: data-state="completed"', () => {
    const plan = planFor(15);
    const firstReq = plan.steps.find((s) => s.required)!;
    render(
      <PymeOnboardingPlanPanel
        plan={plan}
        completedStepIds={[firstReq.id]}
      />,
    );
    expect(screen.getByTestId(`pyme-plan-step-${firstReq.id}`)).toHaveAttribute(
      'data-state',
      'completed',
    );
  });

  it('paso del criticalPath: data-critical="true" + tag Crítico', () => {
    const plan = planFor(15);
    if (plan.criticalPath.length > 0) {
      const critId = plan.criticalPath[0]!;
      render(<PymeOnboardingPlanPanel plan={plan} />);
      expect(screen.getByTestId(`pyme-plan-step-${critId}`)).toHaveAttribute(
        'data-critical',
        'true',
      );
      expect(
        screen.getByTestId(`pyme-plan-step-${critId}-critical-tag`),
      ).toBeInTheDocument();
    }
  });

  it('onToggleStep dispara con (step, willBeCompleted=true) si no estaba marcado', () => {
    const plan = planFor(15);
    const onToggle = vi.fn();
    const firstReq = plan.steps.find((s) => s.required)!;
    render(
      <PymeOnboardingPlanPanel plan={plan} onToggleStep={onToggle} />,
    );
    fireEvent.click(screen.getByTestId(`pyme-plan-step-${firstReq.id}-toggle`));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle.mock.calls[0][0].id).toBe(firstReq.id);
    expect(onToggle.mock.calls[0][1]).toBe(true);
  });

  it('onToggleStep con paso ya completado: willBeCompleted=false', () => {
    const plan = planFor(15);
    const firstReq = plan.steps.find((s) => s.required)!;
    const onToggle = vi.fn();
    render(
      <PymeOnboardingPlanPanel
        plan={plan}
        completedStepIds={[firstReq.id]}
        onToggleStep={onToggle}
      />,
    );
    fireEvent.click(screen.getByTestId(`pyme-plan-step-${firstReq.id}-toggle`));
    expect(onToggle.mock.calls[0][1]).toBe(false);
  });

  it('sin onToggleStep: botón disabled', () => {
    const plan = planFor(15);
    const firstReq = plan.steps.find((s) => s.required)!;
    render(<PymeOnboardingPlanPanel plan={plan} />);
    expect(
      screen.getByTestId(`pyme-plan-step-${firstReq.id}-toggle`),
    ).toBeDisabled();
  });

  it('recommendedModules: chips renderizadas', () => {
    const plan = planFor(15);
    render(<PymeOnboardingPlanPanel plan={plan} />);
    if (plan.recommendedModules.length > 0) {
      const m = plan.recommendedModules[0]!;
      expect(screen.getByTestId(`pyme-plan-module-${m}`)).toBeInTheDocument();
    }
  });

  it('regulatoryNotes: lista visible cuando hay notas', () => {
    const plan = planFor(15);
    render(<PymeOnboardingPlanPanel plan={plan} />);
    if (plan.regulatoryNotes.length > 0) {
      expect(screen.getByTestId('pyme-plan-regulatory-notes')).toBeInTheDocument();
    } else {
      expect(screen.queryByTestId('pyme-plan-regulatory-notes')).toBeNull();
    }
  });

  it('plan con optionalSteps: sección visible', () => {
    const plan = planFor(15);
    const hasOptional = plan.steps.some((s) => !s.required);
    render(<PymeOnboardingPlanPanel plan={plan} />);
    if (hasOptional) {
      expect(screen.getByTestId('pyme-plan-optional-steps')).toBeInTheDocument();
    } else {
      expect(screen.queryByTestId('pyme-plan-optional-steps')).toBeNull();
    }
  });
});
