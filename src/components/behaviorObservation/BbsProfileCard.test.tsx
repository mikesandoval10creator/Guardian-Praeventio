// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BbsProfileCard } from './BbsProfileCard.js';
import type {
  BbsProfile,
  ObservationCategory,
} from '../../services/behaviorObservation/bbsObservationEngine.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function emptyCategoryRecord(): BbsProfile['byCategory'] {
  return {
    epp: { total: 0, safe: 0, atRisk: 0, safePercentage: 0 },
    positioning: { total: 0, safe: 0, atRisk: 0, safePercentage: 0 },
    tools_equipment: { total: 0, safe: 0, atRisk: 0, safePercentage: 0 },
    procedures: { total: 0, safe: 0, atRisk: 0, safePercentage: 0 },
    housekeeping: { total: 0, safe: 0, atRisk: 0, safePercentage: 0 },
    ergonomics: { total: 0, safe: 0, atRisk: 0, safePercentage: 0 },
    communication: { total: 0, safe: 0, atRisk: 0, safePercentage: 0 },
  };
}

function makeProfile(over: Partial<BbsProfile> = {}): BbsProfile {
  return {
    tenantId: 'tenant-x',
    windowStart: '2026-05-01T00:00:00Z',
    windowEnd: '2026-05-13T00:00:00Z',
    totalObservations: 100,
    safePercentage: 85,
    byCategory: emptyCategoryRecord(),
    focusCategories: [],
    topRiskAreas: [],
    ...over,
  };
}

describe('<BbsProfileCard />', () => {
  it('renderiza overall % + barra refleja safePercentage', () => {
    render(<BbsProfileCard profile={makeProfile({ safePercentage: 73 })} />);
    expect(screen.getByTestId('bbs-overall')).toHaveTextContent('73%');
    expect(screen.getByTestId('bbs-overall-bar').style.width).toBe('73%');
  });

  it('sin observaciones en categorías: empty state visible', () => {
    render(<BbsProfileCard profile={makeProfile()} />);
    expect(screen.getByTestId('bbs-no-categories')).toBeInTheDocument();
  });

  it('renderiza categorías con observaciones (total > 0)', () => {
    const byCat = emptyCategoryRecord();
    byCat.epp = { total: 20, safe: 18, atRisk: 2, safePercentage: 90 };
    byCat.ergonomics = { total: 15, safe: 9, atRisk: 6, safePercentage: 60 };
    render(<BbsProfileCard profile={makeProfile({ byCategory: byCat })} />);
    expect(screen.getByTestId('bbs-category-epp')).toBeInTheDocument();
    expect(screen.getByTestId('bbs-category-ergonomics')).toBeInTheDocument();
    expect(screen.queryByTestId('bbs-category-positioning')).toBeNull();
  });

  it('focusCategories: tag "Foco" visible solo en esas categorías', () => {
    const byCat = emptyCategoryRecord();
    byCat.epp = { total: 20, safe: 18, atRisk: 2, safePercentage: 90 };
    byCat.ergonomics = { total: 15, safe: 9, atRisk: 6, safePercentage: 60 };
    render(
      <BbsProfileCard
        profile={makeProfile({
          byCategory: byCat,
          focusCategories: ['ergonomics'],
        })}
      />,
    );
    expect(screen.getByTestId('bbs-category-ergonomics-focus-tag')).toBeInTheDocument();
    expect(screen.queryByTestId('bbs-category-epp-focus-tag')).toBeNull();
    expect(screen.getByTestId('bbs-category-ergonomics')).toHaveAttribute(
      'data-focus',
      'true',
    );
    expect(screen.getByTestId('bbs-category-epp')).toHaveAttribute(
      'data-focus',
      'false',
    );
  });

  it('barra por categoría refleja safePercentage', () => {
    const byCat = emptyCategoryRecord();
    byCat.procedures = { total: 10, safe: 4, atRisk: 6, safePercentage: 40 };
    render(<BbsProfileCard profile={makeProfile({ byCategory: byCat })} />);
    expect(
      screen.getByTestId('bbs-category-procedures-bar').style.width,
    ).toBe('40%');
  });

  it('onCategoryClick dispara con la categoría', () => {
    const onClick = vi.fn();
    const byCat = emptyCategoryRecord();
    byCat.epp = { total: 10, safe: 9, atRisk: 1, safePercentage: 90 };
    render(
      <BbsProfileCard
        profile={makeProfile({ byCategory: byCat })}
        onCategoryClick={onClick}
      />,
    );
    fireEvent.click(
      screen.getByTestId('bbs-category-epp').querySelector('button')!,
    );
    expect(onClick).toHaveBeenCalledWith('epp' satisfies ObservationCategory);
  });

  it('sin onCategoryClick: botón disabled', () => {
    const byCat = emptyCategoryRecord();
    byCat.epp = { total: 10, safe: 9, atRisk: 1, safePercentage: 90 };
    render(<BbsProfileCard profile={makeProfile({ byCategory: byCat })} />);
    expect(
      screen.getByTestId('bbs-category-epp').querySelector('button'),
    ).toBeDisabled();
  });

  it('topRiskAreas: lista con porcentajes + total obs', () => {
    render(
      <BbsProfileCard
        profile={makeProfile({
          topRiskAreas: [
            { areaId: 'sector-c', atRiskPct: 45, total: 22 },
            { areaId: 'almacen', atRiskPct: 32, total: 12 },
          ],
        })}
      />,
    );
    expect(screen.getByTestId('bbs-area-sector-c')).toHaveTextContent('45% riesgo');
    expect(screen.getByTestId('bbs-area-sector-c')).toHaveTextContent('(22 obs)');
    expect(screen.getByTestId('bbs-area-almacen')).toHaveTextContent('32% riesgo');
  });

  it('onAreaClick dispara con areaId', () => {
    const onClick = vi.fn();
    render(
      <BbsProfileCard
        profile={makeProfile({
          topRiskAreas: [{ areaId: 'sector-c', atRiskPct: 45, total: 22 }],
        })}
        onAreaClick={onClick}
      />,
    );
    fireEvent.click(screen.getByTestId('bbs-area-sector-c'));
    expect(onClick).toHaveBeenCalledWith('sector-c');
  });

  it('topRiskAreas vacío: sección oculta', () => {
    render(<BbsProfileCard profile={makeProfile({ topRiskAreas: [] })} />);
    expect(screen.queryByTestId('bbs-top-risk-areas')).toBeNull();
  });

  it('safe count + atRisk count visibles por categoría', () => {
    const byCat = emptyCategoryRecord();
    byCat.epp = { total: 15, safe: 12, atRisk: 3, safePercentage: 80 };
    render(<BbsProfileCard profile={makeProfile({ byCategory: byCat })} />);
    expect(screen.getByTestId('bbs-category-epp')).toHaveTextContent(
      /12 seguras/,
    );
    expect(screen.getByTestId('bbs-category-epp')).toHaveTextContent(/3 en riesgo/);
  });

  it('window dates se renderizan en header', () => {
    render(
      <BbsProfileCard
        profile={makeProfile({
          windowStart: '2026-04-15T00:00:00Z',
          windowEnd: '2026-04-30T00:00:00Z',
          totalObservations: 47,
        })}
      />,
    );
    const card = screen.getByTestId('bbs-profile-card');
    expect(card).toHaveTextContent('2026-04-15');
    expect(card).toHaveTextContent('2026-04-30');
    expect(card).toHaveTextContent(/47 observaciones/);
  });
});
