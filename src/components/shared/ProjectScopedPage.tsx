// SPDX-License-Identifier: MIT
// Praeventio Guard — Plan 2026-05-23 Fase B.3.
//
// Shell component que encapsula el wrapper estructural común a 15 pages
// Sprint K + Digital Twin: container + header + project gate +
// loading skeleton + error banner + content slot. Cierra el último
// duplicado del audit 2026-05-23 (~3000 LOC × 15% header = ~450 LOC).
//
// API explícitamente desacoplada del hook `useProjectFirestoreCollection`
// — recibe `loading` / `error` como props para que pueda renderear pages
// que también combinan estado local (forms, validations, etc.).
//
// Convención de layout heredada de pages existentes (`Reglamentos.tsx`,
// `SusesoReports.tsx`):
//   - `max-w-5xl mx-auto p-4 space-y-6`
//   - header: title (text-2xl font-bold) + opcional description + actions
//   - error banner: DataLoadErrorBanner inline arriba del content
//   - empty/loading/content state intercalados por las props
//
// Anti-pattern que NO usamos: leer ProjectContext acá. La page conoce su
// `loading` real (que puede combinar el hook + estado local + side-effects),
// así que pedirlo como prop es más honesto que adivinar desde adentro.

import React from 'react';
import { Folder, Loader2 } from 'lucide-react';
import { useProject } from '../../contexts/ProjectContext';
import { EmptyState } from './EmptyState';
import { DataLoadErrorBanner } from './DataLoadErrorBanner';

export interface ProjectScopedPageProps {
  /** Título principal de la page. Aparece en `<h1 className="text-2xl font-bold">`. */
  title: string;
  /** Subtítulo bajo el title. Texto plano o JSX. */
  description?: React.ReactNode;
  /** Botones / chips a la derecha del title. Ej. "Nuevo registro", filtros. */
  actions?: React.ReactNode;
  /** Si true, muestra spinner en vez del content. */
  loading?: boolean;
  /** Si está, renderea DataLoadErrorBanner sobre el content. */
  error?: Error | null;
  /** Label opcional para personalizar el mensaje del error banner. */
  errorResourceLabel?: string;
  /** Override del mensaje del EmptyState cuando no hay proyecto. */
  emptyProjectMessage?: string;
  /** Label del CTA del empty state. Defaults a "Ir a proyectos". */
  emptyProjectActionLabel?: string;
  /** Callback del CTA. Si no se pasa, no se renderea el botón. */
  onEmptyProjectAction?: () => void;
  /** Si true, el shell NO bloquea el render cuando selectedProject es null
   *  (útil para pages que tienen modo guest / demo). */
  allowAnonymous?: boolean;
  /** Override de `selectedProject?.id` para tests / multi-proyecto session. */
  projectIdOverride?: string;
  /** Contenido principal. */
  children: React.ReactNode;
  /** data-testid override para tests E2E. */
  'data-testid'?: string;
}

export const ProjectScopedPage: React.FC<ProjectScopedPageProps> = ({
  title,
  description,
  actions,
  loading = false,
  error = null,
  errorResourceLabel,
  emptyProjectMessage,
  emptyProjectActionLabel,
  onEmptyProjectAction,
  allowAnonymous = false,
  projectIdOverride,
  children,
  'data-testid': dataTestId,
}) => {
  const { selectedProject } = useProject();
  const projectId = projectIdOverride ?? selectedProject?.id ?? '';
  const isProjectMissing = !projectId && !allowAnonymous;

  return (
    <div
      className="max-w-5xl mx-auto p-4 space-y-6"
      data-testid={dataTestId ?? 'project-scoped-page'}
    >
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-2 min-w-0">
          <h1 className="text-2xl font-bold">{title}</h1>
          {description && (
            <div className="text-sm text-zinc-600 dark:text-zinc-400">
              {description}
            </div>
          )}
        </div>
        {actions && (
          <div className="shrink-0 flex items-center gap-2">{actions}</div>
        )}
      </header>

      {/* Project gate — solo cuando NO está allowAnonymous Y no hay proyecto */}
      {isProjectMissing ? (
        <EmptyState
          icon={Folder}
          title={emptyProjectMessage ?? 'Selecciona un proyecto'}
          description="Esta página se enfoca en datos por proyecto. Elige uno en el selector para continuar."
          action={
            onEmptyProjectAction
              ? {
                  label: emptyProjectActionLabel ?? 'Ir a proyectos',
                  onClick: onEmptyProjectAction,
                }
              : undefined
          }
        />
      ) : (
        <>
          <DataLoadErrorBanner error={error} resourceLabel={errorResourceLabel} />
          {loading ? (
            <div
              className="flex items-center justify-center py-12 text-muted-token gap-2"
              role="status"
              aria-live="polite"
              data-testid="project-scoped-page-loading"
            >
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm">Cargando…</span>
            </div>
          ) : (
            children
          )}
        </>
      )}
    </div>
  );
};

export default ProjectScopedPage;
