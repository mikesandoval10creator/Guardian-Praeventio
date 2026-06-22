// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Badge from './Badge';

describe('Badge', () => {
  it('attention usa el token de atención (dorado)', () => {
    render(<Badge tone="attention">Requiere atención</Badge>);
    const el = screen.getByText('Requiere atención');
    expect(el.className).toContain('accent-warning');
  });
  it('alert usa el token hazard', () => {
    render(<Badge tone="alert">Crítico</Badge>);
    expect(screen.getByText('Crítico').className).toContain('accent-hazard');
  });
});
