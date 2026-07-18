// One place that turns ANY failure into something a person can act on.
//
// WHY: the app used to put machine-facing text straight on screen — `Error 403`,
// `http_500`, `forbidden_role`, or the Firebase SDK's English
// "Missing or insufficient permissions.". To the person using a
// risk-prevention tool, all of those read the same way: "this is broken".
// A failure nobody can interpret is indistinguishable from a bug, and in a
// safety product that costs trust exactly when it matters most. It does not
// matter whether that person is wearing a hard hat or sitting in an office —
// if they use the app, it has to speak to them.
//
// The rule: every message a user sees says WHAT happened and WHAT TO DO next.
// Never a bare status number, never a machine code, never untranslated SDK text.
//
// Copy is es-CL (CLAUDE.md #2).

const GENERIC = 'No pudimos completar la acción. Revisa los datos e inténtalo nuevamente.';

/** Server machine code (or Firebase `code`) → what a person needs to read. */
const MESSAGE_BY_CODE: Record<string, string> = {
  // ── Authorisation / identity ──────────────────────────────────────────
  forbidden_role:
    'No tienes un rol autorizado para esta acción. Pídele a un administrador, gerente, supervisor o prevencionista que la realice.',
  forbidden: 'No tienes permiso para realizar esta acción. Consulta con el administrador de tu empresa.',
  unauthorized: 'Tu sesión no es válida. Vuelve a iniciar sesión para continuar.',
  unauthenticated: 'Tu sesión expiró. Vuelve a iniciar sesión para continuar.',
  'permission-denied':
    'No tienes permiso para acceder a esta información. Si crees que deberías tenerlo, pídeselo al administrador de tu empresa.',
  tenant_mismatch:
    'Estos datos pertenecen a otra empresa. Cierra sesión y vuelve a entrar con la cuenta correcta.',

  // ── Datos / validación ────────────────────────────────────────────────
  invalid_payload:
    'Faltan datos obligatorios o alguno tiene un formato inválido. Revisa el formulario y vuelve a intentarlo.',
  empty_description: 'La descripción no puede quedar vacía. Cuéntanos brevemente qué ocurrió.',
  invalid_uid: 'No pudimos identificar tu usuario. Vuelve a iniciar sesión.',
  invalid_tenant: 'No pudimos identificar tu empresa. Vuelve a iniciar sesión.',
  invalid_project: 'El proyecto seleccionado no es válido. Elige un proyecto e inténtalo de nuevo.',
  invalid_projectId: 'El proyecto seleccionado no es válido. Vuelve a elegirlo e inténtalo nuevamente.',

  // ── Existencia ────────────────────────────────────────────────────────
  not_found: 'No encontramos lo que buscabas. Es posible que se haya eliminado.',
  'not-found': 'No encontramos lo que buscabas. Es posible que se haya eliminado.',
  form_not_found: 'No encontramos el formulario. Puede que lo hayan eliminado o que el folio sea incorrecto.',
  'already-exists': 'Ese registro ya existe. Revisa el listado antes de crear uno nuevo.',

  // ── Conectividad / capacidad ──────────────────────────────────────────
  unavailable:
    'No hay conexión con el servidor. Tus datos se guardan en el dispositivo y se sincronizan solos cuando vuelva la señal.',
  'deadline-exceeded': 'La operación tardó demasiado. Revisa tu conexión y vuelve a intentarlo.',
  'resource-exhausted': 'El servicio alcanzó su límite de uso por ahora. Espera unos minutos y vuelve a intentarlo.',
  rate_limited: 'Hiciste demasiadas solicitudes seguidas. Espera un momento y vuelve a intentarlo.',
  quota_exceeded: 'Se alcanzó el límite del plan. Consulta con el administrador de tu empresa.',

  // ── Conflicto / estado ────────────────────────────────────────────────
  'failed-precondition': 'La operación no se puede completar en el estado actual. Actualiza la página y revisa los datos.',
  aborted: 'La operación se interrumpió porque otra persona modificó los mismos datos. Actualiza y vuelve a intentarlo.',
  folio_conflict: 'Ese folio ya existe. Actualiza el listado y revisa el registro antes de volver a intentarlo.',
  cancelled: 'La operación se canceló antes de completarse. Puedes volver a intentarlo.',
  internal: 'El servidor tuvo un problema y no pudo completar la acción. Inténtalo en unos minutos.',
};

/** Fallback por status HTTP — siempre una frase, nunca un número pelado. */
function messageByStatus(status: number): string {
  if (status === 400) return MESSAGE_BY_CODE.invalid_payload;
  if (status === 401) return MESSAGE_BY_CODE.unauthenticated;
  if (status === 403) return MESSAGE_BY_CODE.forbidden;
  if (status === 404) return MESSAGE_BY_CODE.not_found;
  if (status === 409) return MESSAGE_BY_CODE.aborted;
  if (status === 429) return MESSAGE_BY_CODE.rate_limited;
  if (status >= 500) {
    return 'El servidor tuvo un problema y no pudo completar la acción. ' +
      'Vuelve a intentarlo en unos minutos; si sigue fallando, avisa al administrador.';
  }
  return GENERIC;
}

/**
 * True when `raw` is machine-facing text that must never reach a user:
 * a bare status (`Error 403`, `HTTP 500`, `http_403`), a code token
 * (`forbidden_role`, `permission-denied`) or a namespaced SDK code
 * (`auth/user-not-found`).
 *
 * Deliberately narrow: anything that looks like a real sentence is treated as
 * already-human and passed through untouched, so the good Spanish messages the
 * app already shows are never clobbered.
 */
