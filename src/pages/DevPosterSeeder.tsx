// SPDX-License-Identifier: MIT
//
// Dev Poster Seeder — herramienta one-time para generar embeddings
// de referencia de los afiches de seguridad usando la MISMA
// MediaPipe ImageEmbedder que usa el ARPosterScanner en runtime.
//
// 2026-05-16 (Sprint G — AR Real Vision follow-up):
// El scripts/seed-poster-embeddings.md documenta dos flows posibles:
//   (A) Browser flow vía esta página — RECOMENDADO
//   (B) Node flow con tfjs-node — alternativo CI-friendly
//
// Esta es la implementación del flow A. Ventajas vs Node:
//   - Usa el MISMO modelo que produce embeddings en runtime
//     (consistencia bit-perfect — cero drift entre seed y scanner)
//   - Cero deps adicionales (MediaPipe ya en bundle)
//   - Visual: el operador ve qué imágenes carga + verifica calidad
//   - Fácil re-correr cuando se actualiza un poster
//
// Uso:
//   1. Operador coloca los .jpg de referencia en public/posters/
//      (ver public/posters/README.md para el spec)
//   2. Abre http://localhost:5173/dev/poster-seeder (o el equivalente
//      en staging — gated a rol admin en prod)
//   3. Click "Generar embeddings" → la página itera POSTER_CATALOG_RAW
//      cargando cada referenceImageUrl, computando su embedding via
//      el matcher singleton, mostrando preview + similarity-to-self check
//   4. Click "Descargar posterEmbeddings.generated.ts" → bajada con el
//      contenido exacto que reemplaza al archivo existente
//   5. Operador commitea el archivo regenerado al repo, deploys → el
//      scanner pasa a 0/N → N/N matcheables sin más cambios

import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Download,
  Play,
  AlertCircle,
  CheckCircle2,
  ImageIcon,
  Loader2,
} from 'lucide-react';
import { PremiumFeatureGuard } from '../components/shared/PremiumFeatureGuard';
import { Card, Button } from '../components/shared/Card';
import {
  POSTER_CATALOG_SEED,
  cosineSimilarity,
  type PosterDefinition,
} from '../services/ar/posterCatalog';
import {
  getPosterMatcher,
  closePosterMatcher,
} from '../services/ar/posterMatcher';
import { logger } from '../utils/logger';

/**
 * Status del proceso de seeding para un poster individual.
 */
interface SeedProgress {
  posterId: string;
  status: 'pending' | 'loading_image' | 'computing' | 'done' | 'failed';
  embeddingLength?: number;
  /** Cosine similarity contra sí mismo (debería ser ~1.0). Sanity check. */
  selfSimilarity?: number;
  errorMessage?: string;
  embedding?: number[];
}

function statusBadge(status: SeedProgress['status']): string {
  switch (status) {
    case 'pending':
      return 'bg-zinc-700 text-zinc-300';
    case 'loading_image':
      return 'bg-blue-700 text-blue-100';
    case 'computing':
      return 'bg-amber-700 text-amber-100';
    case 'done':
      return 'bg-emerald-700 text-emerald-100';
    case 'failed':
      return 'bg-rose-700 text-rose-100';
  }
}

function statusLabel(status: SeedProgress['status']): string {
  switch (status) {
    case 'pending':
      return 'Pendiente';
    case 'loading_image':
      return 'Cargando imagen…';
    case 'computing':
      return 'Computando embedding…';
    case 'done':
      return 'OK';
    case 'failed':
      return 'Falló';
  }
}

/**
 * Carga una imagen URL → HTMLImageElement decoded, listo para
 * MediaPipe embedder. Resuelve cuando la imagen está fully loaded.
 */
async function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`No pudimos cargar la imagen ${url}`));
    img.src = url;
  });
}

/**
 * Renderiza el contenido del archivo posterEmbeddings.generated.ts
 * con los embeddings calculados. El operador descarga este archivo y
 * lo commitea al repo reemplazando el placeholder vacío.
 */
