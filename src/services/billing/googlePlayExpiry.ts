// Play subscriptionsv2 expiryTime is RFC3339, not epoch milliseconds.
// Preserve the store timestamp, including nanoseconds and timezone offsets.
const RFC3339 = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

export function parseGooglePlayExpiryTime(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new Error('Invalid Google Play expiryTime');
  const match = RFC3339.exec(value);
  if (!match) throw new Error('Invalid Google Play expiryTime');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (year < 1 || day > lastDay || !Number.isFinite(Date.parse(value))) {
    throw new Error('Invalid Google Play expiryTime');
  }
  return value;
}
