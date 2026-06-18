// Praeventio Guard — SLA Watch items hook.
//
// Combines corrective actions and work permits into AssessedItem[] for
// the SlaWatchPanel. Each item is assessed client-side using assessSla.

import { useMemo } from 'react';
import { useCorrectiveActions } from './useCorrectiveActions';
import { useWorkPermits } from './useWorkPermits';
import {
  assessSla,
  type WorkflowItem,
} from '../services/escalation/escalationSlaEngine';
import type { AssessedItem } from '../components/escalation/SlaWatchPanel';
import type { CorrectiveAction } from '../services/correctiveActions/weakActionDetector';
import type { WorkPermit } from '../services/workPermits/workPermitEngine';

function correctiveActionToWorkflowItem(action: CorrectiveAction): WorkflowItem {
  return {
    id: action.id,
    kind: 'corrective_action',
    severity: action.isSystemic ? 'high' : 'medium',
    status: action.status === 'open' ? 'open' : action.status === 'closed' ? 'closed' : 'closed',
    createdAt: new Date().toISOString(),
  };
}

function workPermitToWorkflowItem(permit: WorkPermit): WorkflowItem {
  return {
    id: permit.id,
    kind: 'work_permit',
    severity: 'medium',
    status: permit.status === 'active' ? 'in_progress' : permit.status === 'fulfilled' ? 'closed' : 'open',
    createdAt: permit.createdAt ?? new Date().toISOString(),
  };
}

export function useSlaWatchItems(projectId: string | null) {
  const { data: correctiveActionsData } = useCorrectiveActions(projectId, { status: 'open' });
  const { data: workPermitsData } = useWorkPermits(projectId, { status: 'active' });

  const items = useMemo<AssessedItem[]>(() => {
    const now = new Date();
    const result: AssessedItem[] = [];

    if (correctiveActionsData?.actions) {
      for (const action of correctiveActionsData.actions) {
        const item = correctiveActionToWorkflowItem(action);
        result.push({
          item,
          assessment: assessSla(item, now),
          label: action.description,
        });
      }
    }

    if (workPermitsData?.permits) {
      for (const permit of workPermitsData.permits) {
        const item = workPermitToWorkflowItem(permit);
        result.push({
          item,
          assessment: assessSla(item, now),
          label: permit.taskDescription,
        });
      }
    }

    return result;
  }, [correctiveActionsData, workPermitsData]);

  return { items };
}
