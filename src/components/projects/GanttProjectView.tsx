import { useMemo, useState } from 'react';
import { Gantt, ViewMode, type Task } from 'gantt-task-react';
import 'gantt-task-react/dist/index.css';
import type { PredictedActivity } from '../../services/calendar/predictions';
import type { ClimateRiskAssessment } from '../../services/zettelkasten/climateRiskCoupling';

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
  onActivityClick?: (activity: PredictedActivity) => void;
  onProjectClick?: (projectId: string) => void;
  onClimateRiskClick?: (assessment: ClimateRiskAssessment) => void;
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

function toDate(d: string | Date): Date {
  return d instanceof Date ? d : new Date(d);
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
  onActivityClick,
  onProjectClick,
  onClimateRiskClick,
}: GanttProjectViewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.Week);

  const tasks: Task[] = useMemo(() => {
    const out: Task[] = [];

    // 1) Project bars.
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

    // 2) Predicted activities — milestones colored by priority.
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

    // 3) Climate risks — milestones with weather label.
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
  }, [projects, predictedActivities, climateRisks]);

  const handleClick = (task: Task) => {
    if (task.id.startsWith('predicted::')) {
      // Recover the underlying activity by id parts.
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
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
        <h3 className="text-sm font-semibold text-slate-700">
          Línea de tiempo de proyectos
        </h3>
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

      <div className="overflow-x-auto p-2">
        <Gantt
          tasks={tasks}
          viewMode={viewMode}
          locale="es"
          onClick={handleClick}
          listCellWidth=""
          columnWidth={viewMode === ViewMode.Month ? 200 : 60}
        />
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 border-t border-slate-200 px-4 py-2 text-xs text-slate-600">
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
      </div>
    </div>
  );
}
