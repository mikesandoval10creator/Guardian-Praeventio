// SPDX-License-Identifier: MIT
// Sprint 20 — Bucket D: Cuadrillas dashboard.
//
// Three-pane layout for the organic Crew → Process → Task pipeline:
//   • Header  — title + "Nueva cuadrilla" CTA.
//   • Left    — list of crews for the active project (Firestore subscription).
//   • Center  — selected crew detail: members, XP, processes activos with
//               action buttons (Iniciar / Ver detalle / Cerrar).
//   • Right   — GanttProjectView scoped to the active project + crews.
//
// Reuses the existing modals StartProcessModal, ProcessDetailModal,
// CloseProcessModal, and the new CreateCrewModal. No business logic lives
// here — it's pure orchestration over Firestore + the modal components.

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Users, Plus, ListChecks, Trophy, Hammer, Eye, ShieldCheck, FileSpreadsheet } from 'lucide-react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useProject } from '../contexts/ProjectContext';
import type { Crew, Process } from '../types/organic';
import { StartProcessModal } from '../components/processes/StartProcessModal';
import { ProcessDetailModal } from '../components/processes/ProcessDetailModal';
import { CloseProcessModal } from '../components/processes/CloseProcessModal';
import { CreateCrewModal } from '../components/processes/CreateCrewModal';
import { GanttProjectView } from '../components/projects/GanttProjectView';
import { CsvImportExportModal } from '../components/etl/CsvImportExportModal';
import { ProcessClosePreviewCard } from '../components/organic/ProcessClosePreviewCard';
import { useProjectProcesses } from '../hooks/useProjectProcesses';

