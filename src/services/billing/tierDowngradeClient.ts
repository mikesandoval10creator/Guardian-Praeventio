import { apiAuthHeaderOrThrow } from "../../lib/apiAuth";
import type { TierId } from "../pricing/tiers";

export type TierDowngradeCategory = "workers" | "projects";

export interface TierDowngradePreview {
  sourceTier: TierId;
  targetTier: TierId;
  overages: {
    projects: {
      count: number;
      current: number;
      cap: number;
      candidateIds: string[];
    };
    workers: {
      count: number;
      capPerProject: number;
      projects: Array<{
        projectId: string;
        current: number;
        cap: number;
        count: number;
        candidateIds: string[];
      }>;
    };
  };
}

export interface TierDowngradeBackup {
  version: 1;
  generatedAt: string;
  sourceTier: TierId;
  targetTier: TierId;
  category: TierDowngradeCategory;
  count: number;
  records: unknown[];
}

interface ExportResponse {
  backup: TierDowngradeBackup;
  fingerprint: string;
}

export interface ArchiveResponse {
  success: true;
  archivedCount: number;
}

async function postJson<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const authHeader = await apiAuthHeaderOrThrow();
  const response = await fetch(path, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    const code =
      typeof payload.error === "string"
        ? payload.error
        : `request_failed_${response.status}`;
    throw new Error(code);
  }
  return payload as T;
}

export function loadTierDowngradePreview(
  targetTier: TierId,
): Promise<TierDowngradePreview> {
  return postJson<TierDowngradePreview>("/api/tier-downgrade/preview", {
    targetTier,
  });
}

export function archiveTierDowngrade(
  category: TierDowngradeCategory,
  targetTier: TierId,
  expectedFingerprint?: string,
): Promise<ArchiveResponse> {
  return postJson<ArchiveResponse>("/api/tier-downgrade/archive", {
    targetTier,
    category,
    ...(expectedFingerprint ? { expectedFingerprint } : {}),
  });
}

function startBackupDownload(backup: TierDowngradeBackup): void {
  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const timestamp = backup.generatedAt.replace(/[:.]/g, "-");
  anchor.href = url;
  anchor.download = `praeventio-downgrade-${backup.category}-${timestamp}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function exportThenArchiveTierDowngrade(
  category: TierDowngradeCategory,
  targetTier: TierId,
): Promise<ArchiveResponse> {
  const exported = await postJson<ExportResponse>(
    "/api/tier-downgrade/export",
    {
      targetTier,
      category,
    },
  );
  startBackupDownload(exported.backup);
  return archiveTierDowngrade(category, targetTier, exported.fingerprint);
}
