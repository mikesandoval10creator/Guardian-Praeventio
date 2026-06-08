import { describe, it, expect } from 'vitest';
import { deriveDriveSaveStatus } from './driveSaveStatus';

describe('deriveDriveSaveStatus — "Guardado en Drive" is never a false success', () => {
  it("returns 'saved' ONLY when the upload produced a real non-empty download URL", () => {
    expect(
      deriveDriveSaveStatus({ downloadUrl: 'https://storage.example/suseso/diat_123.pdf' }),
    ).toBe('saved');
  });

  it("returns 'error' when the upload threw (never claims success on failure)", () => {
    // Even if a URL field is somehow present, a thrown error wins → no false green.
    expect(deriveDriveSaveStatus({ error: new Error('permission-denied') })).toBe('error');
    expect(
      deriveDriveSaveStatus({
        downloadUrl: 'https://storage.example/x.pdf',
        error: new Error('addDoc failed'),
      }),
    ).toBe('error');
  });

  it("returns 'error' when no URL came back (the save did not truly complete)", () => {
    for (const url of [undefined, null, '', '   ']) {
      expect(deriveDriveSaveStatus({ downloadUrl: url })).toBe('error');
    }
  });

  it('REGRESSION: the old false-success path (no real result) never maps to saved', () => {
    // The bug: the button showed green by reaching a line, not from the result.
    expect(deriveDriveSaveStatus({})).not.toBe('saved');
    expect(deriveDriveSaveStatus({ downloadUrl: null, error: undefined })).not.toBe('saved');
  });
});
