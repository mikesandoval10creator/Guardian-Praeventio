// @vitest-environment jsdom
//
// Sprint 29 Bucket DD F-D — DaysWithoutIncidentBadge tests.

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import {
  DaysWithoutIncidentBadge,
  tierForDays,
} from './DaysWithoutIncidentBadge';

afterEach(() => cleanup());

describe('tierForDays', () => {
  it('maps each range to the correct tier', () => {
    expect(tierForDays(0)).toBe('green');
    expect(tierForDays(30)).toBe('green');
    expect(tierForDays(31)).toBe('dorado');
    expect(tierForDays(100)).toBe('dorado');
    expect(tierForDays(101)).toBe('plateado');
    expect(tierForDays(365)).toBe('plateado');
    expect(tierForDays(366)).toBe('gold');
    expect(tierForDays(9999)).toBe('gold');
  });

  it('coerces invalid inputs to the green tier', () => {
    expect(tierForDays(NaN)).toBe('green');
    expect(tierForDays(-5)).toBe('green');
  });
});

describe('DaysWithoutIncidentBadge', () => {
  it('renders the day count and tier label', () => {
    render(<DaysWithoutIncidentBadge days={150} />);
    expect(screen.getByText('150')).toBeTruthy();
    expect(screen.getByLabelText(/150 días sin incidentes/i)).toBeTruthy();
    expect(screen.getByText(/Resiliente/i)).toBeTruthy();
  });

  it('uses the gold tier for streaks > 365 days', () => {
    const { container } = render(<DaysWithoutIncidentBadge days={500} />);
    const badge = container.querySelector('[data-tier="gold"]');
    expect(badge).toBeTruthy();
  });

  it('renders the compact pill variant when requested', () => {
    render(<DaysWithoutIncidentBadge days={42} compact />);
    expect(screen.getByText(/42 días/)).toBeTruthy();
  });
});