function renderGeneratedFile(
  results: Map<string, number[]>,
  generatedAtIso: string,
): string {
  const header = `// SPDX-License-Identifier: MIT
//
// Poster Embeddings — pre-computados offline vía la página
// /dev/poster-seeder usando @mediapipe/tasks-vision ImageEmbedder
// (MobileNetV3 small, l2Normalize=true).
//
// Generado: ${generatedAtIso}
//
// IMPORTANTE: este archivo NO contiene secretos — los embeddings son
// vectores numéricos no-invertibles. Es seguro commitearlo al repo.
//
// Para regenerar (cuando un poster cambia o el modelo se actualiza):
//   1. Actualizar public/posters/<id>.jpg con la nueva imagen
//   2. Abrir /dev/poster-seeder en el browser (gated admin)
//   3. Click "Generar embeddings" → "Descargar"
//   4. Reemplazar este archivo con el descargado y commitear.

`;
  const entries: string[] = [];
  for (const [id, emb] of results.entries()) {
    const formatted = emb
      .map((v) => v.toFixed(6))
      .reduce<string[]>((acc, val, idx) => {
        const lineIdx = Math.floor(idx / 8);
        acc[lineIdx] = acc[lineIdx] ? `${acc[lineIdx]}, ${val}` : `    ${val}`;
        return acc;
      }, [])
      .join(',\n');
    entries.push(`  '${id}': [\n${formatted}\n  ],`);
  }
  const body = `export const POSTER_EMBEDDINGS: Readonly<Record<string, readonly number[]>> = {
${entries.join('\n')}
};
`;
  return header + body;
}

