// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SafetyCapsules } from './SafetyCapsules';

const auth = vi.hoisted(() => ({ user: { uid: 'worker-1', displayName: 'Trabajador' } }));
vi.mock('../../contexts/UniversalKnowledgeContext', () => {
  const nodes: never[] = [];
  return { useUniversalKnowledge: () => ({ nodes }) };
});
vi.mock('../../contexts/FirebaseContext', () => ({ useFirebase: () => auth }));
vi.mock('../../services/geminiService', () => ({
  generateSafetyCapsule: async () => ({ title: 'Pausa segura', content: 'Revisa el equipo.', keyTip: 'Atención', duration: '1 min' }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback, i18n: { language: 'es-CL' } }),
}));
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: { div: ({ children }: { children: React.ReactNode }) => <div>{children}</div> },
}));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); auth.user = { uid: 'worker-1', displayName: 'Trabajador' }; });

async function renderCapsule() {
  const view = render(<SafetyCapsules />);
  fireEvent.click(screen.getByRole('button', { name: 'Generar cápsula de seguridad' }));
  return { view, listen: await screen.findByRole('button', { name: 'Escuchar Cápsula' }) };
}

it('reads only the visible capsule through a local voice and stops on unmount', async () => {
  const voice = { lang: 'es-CL', localService: true };
  const speak = vi.fn();
  const cancel = vi.fn();
  vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });
  vi.stubGlobal('speechSynthesis', { getVoices: () => [{ lang: 'es-CL', localService: false }, voice], speak, cancel });
  const { view, listen } = await renderCapsule();
  fireEvent.click(listen);
  expect(speak).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ text: 'Pausa segura. Revisa el equipo.', voice }));
  view.unmount();
  expect(cancel).toHaveBeenCalledOnce();
});

it('keeps the capsule readable and explains when a local matching voice is unavailable', async () => {
  const speak = vi.fn();
  vi.stubGlobal('SpeechSynthesisUtterance', class {});
  vi.stubGlobal('speechSynthesis', { getVoices: () => [{ lang: 'es-CL', localService: false }], speak, cancel: vi.fn() });
  const { listen } = await renderCapsule();
  fireEvent.click(listen);
  expect(screen.getByRole('status')).toHaveTextContent('No hay una voz local disponible');
  expect(screen.getByText(/Revisa el equipo/)).toBeVisible();
  expect(speak).not.toHaveBeenCalled();
});

it('stops playback and removes the prior capsule when the worker changes', async () => {
  const cancel = vi.fn();
  vi.stubGlobal('SpeechSynthesisUtterance', class {});
  vi.stubGlobal('speechSynthesis', { getVoices: () => [{ lang: 'es-CL', localService: true }], speak: vi.fn(), cancel });
  const { view, listen } = await renderCapsule();
  fireEvent.click(listen);
  expect(screen.getByRole('button', { name: 'Detener audio' })).toBeVisible();
  auth.user = { uid: 'worker-2', displayName: 'Otro trabajador' };
  view.rerender(<SafetyCapsules />);
  expect(cancel).toHaveBeenCalledOnce();
  expect(screen.queryByText(/Revisa el equipo/)).not.toBeInTheDocument();
});