export function isMachineText(raw: unknown): boolean {
  if (typeof raw !== 'string') return true;
  const s = raw.trim();
  if (s.length === 0) return true;
  // "Error 403", "HTTP 500", "http_403", "error_404", "403"
  if (/^(error|http|status)?[\s_:-]*\d{3}$/i.test(s)) return true;
  // single snake_case / kebab-case token: forbidden_role, permission-denied
  if (/^[a-z][a-z0-9]*([_-][a-z0-9]+)+$/i.test(s)) return true;
  // namespaced SDK code: auth/user-not-found, firestore/permission-denied
  if (/^[a-z][a-z0-9-]*\/[a-z0-9_-]+$/i.test(s)) return true;
  return false;
}

/** Extract a Firebase-style `code` when present (FirebaseError, gRPC status). */
function codeOf(err: unknown): string {
  const raw = (err as { code?: unknown } | null)?.code;
  if (typeof raw !== 'string') return '';
  // 'auth/user-not-found' → 'user-not-found'; 'permission-denied' stays.
  const tail = raw.includes('/') ? raw.slice(raw.indexOf('/') + 1) : raw;
  return tail.trim();
}

/**
 * Message to show for a FAILED `fetch` response. Reads the server's machine
 * code from the JSON body when present, falling back to the HTTP status.
 * Safe on any non-ok Response: a missing, empty or non-JSON body degrades to
 * the status sentence instead of throwing.
 *
 * Only call when `res.ok` is false — it consumes the body.
 */
export async function humanErrorFromResponse(res: Response): Promise<string> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Empty or non-JSON body — the status alone drives the message.
  }
  return humanErrorFromBody(body, res.status);
}

/**
 * Same as `humanErrorFromResponse` for callers that ALREADY consumed the body
 * (the very common `const j = await res.json().catch(() => ({}))` shape). A
 * Response body can only be read once, so those sites need this entry point.
 */
export function humanErrorFromBody(body: unknown, status: number): string {
  const b = body as { error?: unknown; message?: unknown } | null;
  const code = typeof b?.error === 'string' ? b.error : '';
  const serverText = typeof b?.message === 'string' ? b.message : '';

  const mapped = MESSAGE_BY_CODE[code];
  if (mapped) return mapped;
  // A server `message` that is already a human sentence is worth showing;
  // a machine token is not.
  if (serverText && !isMachineText(serverText)) return serverText;
  if (code && !isMachineText(code)) return code;
  return messageByStatus(status);
}

/**
 * Message to show for a caught error (thrown Error, FirebaseError, rejected
 * SDK call). Text that is ALREADY a human sentence is returned untouched, so
 * this is safe to apply blanket-wide over existing `catch` blocks without
 * degrading the messages the app already gets right.
 */
export function humanErrorMessage(err: unknown): string {
  const code = codeOf(err);
  if (code && MESSAGE_BY_CODE[code]) return MESSAGE_BY_CODE[code];

  const raw =
    typeof err === 'string'
      ? err
      : (err as { message?: unknown } | null)?.message;
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return GENERIC;

  // A code that arrived as the message ("forbidden_role").
  if (MESSAGE_BY_CODE[text]) return MESSAGE_BY_CODE[text];

  // A machine code is often prefixed with friendly-looking copy
  // (`No se pudo guardar: forbidden_role`). The prefix must not make the
  // technical suffix eligible for display. Prefer the precise mapped action.
  for (const [candidate, message] of Object.entries(MESSAGE_BY_CODE)) {
    const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const embedded = new RegExp(
      `(^|[^a-z0-9_-])${escaped}($|[^a-z0-9_-])`,
      'i',
    );
    if (embedded.test(text)) return message;
  }

  // Likewise, a status embedded in a sentence is still a status. Restrict a
  // bare number to HTTP error ranges so years and domain measurements survive.
  const statusMatch = text.match(
    /(?:\b(?:error|http|status)[\s_:-]*([1-5]\d{2})\b|\b([45]\d{2})\b)/i,
  );
  if (statusMatch) {
    return messageByStatus(Number(statusMatch[1] ?? statusMatch[2]));
  }

  // Unmapped snake_case tokens are contract identifiers, not prose.
  if (/\b[a-z0-9]+(?:_[a-z0-9]+)+\b/i.test(text)) return GENERIC;
  if (isMachineText(text)) return GENERIC;

  // The Firebase SDK's English permission message reaches users verbatim
  // through generic catch blocks — translate the ones we know by shape.
  if (/missing or insufficient permissions/i.test(text)) {
    return MESSAGE_BY_CODE['permission-denied'];
  }
  if (/permission denied/i.test(text)) {
    return MESSAGE_BY_CODE['permission-denied'];
  }
  if (/quota (?:has been )?exceeded/i.test(text)) {
    return MESSAGE_BY_CODE.quota_exceeded;
  }
  if (/\btimeout\b/i.test(text)) {
    return MESSAGE_BY_CODE['deadline-exceeded'];
  }
  if (/client is offline|failed to get document because the client is offline/i.test(text)) {
    return MESSAGE_BY_CODE.unavailable;
  }
  if (/network ?error|network (?:is )?down|failed to fetch|load failed/i.test(text)) {
    return 'No pudimos conectar con el servidor. Revisa tu conexión e inténtalo nuevamente.';
  }

  // A short direct string is usually a label/token, not enough guidance for
  // the person using the app. Error objects keep their existing domain copy.
  if (typeof err === 'string' && text.length <= 20) return GENERIC;

  // Already a human sentence — leave it exactly as the caller wrote it.
  return text;
}
