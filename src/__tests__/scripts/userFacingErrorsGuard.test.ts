import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const guard = require('../../../scripts/check-user-facing-errors.cjs') as {
  scanSource: (
    source: string,
    fileKey?: string,
  ) => Array<{
    file: string;
    line: number;
    kind: 'raw-jsx-error' | 'raw-error-state' | 'visible-machine-status';
    excerpt: string;
  }>;
};

const scan = (source: string) => guard.scanSource(source, 'src/pages/Example.tsx');

describe('user-facing error guard', () => {
  it('flags a raw Error.message rendered in JSX', () => {
    expect(scan('const view = <p>{error.message}</p>;')).toMatchObject([
      { kind: 'raw-jsx-error' },
    ]);
  });

  it('flags a raw error-like identifier rendered in JSX', () => {
    expect(scan('const view = <p>{error}</p>;')).toMatchObject([
      { kind: 'raw-jsx-error' },
    ]);
  });

  it('flags a caught message assigned directly to visible state', () => {
    expect(
      scan('setError(err instanceof Error ? err.message : String(err));'),
    ).toMatchObject([{ kind: 'raw-error-state' }]);
  });

  it('flags a visible HTTP status template', () => {
    expect(scan('setNotice(`Error ${response.status}`);')).toMatchObject([
      { kind: 'visible-machine-status' },
    ]);
  });

  it('allows presentation values routed through the shared humanizer', () => {
    expect(scan('const view = <p>{humanErrorMessage(error)}</p>;')).toEqual([]);
    expect(scan('setError(humanErrorMessage(err));')).toEqual([]);
    expect(scan('setError(humanErrorFromBody(body, response.status));')).toEqual([]);
  });

  it('allows technical detail in diagnostics and internal exceptions', () => {
    expect(scan("logger.error('failed', { error });")).toEqual([]);
    expect(scan("logger.warn('failed', { err: String(err) });")).toEqual([]);
    expect(scan('console.error(err.message);')).toEqual([]);
    expect(scan('Sentry.captureException(err);')).toEqual([]);
    expect(scan('throw new Error(`http_${res.status}`);')).toEqual([]);
  });

  it('still detects direct notification APIs', () => {
    expect(scan('toast.error(err.message);')).toMatchObject([
      { kind: 'raw-error-state' },
    ]);
    expect(scan('showToast(String(error));')).toMatchObject([
      { kind: 'raw-error-state' },
    ]);
  });

  it('reports stable file and line evidence', () => {
    const violations = scan([
      'const ok = true;',
      'const view = <p>{submitError}</p>;',
    ].join('\n'));

    expect(violations).toMatchObject([
      {
        file: 'src/pages/Example.tsx',
        line: 2,
        kind: 'raw-jsx-error',
      },
    ]);
  });
});
