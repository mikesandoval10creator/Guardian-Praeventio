// Pins the contract that matters to a human in the field: a refused
// regulatory action NEVER surfaces as a bare status code or a raw machine
// code. The builders used to render `Error 403`, which reads as "the app is
// broken" when the app in fact worked exactly as designed.

import { describe, it, expect } from 'vitest';

import { regulatoryErrorMessage } from './regulatoryErrorMessage';

/** Minimal Response stand-in (jsdom-free: we only use status + json()). */
function res(status: number, body?: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => {
      if (body === undefined) throw new Error('no body');
      return body;
    },
  } as unknown as Response;
}

describe('regulatoryErrorMessage', () => {
  it('explains a role refusal and names who CAN do it', async () => {
    const msg = await regulatoryErrorMessage(res(403, { error: 'forbidden_role' }));
    expect(msg).toMatch(/rol autorizado/i);
    // Actionable: tells the user which roles may perform the action.
    expect(msg).toMatch(/prevencionista/i);
  });

  it('maps the other known server codes to sentences', async () => {
    expect(await regulatoryErrorMessage(res(403, { error: 'tenant_mismatch' }))).toMatch(
      /otra empresa/i,
    );
    expect(await regulatoryErrorMessage(res(400, { error: 'invalid_payload' }))).toMatch(
      /datos obligatorios|formato inválido/i,
    );
    expect(await regulatoryErrorMessage(res(404, { error: 'form_not_found' }))).toMatch(
      /no encontramos/i,
    );
  });

  it('falls back to a sentence by status when the code is unknown', async () => {
    const msg = await regulatoryErrorMessage(res(403, { error: 'some_new_code' }));
    expect(msg).toMatch(/no tienes permiso/i);
  });

  it('degrades gracefully when the body is missing or not JSON', async () => {
    expect(await regulatoryErrorMessage(res(500))).toMatch(/servidor/i);
    expect(await regulatoryErrorMessage(res(401))).toMatch(/sesión expiró/i);
  });

  // The whole point of the module: no leaking of machine-facing detail.
  it('NEVER returns a bare status code or a raw machine code', async () => {
    const cases = [
      res(400, { error: 'invalid_payload' }),
      res(401),
      res(403, { error: 'forbidden_role' }),
      res(404, { error: 'form_not_found' }),
      res(500),
      res(418, { error: 'unmapped' }),
    ];
    for (const c of cases) {
      const msg = await regulatoryErrorMessage(c);
      expect(msg).not.toMatch(/\b4\d{2}\b|\b5\d{2}\b/); // no 4xx/5xx digits
      expect(msg).not.toMatch(/forbidden_role|invalid_payload|tenant_mismatch|form_not_found/);
      expect(msg.length).toBeGreaterThan(20); // a sentence, not a token
    }
  });
});
