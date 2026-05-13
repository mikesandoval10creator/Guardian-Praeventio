// Praeventio Guard — Wire UI S44: <PhotoEvidenceCard />
//
// Tarjeta presentacional para un artifact de evidencia fotográfica. El
// padre construye el artifact vía buildArtifact y lo pasa como prop.

import { Camera, Link2, MapPin, Fingerprint } from 'lucide-react';
import type { EvidenceArtifact } from '../../services/photoEvidence/photoEvidenceEngine.js';

interface PhotoEvidenceCardProps {
  artifact: EvidenceArtifact;
}

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export function PhotoEvidenceCard({ artifact }: PhotoEvidenceCardProps) {
  const shortHash = artifact.id.slice(0, 12);
  return (
    <section
      className="rounded-2xl border border-teal-200 bg-teal-50 text-teal-700 p-4 space-y-2"
      data-testid="photoEvidence.card"
      aria-label="Evidencia fotográfica"
    >
      <header className="flex items-center gap-2">
        <Camera className="w-4 h-4" aria-hidden="true" />
        <h2 className="text-sm font-bold" data-testid="photoEvidence.card.title">
          {artifact.originalFilename}
        </h2>
        <span
          className="ml-auto text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-white/60"
          data-testid="photoEvidence.card.mime"
        >
          {artifact.mimeType}
        </span>
      </header>

      <dl className="grid grid-cols-2 gap-2 text-[11px]">
        <div>
          <dt className="uppercase text-slate-500">Tamaño</dt>
          <dd className="font-bold" data-testid="photoEvidence.card.size">
            {formatBytes(artifact.byteSize)}
          </dd>
        </div>
        <div>
          <dt className="uppercase text-slate-500">Capturada</dt>
          <dd data-testid="photoEvidence.card.capturedAt">
            {new Date(artifact.capturedAt).toLocaleString()}
          </dd>
        </div>
      </dl>

      <p
        className="flex items-center gap-1 text-[11px] font-mono"
        data-testid="photoEvidence.card.hash"
      >
        <Fingerprint className="w-3 h-3" aria-hidden="true" />
        {shortHash}…
      </p>

      {artifact.capturedLocation && (
        <p
          className="flex items-center gap-1 text-[11px]"
          data-testid="photoEvidence.card.location"
        >
          <MapPin className="w-3 h-3" aria-hidden="true" />
          {artifact.capturedLocation.lat.toFixed(4)},{' '}
          {artifact.capturedLocation.lng.toFixed(4)}
        </p>
      )}

      {artifact.linkages.length > 0 && (
        <div
          className="rounded bg-white/70 border border-current/20 p-2 text-[11px] space-y-1"
          data-testid="photoEvidence.card.linkages"
        >
          <div className="flex items-center gap-1 font-bold uppercase">
            <Link2 className="w-3 h-3" aria-hidden="true" />
            Vinculada a {artifact.linkages.length}
          </div>
          <ul>
            {artifact.linkages.slice(0, 3).map((l, i) => (
              <li key={i}>
                {l.nodeKind} · {l.nodeId}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
