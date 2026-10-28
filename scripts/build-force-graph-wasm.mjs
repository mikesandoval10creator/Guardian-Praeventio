#!/usr/bin/env node
/**
 * build-force-graph-wasm.mjs — construye el módulo WASM experimental del layout
 * del KnowledgeGraph desde wasm/force-graph-layout de forma reproducible.
 *
 * - Compila `cargo build --release --target wasm32-unknown-unknown --locked --offline`
 *   contra el Cargo.lock commiteado (sin red, sin resolución nueva).
 * - Calcula SHA-256 del .wasm y lo copia versionado por hash a dist/ (gitignored).
 * - NO activa nada en el producto: el asset solo existe como artefacto local de
 *   distribución/verificación hasta el gate de adopción.
 *
 * Uso: node scripts/build-force-graph-wasm.mjs [--clean]
 *   --clean : elimina target/ antes de compilar (verificación de determinisidad).
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const crateDir = path.join(repoRoot, 'wasm', 'force-graph-layout');
const wasmRel = path.join('target', 'wasm32-unknown-unknown', 'release', 'force_graph_layout.wasm');
const wasmPath = path.join(crateDir, wasmRel);
const distDir = path.join(crateDir, 'dist');

function resolveCargo() {
  const candidates = process.env.CARGO
    ? [process.env.CARGO]
    : ['cargo', path.join(process.env.USERPROFILE || '', '.cargo', 'bin', 'cargo.exe')];
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (probe.status === 0) return candidate;
  }
  throw new Error('cargo not found: install Rust 1.99.1 (see wasm/force-graph-layout/rust-toolchain.toml)');
}

function main() {
  for (const required of ['Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml']) {
    if (!fs.existsSync(path.join(crateDir, required))) {
      throw new Error(`missing ${required} in ${crateDir}`);
    }
  }
  const cargo = resolveCargo();
  const clean = process.argv.includes('--clean');
  if (clean) fs.rmSync(path.join(crateDir, 'target'), { recursive: true, force: true });

  const build = spawnSync(
    cargo,
    ['build', '--release', '--bin', 'force_graph_layout', '--target', 'wasm32-unknown-unknown', '--locked', '--offline'],
    { cwd: crateDir, encoding: 'utf8' },
  );
  if (build.status !== 0) {
    process.stderr.write(build.stdout || '');
    process.stderr.write(build.stderr || '');
    throw new Error(`cargo build failed with exit ${build.status}`);
  }

  const bytes = fs.readFileSync(wasmPath);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  fs.mkdirSync(distDir, { recursive: true });
  const assetName = `force-graph-layout-${sha256}.wasm`;
  fs.copyFileSync(wasmPath, path.join(distDir, assetName));
  const report = {
    module: 'force-graph-layout',
    abiVersion: 1,
    sha256,
    sizeBytes: bytes.length,
    toolchain: '1.99.1 (rust-toolchain.toml)',
    target: 'wasm32-unknown-unknown',
    buildCommand: 'cargo build --release --bin force_graph_layout --target wasm32-unknown-unknown --locked --offline',
    activatedInProduct: false,
  };
  fs.writeFileSync(path.join(distDir, 'build-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`force-graph-layout wasm built: ${assetName}`);
  console.log(`sha256=${sha256}`);
  console.log(`sizeBytes=${bytes.length}`);
  console.log('activatedInProduct=false');
}

main();
