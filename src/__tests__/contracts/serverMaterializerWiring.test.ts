import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const serverSource = readFileSync(resolve(process.cwd(), 'server.ts'), 'utf8');

describe('Zettelkasten materializer runtime wiring', () => {
  it('imports and starts the materializer from the productive server boot', () => {
    expect(serverSource).toContain('setupMaterializerListener');
    expect(serverSource).toMatch(/materializerHandle\s*=\s*setupMaterializerListener\(/);
    expect(serverSource).toContain("process.env.MATERIALIZER_ENABLED !== 'false'");
    expect(serverSource).toContain('resolveProjectTenant');
  });

  it('releases the materializer listener during graceful shutdown', () => {
    expect(serverSource).toContain('() => materializerHandle?.unsubscribe()');
  });
});