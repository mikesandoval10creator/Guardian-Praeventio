const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const root = path.resolve(__dirname, '../..');
const crate = path.join(root, 'wasm/force-graph-layout');
const inventoryPath = path.join(crate, 'LICENSES/cargo-license-inventory.json');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const load = () => JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));

test('license inventory covers every locked third-party crate, not only direct dependencies', () => {
  const lock = fs.readFileSync(path.join(crate, 'Cargo.lock'));
  const packages = lock.toString().split('[[package]]').slice(1).filter((b) => /^source = /m.test(b)).map((b) => {
    const field = (n) => JSON.parse(b.match(new RegExp(`^${n} = (".*")$`, 'm'))[1]);
    return { name: field('name'), version: field('version'), source: field('source'), archiveSha256: field('checksum') };
  });
  const inventory = load();
  assert.equal(inventory.lockSha256, sha(lock));
  assert.equal(inventory.distributionApproved, false, 'inventory is not a legal/adoption verdict');
  assert.deepEqual(inventory.packages.map(({ name, version, source, archiveSha256 }) => ({ name, version, source, archiveSha256 })), packages);
});

test('all recorded Cargo license notices ship with exact bytes', () => {
  for (const p of load().packages) {
    assert.ok(p.license && p.documents.length, `missing license ${p.name}`);
    for (const doc of p.documents) {
      const bytes = fs.readFileSync(path.join(crate, 'LICENSES/crates', `${p.name}-${p.version}`, doc.file));
      assert.equal(sha(bytes), doc.sha256);
      assert.equal(bytes.length, doc.sizeBytes);
    }
  }
  assert.equal(fs.readFileSync(path.join(crate, 'LICENSES/crates/.gitattributes'), 'utf8').trim(), '* -text');
});

test('Unicode AND obligation is preserved rather than reduced to MIT/Apache choice', () => {
  const p = load().packages.find((x) => x.name === 'unicode-ident');
  assert.equal(p.license, '(MIT OR Apache-2.0) AND Unicode-3.0');
  assert.ok(p.documents.some((x) => x.file === 'LICENSE-UNICODE'));
});

test('narrative Cargo inventory agrees with authenticated package SPDX expressions', () => {
  const markdown = fs.readFileSync(path.join(crate, 'LICENSES/THIRD-PARTY.md'), 'utf8');
  const rows = [...markdown.matchAll(/^- ([a-z][a-z0-9_-]*) (\d[^ ]*) — (.+)$/gm)].map((m) => ({
    name: m[1], version: m[2], license: m[3].replace(' (incluye COPYING y UNLICENSE)', '').trim(),
  }));
  assert.deepEqual(rows, load().packages.map(({ name, version, license }) => ({ name, version, license })));
});

test('pre-existing adapted D3 ISC notices are preserved byte-identically', () => {
  for (const file of ['d3-force.LICENSE', 'd3-quadtree.LICENSE']) {
    assert.equal(sha(fs.readFileSync(path.join(crate, 'LICENSES', file))), 'e008c5e25a6be382593089c29bfabbc553c6378eee02895aec46ce396cc404ee');
  }
});

test('required adoption lane authenticates archives and notice bytes offline', {
  skip: process.env.LAYOUT_WASM_REQUIRED !== '1' ? 'optional run: live Cargo/Python audit requires the prepared adoption environment' : false,
}, (t) => {
  const python = process.platform === 'win32' ? 'python' : 'python3';
  for (const args of [['-B', 'scripts/audit-force-graph-licenses.py', '--check'], ['-B', '-m', 'unittest', 'discover', '-s', 'scripts/tests', '-p', 'test_force_graph_licenses.py']]) {
    const r = spawnSync(python, args, { cwd: root, encoding: 'utf8', timeout: 60_000 });
    assert.equal(r.error, undefined, 'Python>=3.11 and Cargo are required in the prepared adoption lane');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    if (args.includes('unittest')) assert.match(r.stdout + r.stderr, /Ran [1-9]\d* tests/);
    t.diagnostic((r.stdout + r.stderr).trim());
  }
});
