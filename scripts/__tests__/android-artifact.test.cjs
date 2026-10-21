'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  findAdMobStrings,
  findAdMobManifestMarkers,
  readZipEntry,
  scanDex,
} = require('../check-android-artifact.cjs');

// Minimal stored-ZIP builder: enough to exercise the APK reader without a
// fixture binary or an external zip tool. CRC is not read by the guard.
function buildStoredZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuffer = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    localParts.push(local, nameBuffer, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuffer);

    offset += local.length + nameBuffer.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, centralDirectory, eocd]);
}

test('detects AdMob classes in DEX entries', () => {
  const dex = Buffer.from(
    'Lcom/google/android/gms/ads/AdView;Lcom/google/android/gms/ads/MobileAds;',
    'utf8',
  );
  const zip = buildStoredZip([{ name: 'classes.dex', data: dex }]);

  assert.equal(readZipEntry(zip, 'classes.dex').toString('utf8'), dex.toString('utf8'));
  assert.deepEqual(
    scanDex(zip).sort(),
    [
      'com/google/android/gms/ads/AdView',
      'com/google/android/gms/ads/MobileAds',
    ].sort(),
  );
});

test('scans every classes*.dex, not only classes.dex', () => {
  const zip = buildStoredZip([
    { name: 'classes.dex', data: Buffer.from('clean', 'utf8') },
    {
      name: 'classes2.dex',
      data: Buffer.from('com/google/android/gms/ads/InterstitialAd', 'utf8'),
    },
  ]);

  assert.deepEqual(scanDex(zip), ['com/google/android/gms/ads/InterstitialAd']);
});

test('does not flag the advertising-id client used by non-ads analytics', () => {
  const dex = Buffer.from(
    'Lcom/google/android/gms/ads/identifier/AdvertisingIdClient;',
    'utf8',
  );
  const zip = buildStoredZip([{ name: 'classes.dex', data: dex }]);

  assert.deepEqual(scanDex(zip), []);
});

test('reads the packaged AndroidManifest.xml entry', () => {
  const manifest = Buffer.from(
    '<manifest><uses-permission android:name="android.permission.CAMERA"/></manifest>',
    'utf8',
  );
  const zip = buildStoredZip([{ name: 'AndroidManifest.xml', data: manifest }]);

  assert.equal(
    readZipEntry(zip, 'AndroidManifest.xml').toString('utf8'),
    manifest.toString('utf8'),
  );
});

test('finds AdMob manifest markers in UTF-8 and UTF-16LE string pools', () => {
  const marker = 'com.google.android.gms.permission.AD_ID';
  const utf8 = Buffer.from(`<uses-permission android:name="${marker}"/>`, 'utf8');
  const utf16 = Buffer.from(marker, 'utf16le');

  assert.deepEqual(findAdMobManifestMarkers(utf8), [marker]);
  assert.deepEqual(findAdMobManifestMarkers(utf16), [marker]);
});

test('ignores a manifest with no ad-services markers', () => {
  const manifest = Buffer.from(
    '<manifest><uses-permission android:name="android.permission.CAMERA"/></manifest>',
    'utf8',
  );

  assert.deepEqual(findAdMobManifestMarkers(manifest), []);
  assert.deepEqual(findAdMobStrings(manifest), []);
});

test('CI runs the packaged APK guard and uploads the artifact', () => {
  const workflow = require('node:fs').readFileSync(
    require('node:path').resolve(
      __dirname,
      '../../.github/workflows/mobile-build-check.yml',
    ),
    'utf8',
  );

  assert.match(workflow, /node scripts\/check-android-artifact\.cjs/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /app-debug\.apk/);
});
