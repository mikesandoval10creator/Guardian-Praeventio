// SPDX-License-Identifier: MIT
// Sprint 24 — Bucket JJ — Pre-built CSV schemas for the 6 entity types
// the universal CsvAdapter handles. Schemas are intentionally small and
// permissive: SAP/Excel exports from the field rarely match our internal
// field names byte-for-byte, so each column lists Spanish + English
// aliases, and `transform` fills sensible defaults (status='active',
// createdAt=now) that keep the rows valid against the typed entity.
//
// IMPORTANT: keep these in sync with `src/types/index.ts` and
// `src/types/organic.ts`. When you add a new field to an entity, decide
// whether it is bulk-import-relevant (i.e. comes from the client's
// system) — most operational/derived fields (xpAwardedAtClose, nodeId)
// stay out of the schema because they're computed downstream.

import type { Worker, TrainingSession } from '../../types';
import type { Crew, Process } from '../../types/organic';
import { CsvAdapter, type CsvSchema } from './csvAdapter';

// ---------------------------------------------------------------------------
// Workers
// ---------------------------------------------------------------------------

export const workerSchema: CsvSchema<Worker> = {
  entityType: 'workers',
  columns: [
    { name: 'name', type: 'string', required: true, mapTo: 'name', aliases: ['nombre'] },
    { name: 'role', type: 'string', required: true, mapTo: 'role', aliases: ['cargo', 'puesto'] },
    { name: 'email', type: 'string', required: true, mapTo: 'email', aliases: ['correo'] },
    { name: 'phone', type: 'string', required: false, mapTo: 'phone', aliases: ['telefono', 'teléfono', 'celular'] },
    { name: 'status', type: 'string', required: false, mapTo: 'status', aliases: ['estado'] },
  ],
  validate: (row) => {
    const errs: string[] = [];
    if (row.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.email)) {
      errs.push(`email inválido: ${row.email}`);
    }
    if (row.status && row.status !== 'active' && row.status !== 'inactive') {
      errs.push(`status inválido: ${row.status} (active|inactive)`);
    }
    return errs;
  },
  transform: (raw): Worker => ({
    id: raw.id ?? '',
    name: String(raw.name ?? ''),
    role: String(raw.role ?? ''),
    email: String(raw.email ?? ''),
    phone: raw.phone ? String(raw.phone) : undefined,
    status: (raw.status as 'active' | 'inactive') ?? 'active',
    joinedAt: raw.joinedAt ?? new Date().toISOString(),
    projectId: raw.projectId ?? undefined,
  }),
};

// ---------------------------------------------------------------------------
// Findings — Findings are stored as RiskNode (NodeType.FINDING) in the
// Universal Knowledge graph, but for ETL purposes we expose a flat
// projection that maps to the metadata fields the UI relies on.
// ---------------------------------------------------------------------------

export interface FindingCsvRow {
  title: string;
  description: string;
  severity: 'Crítica' | 'Alta' | 'Media' | 'Baja';
  status: 'Abierto' | 'Cerrado';
  category: string;
  location: string;
  createdAt: string;
}

export const findingSchema: CsvSchema<FindingCsvRow> = {
  entityType: 'findings',
  columns: [
    { name: 'title', type: 'string', required: true, mapTo: 'title', aliases: ['titulo', 'título', 'hallazgo'] },
    { name: 'description', type: 'string', required: true, mapTo: 'description', aliases: ['descripcion', 'descripción'] },
    { name: 'severity', type: 'string', required: true, mapTo: 'severity', aliases: ['severidad', 'criticidad'] },
    { name: 'status', type: 'string', required: false, mapTo: 'status', aliases: ['estado'] },
    { name: 'category', type: 'string', required: false, mapTo: 'category', aliases: ['categoria', 'categoría'] },
    { name: 'location', type: 'string', required: false, mapTo: 'location', aliases: ['ubicacion', 'ubicación', 'lugar'] },
    { name: 'createdAt', type: 'date', required: false, mapTo: 'createdAt', aliases: ['fecha'] },
  ],
  validate: (row) => {
    const errs: string[] = [];
    const validSeverity = ['Crítica', 'Alta', 'Media', 'Baja'];
    if (!validSeverity.includes(row.severity)) {
      errs.push(`severidad inválida: ${row.severity} (${validSeverity.join('|')})`);
    }
    if (row.status && !['Abierto', 'Cerrado'].includes(row.status)) {
      errs.push(`status inválido: ${row.status}`);
    }
    return errs;
  },
  transform: (raw): FindingCsvRow => ({
    title: String(raw.title ?? ''),
    description: String(raw.description ?? ''),
    severity: (raw.severity as FindingCsvRow['severity']) ?? 'Media',
    status: (raw.status as FindingCsvRow['status']) ?? 'Abierto',
    category: String(raw.category ?? 'general'),
    location: String(raw.location ?? ''),
    createdAt: raw.createdAt ?? new Date().toISOString(),
  }),
};

