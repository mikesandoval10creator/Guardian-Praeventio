// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { IperMatrixCard } from './IperMatrixCard.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

describe('<IperMatrixCard />', () => {
  it('renderiza con valores iniciales 3x3 → moderado', () => {
    render(<IperMatrixCard />);
    expect(screen.getByTestId('iper-matrix-card')).toBeInTheDocument();
    expect(screen.getByTestId('iper-level').textContent).toBe('moderado');
    expect(screen.getByTestId('iper-score').textContent).toBe('9');
  });

  it('5x5 → intolerable', () => {
    render(<IperMatrixCard initialProbability={5} initialSeverity={5} />);
    expect(screen.getByTestId('iper-level').textContent).toBe('intolerable');
  });

  it('cambio en select actualiza', () => {
    render(<IperMatrixCard />);
    const sev = screen.getByTestId('iper-severity') as HTMLSelectElement;
    fireEvent.change(sev, { target: { value: '5' } });
    expect(screen.getByTestId('iper-score').textContent).toBe('15');
  });

  it('control effectiveness produce residual', () => {
    render(
      <IperMatrixCard
        initialProbability={4}
        initialSeverity={4}
        initialControlEffectiveness="high"
      />,
    );
    expect(screen.getByTestId('iper-residual')).toBeInTheDocument();
  });

  it('dispara onChange', () => {
    const onChange = vi.fn();
    render(<IperMatrixCard onChange={onChange} />);
    expect(onChange).toHaveBeenCalled();
  });
});

// DS 44/2024 — la lente RECOMIENDA y cita la norma; nunca reclasifica sola.
describe('<IperMatrixCard /> — DS 44 (recomienda, no impone)', () => {
  it('no muestra el bloque DS 44 mientras no se marque ningún factor', () => {
    render(<IperMatrixCard />);
    expect(screen.queryByTestId('iper-ds44-recommendations')).toBeNull();
  });

  it('cita la norma y sugiere un nivel SIN cambiar la clasificación calculada', () => {
    render(<IperMatrixCard />);
    expect(screen.getByTestId('iper-level').textContent).toBe('moderado');

    fireEvent.click(screen.getByTestId('iper-ds44-maternity'));

    // La clasificación sigue siendo la del motor base: la decide el usuario.
    expect(screen.getByTestId('iper-level').textContent).toBe('moderado');

    const rec = screen.getByTestId('iper-ds44-recommendations');
    expect(rec.textContent).toMatch(/reasign|apartar/i);
    expect(rec.textContent).toMatch(/202/); // Código del Trabajo art. 202
    expect(rec.textContent).toMatch(/importante/i); // nivel sugerido, no aplicado
  });

  it('evalúa una amenaza natural y recomienda el plan de emergencia', () => {
    render(<IperMatrixCard />);
    fireEvent.change(screen.getByTestId('iper-ds44-disaster'), {
      target: { value: 'sismo' },
    });
    const rec = screen.getByTestId('iper-ds44-recommendations');
    expect(rec.textContent).toMatch(/plan de emergencia|evacuaci/i);
  });

  it('propaga los factores DS 44 en onChange para que la página los persista', () => {
    const onChange = vi.fn();
    render(<IperMatrixCard onChange={onChange} />);
    fireEvent.click(screen.getByTestId('iper-ds44-psychosocial'));

    const [input, result] = onChange.mock.calls.at(-1) as [
      { genderLens?: { genderedPsychosocial?: boolean } },
      { ds44Recommendations?: Array<{ basis: string }> },
    ];
    expect(input.genderLens?.genderedPsychosocial).toBe(true);
    expect(result.ds44Recommendations?.[0].basis).toMatch(/21\.643|karin/i);
  });
});
