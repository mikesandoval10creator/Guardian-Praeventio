// The contract that protects the person using the app: nothing machine-facing
// ever reaches the screen, AND the good messages the app already writes are
// never clobbered. That second half is what makes it safe to apply
// `humanErrorMessage` blanket-wide across existing catch blocks.

import { describe, it, expect } from 'vitest';

import {
  humanErrorFromResponse,
  humanErrorMessage,
  isMachineText,
} from './humanError';

/** Minimal Response stand-in: only `status` + `json()` are used. */
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

/** Anything a user could ever be shown must look like a sentence. */
function expectHuman(msg: string) {
  expect(msg).not.toMatch(/\b\d{3}\b/); // no bare status number
  expect(msg.length).toBeGreaterThan(20);
  expect(msg).toMatch(/\s/); // more than one word
  expect(isMachineText(msg)).toBe(false);
}

describe('isMachineText', () => {
  it('flags bare statuses and code tokens', () => {
    for (const s of [
      'Error 403', 'HTTP 500', 'http_403', 'error_404', '403',
      'forbidden_role', 'permission-denied', 'auth/user-not-found', '', '   ',
    ]) {
      expect(isMachineText(s)).toBe(true);
    }
  });

  it('does NOT flag a real sentence (so good copy survives)', () => {
    for (const s of [
      'No estás autenticado.',
      'Geolocalización no disponible en este dispositivo.',
      'Ningún DEA tiene ubicación registrada todavía.',
      'No se pudo crear el claim.',
    ]) {
      expect(isMachineText(s)).toBe(false);
    }
  });
});

describe('humanErrorFromResponse', () => {
  it('translates the server machine code', async () => {
    const msg = await humanErrorFromResponse(res(403, { error: 'forbidden_role' }));
    expect(msg).toMatch(/rol autorizado/i);
    expect(msg).toMatch(/prevencionista/i); // says who CAN do it
    expectHuman(msg);
  });

  it('falls back to the status when the code is unknown', async () => {
    expectHuman(await humanErrorFromResponse(res(403, { error: 'brand_new_code' })));
    expectHuman(await humanErrorFromResponse(res(500)));
    expectHuman(await humanErrorFromResponse(res(404)));
  });

  it('keeps a server `message` that is already a sentence', async () => {
    const msg = await humanErrorFromResponse(
      res(400, { message: 'El RUT ingresado no es válido.' }),
    );
    expect(msg).toBe('El RUT ingresado no es válido.');
  });

  it('never leaks a status number or a machine code', async () => {
    const cases = [
      res(400, { error: 'invalid_payload' }),
      res(401),
      res(403, { error: 'forbidden_role' }),
      res(404, { error: 'form_not_found' }),
      res(409),
      res(429),
      res(500),
      res(418, { error: 'unmapped_code' }),
    ];
    for (const c of cases) {
      const msg = await humanErrorFromResponse(c);
      expect(msg).not.toMatch(/\b\d{3}\b/);
      expect(msg).not.toMatch(/invalid_payload|forbidden_role|form_not_found|unmapped_code/);
      expect(msg.length).toBeGreaterThan(20);
    }
  });
});

describe('humanErrorMessage', () => {
  it('passes a direct human string through unchanged', () => {
    const message = 'Geolocalización no disponible en este dispositivo.';
    expect(humanErrorMessage(message)).toBe(message);
  });

  it('translates a Firebase code', () => {
    const msg = humanErrorMessage({ code: 'permission-denied', message: 'whatever' });
    expect(msg).toMatch(/no tienes permiso/i);
    expectHuman(msg);
  });

  it('translates the SDK English permission text that used to reach users', () => {
    const msg = humanErrorMessage(new Error('Missing or insufficient permissions.'));
    expect(msg).toMatch(/no tienes permiso/i);
    expect(msg).not.toMatch(/permissions/i); // the English is gone
  });

  it('turns offline SDK text into the honest offline explanation', () => {
    const msg = humanErrorMessage(
      new Error('Failed to get document because the client is offline'),
    );
    expect(msg).toMatch(/conexión|sincronizan/i);
    expect(msg).not.toMatch(/offline|document/i);
  });

  // THE property that makes an app-wide sweep safe.
  it('passes an already-human message through UNCHANGED', () => {
    for (const s of [
      'No estás autenticado.',
      'Geolocalización no disponible en este dispositivo.',
      'Ningún DEA tiene ubicación registrada todavía.',
    ]) {
      expect(humanErrorMessage(new Error(s))).toBe(s);
    }
  });

  it('replaces a machine token that arrived as the message', () => {
    expect(humanErrorMessage(new Error('forbidden_role'))).toMatch(/rol autorizado/i);
    expect(humanErrorMessage(new Error('http_500'))).toBe(
      'No pudimos completar la acción. Revisa los datos e inténtalo nuevamente.',
    );
  });

  it('handles a missing/!Error value without throwing', () => {
    expectHuman(humanErrorMessage(undefined));
    expectHuman(humanErrorMessage(null));
    expectHuman(humanErrorMessage({}));
    expectHuman(humanErrorMessage('plain string'));
  });
});