// ---------------------------------------------------------------------------
// Processes (Sprint 15 organic structure)
// ---------------------------------------------------------------------------

export const processSchema: CsvSchema<Process> = {
  entityType: 'processes',
  columns: [
    { name: 'name', type: 'string', required: true, mapTo: 'name', aliases: ['nombre', 'proceso'] },
    { name: 'description', type: 'string', required: false, mapTo: 'description', aliases: ['descripcion', 'descripción'] },
    { name: 'type', type: 'string', required: true, mapTo: 'type', aliases: ['tipo'] },
    { name: 'crewId', type: 'string', required: true, mapTo: 'crewId', aliases: ['cuadrilla', 'crew_id'] },
    { name: 'status', type: 'string', required: false, mapTo: 'status', aliases: ['estado'] },
    { name: 'plannedEndDate', type: 'date', required: false, mapTo: 'plannedEndDate', aliases: ['fecha_termino', 'fechaTermino'] },
    { name: 'complianceScore', type: 'number', required: false, mapTo: 'complianceScore', aliases: ['cumplimiento'] },
  ],
  validate: (row) => {
    const errs: string[] = [];
    const validTypes = [
      'concreto',
      'fachada',
      'movimiento_tierras',
      'soldadura',
      'mantenimiento',
      'demolicion',
      'instalacion_electrica',
      'pintura',
      'topografia',
      'transporte',
      'otro',
    ];
    if (!validTypes.includes(row.type)) {
      errs.push(`tipo inválido: ${row.type}`);
    }
    const validStatus = ['planning', 'active', 'paused', 'completed', 'aborted'];
    if (row.status && !validStatus.includes(row.status)) {
      errs.push(`status inválido: ${row.status}`);
    }
    if (row.complianceScore !== undefined && (row.complianceScore < 0 || row.complianceScore > 100)) {
      errs.push(`complianceScore fuera de rango 0-100: ${row.complianceScore}`);
    }
    return errs;
  },
  transform: (raw): Process => ({
    id: raw.id ?? '',
    crewId: String(raw.crewId ?? ''),
    projectId: raw.projectId ?? '',
    type: raw.type ?? 'otro',
    name: String(raw.name ?? ''),
    description: String(raw.description ?? ''),
    startedAt: raw.startedAt ?? null,
    endedAt: raw.endedAt ?? null,
    plannedEndDate: raw.plannedEndDate ?? null,
    status: raw.status ?? 'planning',
    complianceScore: typeof raw.complianceScore === 'number' ? raw.complianceScore : 100,
    incidentsDuringProcess: 0,
    alertsResponded: 0,
    xpAwardedAtClose: null,
  }),
};

// ---------------------------------------------------------------------------
// Training sessions
// ---------------------------------------------------------------------------

export const trainingSchema: CsvSchema<TrainingSession> = {
  entityType: 'training',
  columns: [
    { name: 'title', type: 'string', required: true, mapTo: 'title', aliases: ['titulo', 'título', 'capacitacion', 'capacitación'] },
    { name: 'description', type: 'string', required: false, mapTo: 'description', aliases: ['descripcion', 'descripción'] },
    { name: 'date', type: 'date', required: true, mapTo: 'date', aliases: ['fecha'] },
    { name: 'duration', type: 'number', required: true, mapTo: 'duration', aliases: ['duracion', 'duración', 'minutos'] },
    { name: 'status', type: 'string', required: false, mapTo: 'status', aliases: ['estado'] },
    { name: 'youtubeUrl', type: 'string', required: false, mapTo: 'youtubeUrl', aliases: ['youtube', 'video', 'url'] },
    { name: 'points', type: 'number', required: false, mapTo: 'points', aliases: ['puntos', 'xp'] },
  ],
  validate: (row) => {
    const errs: string[] = [];
    if (row.status && row.status !== 'scheduled' && row.status !== 'completed') {
      errs.push(`status inválido: ${row.status} (scheduled|completed)`);
    }
    if (row.duration !== undefined && row.duration <= 0) {
      errs.push(`duration debe ser > 0`);
    }
    return errs;
  },
  transform: (raw): TrainingSession => ({
    id: raw.id ?? '',
    title: String(raw.title ?? ''),
    description: raw.description ? String(raw.description) : undefined,
    date: String(raw.date ?? ''),
    duration: Number(raw.duration ?? 0),
    status: (raw.status as 'scheduled' | 'completed') ?? 'scheduled',
    attendees: [],
    youtubeUrl: raw.youtubeUrl ? String(raw.youtubeUrl) : undefined,
    points: typeof raw.points === 'number' ? raw.points : undefined,
  }),
};

// ---------------------------------------------------------------------------
// Crews
// ---------------------------------------------------------------------------

