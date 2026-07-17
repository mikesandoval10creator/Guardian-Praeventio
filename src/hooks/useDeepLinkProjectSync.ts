// Praeventio Guard — realign the active project for a deep link.
//
// [P1][VIDA] A push notification's deep link carries `?projectId=<pid>&source=push`.
// The emergency/incident screens read their data project from ProjectContext,
// NOT from the query, so a supervisor whose active project differs from the
// notification's project would see the WRONG project's emergencies (or an
// incident bundle that can't be found). This hook resolves the payload project
// against the user's projects and selects it before the screen queries.
//
// Consumed by the deep-link target screens (EmergenciaAvanzada, IncidentBundle).
// Only acts on push deep links (`source=push`) so normal in-app navigation with
// a stray `projectId` query is never hijacked.

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useProjectOptional } from '../contexts/ProjectContext';

export type DeepLinkProjectStatus =
  /** No push deep link, or already on the right project. Render normally. */
  | 'idle'
  /** Payload project matched a membership and is (being) selected. */
  | 'aligned'
  /** Waiting for the projects list to load before we can match. */
  | 'resolving'
  /** The payload project is not among the user's projects (access revoked or
   *  wrong account) — the caller should show a safe notice, NOT the current
   *  project's emergency data. */
  | 'not-member';

export interface DeepLinkProjectSync {
  status: DeepLinkProjectStatus;
  /** The projectId the notification pointed at, if any. */
  targetProjectId: string | null;
}

export function useDeepLinkProjectSync(): DeepLinkProjectSync {
  const [searchParams] = useSearchParams();
  const project = useProjectOptional();
  const targetProjectId = searchParams.get('projectId');
  const fromPush = searchParams.get('source') === 'push';
  const [status, setStatus] = useState<DeepLinkProjectStatus>('idle');

  const projects = project?.projects;
  const selectedId = project?.selectedProject?.id ?? null;
  const setSelectedProject = project?.setSelectedProject;

  useEffect(() => {
    if (!fromPush || !targetProjectId || !setSelectedProject) {
      setStatus('idle');
      return;
    }
    if (selectedId === targetProjectId) {
      setStatus('aligned');
      return;
    }
    // Projects may still be loading (cold start from a tapped notification).
    if (!projects || projects.length === 0) {
      setStatus('resolving');
      return;
    }
    const match = projects.find((p) => p.id === targetProjectId);
    if (match) {
      setSelectedProject(match);
      setStatus('aligned');
    } else {
      setStatus('not-member');
    }
  }, [fromPush, targetProjectId, projects, selectedId, setSelectedProject]);

  return { status, targetProjectId };
}
