#!/usr/bin/env node
'use strict';

/**
 * Guard the PACKAGED Android artifact against AdMob, not just the source tree.
 *
 * The source-level AdMob removal can regress through a transitive Gradle
 * dependency: `play-services-ads` (or an ads-identifier variant) can reappear
 * in the merged manifest and the DEX without any file in this repo mentioning
 * it. This script reads the APK that CI actually built:
 *
 *   - every `classes*.dex` for AdMob classes,
 *   - the packaged binary `AndroidManifest.xml` for ad-services permissions
 *     and APPLICATION_ID (UTF-8 and UTF-16LE string pools),
 *   - the AGP merged manifest when it is still on disk.
 *
 * It parses the ZIP central directory directly with Node's zlib, so the guard
 * needs no `unzip`/`tar` and runs the same on Linux and Windows.
 *
 * `com/google/android/gms/ads/identifier/` is the Advertising ID client used by
 * non-ads analytics. It is deliberately NOT treated as AdMob; the ad-services
 * permission markers below still catch an unintended ad-tech dependency.
 *
 * Usage:
 *   node scripts/check-android-artifact.cjs
 *   node scripts/check-android-artifact.cjs --apk path/to/app-debug.apk
 *
 * Exit codes: 0 clean, 1 AdMob evidence found, 2 unreadable APK.
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_APK = path.join(ROOT, 'android/app/build/outputs/apk/debug/app-debug.apk');
const MERGED_MANIFEST_DIR = path.join(
  ROOT,
  'android/app/build/intermediates/merged_manifests/debug',
);

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;

// DEX strings that only the Google Mobile Ads (AdMob) SDK carries. Keep these
// specific so an unrelated `ads.identifier` client is not a false positive.
const ADMOB_STRING_MARKERS = [
  'com/google/android/gms/ads/AdActivity',
  'com/google/android/gms/ads/AdListener',
  'com/google/android/gms/ads/AdRequest',
  'com/google/android/gms/ads/AdSize',
  'com/google/android/gms/ads/AdView',
  'com/google/android/gms/ads/FullScreenContentCallback',
  'com/google/android/gms/ads/InterstitialAd',
  'com/google/android/gms/ads/MobileAds',
  'com/google/android/gms/ads/RewardedAd',
  'com/google/android/gms/ads/appopen/AppOpenAd',
  'com/google/android/gms/ads/mediation/',
];

// Manifest/ad-tech markers. `AD_ID` is the advertising-ID permission; a safety
// app with clinical PII should not merge it without an explicit decision.
const ADMOB_MANIFEST_MARKERS = [
  'com.google.android.gms.ads.APPLICATION_ID',
  'com.google.android.gms.ads.AdActivity',
  'com.google.android.gms.permission.AD_ID',
  'android.permission.ACCESS_ADSERVICES_AD_ID',
  'android.permission.ACCESS_ADSERVICES_ATTRIBUTION',
  'android.permission.ACCESS_ADSERVICES_TOPICS',
];

function unique(values) {
  return [...new Set(values)];
}

function findAdMobStrings(buffer) {
  return ADMOB_STRING_MARKERS.filter((marker) =>
    buffer.includes(Buffer.from(marker, 'utf8')),
  );
}

function findAdMobManifestMarkers(buffer) {
  const utf8 = buffer.toString('utf8');
  const utf16 = buffer.toString('utf16le');
  return unique(
    ADMOB_MANIFEST_MARKERS.filter(
      (marker) => utf8.includes(marker) || utf16.includes(marker),
    ),
  );
}

function readUInt16(buffer, offset) {
  return buffer.readUInt16LE(offset);
}

function readUInt32(buffer, offset) {
  return buffer.readUInt32LE(offset);
}

/**
 * Minimal ZIP reader for APKs: locate the EOCD, walk the central directory,
 * and inflate one entry. Throws on Zip64 or unsupported compression instead of
 * silently skipping an artifact it cannot inspect.
 */
