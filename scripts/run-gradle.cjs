#!/usr/bin/env node
/**
 * Run the Android Gradle wrapper from an npm script on every supported host.
 *
 * npm executes package scripts through cmd.exe on Windows, where `./gradlew`
 * is not a valid executable command. The release script must still work on
 * macOS/Linux, where the Unix wrapper is the canonical entry point.
 *
 * Arguments are passed as argv rather than interpolated into a shell command.
 */

'use strict';

const { existsSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = resolve(__dirname, '..');
const androidRoot = join(repoRoot, 'android');
const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('Usage: node scripts/run-gradle.cjs <gradle-task> [...args]');
  process.exit(2);
}

const wrapper = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
if (!existsSync(join(androidRoot, wrapper))) {
  console.error(`[run-gradle] wrapper not found: android/${wrapper}`);
  process.exit(1);
}

const command = process.platform === 'win32' ? 'cmd.exe' : wrapper;
const commandArgs = process.platform === 'win32'
  ? ['/d', '/s', '/c', wrapper, ...args]
  : args;

const result = spawnSync(command, commandArgs, {
  cwd: androidRoot,
  env: process.env,
  stdio: 'inherit',
});

if (result.error) {
  console.error(`[run-gradle] failed to start ${wrapper}: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
