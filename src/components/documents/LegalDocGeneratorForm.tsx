// Praeventio Guard — Wire UI #83: <LegalDocGeneratorForm />
//
// Form para generar documentos legales desde plantilla. Selección
// de tipo, inputs requeridos, preview del markdown rendered, callback
// onGenerate con el resultado para que el caller produzca el PDF y
// suba a Storage / nodo DOCUMENT.

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Eye, AlertCircle } from 'lucide-react';
import {
  TEMPLATES,
  renderLegalDoc,
  listTemplates,
  type LegalDocTemplateKind,
  type RenderResult,
} from '../../services/documents/legalDocTemplates.js';

interface LegalDocGeneratorFormProps {
  initialKind?: LegalDocTemplateKind;
  onGenerate?: (kind: LegalDocTemplateKind, result: RenderResult) => void;
}

export function LegalDocGeneratorForm({
  initialKind = 'RIOHS',
  onGenerate,
}: LegalDocGeneratorFormProps) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<LegalDocTemplateKind>(initialKind);
  const [data, setData] = useState<Record<string, string>>({});

  const templates = useMemo(() => listTemplates(), []);
  const template = TEMPLATES[kind];
  const result = useMemo(() => renderLegalDoc({ kind, data }), [kind, data]);

  function setToken(token: string, value: string) {
    setData((prev) => ({ ...prev, [token]: value }));
  }

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-4"
      data-testid="legaldoc-form"
      aria-label={t('legalDoc.aria', 'Generador documentos legales') as string}
    >
      <header className="flex items-center gap-2">
        <FileText className="w-4 h-4 text-sky-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('legalDoc.title', 'Documentos legales')}
        </h2>
      </header>

      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase text-secondary-token">
          {t('legalDoc.kind', 'Tipo de documento')}
        </span>
        <select
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as LegalDocTemplateKind);
            setData({});
          }}
          data-testid="legaldoc-kind"
          className="text-xs rounded border border-default-token bg-surface px-2 py-1"
        >
          {templates.map((m) => (
            <option key={m.kind} value={m.kind}>
              {m.title}
            </option>
          ))}
        </select>
      </label>

      <div className="space-y-2" data-testid="legaldoc-required-fields">
        <h3 className="text-[10px] uppercase font-bold text-secondary-token">
          {t('legalDoc.required', 'Campos requeridos')}
        </h3>
        {template.requiredTokens.map((tok) => (
          <label key={tok} className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase text-secondary-token">{tok}</span>
            <input
              type="text"
              value={data[tok] ?? ''}
              onChange={(e) => setToken(tok, e.target.value)}
              data-testid={`legaldoc-field-${tok}`}
              className="text-xs rounded border border-default-token bg-surface px-2 py-1"
              aria-label={tok}
            />
          </label>
        ))}
      </div>

      <details data-testid="legaldoc-optional-fields">
        <summary className="text-[10px] uppercase font-bold text-secondary-token cursor-pointer">
          {t('legalDoc.optional', 'Campos opcionales')}
        </summary>
        <div className="mt-2 space-y-2">
          {Object.keys(template.optionalTokens).map((tok) => (
            <label key={tok} className="flex flex-col gap-0.5">
              <span className="text-[10px] uppercase text-secondary-token">{tok}</span>
              <input
                type="text"
                value={data[tok] ?? ''}
                onChange={(e) => setToken(tok, e.target.value)}
                placeholder={template.optionalTokens[tok]}
                data-testid={`legaldoc-optional-${tok}`}
                className="text-xs rounded border border-default-token bg-surface px-2 py-1"
                aria-label={tok}
              />
            </label>
          ))}
        </div>
      </details>

      {!result.ok && result.missingTokens && result.missingTokens.length > 0 && (
        <div
          className="flex items-start gap-2 bg-amber-500/10 text-amber-700 dark:text-amber-300 p-2 rounded text-[11px]"
          data-testid="legaldoc-missing-warning"
        >
          <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            {t('legalDoc.missingTokens', 'Faltan campos')}:{' '}
            {result.missingTokens.join(', ')}
          </span>
        </div>
      )}

      <details data-testid="legaldoc-preview" open={result.ok}>
        <summary className="flex items-center gap-1 text-[10px] uppercase font-bold text-secondary-token cursor-pointer">
          <Eye className="w-3 h-3" aria-hidden="true" />
          {t('legalDoc.preview', 'Previsualización markdown')}
        </summary>
        <pre
          className="mt-2 text-[10px] whitespace-pre-wrap bg-surface-elevated rounded p-2 max-h-80 overflow-y-auto"
          data-testid="legaldoc-markdown"
        >
          {result.markdown ?? `(faltan datos para renderizar)`}
        </pre>
      </details>

      <div
        className="text-[10px] text-secondary-token"
        data-testid="legaldoc-references"
      >
        {t('legalDoc.references', 'Referencias normativas')}:{' '}
        {template.legalReferences.join(' · ')}
      </div>

      <button
        type="button"
        disabled={!result.ok}
        onClick={() => result.ok && onGenerate?.(kind, result)}
        data-testid="legaldoc-generate-btn"
        className="w-full px-3 py-1.5 rounded bg-sky-500 text-white text-xs font-bold hover:bg-sky-600 disabled:opacity-50"
      >
        {t('legalDoc.generate', 'Generar PDF')}
      </button>
    </section>
  );
}
