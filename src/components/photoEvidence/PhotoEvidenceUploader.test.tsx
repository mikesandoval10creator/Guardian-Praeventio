// @vitest-environment jsdom
//
// Covers the UI that finally calls uploadPhotoEvidenceBytes: role gate,
// offline behavior, validation, notes, geolocation and refetch callback.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { PhotoEvidenceUploader } from './PhotoEvidenceUploader';
import { PhotoEvidenceValidationError } from '../../services/photoEvidence/photoEvidenceEngine';

const h = vi.hoisted(() => ({
  upload: vi.fn(),
  user: { uid: 'u-sup' } as { uid: string } | null,
  role: 'supervisor',
  admin: false,
  online: true,
  onUploaded: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string, opts?: Record<string, unknown>) => {
      if (typeof fallback !== 'string') return _key;
      if (!opts) return fallback;
      return Object.entries(opts).reduce(
        (out, [key, value]) => out.replace(`{{${key}}}`, String(value)),
        fallback,
      );
    },
  }),
}));

vi.mock('../../contexts/FirebaseContext', () => ({
  useFirebase: () => ({
    user: h.user,
    userRole: h.role,
    isAdmin: h.admin,
  }),
}));

vi.mock('../../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => h.online,
}));

vi.mock('../../hooks/usePhotoEvidence', () => ({
  uploadPhotoEvidenceBytes: h.upload,
}));

vi.mock('../../utils/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

function renderUploader() {
  return render(
    <PhotoEvidenceUploader
      projectId="p1"
      nodeKind="incident"
      nodeId="inc-1"
      onUploaded={h.onUploaded}
    />,
  );
}

function pickFile(name = 'incidente.jpg', type = 'image/jpeg', body = 'abc') {
  const input = screen.getByTestId(
    'photoEvidence.uploader.input',
  ) as HTMLInputElement;
  const file = new File([body], name, { type });
  fireEvent.change(input, { target: { files: [file] } });
  return file;
}

beforeEach(() => {
  h.upload.mockReset();
  h.onUploaded.mockReset();
  h.user = { uid: 'u-sup' };
  h.role = 'supervisor';
  h.admin = false;
  h.online = true;
  h.upload.mockResolvedValue({
    artifact: {
      id: 'a'.repeat(64),
      originalFilename: 'incidente.jpg',
      mimeType: 'image/jpeg',
      byteSize: 3,
      capturedAt: new Date().toISOString(),
      capturedByUid: 'u-sup',
      linkages: [{ nodeKind: 'incident', nodeId: 'inc-1' }],
    },
    storagePath: 'projects/p1/evidence/aaa.jpg',
    downloadUrl: 'https://example.test/aaa.jpg',
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PhotoEvidenceUploader', () => {
  it('is hidden from workers (the listing endpoint is supervisor-only)', () => {
    h.role = 'worker';
    renderUploader();
    expect(screen.queryByTestId('photoEvidence.uploader')).toBeNull();
  });

  it('uploads the selected bytes with project membership, node linkage and notes', async () => {
    renderUploader();
    const file = pickFile();
    fireEvent.change(screen.getByLabelText('Nota (opcional)'), {
      target: { value: 'Andamio sector 3' },
    });
    fireEvent.click(screen.getByTestId('photoEvidence.uploader.submit'));

    await waitFor(() => expect(h.upload).toHaveBeenCalledTimes(1));
    expect(h.upload).toHaveBeenCalledWith(
      'p1',
      file,
      expect.objectContaining({
        capturedByUid: 'u-sup',
        notes: 'Andamio sector 3',
        linkages: [{ nodeKind: 'incident', nodeId: 'inc-1' }],
      }),
    );
    await waitFor(() => expect(h.onUploaded).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('photoEvidence.uploader.success')).toHaveTextContent(
      'Evidencia subida y verificada por hash: incidente.jpg',
    );
  });

  it('adds the captured location when the browser grants it', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      geolocation: {
        getCurrentPosition: (success: PositionCallback) =>
          success({
            coords: { latitude: -33.45, longitude: -70.66 },
          } as GeolocationPosition),
      },
    });
    renderUploader();
    pickFile();
    fireEvent.click(screen.getByTestId('photoEvidence.uploader.submit'));

    await waitFor(() => expect(h.upload).toHaveBeenCalledTimes(1));
    expect(h.upload).toHaveBeenCalledWith(
      'p1',
      expect.any(File),
      expect.objectContaining({
        capturedLocation: { lat: -33.45, lng: -70.66 },
      }),
    );
  });

  it('shows an actionable validation error and does not call the uploader', async () => {
    h.upload.mockRejectedValueOnce(
      new PhotoEvidenceValidationError('too_large', 'too big'),
    );
    renderUploader();
    pickFile();
    fireEvent.click(screen.getByTestId('photoEvidence.uploader.submit'));

    await waitFor(() =>
      expect(screen.getByTestId('photoEvidence.uploader.error')).toHaveTextContent(
        'El archivo es demasiado grande',
      ),
    );
    expect(h.onUploaded).not.toHaveBeenCalled();
  });

  it('rejects an empty file before spending an upload', () => {
    renderUploader();
    pickFile('vacio.jpg', 'image/jpeg', '');
    expect(screen.getByTestId('photoEvidence.uploader.error')).toHaveTextContent(
      'El archivo está vacío',
    );
    expect(h.upload).not.toHaveBeenCalled();
  });

  it('disables the picker and explains why when offline', () => {
    h.online = false;
    renderUploader();
    expect(screen.getByTestId('photoEvidence.uploader.offline')).toBeInTheDocument();
    expect(
      (screen.getByTestId('photoEvidence.uploader.input') as HTMLInputElement)
        .disabled,
    ).toBe(true);
  });
});
