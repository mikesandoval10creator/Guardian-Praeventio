// Praeventio Guard — Wire UI S45: <PortableHistoryPreview />
//
// Vista previa del export portable de historia profesional del
// trabajador (ADR 0012). NUNCA diagnostica — sólo muestra qué se
// incluirá en el archivo serializado. El padre llama a
// `buildPortableHistory` + `serializeAsJson` y pasa los resultados
// como props.

import { Briefcase, ShieldCheck, FileDown, Lock } from 'lucide-react';
import type {
  PortableWorkerHistory,
  SerializedExport,
} from '../../services/workerHistory/portableHistoryExporter.js';

interface PortableHistoryPreviewProps {
  history: PortableWorkerHistory;
  /** Export serializado (JSON o Markdown) ya generado. */
  serialized: SerializedExport;
  /** Callback opcional para descargar el blob. */
  onDownload?: () => void;
}

const LEVEL_TONE: Record<PortableWorkerHistory['redactionLevel'], string> = {
  public: 'bg-teal-50 text-teal-700 border-teal-200',
  employer: 'bg-amber-50 text-amber-700 border-amber-200',
  medical: 'bg-rose-50 text-rose-700 border-rose-200',
};

export function PortableHistoryPreview({
  history,
  serialized,
  onDownload,
}: PortableHistoryPreviewProps) {
  const tone = LEVEL_TONE[history.redactionLevel];

  return (
    <section
      className={`rounded-2xl border p-4 space-y-3 ${tone}`}
      data-testid="workerHistory.preview"
      aria-label="Vista previa de historia profesional portable"
    >
      <header className="flex items-center gap-2">
        <Briefcase className="w-4 h-4" aria-hidden="true" />
        <h2 className="text-sm font-black uppercase tracking-wide">
          Historia profesional portable
        </h2>
        <span
          className="ml-auto text-[10px] uppercase font-bold flex items-center gap-1"
          data-testid="workerHistory.redactionLevel"
        >
          <Lock className="w-3 h-3" aria-hidden="true" />
          {history.redactionLevel}
        </span>
      </header>

      <div className="text-xs space-y-1">
        <p>
          <strong data-testid="workerHistory.fullName">
            {history.identity.fullName}
          </strong>
          {history.identity.birthYear ? ` · n.${history.identity.birthYear}` : ''}
        </p>
        <p className="font-mono text-[10px] opacity-70" data-testid="workerHistory.rutHash">
          RUT hash: {history.identity.rutHash.slice(0, 16)}…
        </p>
      </div>

      <dl
        className="grid grid-cols-3 gap-2 text-[11px] text-center"
        data-testid="workerHistory.counts"
      >
        <div data-testid="workerHistory.count.employments">
          <dt className="opacity-70">Empleos</dt>
          <dd className="font-black tabular-nums">
            {history.employmentSpans.length}
          </dd>
        </div>
        <div data-testid="workerHistory.count.trainings">
          <dt className="opacity-70">Cursos</dt>
          <dd className="font-black tabular-nums">
            {history.completedTrainings.length}
          </dd>
        </div>
        <div data-testid="workerHistory.count.certifications">
          <dt className="opacity-70">Certificaciones</dt>
          <dd className="font-black tabular-nums">
            {history.certifications.length}
          </dd>
        </div>
      </dl>

      {history.includesMedical && (
        <p
          className="text-[10px] font-bold uppercase flex items-center gap-1"
          data-testid="workerHistory.medicalFlag"
        >
          <ShieldCheck className="w-3 h-3" aria-hidden="true" />
          Incluye contexto médico (consentimiento explícito)
        </p>
      )}

      <p className="text-[10px] opacity-70 italic">{history.disclaimer}</p>

      <footer className="flex items-center gap-2 text-[10px]">
        <span
          className="font-mono opacity-70"
          data-testid="workerHistory.checksum"
        >
          {serialized.contentType} · {serialized.checksum.slice(0, 12)}…
        </span>
        {onDownload && (
          <button
            type="button"
            onClick={onDownload}
            data-testid="workerHistory.downloadBtn"
            className="ml-auto px-3 py-1 rounded-lg bg-white/80 text-xs font-bold border border-current hover:bg-white flex items-center gap-1"
          >
            <FileDown className="w-3 h-3" aria-hidden="true" />
            Descargar
          </button>
        )}
      </footer>
    </section>
  );
}
