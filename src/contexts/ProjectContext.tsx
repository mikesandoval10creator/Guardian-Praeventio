import React, { createContext, useContext, useState, useEffect, ReactNode, useMemo } from 'react';
import { db, collection, onSnapshot, query, where, handleFirestoreError, OperationType } from '../services/firebase';
import { useFirebase } from './FirebaseContext';
import { usePendingActions } from '../hooks/usePendingActions';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/shared/ToastContainer';
import { GuestSaveModal } from '../components/shared/GuestSaveModal';
import { analytics } from '../services/analytics';
import type { IndustryCode, ProjectTier } from '../services/analytics';

interface Project {
  id: string;
  name: string;
  description: string;
  location: string;
  coordinates?: { lat: number; lng: number };
  industry: string;
  status: 'active' | 'completed' | 'archived';
  startDate: string;
  endDate?: string;
  clientName?: string;
  riskLevel: 'Bajo' | 'Medio' | 'Alto' | 'CrÃ­tico';
  workersCount?: number;
  updatedAt?: string;
  isPendingSync?: boolean;
  // Legal / SUSESO fields
  companyName?: string;   // RazÃ³n social del empleador
  companyRut?: string;    // RUT empresa (ej: 76.123.456-7)
  companyAddress?: string;
  mutualidad?: 'ACHS' | 'IST' | 'Mutual de Seguridad' | 'SUSESO' | 'Otra';
  // ISO 3166-1 alpha-2 country code (CL default). Used by SusesoReports to
  // route to the matching country regulator client. Sprint 49 E.5 P2 H19:
  // declared so call-sites stop reaching through `selectedProject.country`.
  country?: string;
  // Emergency contact for SafeDrivingMode "Base" button
  phone?: string;
  // Tracking & Shifts
  shiftStart?: string;
  shiftEnd?: string;
  trackCommute?: boolean;
  settings?: {
    geofences?: any[];
    manDownInactivityThreshold?: number;
    manDownMovementThreshold?: number;
  };
  // Sprint 25 Bucket TT â€” daily climate-risk scan. The orchestrator only
  // touches projects with status='active' AND outdoor=true; `geo` is
  // forwarded to OpenWeather; `supervisorUids` receives the FCM blast
  // when severity >= medium; `workTypes` drives the Bernoulli generators
  // (tunnel keywords trigger Venturi, scaffold/crane keywords trigger
  // Windload). All optional â€” legacy projects scan with `outdoor=false`
  // by default and are skipped, matching the runbook contract.
  outdoor?: boolean;
  workTypes?: string[];
  supervisorUids?: string[];
  geo?: { lat: number; lng: number };
}

interface ProjectContextType {
  projects: Project[];
  selectedProject: Project | null;
  setSelectedProject: (project: Project | null) => void;
  createProject: (project: Omit<Project, 'id'>) => Promise<string>;
  loading: boolean;
  // Round 14 Task 5: surface the Firestore subscription error so the
  // Projects page can render a Spanish-CL error banner. `null` when the
  // last snapshot succeeded; populated only when `onSnapshot`'s error
  // callback fires (typically permission-denied or offline-without-cache).
  error: Error | null;
}

/**
 * Map free-text industry names (Spanish UI) â†’ catalog `IndustryCode`
 * enum (TRACKING_PLAN property-glossary). The product UI offers Spanish
 * labels; analytics dashboards key off the closed-set English codes so
 * cardinality stays bounded. Unknown labels collapse to `other`.
 */
function mapIndustryToCode(industry: string | undefined): IndustryCode {
  const normalised = (industry ?? '').toLowerCase();
  if (normalised.includes('miner')) return 'mining';
  if (normalised.includes('construc')) return 'construction';
  if (normalised.includes('agric')) return 'agriculture';
  if (normalised.includes('manufact')) return 'manufacturing';
  if (normalised.includes('energ')) return 'energy';
  if (normalised.includes('transport')) return 'transport';
  if (normalised.includes('servic')) return 'services';
  return 'other';
}

const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

