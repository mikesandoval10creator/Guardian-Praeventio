// Human-readable failures for the regulatory-document flows (SUSESO
// DIAT/DIEP, DS-67, DS-76).
//
// WHY THIS EXISTS: the server answers a rejected action with an HTTP status
// plus a machine code (`forbidden_role`, `tenant_mismatch`, `invalid_payload`).
// Both are correct — and both are meaningless to the person holding the phone.
// The builders used to render `Error 403` verbatim, which a prevencionista in
// the field reads as "the app is broken", when in fact the app worked exactly
// as designed and simply refused the action. A refusal the user can't
// understand is indistinguishable from a bug: it generates support load and
// erodes trust in a compliance tool people must rely on.
//
// So: every failure becomes a sentence that says WHAT happened and WHAT TO DO
// next. Never a bare number, never a raw code.
//
// Copy is es-CL (CLAUDE.md #2). These builders are still pre-i18n (all their
// labels are hardcoded Spanish), so the strings live here rather than in
// `common.json` — a future i18n pass should lift the whole component family at
// once instead of leaving it half-translated.

/** Machine code → what a person needs to read. */
const MESSAGE_BY_CODE: Record<string, string> = {
  // The [P0] role gate on create/sign/submit. This is the most likely refusal
  // a real user will hit, so it names the roles that CAN do it.
  forbidden_role:
    'No tienes un rol autorizado para crear, firmar o enviar documentos regulatorios. ' +
    'Esta acción está reservada a administrador, gerente, supervisor o prevencionista. ' +
    'Pídele a una de esas personas que la realice.',
  // Tenant scoping: the token's company doesn't match the document's.
  tenant_mismatch:
    'Este documento pertenece a otra empresa. Cierra sesión y vuelve a entrar con la cuenta de la empresa correcta.',
  // Zod/schema rejection before the handler runs.
  invalid_payload:
    'Faltan datos obligatorios o alguno tiene un formato inválido. Revisa el formulario y vuelve a intentarlo.',
  form_not_found:
    'No encontramos el formulario. Es posible que lo hayan eliminado o que el folio sea incorrecto.',
};

/** Fallback by HTTP status — still a sentence, never a bare number. */
function messageByStatus(status: number): string {
  if (status === 401) {
    return 'Tu sesión expiró. Vuelve a iniciar sesión para continuar.';
  }
  if (status === 403) {
    return 'No tienes permiso para realizar esta acción. Consulta con el administrador de tu empresa.';
  }
  if (status === 404) {
    return 'No encontramos el documento solicitado.';
  }
  if (status >= 500) {
    return 'El servidor tuvo un problema y no pudo completar la acción. ' +
      'Vuelve a intentarlo en unos minutos; si sigue fallando, avisa al administrador.';
  }
  return 'No pudimos completar la acción. Revisa los datos e inténtalo nuevamente.';
}

/**
 * Build the message to show the user for a FAILED regulatory-document
 * response. Reads the server's machine code from the JSON body when present
 * and falls back to the HTTP status. Safe to call on any non-ok `Response`:
 * a missing, empty or non-JSON body degrades to the status-based sentence
 * rather than throwing.
 *
 * Only call this when `res.ok` is false — it consumes the response body.
 */
export async function regulatoryErrorMessage(res: Response): Promise<string> {
  let code = '';
  try {
    const body: unknown = await res.json();
    const raw = (body as { error?: unknown } | null)?.error;
    if (typeof raw === 'string') code = raw;
  } catch {
    // Empty or non-JSON body — fall through to the status-based message.
  }
  return MESSAGE_BY_CODE[code] ?? messageByStatus(res.status);
}
