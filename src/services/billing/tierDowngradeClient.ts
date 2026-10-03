import { z } from "zod";
import { apiAuthHeaderOrThrow } from "../../lib/apiAuth";
import { TIER_IDS, type TierId } from "../pricing/tiers";

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

const candidateSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("project"),
    projectId: z.string().min(1),
    data: z.record(z.string(), z.unknown()),
  }),
  z.object({
    kind: z.literal("worker"),
    projectId: z.string().min(1),
    workerId: z.string().min(1),
    data: z.record(z.string(), z.unknown()),
  }),
]);

const exportSchema = z.object({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  backup: z.object({
    version: z.literal(1),
    generatedAt: z.iso.datetime(),
    sourceTier: z.enum(TIER_IDS),
    targetTier: z.enum(TIER_IDS),
    category: z.enum(["workers", "projects"]),
    count: z.number().int().nonnegative(),
    records: z.array(candidateSchema),
  }),
});

function assertExportResponse(
  value: unknown,
  category: TierDowngradeCategory,
  targetTier: TierId,
): asserts value is ExportResponse {
  const parsed = exportSchema.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.backup.category !== category ||
    parsed.data.backup.targetTier !== targetTier ||
    parsed.data.backup.count !== parsed.data.backup.records.length ||
    parsed.data.backup.records.some(
      (record) =>
        record.kind !== (category === "workers" ? "worker" : "project"),
    )
  ) {
    throw new Error("downgrade_export_invalid");
  }
  // Validate only: download the original backup without stripping record data.
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
  let anchor: HTMLAnchorElement | undefined;
  try {
    anchor = document.createElement("a");
    const timestamp = backup.generatedAt.replace(/[:.]/g, "-");
    anchor.href = url;
    anchor.download = `praeventio-downgrade-${backup.category}-${timestamp}.json`;
    anchor.hidden = true;
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    try {
      anchor?.remove();
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

export async function exportThenArchiveTierDowngrade(
  category: TierDowngradeCategory,
  targetTier: TierId,
): Promise<ArchiveResponse> {
  const exported = await postJson<unknown>("/api/tier-downgrade/export", {
    targetTier,
    category,
  });
  assertExportResponse(exported, category, targetTier);
  startBackupDownload(exported.backup);
  return archiveTierDowngrade(category, targetTier, exported.fingerprint);
}
