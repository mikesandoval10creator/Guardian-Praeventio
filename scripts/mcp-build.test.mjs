import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CreateMessageRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const repo = fileURLToPath(new URL('../', import.meta.url));

test('MCP compiles for Node and the entrypoint reaches configuration validation', () => {
  const build = spawnSync(process.execPath, [
    resolve(repo, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.mcp.json',
  ], { cwd: repo, encoding: 'utf8', timeout: 30000, maxBuffer: 65536 });
  assert.ifError(build.error);
  assert.equal(build.status, 0, build.stdout + build.stderr);

  // No credentials or tenant are inherited: loading all runtime imports must
  // succeed before the CLI rejects its missing tenant configuration.
  const npmCli = process.env.npm_execpath;
  assert.ok(npmCli, 'Run this regression with npm run test:mcp-build');
  const scratch = mkdtempSync(join(tmpdir(), 'mcp-start-'));
  try {
    const startup = spawnSync(process.execPath, [npmCli, '--silent', 'run', 'mcp:start'], {
      cwd: repo,
      env: {
        // Windows native runtime/shell require these; do not inherit secrets.
        ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
        ...(process.env.ComSpec ? { ComSpec: process.env.ComSpec } : {}),
        PATH: process.platform === 'win32'
          ? `${dirname(process.execPath)};C:\\Windows\\System32`
          : `${dirname(process.execPath)}:/usr/bin:/bin`,
        HOME: scratch,
        TMPDIR: scratch,
        npm_config_cache: join(scratch, 'cache'),
      },
      encoding: 'utf8',
      timeout: 45000,
      maxBuffer: 65536,
    });
    assert.ifError(startup.error);
    assert.equal(startup.status, 1, startup.stdout + startup.stderr);
    assert.match(startup.stderr, /PRAEVENTIO_MCP_TENANTS no configurada/);
    assert.equal(startup.stdout, '', 'MCP diagnostics must not pollute stdout');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

// Protocol integration, not live inference: the model reply and read-only
// data source are explicit test fixtures; SDK, compiled server and pipes are real.
test('compiled MCP uses the client model over real stdio without server LLM credentials', { timeout: 15000 }, async () => {
  const serverModule = new URL('../dist-mcp/services/mcp/zettelkastenStdioAdapter.js', import.meta.url).href;
  const childScript = `
    import assert from 'node:assert/strict';
    import { startStdioMcpServer } from ${JSON.stringify(serverModule)};
    assert.equal(process.env.GEMINI_API_KEY, undefined);
    assert.equal(process.env.GOOGLE_APPLICATION_CREDENTIALS, undefined);
    globalThis.fetch = async () => { throw new Error('Unexpected server provider request'); };
    const zk = {
      listAccessibleTenants: async () => ['protocol-tenant'],
      getNode: async () => null, expandSubgraph: async () => [],
      listNodes: async () => [{ id: 'record-1', type: 'NOTE', title: 'Protocol fixture',
        description: 'Controlled test record', tenantId: 'protocol-tenant', projectId: 'protocol-project',
        tags: [], connections: [] }],
    };
    await startStdioMcpServer({ zk, samplingProjects: [{ tenantId: 'protocol-tenant', projectId: 'protocol-project' }] });
  `;
  const env = { PATH: dirname(process.execPath), ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) };
  const transport = new StdioClientTransport({ command: process.execPath,
    args: ['--input-type=module', '-e', childScript], env, stderr: 'pipe' });
  const client = new Client({ name: 'protocol-fixture-client', version: '1.0' }, { capabilities: { sampling: {} } });
  let samplingCalls = 0;
  client.setRequestHandler(CreateMessageRequestSchema, async request => {
    samplingCalls++;
    assert.equal(request.params.includeContext, 'none');
    assert.equal(request.params.maxTokens, 768);
    assert.ok(JSON.stringify(request.params).includes('Controlled test record'));
    assert.equal(request.params.modelPreferences, undefined, 'Guardian must not select a vendor/model');
    return { model: 'controlled-client-fixture', role: 'assistant',
      content: { type: 'text', text: 'Controlled test record (zk:record-1)' } };
  });
  try {
    await client.connect(transport);
    assert.ok((await client.listTools()).tools.some(t => t.name === 'zk.analyzeProject'));
    const result = await client.callTool({ name: 'zk.analyzeProject', arguments: {
      tenantId: 'protocol-tenant', projectId: 'protocol-project', question: 'Summarize the records',
    } });
    assert.equal(result.isError, false);
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.source, 'mcp-client-sampling');
    assert.equal(payload.text, 'Controlled test record (zk:record-1)');
    assert.deepEqual(payload.contextNodeIds, ['record-1']);
    assert.equal(samplingCalls, 1);
  } finally {
    await client.close();
    await transport.close();
  }
});
