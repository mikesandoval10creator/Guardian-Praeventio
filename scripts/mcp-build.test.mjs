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

// Real compiled server + stdio; corpus and project rows are controlled fixtures.
// NO sampling capability: the user's host receives a prepared prompt, not a
// fabricated model answer and not a request to a server-selected provider.
test('compiled MCP prepares actions and searches native law over stdio without sampling', { timeout: 15000 }, async () => {
  const serverModule = new URL('../dist-mcp/services/mcp/zettelkastenStdioAdapter.js', import.meta.url).href;
  const nativeModule = new URL('../dist-mcp/services/rag/nativeNormativeContext.js', import.meta.url).href;
  const childScript = `
    import assert from 'node:assert/strict';
    import { startStdioMcpServer } from ${JSON.stringify(serverModule)};
    import { createNormativeRetriever } from ${JSON.stringify(nativeModule)};
    assert.equal(process.env.GEMINI_API_KEY, undefined);
    assert.equal(process.env.GOOGLE_APPLICATION_CREDENTIALS, undefined);
    globalThis.fetch = async () => { throw new Error('Unexpected server provider request'); };
    const zk = { listAccessibleTenants: async () => ['t1'], getNode: async () => null, expandSubgraph: async () => [],
      listNodes: async () => [{ id: 'n1', tenantId: 't1', projectId: 'p1', type: 'NOTE', title: 'Project fixture',
        description: 'ruido ocupacional', tags: [], connections: [] }] };
    const retrieveNormative = createNormativeRetriever(async () => [{ id: 'law-1234-chunk-0',
      data: { lawId: '1234', title: 'Law fixture', content: 'Texto controlado sobre ruido ocupacional.' } }]);
    await startStdioMcpServer({ zk, samplingProjects: [{ tenantId: 't1', projectId: 'p1' }], retrieveNormative });
  `;
  const env = { PATH: dirname(process.execPath), ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) };
  const transport = new StdioClientTransport({ command: process.execPath,
    args: ['--input-type=module', '-e', childScript], env, stderr: 'pipe' });
  const client = new Client({ name: 'host-without-sampling', version: '1' }, { capabilities: {} });
  try {
    await client.connect(transport);
    assert.equal((await client.listPrompts()).prompts.length, 6);
    const prepared = await client.getPrompt({ name: 'guardian.getChatResponse', arguments: {
      tenantId: 't1', projectId: 'p1', input: JSON.stringify(['ruido ocupacional', '', [], 1, 'medicina']),
    } });
    assert.match(prepared.messages[0].content.text, /NUNCA emitas un diagnóstico/);
    assert.match(prepared.messages[0].content.text, /Project fixture/);
    assert.match(prepared.messages[0].content.text, /law-1234-chunk-0/);
    const result = await client.callTool({ name: 'legal.searchNormative', arguments: { tenantId: 't1', query: 'ruido ocupacional' } });
    assert.equal(result.isError, false);
    assert.equal(JSON.parse(result.content[0].text).method, 'lexical');
    assert.equal(JSON.parse(result.content[0].text).matches[0].id, 'law-1234-chunk-0');
  } finally { await client.close(); await transport.close(); }
});

