const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('PWA manifest declares only assets that are served locally', () => {
  const manifest = JSON.parse(read('public/manifest.json'));

  for (const icon of manifest.icons) {
    assert.ok(icon.src.startsWith('/'), `icon must be local: ${icon.src}`);
    assert.ok(fs.existsSync(path.join(root, 'public', icon.src.slice(1))), `missing asset: ${icon.src}`);
  }
});

test('public metadata keeps the public and application domains separated', () => {
  const html = read('index.html');
  assert.match(html, /<link rel="canonical" href="https:\/\/praeventio\.net\/"/);
  assert.match(html, /"logo": "https:\/\/praeventio\.net\/icon\.svg"/);
  assert.match(html, /"url": "https:\/\/app\.praeventio\.net"/);
  assert.match(html, /"url": "https:\/\/praeventio\.net"/);
  assert.doesNotMatch(html, /https:\/\/(?:www|guard)\.praeventio\.net/);
});

test('landing footer does not publish retired domain links', () => {
  const footer = read('src/components/landing/LandingFooter.tsx');
  assert.doesNotMatch(footer, /www\.praeventio\.net|guard\.praeventio\.net/);
  assert.match(footer, /https:\/\/praeventio\.net\//);
});
