import { describe, it, expect } from 'vitest';
import { buildWebhookCurlCommand } from './webhookCommand';

describe('buildWebhookCurlCommand', () => {
  it('embeds the webhook URL and project id', () => {
    const cmd = buildWebhookCurlCommand('https://app.example.cl/api/telemetry/ingest', 'proj-42');
    expect(cmd).toContain('curl -X POST https://app.example.cl/api/telemetry/ingest');
    expect(cmd).toContain('"projectId": "proj-42"');
  });

  it('uses the global fallback when no project is selected', () => {
    const cmd = buildWebhookCurlCommand('https://x/api/telemetry/ingest', 'global');
    expect(cmd).toContain('"projectId": "global"');
  });

  it('keeps the curl example using a critical wearable sample', () => {
    const cmd = buildWebhookCurlCommand('https://x', 'p1');
    expect(cmd).toContain('"type": "wearable"');
    expect(cmd).toContain('"status": "critical"');
    expect(cmd).toContain('"metric": "Ritmo Cardíaco"');
    expect(cmd).toContain('"unit": "bpm"');
  });

  it('preserves the secretKey placeholder so users know to swap it', () => {
    const cmd = buildWebhookCurlCommand('https://x', 'p1');
    expect(cmd).toContain('"secretKey": "TU_SECRETO_AQUI"');
  });
});
