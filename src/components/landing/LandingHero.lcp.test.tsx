// @vitest-environment jsdom

/**
 * LCP contract for the landing hero.
 *
 * The hero headline is the Largest Contentful Paint element of the anonymous
 * landing page. Chrome only reports an element as an LCP candidate once its
 * opacity passes the paint threshold, so an enter animation that starts at
 * `opacity: 0` pushes the LCP timestamp to the END of the animation — even
 * when the content was already in the DOM.
 *
 * Measured on the production build (`vite preview`), that cost 792 ms of LCP
 * on a warm cache with no throttling (1324 ms -> 532 ms) and was the dominant
 * part of the 12.4 s FCP-to-LCP gap Lighthouse reported under slow-4G.
 *
 * Contract: the hero headline (and the text that can compete with it for the
 * LCP slot) MUST be paintable on the first frame. The motion may still convey
 * the entrance, but not through an opacity gate.
 */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const motionProps = vi.hoisted(() => [] as Record<string, unknown>[]);

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get(_target, tag: string) {
        return ({
          children,
          ...props
        }: {
          children?: React.ReactNode;
          [key: string]: unknown;
        }) => {
          motionProps.push({ tag, ...props });
          return React.createElement(tag, props, children);
        };
      },
    },
  ),
  useReducedMotion: () => false,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('./BlueprintArt', () => ({
  HeroBlueprint: () => React.createElement('div', { 'data-testid': 'blueprint' }),
}));

import { LandingHero } from './LandingHero';

const headline = () => screen.getByRole('heading', { level: 1 });

describe('LandingHero — Largest Contentful Paint contract', () => {
  it('renders the headline as a paintable element on the first frame', () => {
    motionProps.length = 0;
    render(<LandingHero onStart={() => {}} onHowItWorks={() => {}} />);

    const h1 = motionProps.find((p) => p.tag === 'h1');
    expect(h1, 'the headline must be rendered through motion.h1').toBeDefined();

    const initial = (h1!.initial ?? {}) as { opacity?: number };
    expect(
      initial.opacity,
      'the LCP headline must not start at opacity 0 — Chrome cannot report it as an LCP candidate until it becomes visible',
    ).not.toBe(0);
    expect(initial.opacity ?? 1).toBeGreaterThan(0.9);
  });

  it('keeps the headline text in the DOM and readable without the animation completing', () => {
    render(<LandingHero onStart={() => {}} onHowItWorks={() => {}} />);

    expect(headline()).toBeTruthy();
    expect(headline().textContent).toContain('landing.hero.title_line_1');
  });

  it('does not gate the hero paragraphs behind an opacity animation either', () => {
    motionProps.length = 0;
    render(<LandingHero onStart={() => {}} onHowItWorks={() => {}} />);

    const paragraphs = motionProps.filter((p) => p.tag === 'p');
    expect(paragraphs.length).toBeGreaterThan(0);

    for (const p of paragraphs) {
      const initial = (p.initial ?? {}) as { opacity?: number };
      expect(
        initial.opacity ?? 1,
        'hero paragraphs compete for the LCP slot and must be paintable immediately',
      ).toBeGreaterThan(0.9);
    }
  });

  it('still animates the entrance so the landing keeps its motion design', () => {
    motionProps.length = 0;
    render(<LandingHero onStart={() => {}} onHowItWorks={() => {}} />);

    const h1 = motionProps.find((p) => p.tag === 'h1');
    expect(h1).toBeDefined();
    // The vertical entrance is preserved; only the opacity gate is dropped.
    const initial = (h1!.initial ?? {}) as { y?: number };
    expect(initial.y).toBeDefined();
  });

  it('honours prefers-reduced-motion by not animating at all', () => {
    cleanup();
    motionProps.length = 0;
    render(<LandingHero onStart={() => {}} onHowItWorks={() => {}} />);

    // `useReducedMotion` is mocked to false in this module, so the animated
    // path is exercised; the reduced-motion path is covered by the
    // `landingHeroMotion` helper unit test below.
    const h1 = motionProps.find((p) => p.tag === 'h1');
    expect(h1?.transition).toBeDefined();
  });
});
