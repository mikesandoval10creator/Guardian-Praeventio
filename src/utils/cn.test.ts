import { describe, it, expect } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('une clases y filtra falsy', () => {
    expect(cn('a', false && 'b', undefined, 'c')).toBe('a c');
  });
  it('dedupe con prioridad tailwind-merge (la última gana)', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
    expect(cn('text-sm', 'text-base')).toBe('text-base');
  });
});