export function DevPosterSeeder() {
  const { t } = useTranslation();
  const [progress, setProgress] = useState<SeedProgress[]>(() =>
    POSTER_CATALOG_SEED.map((p) => ({ posterId: p.id, status: 'pending' as const })),
  );
  const [running, setRunning] = useState(false);
  const [downloadable, setDownloadable] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const updateProgress = useCallback(
    (posterId: string, patch: Partial<SeedProgress>) => {
      setProgress((prev) =>
        prev.map((p) => (p.posterId === posterId ? { ...p, ...patch } : p)),
      );
    },
    [],
  );

  const runSeeder = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setGlobalError(null);
    setDownloadable(null);

    // Limpia el singleton para garantizar que init() corra fresco.
    closePosterMatcher();
    const matcher = getPosterMatcher({
      thresholdSimilarity: 0.85,
      runningMode: 'IMAGE',
    });

    try {
      await matcher.init();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setGlobalError(`No pudimos inicializar el matcher: ${msg}`);
      setRunning(false);
      return;
    }

    const successful = new Map<string, number[]>();

    for (const poster of POSTER_CATALOG_SEED) {
      updateProgress(poster.id, { status: 'loading_image' });
      try {
        const img = await loadImageElement(poster.referenceImageUrl);
        updateProgress(poster.id, { status: 'computing' });
        const embedding = await matcher.computeEmbedding(img);
        // Sanity check: cos(self, self) debería ser ~1.0
        const selfSim = cosineSimilarity(embedding, embedding);
        successful.set(poster.id, embedding);
        updateProgress(poster.id, {
          status: 'done',
          embedding,
          embeddingLength: embedding.length,
          selfSimilarity: selfSim,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn('poster_seed_failed', { id: poster.id, err: msg });
        updateProgress(poster.id, { status: 'failed', errorMessage: msg });
      }
    }

    if (successful.size > 0) {
      const content = renderGeneratedFile(successful, new Date().toISOString());
      setDownloadable(content);
    } else {
      setGlobalError(
        'Ningún poster pudo procesarse. Verifica que public/posters/*.jpg existan.',
      );
    }
    setRunning(false);
  }, [running, updateProgress]);

  const handleDownload = useCallback(() => {
    if (!downloadable) return;
    const blob = new Blob([downloadable], { type: 'text/typescript;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'posterEmbeddings.generated.ts';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [downloadable]);

  const successCount = progress.filter((p) => p.status === 'done').length;
  const failureCount = progress.filter((p) => p.status === 'failed').length;
  const pendingCount = progress.filter((p) => p.status === 'pending').length;

  return (
    <PremiumFeatureGuard
      featureName={t('devPosterSeeder.guard.featureName', 'Dev: Poster Seeder')}
      description={t(
        'devPosterSeeder.guard.description',
        'Herramienta admin para generar embeddings de referencia de los afiches de seguridad. Solo uso de dev/admin.',
      )}
    >
      <div className="p-4 lg:p-8 space-y-6 max-w-4xl mx-auto">
        <header>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white flex items-center gap-2">
            <ImageIcon className="w-6 h-6 text-teal-500" />
            Generador de embeddings de afiches
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            Procesa los <code className="bg-zinc-800 px-1 py-0.5 rounded text-xs">{POSTER_CATALOG_SEED.length}</code> posters del
            catálogo SEED usando la misma MediaPipe ImageEmbedder que el
            scanner runtime. Genera un archivo descargable que reemplaza{' '}
            <code className="bg-zinc-800 px-1 py-0.5 rounded text-xs">posterEmbeddings.generated.ts</code>{' '}
            en el repo.
          </p>
        </header>

        <Card className="p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-zinc-300">
                <strong className="text-teal-400">{successCount}</strong> OK ·{' '}
                <strong className="text-rose-400">{failureCount}</strong> fallaron ·{' '}
                <strong className="text-zinc-400">{pendingCount}</strong> pendientes
              </p>
              {successCount > 0 && (
                <p className="text-[10px] text-zinc-500 mt-1">
                  Sanity check: cada self-similarity debería estar muy cerca de 1.0.
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                onClick={runSeeder}
                disabled={running}
                className="bg-teal-600 hover:bg-teal-500 flex items-center gap-2"
              >
                {running ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Procesando…
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4" />
                    Generar embeddings
                  </>
                )}
              </Button>
              <Button
                variant="secondary"
                onClick={handleDownload}
                disabled={!downloadable}
                className="flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                Descargar .ts
              </Button>
            </div>
          </div>

          {globalError && (
            <div className="mt-3 bg-rose-900/50 border border-rose-500/30 rounded-lg p-3 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-300 shrink-0 mt-0.5" />
              <p className="text-xs text-rose-200">{globalError}</p>
            </div>
          )}
        </Card>

        <Card className="p-0 overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-zinc-900">
              <tr>
                <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider text-zinc-500">
                  ID
                </th>
                <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider text-zinc-500">
                  Título
                </th>
                <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider text-zinc-500">
                  Estado
                </th>
                <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider text-zinc-500">
                  Dim
                </th>
                <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider text-zinc-500">
                  Self-sim
                </th>
              </tr>
            </thead>
            <tbody>
              {progress.map((p, idx) => {
                const poster: PosterDefinition | undefined = POSTER_CATALOG_SEED.find(
                  (c) => c.id === p.posterId,
                );
                return (
                  <tr
                    key={p.posterId}
                    className={`border-t border-zinc-800 ${idx % 2 === 0 ? '' : 'bg-zinc-950/50'}`}
                  >
                    <td className="px-3 py-2 font-mono text-[10px] text-zinc-400">
                      {p.posterId}
                    </td>
                    <td className="px-3 py-2 text-zinc-200">{poster?.title ?? '—'}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${statusBadge(p.status)}`}
                      >
                        {p.status === 'done' && <CheckCircle2 className="w-3 h-3 inline mr-1" />}
                        {statusLabel(p.status)}
                      </span>
                      {p.errorMessage && (
                        <p className="text-[10px] text-rose-300 mt-1">{p.errorMessage}</p>
                      )}
                    </td>
                    <td className="px-3 py-2 text-zinc-400 font-mono">
                      {p.embeddingLength ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-zinc-400 font-mono">
                      {p.selfSimilarity !== undefined ? p.selfSimilarity.toFixed(4) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>

        <Card className="p-4 bg-zinc-900/50 border-zinc-700/40">
          <h3 className="text-sm font-bold text-zinc-300 mb-2">Próximos pasos</h3>
          <ol className="text-xs text-zinc-400 space-y-1 list-decimal list-inside">
            <li>
              Coloca las imágenes en <code className="bg-zinc-800 px-1 rounded">public/posters/</code> (ver
              <code className="bg-zinc-800 px-1 rounded ml-1">README.md</code> para spec)
            </li>
            <li>Click <strong>Generar embeddings</strong> y espera a que todos cierren en OK</li>
            <li>Click <strong>Descargar .ts</strong> y guarda el archivo</li>
            <li>
              Reemplaza{' '}
              <code className="bg-zinc-800 px-1 rounded">
                src/services/ar/posterEmbeddings.generated.ts
              </code>{' '}
              en el repo con el descargado
            </li>
            <li>Commit + push + deploy → el scanner pasa a N/N matcheables</li>
          </ol>
        </Card>
      </div>
    </PremiumFeatureGuard>
  );
}
