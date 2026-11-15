/** Canonical client DTO for generated training capsules; never render provider objects directly. */
export interface SafetyCapsuleDto {
  readonly schemaVersion: 1;
  readonly title: string;
  readonly content: string;
  readonly keyTip: string;
  readonly duration: string;
}

/** Validate and strip provider-only fields once, at the HTTP client boundary. */
export function normalizeSafetyCapsule(value: unknown): SafetyCapsuleDto {
  // Preserve a legacy text response, without fabricating safety advice or timing.
  if (typeof value === 'string' && value.trim() && value.length <= 20000) {
    return { schemaVersion: 1, title: 'Cápsula de seguridad', content: value.trim(), keyTip: '', duration: '' };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid safety capsule response');
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== undefined && record.schemaVersion !== 1) {
    throw new Error('Unsupported safety capsule version');
  }
  const field = (key: string, max: number): string => {
    const raw = record[key];
    if (typeof raw !== 'string' || !raw.trim() || raw.length > max) {
      throw new Error('Invalid safety capsule field');
    }
    return raw.trim();
  };
  return {
    schemaVersion: 1,
    title: field('title', 300),
    content: field('content', 20000),
    keyTip: field('keyTip', 2000),
    duration: field('duration', 100),
  };
}
