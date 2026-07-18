// Praeventio Guard — Fase F.3 page wrapper.
//
// Visualiza el "expediente automático" de un incidente. URL:
//   /incidents/:incidentId/bundle
//
// El servicio `buildIncidentBundle` ya existía; el endpoint
// `/api/sprint-k/:projectId/incidents/:incidentId/bundle` se agregó en
// el mismo PR. Esta página orquesta proyecto + hook + render del card
// (`IncidentEvidenceBundleCard`).
//
// Cuando el usuario hace click en "Descargar JSON" la página construye
// un Blob y dispara una descarga del cliente — sin endpoint adicional.
// La generación PDF se queda para sub-PR (depende `pdfkit`).

import { useCallback } from 'react';
import { humanErrorMessage } from '../lib/humanError';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Folder, WifiOff, FileQuestion } from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useDeepLinkProjectSync } from '../hooks/useDeepLinkProjectSync';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useIncidentBundle } from '../hooks/useIncidentBundle';
import { IncidentEvidenceBundleCard } from '../components/incidentBundle/IncidentEvidenceBundleCard';
import {
  manifestToJson,
  type IncidentBundleManifest,
} from '../services/incidentBundle/incidentEvidenceBundle';
// F.19 wire-up: render photo evidence linked to this incident.
import { usePhotoEvidenceByNode } from '../hooks/usePhotoEvidence';
import { PhotoEvidenceCard } from '../components/photoEvidence/PhotoEvidenceCard';
import { Camera } from 'lucide-react';
import { logger } from '../utils/logger';

export function IncidentBundle() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  // [P1][VIDA] When reached from a push notification for another project,
  // realign the active project BEFORE querying the bundle — otherwise the
  // bundle is fetched against the wrong project and never found.
  const { status: projectSyncStatus } = useDeepLinkProjectSync();
  const isOnline = useOnlineStatus();
  const { incidentId } = useParams<{ incidentId: string }>();
  const projectId = selectedProject?.id ?? null;

  const { data, loading, error } = useIncidentBundle(
    projectId,
    incidentId ?? null,
  );

  // F.19: photos linked to the incident render as their own section. The
  // bundle endpoint's `evidence` array is the high-level manifest shape;
  // photo-evidence is the concrete byte-backed feed for fiscalizadores.
  const { data: photoEvidence } = usePhotoEvidenceByNode(
    projectId,
    incidentId ? 'incident' : null,
    incidentId ?? null,
  );

  const handleExport = useCallback((manifest: IncidentBundleManifest) => {
    // Client-side download: stringify → Blob → anchor click. No
    // additional endpoint required. PDF export depends on pdfkit and
    // ships in a sub-PR.
    try {
      const json = manifestToJson(manifest);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `incident-bundle-${manifest.bundleId}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      logger.info('incidentBundle.export.json', {
        bundleId: manifest.bundleId,
      });
    } catch (err) {
      logger.error('incidentBundle.export.failed', err);
    }
  }, []);

  if (!incidentId) {
    return (
      <div
        className="flex-1 w-full p-4 sm:p-6 max-w-4xl mx-auto"
        data-testid="incident-bundle-page-noid"
      >
        <div className="rounded-2xl border border-default-token bg-surface p-8 text-center">
          <FileQuestion
            className="w-12 h-12 mx-auto mb-4 text-secondary-token"
            aria-hidden="true"
          />
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('incidentBundle.page.title', 'Expediente de incidente')}
          </h1>
          <p className="mt-2 text-sm text-secondary-token">
            {t(
              'incidentBundle.page.noId',
              'Falta el ID del incidente en la URL.',
            )}
          </p>
        </div>
      </div>
    );
  }

  if (projectSyncStatus === 'not-member') {
    return (
      <div
        className="flex-1 w-full p-4 sm:p-6 max-w-4xl mx-auto"
        data-testid="incident-bundle-page-not-member"
      >
        <div className="rounded-2xl border border-default-token bg-surface p-8 text-center">
          <FileQuestion
            className="w-12 h-12 mx-auto mb-4 text-secondary-token"
            aria-hidden="true"
          />
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('incidentBundle.page.title', 'Expediente de incidente')}
          </h1>
          <p className="mt-2 text-sm text-secondary-token">
            {t(
              'incidentBundle.page.notMember',
              'Este incidente pertenece a un proyecto al que ya no tienes acceso.',
            )}
          </p>
        </div>
      </div>
    );
  }

  if (!selectedProject) {
    return (
      <div
        className="flex-1 w-full p-4 sm:p-6 max-w-4xl mx-auto"
        data-testid="incident-bundle-page-empty"
      >
        <div className="rounded-2xl border border-default-token bg-surface p-8 text-center">
          <Folder
            className="w-12 h-12 mx-auto mb-4 text-secondary-token"
            aria-hidden="true"
          />
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('incidentBundle.page.title', 'Expediente de incidente')}
          </h1>
          <p className="mt-2 text-sm text-secondary-token">
            {t(
              'incidentBundle.page.selectProject',
              'Selecciona un proyecto para construir el expediente.',
            )}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex-1 w-full p-4 sm:p-6 max-w-4xl mx-auto space-y-4"
      data-testid="incident-bundle-page"
    >
      <header className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-500 flex items-center justify-center border border-indigo-500/20">
          <Folder className="w-5 h-5" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-lg font-black text-primary-token uppercase tracking-tight">
            {t('incidentBundle.page.title', 'Expediente de incidente')}
          </h1>
          <p className="text-xs text-secondary-token">
            {t(
              'incidentBundle.page.subtitle',
              'Bundle automático para fiscalización · Incidente {{id}}',
              { id: incidentId },
            )}
          </p>
        </div>
        {!isOnline && (
          <span
            className="ml-auto flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400"
            data-testid="incident-bundle-offline-chip"
          >
            <WifiOff className="w-3 h-3" aria-hidden="true" />
            {t('common.offline', 'Sin conexión')}
          </span>
        )}
      </header>

      {loading && (
        <div
          className="rounded-2xl border border-default-token bg-surface p-6 text-center text-sm text-secondary-token"
          data-testid="incident-bundle-loading"
        >
          {t('common.loading', 'Cargando…')}
        </div>
      )}

      {error && (
        <div
          className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-600 dark:text-rose-400"
          data-testid="incident-bundle-error"
          role="alert"
        >
          {t('incidentBundle.page.error', 'No se pudo construir el expediente: {{msg}}', {
            msg: humanErrorMessage(error),
          })}
        </div>
      )}

      {!loading && !error && data && (
        <IncidentEvidenceBundleCard
          manifest={data.manifest}
          onExport={handleExport}
        />
      )}

      {photoEvidence && photoEvidence.artifacts.length > 0 && (
        <section
          className="space-y-2"
          data-testid="incident-bundle-photo-evidence"
        >
          <header className="flex items-center gap-2">
            <Camera
              className="w-4 h-4 text-teal-600 dark:text-teal-400"
              aria-hidden="true"
            />
            <h2 className="text-sm font-bold uppercase tracking-tight text-primary-token">
              {t('incidentBundle.photoEvidence.title', 'Evidencia fotográfica')}
            </h2>
            <span className="ml-auto text-[11px] text-secondary-token">
              {photoEvidence.artifacts.length}
            </span>
          </header>
          <div className="grid gap-2 sm:grid-cols-2">
            {photoEvidence.artifacts.map((artifact) => (
              <PhotoEvidenceCard key={artifact.id} artifact={artifact} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export default IncidentBundle;
