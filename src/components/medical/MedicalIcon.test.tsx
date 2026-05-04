// @vitest-environment jsdom
//
// Sprint 17c — MedicalIcon component tests.
// Sprint 20 Fase 1b — fallback chain PNG → SVG → placeholder graceful.
//
// Verifies:
//  • registry hit renders an <img> with the PNG candidate first (Sprint 20 Fase 1b)
//  • PNG load failure falls back to SVG legacy
//  • SVG also failing falls back to graceful placeholder
//  • registry miss in graceful mode renders the unknown placeholder span
//  • graceful=false throws on unknown name
//  • pure helper pngPathFor swaps the trailing .svg → .png

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act, fireEvent } from '@testing-library/react';
import { MedicalIcon, pngPathFor } from './MedicalIcon';
import type { MedicalIconEntry } from '../../services/medical/iconLibrary';

afterEach(() => {
  cleanup();
});

describe('pngPathFor', () => {
  it('swaps a trailing .svg for .png', () => {
    const entry = {
      name: 'lung-pair',
      publicPath: '/icons/biology/lung-pair.svg',
      license: 'CC0',
      category: 'organs',
    } satisfies MedicalIconEntry;
    expect(pngPathFor(entry)).toBe('/icons/biology/lung-pair.png');
  });

  it('returns the path unchanged when it does not end in .svg', () => {
    const entry = {
      name: 'mystery',
      publicPath: '/icons/biology/mystery.png',
      license: 'CC0',
      category: 'organs',
    } satisfies MedicalIconEntry;
    expect(pngPathFor(entry)).toBe('/icons/biology/mystery.png');
  });
});

describe('MedicalIcon', () => {
  it('initial render points at the PNG candidate (Sprint 20 Fase 1b)', () => {
    const { container } = render(<MedicalIcon name="lung-pair" size={32} />);
    const img = container.querySelector<HTMLImageElement>('img[data-medical-icon="lung-pair"]');
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toBe('/icons/biology/lung-pair.png');
    expect(img!.getAttribute('width')).toBe('32');
    expect(img!.getAttribute('height')).toBe('32');
    expect(img!.getAttribute('loading')).toBe('lazy');
    expect(img!.getAttribute('data-medical-icon-stage')).toBe('png');
  });

  it('falls back to the SVG legacy path when the PNG fails to load', () => {
    const { container } = render(<MedicalIcon name="lung-pair" size={32} />);
    const img = container.querySelector<HTMLImageElement>('img[data-medical-icon="lung-pair"]');
    expect(img!.getAttribute('src')).toBe('/icons/biology/lung-pair.png');
    act(() => {
      fireEvent.error(img!);
    });
    const fallback = container.querySelector<HTMLImageElement>(
      'img[data-medical-icon="lung-pair"]',
    );
    expect(fallback!.getAttribute('src')).toBe('/icons/biology/lung-pair.svg');
    expect(fallback!.getAttribute('data-medical-icon-stage')).toBe('svg');
  });

  it('falls back to the graceful placeholder when both PNG and SVG fail', () => {
    const { container } = render(<MedicalIcon name="lung-pair" size={48} />);
    const img1 = container.querySelector<HTMLImageElement>('img[data-medical-icon="lung-pair"]');
    act(() => {
      fireEvent.error(img1!);
    });
    const img2 = container.querySelector<HTMLImageElement>('img[data-medical-icon="lung-pair"]');
    act(() => {
      fireEvent.error(img2!);
    });
    expect(container.querySelector('img')).toBeNull();
    const placeholder = container.querySelector<HTMLElement>(
      'span[data-medical-icon-failed="lung-pair"]',
    );
    expect(placeholder).not.toBeNull();
    expect(placeholder!.style.width).toBe('48px');
  });

  it('renders a graceful placeholder when the icon name is unknown', () => {
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
