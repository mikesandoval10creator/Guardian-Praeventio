'use strict';

function validateLookupKeyring(value, options = {}) {
  if (!value || Array.isArray(value) || typeof value !== 'object') return false;
  const entries = Object.entries(value);
  const minimumEntries = options.minimumEntries ?? 1;
  return entries.length >= minimumEntries && entries.every(([version, key]) =>
    /^[A-Za-z0-9._-]{1,40}$/.test(version) &&
    typeof key === 'string' &&
    Buffer.byteLength(key, 'utf8') >= 32,
  );
}

module.exports = { validateLookupKeyring };

if (require.main === module) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { raw += chunk; });
  process.stdin.on('end', () => {
    try {
      const parsed = JSON.parse(raw);
      if (!validateLookupKeyring(parsed)) throw new Error('invalid keyring');
      console.info('Health professional lookup keyring is valid.');
    } catch {
      console.error('HEALTH_PROFESSIONAL_LOOKUP_KEYS must be versioned JSON with keys of at least 32 bytes.');
      process.exitCode = 1;
    }
  });
}
