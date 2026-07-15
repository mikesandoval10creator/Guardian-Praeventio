#!/usr/bin/env node
'use strict';

const MAX_LABEL_LENGTH = 64;

function normalizePrefix(prefix) {
  return String(prefix || '').replace(/^\/+|\/+$/g, '');
}

function parseGsUri(uri) {
  if (typeof uri !== 'string' || !uri.startsWith('gs://')) {
    throw new Error(`Invalid GCS URI: ${uri}`);
  }
  const withoutScheme = uri.slice('gs://'.length);
  const slash = withoutScheme.indexOf('/');
  const bucket = slash === -1 ? withoutScheme : withoutScheme.slice(0, slash);
  const prefix = slash === -1 ? '' : normalizePrefix(withoutScheme.slice(slash + 1));
  if (!bucket || /\s/.test(bucket)) {
    throw new Error(`Invalid GCS URI: ${uri}`);
  }
  return { bucket, prefix };
}

function sanitizeLabel(label) {
  return String(label || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, MAX_LABEL_LENGTH);
}

function utcMinuteSlug(date) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new Error('A valid Date is required to build a backup URI.');
  }
  const pad = (value) => String(value).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}` +
    `-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}`
  );
}

function canonicalNamespace(prefix) {
  const normalized = normalizePrefix(prefix);
  if (normalized === 'firestore' || normalized.endsWith('/firestore')) {
    return normalized;
  }
  return normalized ? `${normalized}/firestore` : 'firestore';
}

function buildCanonicalExportUri(bucketUri, date, label = '') {
  const { bucket, prefix } = parseGsUri(bucketUri);
  const safeLabel = sanitizeLabel(label);
  const folder = `${utcMinuteSlug(date)}${safeLabel ? `-${safeLabel}` : ''}`;
  return `gs://${bucket}/${canonicalNamespace(prefix)}/${folder}`;
}

function strictUtcDate(year, month, day, hour = 0, minute = 0) {
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute
  ) {
    return null;
  }
  return date;
}

function parseDatedFolder(folder, layout) {
  const canonical = /^(\d{4})-(\d{2})-(\d{2})(?:-(\d{2})(\d{2}))?(?:-([a-zA-Z0-9_-]{1,64}))?$/;
  const legacy = /^firestore-export-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(?:-([a-zA-Z0-9_-]{1,64}))?$/;
  const match = (layout === 'canonical' ? canonical : legacy).exec(folder);
  if (!match) return null;
  const [, year, month, day, hour = '00', minute = '00', label] = match;
  const date = strictUtcDate(+year, +month, +day, +hour, +minute);
  if (!date) return null;
  return { date, label: label || null };
}

function parseExportFolder(fullPrefix, discoveryPrefix = '') {
  const normalizedFull = normalizePrefix(fullPrefix);
  const normalizedRoot = normalizePrefix(discoveryPrefix);
  const canonicalBase = `${canonicalNamespace(normalizedRoot)}/`;
  if (normalizedFull.startsWith(canonicalBase)) {
    const folder = normalizedFull.slice(canonicalBase.length);
    if (!folder || folder.includes('/')) return null;
    const parsed = parseDatedFolder(folder, 'canonical');
    return parsed
      ? {
          folder,
          fullPrefix: normalizedFull,
          date: parsed.date,
          layout: 'canonical',
          label: parsed.label,
        }
      : null;
  }

  const rootPrefix = normalizedRoot ? `${normalizedRoot}/` : '';
  if (rootPrefix && !normalizedFull.startsWith(rootPrefix)) return null;
  const folder = rootPrefix ? normalizedFull.slice(rootPrefix.length) : normalizedFull;
  if (!folder || folder.includes('/')) return null;
  const parsed = parseDatedFolder(folder, 'legacy');
  return parsed
    ? {
        folder,
        fullPrefix: normalizedFull,
        date: parsed.date,
        layout: 'legacy',
        label: parsed.label,
      }
    : null;
}

module.exports = {
  buildCanonicalExportUri,
  canonicalNamespace,
  parseExportFolder,
  parseGsUri,
  sanitizeLabel,
  utcMinuteSlug,
};
