// SPDX-License-Identifier: MIT
//
// SUSESO DIAT/DIEP reports can be saved to cloud storage ("Guardar en Drive").
// The UI used to flash a green "Guardado en Drive" status positionally — by
// reaching a line after the awaits — rather than from the REAL upload result,
// and surfaced failures only to the logger (invisible to the user). On an
// official injury report a FALSE "saved" status makes the employer believe a
// compliance document is archived when it is not. This helper makes the status
// honest: 'saved' is returned ONLY when the upload genuinely produced a real,
// non-empty download URL; any error or missing URL is reported as 'error'.
// (Directive: hacer REAL, no fabricar el estado de éxito.)

export type DriveSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/** Outcome of attempting to upload + persist the report. Decoupled from the
 *  Firebase SDK so it can be unit-tested without mocking storage/firestore. */
export interface DriveSaveOutcome {
  /** The download URL returned by storage AFTER a fully successful upload +
   *  metadata persist. Undefined/blank when any step did not complete. */
  downloadUrl?: string | null;
  /** Set when any step (canvas, upload, getDownloadURL, metadata write) threw. */
  error?: unknown;
}

/**
 * Derive the honest, user-visible status from a real upload outcome.
 * Contract:
 *   - error present                -> 'error' (never claim success on failure)
 *   - no error but URL absent/blank -> 'error' (the save did not truly complete)
 *   - error absent AND real URL     -> 'saved'
 * It will NEVER return 'saved' for a thrown error or an empty/whitespace URL.
 */
export function deriveDriveSaveStatus(outcome: DriveSaveOutcome): DriveSaveStatus {
  if (outcome.error !== undefined && outcome.error !== null) return 'error';
  const url = outcome.downloadUrl?.trim();
  return url ? 'saved' : 'error';
}
