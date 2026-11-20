// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { apiAuthHeader } from '../../lib/apiAuth';
import { Ds67Builder } from './Ds67Builder';
import { Ds76Builder } from './Ds76Builder';

vi.mock('../../services/firebase', () => ({ auth: null }));
vi.mock('../../lib/apiAuth', () => ({ apiAuthHeader: vi.fn(async () => null) }));
vi.mock('../../services/compliance/ds67/ds67Service', () => ({ ds67FolioToDocId: vi.fn() }));
vi.mock('../../services/compliance/ds76/ds76Service', () => ({ ds76FolioToDocId: vi.fn() }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it.each([
  { Builder: Ds67Builder, label: 'RUT empresa' },
  { Builder: Ds76Builder, label: 'RUT mandante', other: 'RUT contratista' },
  { Builder: Ds76Builder, label: 'RUT contratista', other: 'RUT mandante' },
])('explica cómo corregir $label antes de generar el PDF', async ({ Builder, label, other }) => {
  render(<Builder tenantId="tenant-test" reportedBy={{ uid: 'test', rut: '11.111.111-1', fullName: 'Test' }} />);
  if (other) fireEvent.change(screen.getByLabelText(other), { target: { value: '11.111.111-1' } });
  const input = screen.getByLabelText(label);
  fireEvent.change(input, { target: { value: '11.111.111-2' } });
  const form = screen.getByRole('button', { name: 'Generar PDF' }).closest('form');
  if (!form) throw new Error('Missing form');
  fireEvent.submit(form);
  expect(await screen.findByRole('alert')).toHaveTextContent(`${label}: verifica el dígito verificador.`);
  expect(input).toHaveValue('11.111.111-2');
  expect(apiAuthHeader).not.toHaveBeenCalled();
});