function readZipEntry(apk, wantedName) {
  const eocd = apk.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd === -1) throw new Error('ZIP end-of-central-directory not found');
  if (eocd >= 20 && readUInt32(apk, eocd - 20) === ZIP64_LOCATOR_SIGNATURE) {
    throw new Error('ZIP64 APK is not supported by this guard');
  }

  const entryCount = readUInt16(apk, eocd + 10);
  const centralOffset = readUInt32(apk, eocd + 16);
  let cursor = centralOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (readUInt32(apk, cursor) !== CENTRAL_SIGNATURE) {
      throw new Error(`invalid central directory entry at ${cursor}`);
    }

    const method = readUInt16(apk, cursor + 10);
    const compressedSize = readUInt32(apk, cursor + 20);
    const nameLength = readUInt16(apk, cursor + 28);
    const extraLength = readUInt16(apk, cursor + 30);
    const commentLength = readUInt16(apk, cursor + 32);
    const localOffset = readUInt32(apk, cursor + 42);
    const name = apk.toString('utf8', cursor + 46, cursor + 46 + nameLength);

    if (name === wantedName) {
      if (compressedSize === 0xffffffff || localOffset === 0xffffffff) {
        throw new Error(`${wantedName} uses ZIP64 sizes`);
      }
      if (readUInt32(apk, localOffset) !== LOCAL_SIGNATURE) {
        throw new Error(`invalid local header for ${wantedName}`);
      }
      const localNameLength = readUInt16(apk, localOffset + 26);
      const localExtraLength = readUInt16(apk, localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = apk.subarray(dataStart, dataStart + compressedSize);

      if (method === 0) return Buffer.from(compressed);
      if (method === 8) return zlib.inflateRawSync(compressed);
      throw new Error(`${wantedName} uses unsupported compression method ${method}`);
    }

    cursor += 46 + nameLength + extraLength + commentLength;
  }

  throw new Error(`${wantedName} not found in APK`);
}

function listZipEntryNames(apk) {
  const eocd = apk.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd === -1) throw new Error('ZIP end-of-central-directory not found');
  if (eocd >= 20 && readUInt32(apk, eocd - 20) === ZIP64_LOCATOR_SIGNATURE) {
    throw new Error('ZIP64 APK is not supported by this guard');
  }
  const entryCount = readUInt16(apk, eocd + 10);
  const centralOffset = readUInt32(apk, eocd + 16);
  let cursor = centralOffset;
  const names = [];

  for (let index = 0; index < entryCount; index += 1) {
    if (readUInt32(apk, cursor) !== CENTRAL_SIGNATURE) {
      throw new Error(`invalid central directory entry at ${cursor}`);
    }
    const nameLength = readUInt16(apk, cursor + 28);
    const extraLength = readUInt16(apk, cursor + 30);
    const commentLength = readUInt16(apk, cursor + 32);
    names.push(apk.toString('utf8', cursor + 46, cursor + 46 + nameLength));
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

function scanDex(apk) {
  const dexEntries = listZipEntryNames(apk).filter((entry) =>
    /^classes\d*\.dex$/.test(entry),
  );
  if (dexEntries.length === 0) {
    throw new Error('APK contains no classes*.dex entries');
  }

  const hits = [];
  for (const entry of dexEntries) {
    hits.push(...findAdMobStrings(readZipEntry(apk, entry)));
  }
  return unique(hits);
}

function findMergedManifest(dir = MERGED_MANIFEST_DIR) {
  if (!fs.existsSync(dir)) return null;

  const pending = [dir];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(full);
      else if (entry.name === 'AndroidManifest.xml') return full;
    }
  }
  return null;
}

function parseArgs(argv) {
  const index = argv.indexOf('--apk');
  if (index === -1) return DEFAULT_APK;
  const value = argv[index + 1];
  if (!value) throw new Error('--apk requires a path');
  return path.resolve(value);
}

function main(argv = process.argv.slice(2)) {
  let apkPath;
  try {
    apkPath = parseArgs(argv);
  } catch (error) {
    console.error(`[android-artifact] ${error.message}`);
    return 2;
  }

  if (!fs.existsSync(apkPath)) {
    console.error(`[android-artifact] APK not found: ${apkPath}`);
    return 2;
  }

  let dexHits;
  let apkManifestHits;
  try {
    const apk = fs.readFileSync(apkPath);
    dexHits = scanDex(apk);
    apkManifestHits = findAdMobManifestMarkers(
      readZipEntry(apk, 'AndroidManifest.xml'),
    );
  } catch (error) {
    console.error(`[android-artifact] cannot inspect APK: ${error.message}`);
    return 2;
  }

  const mergedManifest = findMergedManifest();
  const mergedHits = mergedManifest
    ? findAdMobManifestMarkers(fs.readFileSync(mergedManifest))
    : [];

  const hits = unique([...dexHits, ...apkManifestHits, ...mergedHits]);
  if (hits.length > 0) {
    console.error('[android-artifact] FAIL — AdMob evidence in the packaged APK:');
    for (const hit of hits) console.error(`  - ${hit}`);
    console.error(
      'Remove the transitive ads dependency (or the merged permission) before release.',
    );
    return 1;
  }

  console.log(
    `[android-artifact] PASS — no AdMob classes or ad-services markers in ${path.basename(apkPath)}` +
      (mergedManifest ? ` (merged manifest: ${path.relative(ROOT, mergedManifest)})` : ''),
  );
  return 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = {
  ADMOB_STRING_MARKERS,
  ADMOB_MANIFEST_MARKERS,
  findAdMobStrings,
  findAdMobManifestMarkers,
  findMergedManifest,
  listZipEntryNames,
  main,
  readZipEntry,
  scanDex,
};
