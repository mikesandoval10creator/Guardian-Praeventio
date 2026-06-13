// SPDX-License-Identifier: MIT
// Phase 5 — csv-crews-fix — Server-routed CSV import for the organic
// structure (Crew / Process).
//
// WHY THIS EXISTS
// ---------------
// `CsvAdapter.importToFirestore` writes with `addDoc(projects/{pid}/crews|
// processes)`. That subcollection path is **read-only** for clients
// (firestore.rules "Master Gate for sub-collections" allows `read`, never
// `create`), so every row failed silently and the dashboard — which reads the
// TOP-LEVEL `crews`/`processes` collections written exclusively by the server
// (POST /api/crews, POST /api/processes) — never saw the data.
//
// This module re-cables the crews/processes import to those existing server
// endpoints, which are the canonical single-writer for the positive-only XP
// economy. Errors are surfaced PER ROW (no silent swallow) so the user gets an
// honest ok/failed summary.
//
// Mapping is driven by the parsed, schema-validated rows produced by the
// `crewSchema` / `processSchema` (see `schemas.ts`). We only forward the
// fields the endpoints accept; server-computed fields (xp, createdBy,
// complianceScore default, …) are intentionally NOT sent.

import { apiAuthHeader } from '../../lib/apiAuth';
import type { Crew, Process } from '../../types/organic';

/** Per-row failure with the 1-based CSV row number for the UI. */
export interface ApiRowError {
  /** 1-based row number relative to the parsed `success` array (+offset). */
  row: number;
  reason: string;
}

export interface ApiImportResult {
  written: number;
  failed: number;
  rowErrors: ApiRowError[];
}

/**
 * Injectable fetch — defaults to global `fetch`. Tests pass a stub so the
 * mapping + per-row error handling can be exercised without a network or a
 * running server (CLAUDE.md: behavioral tests over real code, no mirrors).
 */
export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;

interface SyncOpts {
  projectId: string;
  /** Defaults to the global `fetch`. */
  fetchImpl?: FetchLike;
  /**
   * Pre-resolved Authorization header. Defaults to `apiAuthHeader()`. If
   * `null`/absent, the import aborts with every row marked failed — we never
   * fire unauthenticated writes.
   */
  authHeader?: string | null;
}

function resolveFetch(opts: SyncOpts): FetchLike {
  if (opts.fetchImpl) return opts.fetchImpl;
  // Bind to preserve the global `this` and keep the shape narrow.
  return ((input, init) =>
    fetch(input, init as RequestInit)) as unknown as FetchLike;
}

/**
 * Build the `POST /api/crews` body from a parsed crew row. Returns a string
 * error if the row cannot be mapped (so the caller records it instead of
 * firing a request that the server would 400).
 */
export function mapCrewRowToPayload(
  row: Partial<Crew>,
  projectId: string,
): { ok: true; payload: { projectId: string; name: string; memberUids: string[] } } | { ok: false; reason: string } {
  const name = typeof row.name === 'string' ? row.name.trim() : '';
  if (!name) return { ok: false, reason: 'columna "name" requerida' };
  const memberUids = Array.isArray(row.memberUids)
    ? row.memberUids.filter((u): u is string => typeof u === 'string' && u.length > 0)
    : [];
  return { ok: true, payload: { projectId, name, memberUids } };
}

/**
 * Build the `POST /api/processes` body from a parsed process row. The
 * endpoint requires `crewId` (a process cannot exist without an owning crew),
 * so a blank `crewId` is reported rather than silently dropped.
 */
export function mapProcessRowToPayload(
  row: Partial<Process>,
  projectId: string,
):
  | {
      ok: true;
      payload: {
        projectId: string;
        crewId: string;
        type: string;
        name: string;
        description: string;
        plannedEndDate: string | null;
      };
    }
  | { ok: false; reason: string } {
  const name = typeof row.name === 'string' ? row.name.trim() : '';
  if (!name) return { ok: false, reason: 'columna "name" requerida' };
  const crewId = typeof row.crewId === 'string' ? row.crewId.trim() : '';
  if (!crewId) return { ok: false, reason: 'columna "crewId" requerida' };
  const type = typeof row.type === 'string' ? row.type : 'otro';
  return {
    ok: true,
    payload: {
      projectId,
      crewId,
      type,
      name,
      description: typeof row.description === 'string' ? row.description : '',
      plannedEndDate:
        typeof row.plannedEndDate === 'string' && row.plannedEndDate.length > 0
          ? row.plannedEndDate
          : null,
    },
  };
}

async function postRows<T>(
  rows: T[],
  endpoint: string,
  mapper: (row: T, projectId: string) =>
    | { ok: true; payload: unknown }
    | { ok: false; reason: string },
  opts: SyncOpts,
): Promise<ApiImportResult> {
  const result: ApiImportResult = { written: 0, failed: 0, rowErrors: [] };

  const authHeader =
    opts.authHeader !== undefined ? opts.authHeader : await apiAuthHeader();
  if (!authHeader) {
    // No session — fail every row visibly rather than firing 401s.
    rows.forEach((_, i) => {
      result.failed++;
      result.rowErrors.push({
        row: i + 1,
        reason: 'sesión no disponible',
      });
    });
    return result;
  }

  const doFetch = resolveFetch(opts);

  for (let i = 0; i < rows.length; i++) {
    const mapped = mapper(rows[i], opts.projectId);
    if (!mapped.ok) {
      result.failed++;
      result.rowErrors.push({ row: i + 1, reason: mapped.reason });
      continue;
    }
    try {
      const res = await doFetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader,
        },
        body: JSON.stringify(mapped.payload),
      });
      if (res.ok) {
        result.written++;
      } else {
        const body = await res.json().catch(() => ({}));
        result.failed++;
        result.rowErrors.push({
          row: i + 1,
          reason: body?.error ?? `HTTP ${res.status}`,
        });
      }
    } catch (err) {
      result.failed++;
      result.rowErrors.push({
        row: i + 1,
        reason: (err as Error)?.message ?? 'error de red',
      });
    }
  }

  return result;
}

/** Import parsed crew rows via `POST /api/crews`, one request per row. */
export function importCrewsViaApi(
  rows: Array<Partial<Crew>>,
  opts: SyncOpts,
): Promise<ApiImportResult> {
  return postRows(rows, '/api/crews', mapCrewRowToPayload, opts);
}

/** Import parsed process rows via `POST /api/processes`, one request per row. */
export function importProcessesViaApi(
  rows: Array<Partial<Process>>,
  opts: SyncOpts,
): Promise<ApiImportResult> {
  return postRows(rows, '/api/processes', mapProcessRowToPayload, opts);
}