export function CuadrillasDashboard() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const projectId = selectedProject?.id ?? '';

  const [crews, setCrews] = useState<Crew[]>([]);
  const [processes, setProcesses] = useState<Process[]>([]);
  const [selectedCrewId, setSelectedCrewId] = useState<string | null>(null);

  const [showCreateCrew, setShowCreateCrew] = useState(false);
  const [showStartProcess, setShowStartProcess] = useState(false);
  const [detailProcess, setDetailProcess] = useState<Process | null>(null);
  const [closeProcess, setCloseProcess] = useState<Process | null>(null);
  const [showCsvModal, setShowCsvModal] = useState<null | 'processes' | 'crews'>(null);

  // Subscribe to crews of the active project.
  useEffect(() => {
    if (!projectId) {
      setCrews([]);
      return undefined;
    }
    const q = query(collection(db, 'crews'), where('projectId', '==', projectId));
    const un = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Crew, 'id'>) }));
        setCrews(list);
        if (list.length > 0 && !selectedCrewId) {
          setSelectedCrewId(list[0].id);
        }
      },
      () => setCrews([])
    );
    return () => un();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Subscribe to processes for the active project.
  useEffect(() => {
    if (!projectId) {
      setProcesses([]);
      return undefined;
    }
    const q = query(collection(db, 'processes'), where('projectId', '==', projectId));
    const un = onSnapshot(
      q,
      (snap) => {
        setProcesses(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Process, 'id'>) })));
      },
      () => setProcesses([])
    );
    return () => un();
  }, [projectId]);

  // Server-backed read of the project's processes (GET /api/processes) — powers
  // the "Procesos por cerrar" close-preview panel below. This reads the same
  // real `processes` collection the client subscription watches, but via the
  // tenant-gated server endpoint so the XP preview is grounded in server state.
  const { processes: serverProcesses, refresh: refreshProcesses } =
    useProjectProcesses(projectId || null);

  const selectedCrew = useMemo(
    () => crews.find((c) => c.id === selectedCrewId) ?? null,
    [crews, selectedCrewId]
  );

  // Active processes of the selected crew, sourced from the server endpoint, for
  // the close-XP preview cards. Honest empty state when there are none.
  const closablePreviewProcesses = useMemo(
    () =>
      serverProcesses.filter(
        (p) => p.crewId === selectedCrewId && (p.status === 'active' || p.status === 'paused'),
      ),
    [serverProcesses, selectedCrewId]
  );

  const crewProcesses = useMemo(
    () => processes.filter((p) => p.crewId === selectedCrewId),
    [processes, selectedCrewId]
  );

  const activeCrewProcesses = useMemo(
    () => crewProcesses.filter((p) => p.status === 'active' || p.status === 'paused'),
    [crewProcesses]
  );

  if (!projectId) {
    return (
      <div className="p-6">
        <div className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-6">
          <h2 className="text-lg font-bold text-amber-700 dark:text-amber-300">
            {t('cuadrillas.selectProject', 'Selecciona un proyecto')}
          </h2>
          <p className="mt-1 text-sm text-amber-700/80 dark:text-amber-300/80">
            {t('cuadrillas.selectProjectHint', 'Para gestionar cuadrillas debes tener un proyecto activo.')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 space-y-4">
      {/* Header */}
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="w-6 h-6 text-[var(--accent-primary,#4db6ac)]" />
          <h1 className="text-xl lg:text-2xl font-black text-primary-token tracking-tight">
            {t('cuadrillas.title', 'Cuadrillas')}
          </h1>
          <span className="text-xs text-muted-token">
            · {selectedProject?.name}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCsvModal('processes')}
            className="inline-flex items-center gap-1.5 rounded-md bg-teal-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-teal-700"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            {t('cuadrillas.importExportCsv', 'Import/Export CSV')}
          </button>
          <button
            onClick={() => setShowCreateCrew(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700"
          >
            <Plus className="w-3.5 h-3.5" />
            {t('cuadrillas.newCrew', 'Nueva cuadrilla')}
          </button>
        </div>
      </header>

      <CsvImportExportModal
        isOpen={showCsvModal !== null}
        onClose={() => setShowCsvModal(null)}
        entityType={showCsvModal ?? 'processes'}
        projectId={projectId || null}
        // Export reads the TOP-LEVEL collections this dashboard already
        // subscribes to (server is the only writer); the project subcollection
        // the adapter used to query is always empty.
        liveExportRows={showCsvModal === 'crews' ? crews : processes}
      />

      {/* 3-pane grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left — crews list */}
        <aside className="lg:col-span-3 rounded-2xl border border-default-token bg-surface p-3 max-h-[70vh] overflow-y-auto">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-token mb-2">
            {t('cuadrillas.crewList', 'Lista de cuadrillas')} ({crews.length})
          </h3>
          {crews.length === 0 ? (
            <p className="text-xs text-muted-token px-2 py-4">
              {t('cuadrillas.noCrews', 'No hay cuadrillas. Crea la primera con el botón superior.')}
            </p>
          ) : (
            <ul className="space-y-1">
              {crews.map((c) => {
                const isActive = c.id === selectedCrewId;
                return (
                  <li key={c.id}>
                    <button
                      onClick={() => setSelectedCrewId(c.id)}
                      data-testid={`crew-row-${c.id}`}
                      className={`w-full text-left rounded-lg px-3 py-2 transition-colors ${
                        isActive
                          ? 'bg-emerald-50 dark:bg-emerald-900/30 ring-1 ring-emerald-300 dark:ring-emerald-700'
                          : 'hover:bg-zinc-50 dark:hover:bg-zinc-800'
                      }`}
                    >
                      <p className="text-sm font-semibold text-primary-token">
                        {c.name}
                      </p>
                      <p className="text-[11px] text-muted-token mt-0.5">
                        {t('cuadrillas.membersCount', '{{count}} miembros', { count: c.memberUids.length })} · {c.xp} XP
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        {/* Center — crew detail */}
        <section className="lg:col-span-5 rounded-2xl border border-default-token bg-surface p-4 max-h-[70vh] overflow-y-auto">
          {!selectedCrew ? (
            <p className="text-sm text-muted-token py-8 text-center">
              {t('cuadrillas.selectCrew', 'Selecciona una cuadrilla para ver el detalle.')}
            </p>
          ) : (
            <motion.div
              key={selectedCrew.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-4"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-lg font-bold text-primary-token">
                    {selectedCrew.name}
                  </h2>
                  <p className="text-xs text-muted-token mt-0.5">
                    {t('cuadrillas.membersCount', '{{count}} miembros', { count: selectedCrew.memberUids.length })} · {t('cuadrillas.processesCompleted', '{{count}} procesos completados', { count: selectedCrew.totalProcessesCompleted })}
                  </p>
                </div>
                <button
                  onClick={() => setShowStartProcess(true)}
                  data-testid="start-process-button"
                  className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700"
                >
                  <Hammer className="w-3.5 h-3.5" />
                  {t('cuadrillas.startProcess', 'Iniciar proceso')}
                </button>
              </div>

              {/* XP card */}
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 p-3">
                  <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                    <Trophy className="w-3.5 h-3.5" />
                    <span className="text-[10px] uppercase tracking-wider font-bold">XP</span>
                  </div>
                  <p className="mt-1 text-xl font-black text-emerald-700 dark:text-emerald-300">
                    {selectedCrew.xp}
                  </p>
                </div>
                <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 p-3">
                  <div className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span className="text-[10px] uppercase tracking-wider font-bold">{t('cuadrillas.noIncident', 'Sin incidente')}</span>
                  </div>
                  <p className="mt-1 text-xl font-black text-blue-700 dark:text-blue-300">
                    {selectedCrew.daysWithoutIncident}d
                  </p>
                </div>
                <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/40 border border-default-token p-3">
                  <div className="flex items-center gap-1.5 text-secondary-token">
                    <ListChecks className="w-3.5 h-3.5" />
                    <span className="text-[10px] uppercase tracking-wider font-bold">{t('cuadrillas.processes', 'Procesos')}</span>
                  </div>
                  <p className="mt-1 text-xl font-black text-secondary-token">
                    {crewProcesses.length}
                  </p>
                </div>
              </div>

              {/* Members */}
              <section>
                <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-token mb-2">
                  {t('cuadrillas.members', 'Miembros')} ({selectedCrew.memberUids.length})
                </h4>
                {selectedCrew.memberUids.length === 0 ? (
                  <p className="text-xs text-muted-token">
                    {t('cuadrillas.noMembers', 'Sin miembros aún. Asigna trabajadores desde el panel del proyecto.')}
                  </p>
                ) : (
                  <ul className="flex flex-wrap gap-1.5">
                    {selectedCrew.memberUids.map((uid) => (
                      <li
                        key={uid}
                        className="text-[11px] font-mono px-2 py-1 rounded bg-zinc-100 dark:bg-zinc-800 text-secondary-token"
                      >
                        {uid}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Active processes */}
              <section>
                <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-token mb-2">
                  {t('cuadrillas.activeProcesses', 'Procesos activos')} ({activeCrewProcesses.length})
                </h4>
                {activeCrewProcesses.length === 0 ? (
                  <p className="text-xs text-muted-token">
                    {t('cuadrillas.noActiveProcesses', 'Sin procesos abiertos. Inicia uno con el botón superior.')}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {activeCrewProcesses.map((p) => (
                      <li
                        key={p.id}
                        data-testid={`process-row-${p.id}`}
                        className="rounded-lg border border-default-token p-3 bg-white dark:bg-zinc-950"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-primary-token truncate">
                              {p.name}
                            </p>
                            <p className="text-[11px] text-muted-token mt-0.5">
                              {p.type} · {p.status} · {p.complianceScore}/100 · alertas atendidas: {p.alertsResponded}
                            </p>
                          </div>
                          <div className="flex flex-shrink-0 gap-1.5">
                            <button
                              onClick={() => setDetailProcess(p)}
                              className="inline-flex items-center gap-1 rounded-md bg-zinc-100 dark:bg-zinc-800 px-2 py-1 text-[11px] font-semibold text-secondary-token hover:bg-zinc-200 dark:hover:bg-zinc-700"
                            >
                              <Eye className="w-3 h-3" />
                              {t('cuadrillas.viewDetail', 'Ver detalle')}
                            </button>
                            <button
                              onClick={() => setCloseProcess(p)}
                              className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-bold text-white hover:bg-emerald-700"
                            >
                              <ShieldCheck className="w-3 h-3" />
                              {t('cuadrillas.close', 'Cerrar')}
                            </button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Close-XP preview — server-backed (GET /api/processes). Shows the
                  XP the crew earns when each open process is closed. */}
              <section data-testid="process-close-preview-panel">
                <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-token mb-2">
                  {t('cuadrillas.closePreview', 'XP al cerrar')} ({closablePreviewProcesses.length})
                </h4>
                {closablePreviewProcesses.length === 0 ? (
                  <p
                    className="text-xs text-muted-token"
                    data-testid="process-close-preview-empty"
                  >
                    {t('cuadrillas.noClosablePreview', 'Sin procesos por cerrar. Inicia uno para ver el XP estimado.')}
                  </p>
                ) : (
                  <div className="space-y-3">
                    {closablePreviewProcesses.map((p) => (
                      <ProcessClosePreviewCard
                        key={p.id}
                        process={p}
                        onConfirmClose={() => setCloseProcess(p)}
                      />
                    ))}
                  </div>
                )}
              </section>
            </motion.div>
          )}
        </section>

        {/* Right — Gantt timeline */}
        <section className="lg:col-span-4 rounded-2xl border border-default-token bg-surface p-3 max-h-[70vh] overflow-hidden">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-token mb-2 px-1">
            {t('cuadrillas.timeline', 'Timeline · cuadrillas')}
          </h3>
          {selectedProject ? (
            <div className="overflow-auto max-h-[64vh]">
              <GanttProjectView
                projects={[
                  {
                    id: selectedProject.id,
                    name: selectedProject.name,
                    startDate: selectedProject.startDate,
                    endDate: selectedProject.endDate,
                    status: selectedProject.status,
                  },
                ]}
                crews={crews}
                processes={processes}
              />
            </div>
          ) : (
            <p className="text-xs text-zinc-500 px-2 py-4">{t('cuadrillas.noActiveProject', 'Sin proyecto activo.')}</p>
          )}
        </section>
      </div>

      {/* Modals */}
      <CreateCrewModal
        isOpen={showCreateCrew}
        projectId={projectId}
        onClose={() => setShowCreateCrew(false)}
      />

      {selectedCrew && (
        <StartProcessModal
          isOpen={showStartProcess}
          projectId={projectId}
          crewId={selectedCrew.id}
          crewName={selectedCrew.name}
          onClose={() => setShowStartProcess(false)}
        />
      )}

      <ProcessDetailModal
        isOpen={!!detailProcess}
        process={detailProcess}
        onClose={() => setDetailProcess(null)}
      />

      <CloseProcessModal
        isOpen={!!closeProcess}
        process={closeProcess}
        onClose={() => {
          setCloseProcess(null);
          // Re-pull the server-backed list so the close-XP preview reflects the
          // process that just moved to a terminal status.
          refreshProcesses();
        }}
      />
    </div>
  );
}

export default CuadrillasDashboard;
