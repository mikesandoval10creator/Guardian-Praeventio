// @vitest-environment jsdom
import React, { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import express from 'express';
import request from 'supertest';

const runtime = vi.hoisted(() => ({ uid: 'patient-1' }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: unknown) => typeof fallback === 'string' ? fallback : ((fallback as { defaultValue?: string } | undefined)?.defaultValue ?? key) }),
}));
vi.mock('../../contexts/FirebaseContext', () => ({ useFirebase: () => ({ user: { uid: runtime.uid }, db: {} }) }));
vi.mock('../../lib/apiAuth', () => ({ apiAuthHeader: vi.fn(async () => 'Bearer test-health-vault') }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path }),
  query: (ref: unknown, ...constraints: unknown[]) => ({ ref, constraints }),
  orderBy: (...args: unknown[]) => args,
  onSnapshot: (_query: unknown, next: (snapshot: { docs: unknown[] }) => void) => {
    next({ docs: [] });
    return vi.fn();
  },
}));
vi.mock('../middleware/verifyAuth.js', () => ({
  verifyAuth: (req: import('express').Request, _res: import('express').Response, next: import('express').NextFunction) => {
    req.user = { uid: runtime.uid } as import('express').Request['user'];
    next();
  },
}));
vi.mock('../middleware/auditLog.js', () => ({ auditServerEvent: vi.fn(async () => true) }));

import { HealthVaultShare } from '../../pages/HealthVaultShare';
import { createHealthVaultProfessionalRouter } from './healthVaultProfessional';
import { getEmulatorAdminFirestore } from '../../test/firestore-emulator-setup';

const healthRecord = {
  id: 'record-1', workerUid: 'patient-1', type: 'lab_result', uploadedAt: Date.now(),
  uploadedBy: 'self', meta: { title: 'Hemograma' }, tags: [], shareScope: 'private',
};
const professional = {
  uid: 'doctor-1', displayName: 'Dra. Elena Morales', registryNumber: 'RNPI-12345', status: 'verified', webauthnRequired: true,
};

function fetchResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function app() {
  const server = express();
  server.use(express.json());
  server.use('/api/health-vault', createHealthVaultProfessionalRouter());
  return server;
}

beforeEach(async () => {
  runtime.uid = 'patient-1';
  window.sessionStorage.clear();
  const db = getEmulatorAdminFirestore();
  await db.collection('users').doc('patient-1').collection('health_vault').doc('record-1').set(healthRecord);
  await db.collection('health_professional_identities').doc('doctor-1').set(professional);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('HealthVaultShare → share route → Firestore emulator', () => {
  it('recovers a committed consent after the browser loses the response, including across page remount', async () => {
    const server = app();
    const idempotencyKeys: string[] = [];
    const serverResponses: Array<{ status: number; body: Record<string, unknown> }> = [];
    let postCount = 0;
    const fetchStub = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/health-vault/records') return fetchResponse(200, { records: [healthRecord] });
      if (url === '/api/health-professionals/search?limit=50') return fetchResponse(200, { professionals: [professional] });
      if (url === '/api/health-vault/share' && init?.method === 'POST') {
        const headers = init.headers as Record<string, string>;
        const key = headers['Idempotency-Key'];
        idempotencyKeys.push(key);
        const response = await request(server)
          .post('/api/health-vault/share')
          .set('x-test-uid', runtime.uid)
          .set('Idempotency-Key', key)
          .send(JSON.parse(String(init.body)));
        serverResponses.push({ status: response.status, body: response.body });
        postCount += 1;
        if (postCount === 1) throw new TypeError('simulated response loss after server commit');
        return fetchResponse(response.status, response.body);
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchStub);

    const firstPage = render(createElement(HealthVaultShare));
    await screen.findByRole('checkbox', { name: 'Hemograma' });
    fireEvent.change(screen.getByLabelText('Profesional destinatario'), { target: { value: 'doctor-1' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Hemograma' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generar QR' }));
    await waitFor(() => expect(postCount).toBe(1));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Generar QR' }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByRole('button', { name: 'Generar otro' })).toBeNull();
    firstPage.unmount();

    render(createElement(HealthVaultShare));
    await screen.findByRole('checkbox', { name: 'Hemograma' });
    fireEvent.change(screen.getByLabelText('Profesional destinatario'), { target: { value: 'doctor-1' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Hemograma' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generar QR' }));
    await screen.findByRole('button', { name: 'Generar otro' });

    expect(idempotencyKeys).toHaveLength(2);
    expect(idempotencyKeys[1]).toBe(idempotencyKeys[0]);
    expect(serverResponses[0]?.status).toBe(201);
    expect(serverResponses[1]?.status).toBe(201);
    expect(serverResponses[1]?.body).toEqual(serverResponses[0]?.body);
    expect(idempotencyKeys[0]).not.toBe(serverResponses[0]?.body.secret);

    const db = getEmulatorAdminFirestore();
    const grants = await db.collection('users').doc('patient-1').collection('health_vault_shares').get();
    const creationAudits = await db.collection('audit_logs').where('action', '==', 'health_vault.grant.created').get();
    expect(grants.size).toBe(1);
    expect(creationAudits.size).toBe(1);
  });
});
