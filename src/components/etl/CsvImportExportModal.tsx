// SPDX-License-Identifier: MIT
// Sprint 24 — Bucket JJ — Universal CSV import/export modal.
//
// Reuses the visual language of MassImportModal (the workers-only modal
// already shipped) but is entity-agnostic: pass `entityType` and the
// modal looks up the right schema, adapter, and Firestore collection.
//
// Flow:
//   1. Drag-drop OR paste OR pick a .csv file.
//   2. Click "Validar" — preview shows total / OK / errors with row #.
//   3. Click "Confirmar Importación" — bulk-write to Firestore.
//   4. Click "Exportar" — downloads <entityType>-<timestamp>.csv.
//
// We do NOT delete `MassImportModal` here — Bucket KK (onboarding) is
// the right home for that re-wire.

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Upload,
  Download,
  FileSpreadsheet,
  Loader2,
  AlertCircle,
  CheckCircle2,
  FileWarning,
} from 'lucide-react';
import { getAdapter } from '../../services/etl/schemas';
import type {
  EtlEntityType,
  ImportResult,
  ImportRowError,
} from '../../services/etl/csvAdapter';
import { logger } from '../../utils/logger';

interface CsvImportExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  entityType: EtlEntityType;
  projectId: string | null;
  /** Override the Firestore collection name. Defaults to `entityType`. */
  collectionName?: string;
  /** Optional title; defaults to a Spanish label per entity type. */
  title?: string;
}

const ENTITY_LABEL: Record<EtlEntityType, string> = {
  workers: 'Trabajadores',
  findings: 'Hallazgos',
  processes: 'Procesos',
  training: 'Capacitaciones',
  crews: 'Cuadrillas',
  inspections: 'Inspecciones',
};