export const crewSchema: CsvSchema<Crew> = {
  entityType: 'crews',
  columns: [
    { name: 'name', type: 'string', required: true, mapTo: 'name', aliases: ['nombre', 'cuadrilla'] },
    { name: 'memberUids', type: 'string', required: false, mapTo: 'memberUids', aliases: ['miembros', 'members'] },
    { name: 'xp', type: 'number', required: false, mapTo: 'xp' },
    { name: 'totalProcessesCompleted', type: 'number', required: false, mapTo: 'totalProcessesCompleted', aliases: ['procesos_completados'] },
    { name: 'daysWithoutIncident', type: 'number', required: false, mapTo: 'daysWithoutIncident', aliases: ['dias_sin_incidente'] },
  ],
  validate: (row) => {
    const errs: string[] = [];
    if (row.xp !== undefined && row.xp < 0) errs.push('xp no puede ser negativo');
    return errs;
  },
  transform: (raw): Crew => ({
    id: raw.id ?? '',
    projectId: raw.projectId ?? '',
    name: String(raw.name ?? ''),
    // memberUids arrives as a pipe- or semicolon-separated string in CSV.
    memberUids:
      typeof raw.memberUids === 'string'
        ? raw.memberUids
            .split(/[|;]/)
            .map((s: string) => s.trim())
            .filter((s: string) => s.length > 0)
        : [],
    createdAt: raw.createdAt ?? new Date().toISOString(),
    totalProcessesCompleted: typeof raw.totalProcessesCompleted === 'number' ? raw.totalProcessesCompleted : 0,
    daysWithoutIncident: typeof raw.daysWithoutIncident === 'number' ? raw.daysWithoutIncident : 0,
    xp: typeof raw.xp === 'number' ? raw.xp : 0,
    lastIncidentAt: raw.lastIncidentAt ?? null,
  }),
};

// ---------------------------------------------------------------------------
// Inspections — flat projection. We don't (yet) have a typed Inspection
// in `src/types`, so we declare one here and let the consumer cast.
// ---------------------------------------------------------------------------

export interface InspectionCsvRow {
  title: string;
  inspector: string;
  date: string;
  area: string;
  result: 'Conforme' | 'No Conforme' | 'Observación';
  observations: string;
}

export const inspectionSchema: CsvSchema<InspectionCsvRow> = {
  entityType: 'inspections',
  columns: [
    { name: 'title', type: 'string', required: true, mapTo: 'title', aliases: ['titulo', 'título', 'inspeccion', 'inspección'] },
    { name: 'inspector', type: 'string', required: true, mapTo: 'inspector', aliases: ['responsable', 'auditor'] },
    { name: 'date', type: 'date', required: true, mapTo: 'date', aliases: ['fecha'] },
    { name: 'area', type: 'string', required: false, mapTo: 'area', aliases: ['zona', 'sector'] },
    { name: 'result', type: 'string', required: true, mapTo: 'result', aliases: ['resultado'] },
    { name: 'observations', type: 'string', required: false, mapTo: 'observations', aliases: ['observaciones', 'comentarios'] },
  ],
  validate: (row) => {
    const errs: string[] = [];
    const valid = ['Conforme', 'No Conforme', 'Observación'];
    if (!valid.includes(row.result)) {
      errs.push(`resultado inválido: ${row.result} (${valid.join('|')})`);
    }
    return errs;
  },
  transform: (raw): InspectionCsvRow => ({
    title: String(raw.title ?? ''),
    inspector: String(raw.inspector ?? ''),
    date: String(raw.date ?? ''),
    area: String(raw.area ?? ''),
    result: (raw.result as InspectionCsvRow['result']) ?? 'Observación',
    observations: String(raw.observations ?? ''),
  }),
};

// ---------------------------------------------------------------------------
// Lookup helper
// ---------------------------------------------------------------------------

const SCHEMAS: Record<string, CsvSchema<any>> = {
  workers: workerSchema,
  findings: findingSchema,
  processes: processSchema,
  training: trainingSchema,
  crews: crewSchema,
  inspections: inspectionSchema,
};

/**
 * Returns a ready-to-use adapter for the given entity type. The
 * universal modal calls this so callers only need to pass an
 * `entityType` string.
 */
export function getAdapter(
  entityType: 'workers' | 'findings' | 'processes' | 'training' | 'crews' | 'inspections',
): CsvAdapter<any> {
  const schema = SCHEMAS[entityType];
  if (!schema) {
    throw new Error(`[etl] schema not registered for entityType=${entityType}`);
  }
  return new CsvAdapter(schema);
}

export const ALL_ETL_ENTITY_TYPES: Array<
  'workers' | 'findings' | 'processes' | 'training' | 'crews' | 'inspections'
> = ['workers', 'findings', 'processes', 'training', 'crews', 'inspections'];
