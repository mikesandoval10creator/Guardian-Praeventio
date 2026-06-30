// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Input from './Input';

describe('Input', () => {
  it('renderiza y refleja el value', () => {
    render(<Input defaultValue="hola" aria-label="campo" />);
    expect((screen.getByLabelText('campo') as HTMLInputElement).value).toBe('hola');
  });
  it('usa tokens de superficie/borde', () => {
    render(<Input aria-label="c2" />);
    expect(screen.getByLabelText('c2').className).toMatch(/bg-\[var\(--bg-surface\)\]|border-\[var\(--border-default\)\]/);
  });
});
