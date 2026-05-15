// Praeventio Guard — Renderizado inmutable real (jsPDF + SHA-256).
//
// Antes era `setTimeout(3000)` simulando "Puppeteer rendering delay"
// sin generar nada. AHORA genera un PDF real con jsPDF, calcula
// SHA-256 sobre los bytes, y permite verificar la integridad al subir
// el PDF de vuelta.
//
// El SHA-256 actúa como content-addressed identifier: si el PDF cambia
// un solo byte, el hash es distinto. El usuario puede:
//   1. Generar el PDF (descarga + hash visible)
//   2. Re-subir el PDF para verificar contra el hash conocido
//   3. Compartir el hash con un auditor que verifica offline
//
// Esto NO es firma digital (eso requiere PKI infra que NO existe en
// el repo todavía). Pero SÍ es prueba de integridad criptográfica
// real — si el PDF se modifica, el hash cambia y la verificación falla.

import React, { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import {
  Printer,
  ShieldAlert,
  FileText,
  Download,
  CheckCircle2,
  AlertTriangle,
  FileCheck,
  Lock,
  Upload,
  X,
  Loader2,
  RefreshCcw,
} from 'lucide-react';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { Card, Button } from '../components/shared/Card';
import { PremiumFeatureGuard } from '../components/shared/PremiumFeatureGuard';
import {
  buildImmutablePdf,
  downloadImmutablePdf,
  formatHashForDisplay,
  verifyImmutablePdf,
  type ImmutablePdfArtifact,
  type ImmutablePdfKind,
} from '../services/immutable/pdfImmutableService';
import { useFirebase } from '../contexts/FirebaseContext';

interface VerificationOutcome {
  valid: boolean;
  filename: string;
  actualHash: string;
  expectedHash: string;
  sizeBytes: number;
}

const DOC_TEMPLATES: Array<{
  kind: ImmutablePdfKind;
  title: string;
  description: string;
}> = [
  {
    kind: 'audit_report',
    title: 'Reporte de auditoría',
    description: 'Hallazgos + estado + acciones correctivas. Útil para fiscalización.',
  },
  {
    kind: 'incident_summary',
    title: 'Resumen de incidente',
    description: 'Cronología + involucrados + causa raíz + plan preventivo.',
  },
  {
    kind: 'compliance_certificate',
    title: 'Certificado de cumplimiento',
    description: 'Sello de auditor con hash verificable.',
  },
  {
    kind: 'inspection_log',
    title: 'Registro de inspección',
    description: 'Checklist completo + evidencia + firmas.',
  },
  {
    kind: 'training_record',
    title: 'Registro de capacitación',
    description: 'Asistentes + temario + evaluación + fecha vigencia.',
  },
];

export function ImmutableRender() {
  const { t } = useTranslation();
  const { user } = useFirebase();
  const [selectedKind, setSelectedKind] =
    useState<ImmutablePdfKind>('audit_report');
  const [docTitle, setDocTitle] = useState('Reporte de auditoría — Túnel 4');
  const [docSubtitle, setDocSubtitle] = useState('Q2 2026 · Sector NW');
  const [isRendering, setIsRendering] = useState(false);
  const [renderedArtifact, setRenderedArtifact] =
    useState<ImmutablePdfArtifact | null>(null);
  const [verifyOutcome, setVerifyOutcome] =
    useState<VerificationOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleRender = useCallback(async () => {
    setError(null);
    setIsRendering(true);
    try {
      const artifact = await buildImmutablePdf({
        kind: selectedKind,
        title: docTitle.trim(),
        subtitle: docSubtitle.trim() || undefined,
        authorUid: user?.uid ?? 'anonymous',
        authorName: user?.displayName ?? user?.email ?? undefined,
        createdAtIso: new Date().toISOString(),
        tenantId: 'demo-tenant', // En productivo viene del contexto Project/Tenant
        sections: [
          {
            heading: 'Resumen ejecutivo',
            paragraphs: [
              `Documento generado el ${new Date().toLocaleString()} por ${
                user?.email ?? 'usuario anónimo'
              }.`,
              'Este PDF tiene un hash SHA-256 único calculado sobre todos sus bytes. Cualquier modificación posterior (un solo byte cambiado) hace que la verificación falle.',
            ],
          },
          {
            heading: 'Hallazgos',
            paragraphs: [
              'Inspección visual identificó 3 puntos de atención que requieren plan correctivo.',
            ],
            tables: [
              {
                headers: ['ID', 'Hallazgo', 'Severidad', 'Estado'],
                rows: [
                  ['H-001', 'Iluminación insuficiente nivel 4', 'Media', 'Abierto'],
                  ['H-002', 'Señalización vía evacuación desgastada', 'Baja', 'Asignado'],
                  ['H-003', 'Extintor sector NW vencido', 'Alta', 'En reposición'],
                ],
              },
            ],
          },
          {
            heading: 'Acciones preventivas',
            paragraphs: [
              '1. Reemplazar luminaria sector A4-12 (responsable: J. Pérez, plazo: 7 días).',
              '2. Renovar señalética vía 3 (responsable: M. Soto, plazo: 14 días).',
              '3. Reposición extintor — orden de compra emitida (plazo: 3 días).',
            ],
          },
        ],
      });
      setRenderedArtifact(artifact);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRendering(false);
    }
  }, [selectedKind, docTitle, docSubtitle, user]);

  const handleDownload = useCallback(() => {
    if (renderedArtifact) {
      downloadImmutablePdf(renderedArtifact);
    }
  }, [renderedArtifact]);

  const handleVerify = useCallback(async () => {
    if (!renderedArtifact) return;
    setError(null);
    setVerifyOutcome(null);
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError('Selecciona un archivo PDF para verificar.');
      return;
    }
    try {
      const buffer = await file.arrayBuffer();
      const uploadedBytes = new Uint8Array(buffer);
      const uploadedHash = bytesToHex(sha256(uploadedBytes));
      const result = verifyImmutablePdf(
        uploadedBytes,
        renderedArtifact.contentHashHex,
      );
      setVerifyOutcome({
        valid: result.valid,
        filename: file.name,
        actualHash: uploadedHash,
        expectedHash: renderedArtifact.contentHashHex,
        sizeBytes: uploadedBytes.length,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [renderedArtifact]);

  const reset = useCallback(() => {
    setRenderedArtifact(null);
    setVerifyOutcome(null);
    setError(null);
  }, []);

  return (
    <PremiumFeatureGuard
      feature="canUseCustomBranding"
      featureName={t('immutableRender.featureName', 'Renderizado Inmutable') as string}
      description={
        t(
          'immutableRender.featureDesc',
          'Genera PDFs con hash SHA-256 verificable. Disponible desde el plan Diamante.',
        ) as string
      }
    >
      <div
        data-testid="immutable-render-page"
        className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-6"
      >
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white uppercase tracking-tighter leading-tight flex items-center gap-3">
              <Printer
                className="w-8 h-8 text-fuchsia-500"
                aria-hidden="true"
              />
              {t('immutableRender.title', 'Renderizado inmutable')}
            </h1>
            <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
              {t(
                'immutableRender.subtitle',
                'jsPDF + SHA-256 content addressing',
              )}
            </p>
          </div>
          <div className="px-4 py-2 rounded-xl border flex items-center gap-2 text-fuchsia-500 bg-fuchsia-500/10 border-fuchsia-500/20">
            <Lock className="w-5 h-5" aria-hidden="true" />
            <span className="font-bold uppercase tracking-wider text-sm">
              {t('immutableRender.tierBadge', 'SHA-256 real')}
            </span>
          </div>
        </header>

        {error && (
          <div
            data-testid="immutable-error"
            role="alert"
            className="rounded-lg border border-rose-500/40 bg-rose-500/5 p-3 flex items-start gap-2"
          >
            <AlertTriangle
              className="w-4 h-4 text-rose-400 shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <p className="text-xs text-rose-300 font-mono">{error}</p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Generation panel */}
          <Card className="p-6 border-white/5 space-y-4">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <FileCheck
                className="w-5 h-5 text-fuchsia-500"
                aria-hidden="true"
              />
              {t('immutableRender.generateSection', 'Generar documento')}
            </h2>

            <div>
              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider block mb-2">
                {t('immutableRender.kindLabel', 'Tipo de documento')}
              </label>
              <div
                className="grid grid-cols-1 gap-2"
                data-testid="immutable-doc-kinds"
              >
                {DOC_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.kind}
                    type="button"
                    onClick={() => setSelectedKind(tpl.kind)}
                    data-testid={`immutable-kind-${tpl.kind}`}
                    data-selected={selectedKind === tpl.kind ? 'true' : 'false'}
                    className={`p-3 rounded-lg border-2 text-left transition-colors ${
                      selectedKind === tpl.kind
                        ? 'border-fuchsia-500/40 bg-fuchsia-500/5'
                        : 'border-zinc-800 bg-zinc-900/50 hover:border-zinc-700'
                    }`}
                  >
                    <p className="text-sm font-bold text-white flex items-center gap-2">
                      <FileText
                        className={`w-4 h-4 ${
                          selectedKind === tpl.kind
                            ? 'text-fuchsia-400'
                            : 'text-zinc-500'
                        }`}
                        aria-hidden="true"
                      />
                      {tpl.title}
                    </p>
                    <p className="text-[11px] text-zinc-400 mt-0.5 ml-6">
                      {tpl.description}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider block mb-1">
                {t('immutableRender.titleLabel', 'Título')}
              </label>
              <input
                type="text"
                value={docTitle}
                onChange={(e) => setDocTitle(e.target.value)}
                data-testid="immutable-title-input"
                className="w-full px-3 py-2 rounded-md border border-white/10 bg-zinc-900 text-white text-sm focus:outline-none focus:ring-2 focus:ring-fuchsia-500/40"
              />
            </div>

            <div>
              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider block mb-1">
                {t('immutableRender.subtitleLabel', 'Subtítulo (opcional)')}
              </label>
              <input
                type="text"
                value={docSubtitle}
                onChange={(e) => setDocSubtitle(e.target.value)}
                data-testid="immutable-subtitle-input"
                className="w-full px-3 py-2 rounded-md border border-white/10 bg-zinc-900 text-white text-sm focus:outline-none focus:ring-2 focus:ring-fuchsia-500/40"
              />
            </div>

            <Button
              onClick={() => void handleRender()}
              disabled={isRendering || docTitle.trim().length === 0}
              className="w-full"
              data-testid="immutable-render-btn"
            >
              {isRendering ? (
                <>
                  <Loader2
                    className="w-4 h-4 animate-spin mr-2"
                    aria-hidden="true"
                  />
                  {t('immutableRender.rendering', 'Generando PDF…')}
                </>
              ) : (
                <>
                  <Printer className="w-4 h-4 mr-2" aria-hidden="true" />
                  {t('immutableRender.generate', 'Generar PDF + Hash')}
                </>
              )}
            </Button>
          </Card>

          {/* Output panel */}
          <Card className="p-6 border-white/5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <ShieldAlert
                  className="w-5 h-5 text-fuchsia-500"
                  aria-hidden="true"
                />
                {t('immutableRender.artifactSection', 'Artifact generado')}
              </h2>
              {renderedArtifact && (
                <button
                  onClick={reset}
                  data-testid="immutable-reset"
                  className="text-zinc-500 hover:text-white"
                  aria-label="Limpiar"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              )}
            </div>

            {!renderedArtifact && !isRendering && (
              <div className="h-64 flex flex-col items-center justify-center text-center border border-dashed border-zinc-800 rounded-xl bg-zinc-900/30 gap-2">
                <FileText
                  className="w-10 h-10 text-zinc-700"
                  aria-hidden="true"
                />
                <p className="text-sm text-zinc-500">
                  {t(
                    'immutableRender.empty',
                    'Genera un documento para ver su hash + descarga.',
                  )}
                </p>
              </div>
            )}

            {renderedArtifact && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-3"
              >
                <div className="p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/30">
                  <div className="flex items-start gap-3">
                    <CheckCircle2
                      className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5"
                      aria-hidden="true"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-emerald-200">
                        {t(
                          'immutableRender.success',
                          'PDF generado con hash criptográfico',
                        )}
                      </p>
                      <p
                        className="text-[11px] text-emerald-300/80 mt-1"
                        data-testid="immutable-filename"
                      >
                        {renderedArtifact.filename}
                      </p>
                      <p
                        className="text-[10px] text-emerald-400/60 mt-0.5"
                        data-testid="immutable-size"
                      >
                        {(renderedArtifact.sizeBytes / 1024).toFixed(1)} KB
                      </p>
                    </div>
                  </div>
                </div>

                <div>
                  <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">
                    SHA-256
                  </p>
                  <div className="p-2.5 rounded-md bg-zinc-950 border border-zinc-800">
                    <code
                      data-testid="immutable-hash"
                      className="text-[10px] font-mono text-fuchsia-300 break-all leading-relaxed"
                    >
                      {formatHashForDisplay(renderedArtifact.contentHashHex)}
                    </code>
                  </div>
                </div>

                <Button
                  onClick={handleDownload}
                  className="w-full"
                  data-testid="immutable-download"
                >
                  <Download className="w-4 h-4 mr-2" aria-hidden="true" />
                  {t('immutableRender.download', 'Descargar PDF')}
                </Button>
              </motion.div>
            )}
          </Card>
        </div>

        {/* Verify panel */}
        {renderedArtifact && (
          <Card className="p-6 border-white/5 space-y-4">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <FileCheck
                className="w-5 h-5 text-emerald-400"
                aria-hidden="true"
              />
              {t(
                'immutableRender.verifySection',
                'Verificar integridad de un PDF',
              )}
            </h2>
            <p className="text-xs text-zinc-400 leading-relaxed">
              {t(
                'immutableRender.verifyDesc',
                'Sube el PDF generado (o una versión modificada) para comprobar si su SHA-256 coincide con el del artifact original. Si un solo byte cambió, la verificación fallará.',
              )}
            </p>

            <div className="flex flex-col sm:flex-row gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                data-testid="immutable-verify-input"
                onChange={() => setVerifyOutcome(null)}
                className="flex-1 text-xs text-zinc-300 file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:bg-fuchsia-600 file:text-white file:font-bold hover:file:brightness-110"
              />
              <Button
                onClick={() => void handleVerify()}
                data-testid="immutable-verify-btn"
              >
                <Upload className="w-4 h-4 mr-2" aria-hidden="true" />
                {t('immutableRender.verify', 'Verificar')}
              </Button>
            </div>

            {verifyOutcome && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                data-testid="immutable-verify-result"
                data-valid={verifyOutcome.valid ? 'true' : 'false'}
                className={`p-4 rounded-xl border ${
                  verifyOutcome.valid
                    ? 'bg-emerald-500/5 border-emerald-500/30'
                    : 'bg-rose-500/5 border-rose-500/30'
                }`}
              >
                <div className="flex items-start gap-3">
                  {verifyOutcome.valid ? (
                    <CheckCircle2
                      className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5"
                      aria-hidden="true"
                    />
                  ) : (
                    <AlertTriangle
                      className="w-5 h-5 text-rose-400 shrink-0 mt-0.5"
                      aria-hidden="true"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p
                      className={`text-sm font-bold ${
                        verifyOutcome.valid
                          ? 'text-emerald-200'
                          : 'text-rose-200'
                      }`}
                    >
                      {verifyOutcome.valid
                        ? t(
                            'immutableRender.valid',
                            '✓ Integridad verificada: el PDF NO ha sido modificado',
                          )
                        : t(
                            'immutableRender.invalid',
                            '✗ Hash NO coincide: el PDF fue modificado o es uno distinto',
                          )}
                    </p>
                    <div className="mt-2 grid grid-cols-1 gap-1.5 text-[11px]">
                      <div>
                        <span className="text-zinc-500">Archivo:</span>{' '}
                        <code className="font-mono text-zinc-300">
                          {verifyOutcome.filename}
                        </code>
                      </div>
                      <div>
                        <span className="text-zinc-500">Tamaño:</span>{' '}
                        <code className="font-mono text-zinc-300">
                          {(verifyOutcome.sizeBytes / 1024).toFixed(1)} KB
                        </code>
                      </div>
                      <div>
                        <span className="text-zinc-500">Hash esperado:</span>{' '}
                        <code className="font-mono text-emerald-300 break-all">
                          {verifyOutcome.expectedHash.slice(0, 32)}…
                        </code>
                      </div>
                      <div>
                        <span className="text-zinc-500">Hash actual:</span>{' '}
                        <code
                          className={`font-mono break-all ${
                            verifyOutcome.valid
                              ? 'text-emerald-300'
                              : 'text-rose-300'
                          }`}
                        >
                          {verifyOutcome.actualHash.slice(0, 32)}…
                        </code>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </Card>
        )}

        <p className="text-[10px] text-zinc-500 italic text-center">
          {t(
            'immutableRender.standardNote',
            'Generación client-side con jsPDF + SHA-256 (@noble/hashes). El hash criptográfico detecta cualquier modificación a nivel de byte. Para firma digital PKI completa se requiere infraestructura adicional.',
          )}
        </p>
      </div>
    </PremiumFeatureGuard>
  );
}

export default ImmutableRender;
