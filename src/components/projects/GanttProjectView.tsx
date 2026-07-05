import { useMemo, useState } from 'react';
import { Gantt, ViewMode, type Task } from 'gantt-task-react';
import 'gantt-task-react/dist/index.css';
import type { PredictedActivity } from '../../services/calendar/predictions';
import type { ClimateRiskAssessment } from '../../services/zettelkasten/climateRiskCoupling';
import type { Crew, Process, ProcessType } from '../../types/organic';
import { computeProcessCloseXp } from '../../services/organic/processService';

export interface GanttProjectInput {
  id: string;
  name: string;
  startDate: string | Date;
  endDate?: string | Date;
  status?: 'active' | 'completed' | 'archived';
}

export interface GanttProjectViewProps {
  projects: GanttProjectInput[];
  predictedActivities?: PredictedActivity[];
  climateRisks?: ClimateRiskAssessment[];
  /**
   * Sprint 16 — nested Crew → Process swim-lanes. When `crews` is non-empty
   * the timeline switches to "Vista por cuadrilla" by default. Each crew
   * becomes a top-level Gantt project; processes nested under it inherit
   * `project: crew::{id}`. Color is derived from `processType_COLORS`.
   */
  crews?: Crew[];
  processes?: Process[];
  onActivityClick?: (activity: PredictedActivity) => void;
  onProjectClick?: (projectId: string) => void;
  onClimateRiskClick?: (assessment: ClimateRiskAssessment) => void;
  onProcessClick?: (process: Process) => void;
}

const STATUS_COLORS: Record<string, string> = {
  active: '#2563eb',     // blue-600
  completed: '#16a34a',  // green-600
  archived: '#64748b',   // slate-500
};

const PRIORITY_COLORS: Record<PredictedActivity['priority'], string> = {
  info: '#0ea5e9',       // sky-500
  warning: '#f59e0b',    // amber-500
  critical: '#dc2626',   // red-600
};

const CONDITION_ICONS: Record<string, string> = {
  rainy: 'lluvia',
  stormy: 'tormenta',
  'extreme-heat': 'calor',
  'cold-snap': 'frio',
  windy: 'viento',
  snow: 'nieve',
  sunny: 'sol',
};

/**
 * Sprint 16 — process-type color map. Mirrors the closed `ProcessType` union
 * in `src/types/organic.ts`. Adding a new ProcessType requires a matching
 * entry here AND a matching base XP entry in `processService.ts`.
 */
export const PROCESS_TYPE_COLORS: Record<ProcessType, string> = {
  concreto: '#6b7280',
  fachada: '#3b82f6',
  movimiento_tierras: '#a16207',
  soldadura: '#f97316',
  mantenimiento: '#8b5cf6',
  demolicion: '#e11d48',
  instalacion_electrica: '#eab308',
  pintura: '#14b8a6',
  topografia: '#10b981',
  transporte: '#6366f1',
  otro: '#9ca3af',
};

const PROCESS_TYPE_LABEL: Record<ProcessType, string> = {
  concreto: 'Concreto',
  fachada: 'Fachada',
  movimiento_tierras: 'Movimiento de tierras',
  soldadura: 'Soldadura',
  mantenimiento: 'Mantenimiento',
  demolicion: 'Demolición',
  instalacion_electrica: 'Instalación eléctrica',
  pintura: 'Pintura',
  topografia: 'Topografía',
  transporte: 'Transporte',
  otro: 'Otro',
};

