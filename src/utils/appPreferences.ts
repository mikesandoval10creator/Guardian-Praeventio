/**
 * User-level app preferences persisted as a SINGLE nested map field
 * `appPreferences` on `users/{uid}`. One top-level key keeps us well under
 * the firestore.rules `isValidUser` 20-key cap regardless of how many
 * sub-preferences we add. Loaded values come from an untrusted Firestore
 * document, so `coerceAppPreferences` validates every field and falls back
 * to the provided defaults — a malformed doc can never crash the Settings
 * page or silently apply a garbage value.
 */
export interface AppPreferences {
  /** Email alert opt-in. */
  emailNotifs: boolean;
  /** Session expiry in minutes, kept as a string to match the <select> value. */
  sessionTimeout: string;
  /** Gemini response verbosity ('conciso' | 'equilibrado' | 'detallado'). */
  aiDetail: string;
  /** Autonomous background AI analysis opt-in. */
  aiProactive: boolean;
}

export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  emailNotifs: true,
  sessionTimeout: '30',
  aiDetail: 'equilibrado',
  aiProactive: true,
};

/**
 * Validate a raw (untrusted) value read from Firestore into a well-typed
 * AppPreferences, substituting `defaults` for any missing/wrong-typed field.
 */
export function coerceAppPreferences(
  raw: unknown,
  defaults: AppPreferences = DEFAULT_APP_PREFERENCES,
): AppPreferences {
  if (!raw || typeof raw !== 'object') return { ...defaults };
  const r = raw as Record<string, unknown>;
  return {
    emailNotifs: typeof r.emailNotifs === 'boolean' ? r.emailNotifs : defaults.emailNotifs,
    sessionTimeout: typeof r.sessionTimeout === 'string' ? r.sessionTimeout : defaults.sessionTimeout,
    aiDetail: typeof r.aiDetail === 'string' ? r.aiDetail : defaults.aiDetail,
    aiProactive: typeof r.aiProactive === 'boolean' ? r.aiProactive : defaults.aiProactive,
  };
}