// Sprint 32 audit W1 â€” mirror the selected project id to localStorage so
// non-React subscribers (e.g. EmergencyAutoBridge listening to a window
// CustomEvent) can resolve "the worker's current project" without dragging
// in the React context. The mirror is one-way: ProjectContext is the source
// of truth and a stale value in storage is harmless (the bridge just falls
// back to a context-less server call).
const ACTIVE_PROJECT_STORAGE_KEY = 'gp.activeProjectId';

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [fetchedProjects, setFetchedProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [guestSaveOpen, setGuestSaveOpen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      if (selectedProject?.id) {
        window.localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, selectedProject.id);
      } else {
        window.localStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY);
      }
    } catch {
      /* private mode / quota â€” no-op; bridge degrades gracefully */
    }
  }, [selectedProject?.id]);

  const { isAuthReady, user, isAdmin } = useFirebase();

  // Regla #3 (2026-05-15): cuando el usuario selecciona un proyecto,
  // los cálculos de ingeniería que tenía en scratch (porque no había
  // proyecto antes) se auto-promueven al proyecto seleccionado vía
  // writeNodesDebounced. Best-effort: si falla, no rompe el flujo del user.
  useEffect(() => {
    if (!selectedProject?.id) return;
    const projectId = selectedProject.id;
    void (async () => {
      try {
        const [{ promoteAllScratchToProject }, { writeNodesDebounced }] = await Promise.all([
          import('../services/engineering/scratchCalculations'),
          import('../services/zettelkasten/persistence/writeNode'),
        ]);
        const userUid = user?.uid ?? null;
        const promoted = await promoteAllScratchToProject(userUid, projectId);
        if (promoted.length > 0) {
          writeNodesDebounced(promoted, { projectId });
        }
      } catch {
        // Best-effort — scratch storage no es crítico para el flujo principal.
      }
    })();
    // Solo dispara cuando cambia el proyecto seleccionado o el user, no en cada render.
  }, [selectedProject?.id, user?.uid]);
  const pendingActions = usePendingActions('projects');
  const { toasts, show: showToast, dismiss } = useToast();

  const projects = useMemo(() => {
    let combined = [...fetchedProjects];

    pendingActions.forEach(action => {
      if (action.type === 'update' && action.data.id) {
        const index = combined.findIndex(p => p.id === action.data.id);
        if (index !== -1) {
          combined[index] = { ...combined[index], ...action.data };
        }
      } else if (action.type === 'delete' && action.data.id) {
        combined = combined.filter(p => p.id !== action.data.id);
      }
    });

    const pendingCreates = pendingActions
      .filter(a => a.type === 'create')
      .map(a => ({
        ...a.data,
        id: `pending-${a.id}`,
        isPendingSync: true
      })) as Project[];

    return [...pendingCreates, ...combined];
  }, [fetchedProjects, pendingActions]);

  const createProject = async (projectData: Omit<Project, 'id'>): Promise<string> => {
    if (!user) {
      setGuestSaveOpen(true);
      return Promise.reject(new Error('auth-required'));
    }
    try {
      if (!navigator.onLine) {
        const { saveForSync } = await import('../utils/pwa-offline');
        await saveForSync({
          type: 'create',
          collection: 'projects',
          data: {
            ...projectData,
            createdAt: new Date().toISOString(),
            createdBy: user?.uid,
            members: [user?.uid]
          }
        });
        showToast('Proyecto guardado para sincronizaciÃ³n cuando haya conexiÃ³n.', 'info');
        return 'offline-id-' + Date.now();
      }

      const { addDoc } = await import('firebase/firestore');
      const { seedGlobalData } = await import('../services/seedService');

      const docRef = await addDoc(collection(db, 'projects'), {
        ...projectData,
        createdAt: new Date().toISOString(),
        createdBy: user?.uid,
        members: [user?.uid]
      });

      // Wave-9 analytics: fire project.created with the closed-set tier
      // + industry mapping. The catalog enums are the gold standard;
      // unmapped values fall back to 'other'/'free' so the dashboard
      // stays clean rather than blank-ing out.
      try {
        analytics.track('project.created', {
          project_tier: 'free' as ProjectTier,
          industry_code: mapIndustryToCode(projectData.industry),
        });
      } catch { /* analytics must never break user flow */ }

      // Seed initial data for the new project
      await seedGlobalData(docRef.id, projectData.industry);

      // Seed Zettelkasten template nodes (Blocks I-VIII)
      const { seedProjectNodes } = await import('../services/nodeSeedService');
      seedProjectNodes(docRef.id, user?.uid ?? 'system').catch(() => {});

      return docRef.id;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'projects');
      throw error;
    }
  };

  useEffect(() => {
    if (!isAuthReady || !user) {
      setFetchedProjects([]);
      setSelectedProject(null);
      setError(null);
      setLoading(false);
      return;
    }

    let q;
    if (isAdmin) {
      q = query(collection(db, 'projects'));
    } else {
      q = query(collection(db, 'projects'), where('members', 'array-contains', user.uid));
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const newProjects = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Project[];

      setFetchedProjects(newProjects);
      setError(null);

      // Auto-select first project if none selected
      if (newProjects.length > 0 && !selectedProject) {
        setSelectedProject(newProjects[0]);
      }

      setLoading(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'projects');
      setError(err as Error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [isAuthReady, user]);

  return (
    <ProjectContext.Provider value={{ projects, selectedProject, setSelectedProject, createProject, loading, error }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
      <GuestSaveModal
        isOpen={guestSaveOpen}
        onClose={() => setGuestSaveOpen(false)}
        industry={selectedProject?.industry}
      />
    </ProjectContext.Provider>
  );
}

export function useProject() {
  const context = useContext(ProjectContext);
  if (context === undefined) {
    throw new Error('useProject must be used within a ProjectProvider');
  }
  return context;
}