function toDate(d: string | Date | null | undefined): Date {
  // Defensive: a project/process without a (valid) date must NOT crash the whole
  // Gantt — an Invalid Date propagates into the chart lib's date math and throws
  // "RangeError: Invalid time value" on the first toISOString(), taking the whole
  // /cuadrillas page down via the error boundary. Projects created without
  // startDate (ProjectContext.createProject does not set one) hit this. Fall back
  // to "now" so the timeline still draws a valid (if arbitrary) bar.
  if (d instanceof Date) return Number.isNaN(d.getTime()) ? new Date() : d;
  if (d == null || d === '') return new Date();
  const parsed = new Date(d);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function defaultEnd(start: Date): Date {
  // Projects without an explicit end date get a 90-day visualization window
  // so the Gantt has something to draw.
  const d = new Date(start);
  d.setDate(d.getDate() + 90);
  return d;
}

export function GanttProjectView({
  projects,
  predictedActivities = [],
  climateRisks = [],
  crews = [],
  processes = [],
  onActivityClick,
  onProjectClick,
  onClimateRiskClick,
  onProcessClick,
}: GanttProjectViewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.Week);
  // Default to crew view when there's any crew data; fall back to flat
  // view otherwise so legacy single-team projects keep their old layout.
  const [groupByCrew, setGroupByCrew] = useState<boolean>(crews.length > 0);
  const [hoveredProcessId, setHoveredProcessId] = useState<string | null>(null);

  const hoveredProcess = useMemo(
    () => processes.find((p) => p.id === hoveredProcessId) ?? null,
    [processes, hoveredProcessId]
  );

  const tasks: Task[] = useMemo(() => {
    const out: Task[] = [];

    // 1) Project bars (always shown — they anchor the timeline).
    for (const p of projects) {
      const start = toDate(p.startDate);
      const end = p.endDate ? toDate(p.endDate) : defaultEnd(start);
      const color = STATUS_COLORS[p.status ?? 'active'] ?? STATUS_COLORS.active;
      out.push({
        id: `project::${p.id}`,
        name: p.name,
        type: 'project',
        start,
        end,
        progress: p.status === 'completed' ? 100 : 25,
        isDisabled: false,
        styles: {
          backgroundColor: color,
          progressColor: color,
          backgroundSelectedColor: color,
          progressSelectedColor: color,
        },
      });
    }

    // 2a) Crew swim-lanes + nested process bars.
    if (groupByCrew && crews.length > 0) {
      for (const c of crews) {
        // A crew bar only renders when there's a matching project; we span
        // the union of its processes' start/end (or fall back to the
        // parent project's window).
        const proj = projects.find((p) => p.id === c.projectId);
        if (!proj) continue;
        const projStart = toDate(proj.startDate);
        const projEnd = proj.endDate ? toDate(proj.endDate) : defaultEnd(projStart);

        const crewProcs = processes.filter((pr) => pr.crewId === c.id);
        const crewStart = crewProcs.length
          ? new Date(Math.min(...crewProcs.map((pr) => new Date(pr.startedAt ?? projStart).getTime())))
          : projStart;
        const crewEnd = crewProcs.length
          ? new Date(Math.max(...crewProcs.map((pr) => {
              const ref = pr.endedAt ?? pr.plannedEndDate ?? pr.startedAt ?? projStart;
              return new Date(ref).getTime();
            })))
          : projEnd;

        out.push({
          id: `crew::${c.id}`,
          name: `Cuadrilla: ${c.name}`,
          type: 'project',
          start: crewStart,
          end: crewEnd,
          progress: 0,
          styles: {
            backgroundColor: '#0f172a',
            progressColor: '#0f172a',
            backgroundSelectedColor: '#0f172a',
            progressSelectedColor: '#0f172a',
          },
        });

        for (const pr of crewProcs) {
          const start = pr.startedAt ? new Date(pr.startedAt) : crewStart;
          const end = new Date(pr.endedAt ?? pr.plannedEndDate ?? start.getTime() + 7 * 24 * 60 * 60 * 1000);
          const color = PROCESS_TYPE_COLORS[pr.type] ?? PROCESS_TYPE_COLORS.otro;
          out.push({
            id: `process::${pr.id}`,
            name: `${PROCESS_TYPE_LABEL[pr.type]} — ${pr.name}`,
            type: 'task',
            start,
            end,
            progress: pr.status === 'completed' ? 100 : pr.status === 'active' ? 40 : 0,
            project: `crew::${c.id}`,
            styles: {
              backgroundColor: color,
              progressColor: color,
              backgroundSelectedColor: color,
              progressSelectedColor: color,
            },
          });
        }
      }
    } else if (!groupByCrew) {
      // Flat view: processes hang directly under their project.
      for (const pr of processes) {
        const start = pr.startedAt ? new Date(pr.startedAt) : new Date();
        const end = new Date(pr.endedAt ?? pr.plannedEndDate ?? start.getTime() + 7 * 24 * 60 * 60 * 1000);
        const color = PROCESS_TYPE_COLORS[pr.type] ?? PROCESS_TYPE_COLORS.otro;
        out.push({
          id: `process::${pr.id}`,
          name: `${PROCESS_TYPE_LABEL[pr.type]} — ${pr.name}`,
          type: 'task',
          start,
          end,
          progress: pr.status === 'completed' ? 100 : pr.status === 'active' ? 40 : 0,
          project: `project::${pr.projectId}`,
          styles: {
            backgroundColor: color,
            progressColor: color,
            backgroundSelectedColor: color,
            progressSelectedColor: color,
          },
        });
      }
    }

    // 3) Predicted activities — milestones colored by priority.
    predictedActivities.forEach((act, idx) => {
      const start = act.recommendedDate;
      const end = new Date(start.getTime() + act.recommendedDurationMin * 60 * 1000);
      const color = PRIORITY_COLORS[act.priority];
      out.push({
        id: `predicted::${act.projectId}::${act.type}::${idx}`,
        name: `${act.type} (${act.priority})`,
        type: 'milestone',
        start,
        end,
        progress: 0,
        project: `project::${act.projectId}`,
        styles: {
          backgroundColor: color,
          progressColor: color,
          backgroundSelectedColor: color,
          progressSelectedColor: color,
        },
      });
    });

    // 4) Climate risks — milestones with weather label.
    climateRisks.forEach((risk, idx) => {
      const start = risk.forecast.date;
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
      out.push({
        id: `climate::${risk.projectId}::${idx}`,
        name: `Clima: ${CONDITION_ICONS[risk.forecast.conditionCode] ?? risk.forecast.conditionCode}`,
        type: 'milestone',
        start,
        end,
        progress: 0,
        project: `project::${risk.projectId}`,
        styles: {
          backgroundColor: '#7c3aed', // violet-600
          progressColor: '#7c3aed',
          backgroundSelectedColor: '#7c3aed',
          progressSelectedColor: '#7c3aed',
        },
      });
    });

    return out;
  }, [projects, predictedActivities, climateRisks, crews, processes, groupByCrew]);

  const handleClick = (task: Task) => {
    if (task.id.startsWith('process::')) {
      const id = task.id.slice('process::'.length);
      const proc = processes.find((p) => p.id === id);
      if (proc) onProcessClick?.(proc);
      return;
    }
    if (task.id.startsWith('predicted::')) {
      const parts = task.id.split('::');
      const projectId = parts[1];
      const type = parts[2];
      const idx = Number(parts[3]);
      const activity = predictedActivities[idx];
      if (activity && activity.projectId === projectId && activity.type === type) {
        onActivityClick?.(activity);
      }
      return;
    }
    if (task.id.startsWith('climate::')) {
      const parts = task.id.split('::');
      const idx = Number(parts[2]);
      const risk = climateRisks[idx];
      if (risk) onClimateRiskClick?.(risk);
      return;
    }
    if (task.id.startsWith('project::')) {
      const projectId = task.id.slice('project::'.length);
      onProjectClick?.(projectId);
    }
  };

  if (tasks.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-slate-500">
        No hay proyectos para visualizar en la línea de tiempo.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm relative">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2">
        <h3 className="text-sm font-semibold text-slate-700">
          Línea de tiempo de proyectos
        </h3>
        <div className="flex items-center gap-2">
          {crews.length > 0 && (
            <div
              role="group"
              aria-label="Modo de visualización"
              className="flex rounded-md overflow-hidden border border-slate-200 text-[11px]"
            >
              <button
                type="button"
                onClick={() => setGroupByCrew(true)}
                className={`px-2 py-1 ${groupByCrew ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'}`}
              >
                Vista por cuadrilla
              </button>
              <button
                type="button"
                onClick={() => setGroupByCrew(false)}
                className={`px-2 py-1 ${!groupByCrew ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'}`}
              >
                Vista plana
              </button>
            </div>
          )}
          <div className="flex gap-2">
            {[ViewMode.Day, ViewMode.Week, ViewMode.Month].map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                className={`rounded px-2 py-1 text-xs ${
                  viewMode === mode
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div
        className="overflow-x-auto p-2 relative"
        onMouseLeave={() => setHoveredProcessId(null)}
      >
        <Gantt
          tasks={tasks}
          viewMode={viewMode}
          locale="es"
          onClick={handleClick}
          onSelect={(task, isSelected) => {
            if (!isSelected) return;
            if (task.id.startsWith('process::')) {
              setHoveredProcessId(task.id.slice('process::'.length));
            } else {
              setHoveredProcessId(null);
            }
          }}
          listCellWidth=""
          columnWidth={viewMode === ViewMode.Month ? 200 : 60}
        />

        {hoveredProcess && (
          <div
            role="tooltip"
            className="pointer-events-none absolute right-3 top-3 z-10 max-w-xs rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg"
          >
            <p className="font-semibold text-slate-800">{hoveredProcess.name}</p>
            <p className="mt-1 text-slate-600">
              Cumplimiento: <span className="font-mono font-bold">{hoveredProcess.complianceScore}</span>
              {' / 100'}
            </p>
            <p className="text-slate-600">
              XP estimado al cierre:{' '}
              <span className="font-mono font-bold">
                +{computeProcessCloseXp(hoveredProcess.type, hoveredProcess.complianceScore, hoveredProcess.alertsResponded)}
              </span>
            </p>
            <p className="mt-1 text-[10px] text-slate-500">
              Click para detalle del proceso.
            </p>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 border-t border-slate-200 px-4 py-2 text-[11px] text-slate-600">
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded" style={{ background: STATUS_COLORS.active }} />
          Proyecto activo
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded" style={{ background: PRIORITY_COLORS.warning }} />
          Actividad prevista
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded" style={{ background: PRIORITY_COLORS.critical }} />
          Crítica
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded" style={{ background: '#7c3aed' }} />
          Riesgo climático
        </span>
        {processes.length > 0 && (
          <span className="ml-2 inline-flex flex-wrap gap-2 border-l border-slate-200 pl-2">
            {(Object.keys(PROCESS_TYPE_COLORS) as ProcessType[]).map((t) => (
              <span key={t} className="flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded" style={{ background: PROCESS_TYPE_COLORS[t] }} />
                {PROCESS_TYPE_LABEL[t]}
              </span>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}
