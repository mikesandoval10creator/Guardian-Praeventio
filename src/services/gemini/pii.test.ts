// Tests §12.5.1 split step 2 — gemini/pii.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@sentry/core', () => ({
  addBreadcrumb: vi.fn(),
}));

vi.mock('../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../observability/piiRedactor', () => ({
  redactPii: vi.fn(),
}));

import * as Sentry from '@sentry/core';
import { logger } from '../../utils/logger';
import { redactPii } from '../observability/piiRedactor';
import { redactPromptForVertex } from './pii';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('redactPromptForVertex', () => {
  it('count > 0 → loguea + breadcrumb con categorías', () => {
    vi.mocked(redactPii).mockReturnValue({
      redacted: 'Hola, RUT [redacted-rut]',
      count: 1,
      categories: ['rut'],
    });
    const out = redactPromptForVertex('Hola, RUT 12.345.678-9', 'analyzeRisk');
    expect(out).toBe('Hola, RUT [redacted-rut]');
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('[pii.redaction]'),
    );
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'pii.redaction',
        data: expect.objectContaining({ action: 'analyzeRisk', count: 1 }),
      }),
    );
  });

  it('count = 0 → NO loguea ni breadcrumb', () => {
    vi.mocked(redactPii).mockReturnValue({
      redacted: 'inocente prompt',
      count: 0,
      categories: [],
    });
    const out = redactPromptForVertex('inocente prompt', 'genericAction');
    expect(out).toBe('inocente prompt');
    expect(logger.info).not.toHaveBeenCalled();
    expect(Sentry.addBreadcrumb).not.toHaveBeenCalled();
  });

  it('Sentry throw NO afecta control flow (best-effort)', () => {
    vi.mocked(redactPii).mockReturnValue({
      redacted: 'OK redacted',
      count: 2,
      categories: ['email', 'phone'],
    });
    vi.mocked(Sentry.addBreadcrumb).mockImplementation(() => {
      throw new Error('Sentry not initialized');
    });
    // No debe relanzar
    expect(() => redactPromptForVertex('test', 'action')).not.toThrow();
  });

  it('breadcrumb incluye action + count + categories', () => {
    vi.mocked(redactPii).mockReturnValue({
      redacted: 'r',
      count: 3,
      categories: ['rut', 'email', 'phone'],
    });
    redactPromptForVertex('p', 'audit');
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith({
      category: 'pii.redaction',
      level: 'info',
      message: 'Redacted 3 PII token(s) before Vertex AI call',
      data: { action: 'audit', count: 3, categories: ['rut', 'email', 'phone'] },
    });
  });

  it('preserva prompt completo cuando no hay PII', () => {
    const longPrompt = 'A'.repeat(1000);
    vi.mocked(redactPii).mockReturnValue({
      redacted: longPrompt,
      count: 0,
      categories: [],
    });
    expect(redactPromptForVertex(longPrompt, 'generate')).toBe(longPrompt);
  });
});
