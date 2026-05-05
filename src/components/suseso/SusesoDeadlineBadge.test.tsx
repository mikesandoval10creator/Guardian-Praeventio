// @vitest-environment jsdom
//
// SusesoDeadlineBadge tests — Sprint 28 follow-up.

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { SusesoDeadlineBadge } from './SusesoDeadlineBadge';

afterEach(() => cleanup());

const NOW = Date.parse('2026-05-05T12:00:00Z');

describe('SusesoDeadlineBadge', () => {
  it('renders green level when ≥5 días remaining', () => {
    render(
      <SusesoDeadlineBadge
        deadline="2026-05-11T12:00:00Z" // 6 days
        status="pending"
        formKind="DIAT"
        now={NOW}
      />,
    );
    const badge = screen.getByTestId('suseso-deadline-badge');
    expect(badge.getAttribute('data-level')).toBe('green');
    expect(badge.textContent).toContain('DIAT');
    expect(badge.textContent).toContain('6 días');
  });

  it('renders yellow when 3 días', () => {
    render(
      <SusesoDeadlineBadge
        deadline="2026-05-08T12:00:00Z"
        status="pending"
        formKind="DIEP"
        now={NOW}
      />,
    );
    const badge = screen.getByTestId('suseso-deadline-badge');
    expect(badge.getAttribute('data-level')).toBe('yellow');
    expect(badge.textContent).toContain('DIEP');
  });

  it('renders red and "vence HOY" at 0 días', () => {
    render(
      <SusesoDeadlineBadge
        deadline="2026-05-05T18:00:00Z"
        status="pending"
        formKind="DIAT"
        now={NOW}
      />,
    );
    const badge = screen.getByTestId('suseso-deadline-badge');
    expect(badge.getAttribute('data-level')).toBe('red');
    expect(badge.textContent).toMatch(/vence HOY/);
  });

  it('renders overdue with "envío manual urgente" when past deadline', () => {
    render(
      <SusesoDeadlineBadge
        deadline="2026-05-03T12:00:00Z"
        status="overdue"
        formKind="DIAT"
        now={NOW}
      />,
    );
    const badge = screen.getByTestId('suseso-deadline-badge');
    expect(badge.getAttribute('data-level')).toBe('overdue');
    expect(badge.textContent).toMatch(/envío manual urgente/);
  });

  it('shows submitted_by_company pill regardless of deadline', () => {
    render(
      <SusesoDeadlineBadge
        deadline="2026-05-03T12:00:00Z" // already past, but irrelevant
        status="submitted_by_company"
        formKind="DIAT"
        now={NOW}
      />,
    );
    const badge = screen.getByTestId('suseso-deadline-badge');
    expect(badge.getAttribute('data-status')).toBe('submitted_by_company');
    expect(badge.textContent).toMatch(/Enviado por la empresa/);
    // No data-level attribute in the submitted variant.
    expect(badge.getAttribute('data-level')).toBeNull();
  });
});