export function CsvImportExportModal({
  isOpen,
  onClose,
  entityType,
  projectId,
  collectionName,
  title,
}: CsvImportExportModalProps) {
  const adapter = useMemo(() => getAdapter(entityType), [entityType]);
  const [csvText, setCsvText] = useState('');
  const [preview, setPreview] = useState<ImportResult<any> | null>(null);
  const [phase, setPhase] = useState<'input' | 'preview' | 'done' | 'exporting'>('input');
  const [busy, setBusy] = useState(false);
  const [importStats, setImportStats] = useState<{ written: number; failed: number } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const collectionPath = collectionName ?? entityType;
  const label = title ?? ENTITY_LABEL[entityType];

  const reset = useCallback(() => {
    setCsvText('');
    setPreview(null);
    setPhase('input');
    setBusy(false);
    setImportStats(null);
    setExportError(null);
  }, []);

  const close = useCallback(() => {
    reset();
    onClose();
  }, [onClose, reset]);

  const onFileSelected = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setExportError('Solo archivos .csv');
      return;
    }
    const text = await file.text();
    setCsvText(text);
    setExportError(null);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLLabelElement>) => {
      e.preventDefault();
      setDragActive(false);
      const file = e.dataTransfer.files[0];
      if (file) void onFileSelected(file);
    },
    [onFileSelected],
  );

  const validate = useCallback(() => {
    if (!csvText.trim()) return;
    const result = adapter.parse(csvText);
    setPreview(result);
    setPhase('preview');
  }, [adapter, csvText]);

  const confirmImport = useCallback(async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const stats = await adapter.importToFirestore(preview.success, {
        projectId,
        collection: collectionPath,
      });
      setImportStats(stats);
      setPhase('done');
    } catch (err) {
      logger.error('[CsvImportExportModal] importToFirestore failed', { err });
      setImportStats({ written: 0, failed: preview.success.length });
      setPhase('done');
    } finally {
      setBusy(false);
    }
  }, [adapter, preview, projectId, collectionPath]);

  const downloadExport = useCallback(async () => {
    setBusy(true);
    setPhase('exporting');
    setExportError(null);
    try {
      const csv = await adapter.exportFromFirestore({
        projectId,
        collection: collectionPath,
      });
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const a = document.createElement('a');
      a.href = url;
      a.download = `${entityType}-${ts}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setPhase('input');
    } catch (err) {
      logger.error('[CsvImportExportModal] export failed', { err });
      setExportError(`No se pudo exportar: ${(err as Error).message}`);
      setPhase('input');
    } finally {
      setBusy(false);
    }
  }, [adapter, entityType, projectId, collectionPath]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="etl-modal"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
        >
          <div onClick={close} className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
          >
            {/* Header */}
            <div className="p-6 border-b border-zinc-200 dark:border-white/5 flex items-center justify-between bg-gradient-to-r from-teal-500/5 to-transparent shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-teal-500/20 flex items-center justify-center text-teal-600 dark:text-teal-400 shrink-0">
                  <FileSpreadsheet className="w-5 h-5 sm:w-6 sm:h-6" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-black text-zinc-900 dark:text-white uppercase tracking-tight truncate">
                    Importar / Exportar — {label}
                  </h2>
                  <p className="text-[10px] text-zinc-500 dark:text-zinc-400 font-bold uppercase tracking-widest truncate">
                    Pipeline ETL universal · CSV
                  </p>
                </div>
              </div>
              <button
                onClick={close}
                aria-label="Cerrar"
                className="p-2 hover:bg-zinc-100 dark:hover:bg-white/10 rounded-xl transition-colors text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 space-y-4 overflow-y-auto custom-scrollbar flex-1">
              {phase === 'input' && (
                <>
                  <label
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragActive(true);
                    }}
                    onDragLeave={() => setDragActive(false)}
                    onDrop={onDrop}
                    className={`block border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-colors ${
                      dragActive
                        ? 'border-teal-500 bg-teal-500/5'
                        : 'border-zinc-300 dark:border-zinc-700 hover:border-teal-400'
                    }`}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv,text/csv"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void onFileSelected(f);
                      }}
                    />
                    <Upload className="w-8 h-8 mx-auto text-zinc-400 mb-2" />
                    <p className="text-sm font-bold text-zinc-700 dark:text-zinc-300">
                      Arrastra tu CSV aquí o haz clic para seleccionar
                    </p>
                    <p className="text-[10px] text-zinc-500 mt-1">
                      Headers permitidos en español o inglés
                    </p>
                  </label>

                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest ml-1">
                      O pega tu CSV aquí
                    </label>
                    <textarea
                      value={csvText}
                      onChange={(e) => setCsvText(e.target.value)}
                      placeholder="header1,header2,..."
                      className="w-full h-40 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-white/10 rounded-2xl p-4 text-zinc-900 dark:text-zinc-300 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-500/50 transition-all resize-none"
                    />
                  </div>

                  {exportError && (
                    <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-400 text-xs flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{exportError}</span>
                    </div>
                  )}
                </>
              )}

              {phase === 'preview' && preview && (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-zinc-50 dark:bg-zinc-800/50 p-3 rounded-2xl border border-zinc-200 dark:border-white/5 text-center">
                      <p className="text-2xl font-black text-zinc-900 dark:text-white">
                        {preview.total}
                      </p>
                      <p className="text-[10px] font-bold text-zinc-500 uppercase">Total</p>
                    </div>
                    <div className="bg-emerald-50 dark:bg-emerald-500/10 p-3 rounded-2xl border border-emerald-200 dark:border-emerald-500/20 text-center">
                      <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400">
                        {preview.success.length}
                      </p>
                      <p className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase">
                        Válidos
                      </p>
                    </div>
                    <div className="bg-rose-50 dark:bg-rose-500/10 p-3 rounded-2xl border border-rose-200 dark:border-rose-500/20 text-center">
                      <p className="text-2xl font-black text-rose-600 dark:text-rose-400">
                        {preview.errors.length}
                      </p>
                      <p className="text-[10px] font-bold text-rose-700 dark:text-rose-400 uppercase">
                        Errores
                      </p>
                    </div>
                  </div>

                  {preview.errors.length > 0 && (
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      <p className="text-[10px] font-black uppercase text-zinc-500 tracking-widest mb-1 flex items-center gap-2">
                        <FileWarning className="w-3 h-3" /> Errores
                      </p>
                      {preview.errors.map((err: ImportRowError, i: number) => (
                        <div
                          key={i}
                          className="text-xs p-2 rounded-lg bg-rose-500/5 border border-rose-500/20 text-rose-700 dark:text-rose-400"
                        >
                          <span className="font-bold">Fila {err.row}:</span> {err.reason}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {phase === 'done' && importStats && (
                <div className="py-8 text-center space-y-4">
                  <div className="w-16 h-16 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-full flex items-center justify-center mx-auto">
                    <CheckCircle2 className="w-8 h-8 text-emerald-600 dark:text-emerald-500" />
                  </div>
                  <h3 className="text-xl font-black text-zinc-900 dark:text-white uppercase tracking-tighter">
                    Importación finalizada
                  </h3>
                  <div className="grid grid-cols-2 gap-3 max-w-xs mx-auto">
                    <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20">
                      <p className="text-xl font-black text-emerald-600 dark:text-emerald-400">
                        {importStats.written}
                      </p>
                      <p className="text-[10px] font-bold uppercase text-zinc-500">Escritos</p>
                    </div>
                    <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20">
                      <p className="text-xl font-black text-rose-600 dark:text-rose-400">
                        {importStats.failed}
                      </p>
                      <p className="text-[10px] font-bold uppercase text-zinc-500">Fallidos</p>
                    </div>
                  </div>
                </div>
              )}

              {phase === 'exporting' && (
                <div className="py-12 flex flex-col items-center gap-3">
                  <Loader2 className="w-8 h-8 animate-spin text-teal-500" />
                  <p className="text-xs font-bold uppercase tracking-widest text-zinc-500">
                    Exportando…
                  </p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-6 border-t border-zinc-200 dark:border-white/5 bg-zinc-50 dark:bg-zinc-900/50 shrink-0 flex flex-wrap gap-3">
              {phase === 'input' && (
                <>
                  <button
                    onClick={close}
                    className="flex-1 px-4 py-2.5 rounded-xl bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-white font-bold hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors text-sm"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={() => void downloadExport()}
                    disabled={busy}
                    className="px-4 py-2.5 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 font-bold hover:opacity-90 transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-50"
                  >
                    <Download className="w-4 h-4" />
                    Exportar
                  </button>
                  <button
                    onClick={validate}
                    disabled={!csvText.trim()}
                    className="flex-1 px-4 py-2.5 rounded-xl bg-teal-600 text-white font-bold hover:bg-teal-700 transition-all shadow-lg shadow-teal-500/20 disabled:opacity-50 flex items-center justify-center gap-2 text-sm"
                  >
                    <Upload className="w-4 h-4" />
                    Validar CSV
                  </button>
                </>
              )}

              {phase === 'preview' && preview && (
                <>
                  <button
                    onClick={() => setPhase('input')}
                    disabled={busy}
                    className="flex-1 px-4 py-2.5 rounded-xl bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-white font-bold hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors text-sm disabled:opacity-50"
                  >
                    Volver
                  </button>
                  <button
                    onClick={() => void confirmImport()}
                    disabled={busy || preview.success.length === 0}
                    className="flex-1 px-4 py-2.5 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50 flex items-center justify-center gap-2 text-sm"
                  >
                    {busy ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" /> Importando…
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4" /> Confirmar ({preview.success.length})
                      </>
                    )}
                  </button>
                </>
              )}

              {phase === 'done' && (
                <button
                  onClick={close}
                  className="w-full px-4 py-2.5 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-black font-black uppercase tracking-widest text-[10px] hover:opacity-90 transition-colors"
                >
                  Cerrar
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