// SDK + actual compiled edge reader/tenant adapter, real process and stdio.
// Identity policy and stored documents are explicit fixtures, not production IAM.
test('compiled MCP exposes only opted-in project typed relations without inference', { timeout: 15000 }, async () => {
  const serverModule = new URL('../dist-mcp/services/mcp/zettelkastenStdioAdapter.js', import.meta.url).href;
  const readerModule = new URL('../dist-mcp/server/mcp/typedEdgesReader.js', import.meta.url).href;
  const adapterModule = new URL('../dist-mcp/server/mcp/zkFirebaseReadAdapter.js', import.meta.url).href;
  const contractModule = new URL('../dist-mcp/services/mcp/typedEdges.js', import.meta.url).href;
  const childScript = `
    import { startStdioMcpServer } from ${JSON.stringify(serverModule)};
    import { createTypedEdgesReader } from ${JSON.stringify(readerModule)};
    import { createZkFirebaseReadAdapter } from ${JSON.stringify(adapterModule)};
    import { typedEdgesOptIn } from ${JSON.stringify(contractModule)};
    globalThis.fetch = async () => { throw new Error('Unexpected provider request'); };
    const docs = {
      'tenants/t1/zettelkasten_nodes/n1': {tenantId:'t1',projectId:'p1'},
      'tenants/t1/zettelkasten_nodes/n2': {tenantId:'t1',projectId:'p1'},
      'tenants/t1/zettelkasten_nodes/foreign': {tenantId:'t1',projectId:'p2'},
      'tenants/t1/zettelkasten_edges/e1': {id:'e1',tenantId:'t1',projectId:'p1',fromNodeId:'n1',toNodeId:'n2',type:'mitigates',inverseType:'mitigated_by',weight:0.8,createdBy:'private-worker'},
      'tenants/t1/zettelkasten_edges/e2': {id:'e2',tenantId:'t1',projectId:'p1',fromNodeId:'n1',toNodeId:'foreign',type:'requires',inverseType:'required_by'},
    };
    function collection(path, filters = [], cap = Infinity) {
      if(!path.startsWith('tenants')) throw new Error('unexpected global read');
      return {
        doc(id) { const p=path+'/'+id; return {id,get:async()=>({id,exists:!!docs[p],data:()=>docs[p]}),collection:name=>collection(p+'/'+name)}; },
        where(field,op,value) {if(op!=='==')throw new Error('unexpected query');return collection(path,[...filters,[field,value]],cap);},
        limit(n) {return collection(path,filters,n);},
        async get(){return {docs:Object.entries(docs).filter(([p,d])=>p.startsWith(path+'/')&&!p.slice(path.length+1).includes('/')&&filters.every(([f,v])=>d[f]===v)).slice(0,cap).map(([p,d])=>({id:p.split('/').at(-1),exists:true,data:()=>d}))};},
      };
    }
    const firestore={collection}; const allowedProjects=[{tenantId:'t1',projectId:'p1'}];
    await startStdioMcpServer({zk:createZkFirebaseReadAdapter({firestore,accessibleTenants:['t1']}),samplingProjects:allowedProjects,
      readEdges:typedEdgesOptIn(process.env.PRAEVENTIO_MCP_TYPED_EDGES)?createTypedEdgesReader({firestore,accessibleTenants:['t1'],allowedProjects}):undefined});
  `;
  for (const flag of ['0', '1']) {
    const transport = new StdioClientTransport({ command: process.execPath,
      args: ['--input-type=module','-e',childScript], stderr:'pipe', env: {
        PATH: dirname(process.execPath), ...(process.env.SystemRoot ? {SystemRoot:process.env.SystemRoot}:{}),
        PRAEVENTIO_MCP_TYPED_EDGES:flag,
      } });
    const client = new Client({name:'typed-edge-stdio-fixture',version:'1'},{capabilities:{}});
    try {
      await client.connect(transport);
      assert.equal((await client.listTools()).tools.some(t=>t.name==='zk.listEdges'),flag==='1');
      const result=await client.callTool({name:'zk.listEdges',arguments:{tenantId:'t1',projectId:'p1'}});
      if(flag==='0') {assert.equal(result.isError,true);continue;}
      assert.equal(result.isError,false);
      const data=JSON.parse(result.content[0].text);
      assert.deepEqual(data.edges,[{id:'e1',fromNodeId:'n1',toNodeId:'n2',type:'mitigates',inverseType:'mitigated_by',weight:0.8}]);
      assert.equal(data.omitted,1); assert.equal(data.bounded,true);
      assert.doesNotMatch(JSON.stringify(data),/private-worker|foreign/);
      assert.equal((await client.callTool({name:'zk.listEdges',arguments:{tenantId:'t1',projectId:'p2'}})).isError,true);
    } finally {await client.close();await transport.close();}
  }
});
