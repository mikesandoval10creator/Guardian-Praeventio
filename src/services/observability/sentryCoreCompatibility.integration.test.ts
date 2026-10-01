import { afterEach, describe, expect, it } from 'vitest';
import * as BrowserSentry from '@sentry/react';
import * as SharedCoreSentry from '@sentry/core';

describe('Sentry browser SDK and shared core compatibility', () => {
  afterEach(async () => {
    await BrowserSentry.close(0);
  });

  it('exposes the initialized React client through the shared @sentry/core import', () => {
    BrowserSentry.init({
      dsn: 'https://public@example.ingest.sentry.io/1',
      defaultIntegrations: false,
      integrations: [],
    });

    const browserClient = BrowserSentry.getCurrentScope().getClient();
    const sharedCoreClient = SharedCoreSentry.getCurrentScope().getClient();

    expect(browserClient).toBeDefined();
    expect(sharedCoreClient).toBe(browserClient);
  });
});
