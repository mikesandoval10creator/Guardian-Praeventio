// @vitest-environment jsdom
//
// Sprint 17c — MedicalIcon component tests.
//
// Verifies:
//  • registry hit renders an <img> with the public path and size prop
//  • registry miss in graceful mode renders the placeholder span
//  • graceful=false throws on unknown name

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MedicalIcon } from './MedicalIcon';

afterEach(() => {
  cleanup();
});

describe('MedicalIcon', () => {
  it('renders an <img> for a registered icon with the public path', () => {
    const { container } = render(<MedicalIcon name="lung-pair" size={32} />);
    const img = container.querySelector<HTMLImageElement>('img[data-medical-icon="lung-pair"]');
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toBe('/icons/biology/lung-pair.svg');
    expect(img!.getAttribute('width')).toBe('32');
    expect(img!.getAttribute('height')).toBe('32');
    expect(img!.getAttribute('loading')).toBe('lazy');
  });

  it('renders a graceful placeholder when the icon is unknown', () => {
    const { container } = render(<MedicalIcon name="not-a-real-icon" size={64} />);
    const placeholder = container.querySelector<HTMLElement>(
      'span[data-medical-icon-missing="not-a-real-icon"]',
    );
    expect(placeholder).not.toBeNull();
    expect(placeholder!.style.width).toBe('64px');
    expect(placeholder!.style.height).toBe('64px');
    expect(container.querySelector('img')).toBeNull();
  });

  it('honors the size prop (default 48)', () => {
    const { container } = render(<MedicalIcon name="heart-anatomical" />);
    const img = container.querySelector<HTMLImageElement>('img');
    expect(img).not.toBeNull();
    expect(img!.getAttribute('width')).toBe('48');
    expect(img!.getAttribute('height')).toBe('48');
  });

  it('throws when graceful is false and name is unknown', () => {
    // Suppress React error boundary noise.
    const spy = (globalThis as unknown as { console: Console }).console;
    const origError = spy.error;
    spy.error = () => {};
    try {
      expect(() =>
        render(<MedicalIcon name="definitely-missing" graceful={false} />),
      ).toThrow(/unknown name/);
    } finally {
      spy.error = origError;
    }
  });
});
