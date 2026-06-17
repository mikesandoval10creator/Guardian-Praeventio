import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  FileText, 
  Download, 
  Search, 
  AlertTriangle, 
  CheckCircle2, 
  Clock,
  Building2,
  User,
  Activity,
  HardDrive,
  Loader2,
  ArrowRight
} from 'lucide-react';
import { useRiskEngine } from '../hooks/useRiskEngine';
import { useProject } from '../contexts/ProjectContext';
import { NodeType } from '../types';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { handleFirestoreError, OperationType } from '../services/firebase';
import { logger } from '../utils/logger';
import { legalFormValue } from '../utils/legalFormValue';
import { deriveDriveSaveStatus, type DriveSaveStatus } from '../utils/driveSaveStatus';
import { useTranslation } from 'react-i18next';
// §2.14 P0 SECURITY (cierre Fase C.1, 2026-05-21): el cliente
// SusesoApiClient ya no se importa desde código browser. Razón doble:
//   1. En Vite bundle, `process.env.SUSESO_API_KEY` siempre era undefined
//      → `fromEnv()` retornaba null y el botón "Enviar a SUSESO" no hacía
//      nada en producción (false completeness silenciosa).
//   2. Si alguien renombrara las env a VITE_SUSESO_*, los secretos
//      quedarían en el bundle del cliente accesibles vía DevTools.
//
// Adicional: directiva 2.6 inviolable — Praeventio NO envía DIAT/DIEP a
// SUSESO directamente. La empresa imprime/firma/sube al portal de la
// mutualidad. El flujo correcto vive en src/server/routes/suseso.ts
// (POST /api/suseso/form genera folio + PDF; POST /api/suseso/forms/:id/
// mark-submitted confirma upload manual).
//
// Si se requiere reintroducir un wrap server-side de SusesoApiClient,
// debe respetar la directiva 2.6: solo para mutualidades que ofrezcan
// API push opcional (no automático) + opt-in explícito del tenant.
import { SusesoFormBuilder } from '../components/suseso/SusesoFormBuilder';
import { useFirebase } from '../contexts/FirebaseContext';
import { RegulatoryCitation } from '../components/shared/RegulatoryCitation';

export function SusesoReports() {
  const { t } = useTranslation();
  const { nodes } = useRiskEngine();
  const { selectedProject } = useProject();
  const [activeTab, setActiveTab] = useState<'DIAT' | 'DIEP' | 'ROI'>('DIAT');
  const [selectedIncidentId, setSelectedIncidentId] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState(false);
  const isOnline = useOnlineStatus();

  // Filter incidents for the current project
  const incidents = nodes.filter(n => n.type === NodeType.INCIDENT && (!selectedProject || n.projectId === selectedProject.id));
  const selectedIncident = incidents.find(i => i.id === selectedIncidentId);

  // Official DIAT/DIEP forms must never show a fabricated legal identifier — a
  // valid-format fake RUT on a submitted injury report identifies the WRONG
  // worker. Resolve worker identity honestly; missing values are flagged, not faked.
  const workerName = legalFormValue(selectedIncident?.metadata?.workerName);
  const workerRut = legalFormValue(selectedIncident?.metadata?.workerRut);
  const workerRole = legalFormValue(selectedIncident?.metadata?.workerRole);

  // Honest single-source status for the "Guardar en Drive" action. 'saved' is
  // set ONLY from a verified upload result (see deriveDriveSaveStatus); a
  // failure shows 'error' instead of a false green or a silent no-op.
  const [driveStatus, setDriveStatus] = useState<DriveSaveStatus>('idle');
  const isSavingToDrive = driveStatus === 'saving';
  const savedToDrive = driveStatus === 'saved';

  // §2.14 (cierre Fase C.1, 2026-05-21): el path "Enviar a SUSESO" directo
  // se removió. El flujo correcto vive en src/server/routes/suseso.ts y se
  // accede vía SusesoFormBuilder (componente abajo) — empresa imprime/firma/
  // sube manualmente al portal mutualidad (directiva 2.6 inviolable).

  const handleExportPDF = async () => {
    if (!selectedIncident) return;
    setIsGenerating(true);
    try {
      const reportElement = document.getElementById('suseso-form');
      if (!reportElement) return;

      // Dynamic import: jspdf + html2canvas are heavy and only needed on export.
      const { jsPDF } = await import('jspdf');
      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(reportElement, {
        scale: 2,
        useCORS: true,
        logging: false
      });

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`${activeTab}_${selectedIncident.title.replace(/\s+/g, '_')}.pdf`);
    } catch (error) {
      logger.error("Error exporting PDF:", error);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleShareDocument = async () => {
    if (!selectedIncident || !selectedProject) return;
    setDriveStatus('saving');

    // Single honest outcome: success is decided ONLY from the real download URL
    // produced by a fully completed upload + metadata persist. Any thrown step
    // (missing element, canvas, upload, getDownloadURL, addDoc) lands in catch
    // and is reported as 'error' — never a false 'saved'.
    let downloadUrl: string | null = null;
    try {
      const reportElement = document.getElementById('suseso-form');
      if (!reportElement) {
        // Honest failure instead of a silent no-op (button used to snap back to
        // "Guardar en Drive" with no feedback when the form node was absent).
        throw new Error('suseso-form element not found');
      }

      // Dynamic import: jspdf + html2canvas are heavy and only needed on export.
      const { jsPDF } = await import('jspdf');
      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(reportElement, {
        scale: 2,
        useCORS: true,
        logging: false
      });

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);

      // Get PDF as Blob
      const pdfBlob = pdf.output('blob');

      // Upload to Firebase Storage
      const { storage, ref, uploadBytes, getDownloadURL, collection, addDoc, db } = await import('../services/firebase');
      const fileName = `${activeTab}_${selectedIncident.title.replace(/\s+/g, '_')}_${Date.now()}.pdf`;
      const storageRef = ref(storage, `suseso_reports/${selectedProject.id}/${fileName}`);

      await uploadBytes(storageRef, pdfBlob);
      const url = await getDownloadURL(storageRef);

      // Persist metadata to Firestore. A failure here means the document is NOT
      // archived in the project library — it must surface as an honest error,
      // not a green "Guardado". Rethrow so the outer catch owns the status and
      // success can never be assigned after a lost metadata write (do NOT rely
      // on handleFirestoreError's incidental throw — throw explicitly).
      try {
        await addDoc(collection(db, `projects/${selectedProject.id}/documents`), {
          name: `${activeTab}: ${selectedIncident.title}`,
          type: 'pdf',
          url,
          projectId: selectedProject.id,
          category: 'SST',
          status: 'Vigente',
          version: '1.0',
          updatedAt: new Date().toISOString(),
          size: pdfBlob.size
        });
      } catch (metaError) {
        // Log with the redacted Firestore-error helper, then rethrow so the
        // overall save is reported as failed (prevents the false-success path).
        handleFirestoreError(metaError, OperationType.CREATE, `projects/${selectedProject.id}/documents`);
        throw metaError;
      }

      // Only a real, non-empty URL reaches here without a throw.
      downloadUrl = url;
    } catch (error) {
      logger.error('Error saving SUSESO report to cloud storage:', error);
    }

    // Status is derived from the REAL outcome, never set positionally.
    const status = deriveDriveSaveStatus({ downloadUrl });
    setDriveStatus(status);

    // Auto-clear the transient saved/error badge back to idle after 3s.
    setTimeout(() => {
      setDriveStatus('idle');
    }, 3000);
  };

  return (
    <div className="flex-1 w-full p-4 sm:p-6 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
            <FileText className="w-6 h-6 text-blue-500" />
          </div>
          <div>
            <h1 className="text-2xl font-black uppercase tracking-tighter text-zinc-900 dark:text-white">{t('suseso.title', 'Reportes SUSESO')}</h1>
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{t('suseso.subtitle', 'Generación de DIAT y DIEP')}</p>
          </div>
        </div>
        {/* Sprint 29 EE — citas normativas dinámicas. NONCONFORMITY_CORRECTIVE_ACTION
            mapea a DS 109 (Chile), OSHA 1904 (US), RIDDOR (UK),
            CLC §125 (CA), WHS Act Part 3 (AU). */}
        <RegulatoryCitation
          controlId="NONCONFORMITY_CORRECTIVE_ACTION"
          tenantCountry={selectedProject?.country ?? 'CL'}
          label="Marco regulatorio"
          format="short"
        />
      </div>

      {/* Sprint 28 B6 — generador real DIAT/DIEP con folio + firma */}
      <SusesoBuilderSection />

      {/* Tabs */}
      <div className="flex items-center gap-2 p-1.5 bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 rounded-2xl sm:rounded-3xl w-full overflow-x-auto custom-scrollbar shadow-sm">
        {[
          { id: 'DIAT', label: 'DIAT (Accidentes)', icon: AlertTriangle },
          { id: 'DIEP', label: 'DIEP (Enfermedades)', icon: Activity },
          { id: 'ROI', label: 'ROI Siniestralidad', icon: Activity },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl sm:rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap flex-1 sm:flex-none ${
              activeTab === tab.id 
                ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/20' 
                : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/5'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {activeTab === 'ROI' ? (
          <div className="lg:col-span-3 space-y-6">
            <div className="bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 rounded-3xl p-6 shadow-sm">
              <h3 className="text-lg font-black text-zinc-900 dark:text-white uppercase tracking-widest mb-4">{t('suseso.roi.title', 'Cálculo Financiero del Ahorro por Siniestralidad')}</h3>
              <p className="text-sm text-zinc-500 mb-6">Estimación del Retorno de Inversión (ROI) basado en la prevención de incidentes y reducción de la tasa de siniestralidad.</p>
              
              {(() => {
                const COST_PER_INCIDENT = 2_500_000;
                const resolvedIncidents = incidents.filter(n => n.metadata?.status === 'resolved' || n.metadata?.resolved === true).length;
                const estimatedPrevented = Math.max(resolvedIncidents, incidents.length > 0 ? Math.ceil(incidents.length * 0.3) : 0);
                const totalSavings = estimatedPrevented * COST_PER_INCIDENT;
                return (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 rounded-2xl p-4">
                      <h4 className="text-[10px] font-black text-blue-600 dark:text-blue-400 uppercase tracking-widest mb-1">Costo Promedio por Incidente</h4>
                      <p className="text-2xl font-black text-zinc-900 dark:text-white">$2.500.000 <span className="text-xs font-medium text-zinc-500">CLP</span></p>
                      <p className="text-[10px] text-zinc-500 mt-2">Basado en datos históricos de la industria (días perdidos, multas, reemplazos).</p>
                    </div>
                    <div className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-2xl p-4">
                      <h4 className="text-[10px] font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-widest mb-1">Incidentes Registrados (Proyecto)</h4>
                      <p className="text-2xl font-black text-zinc-900 dark:text-white">{incidents.length} <span className="text-xs font-medium text-zinc-500">totales</span></p>
                      <p className="text-[10px] text-zinc-500 mt-2">{resolvedIncidents} resueltos · {incidents.length - resolvedIncidents} activos</p>
                    </div>
                    <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-2xl p-4">
                      <h4 className="text-[10px] font-black text-amber-600 dark:text-amber-400 uppercase tracking-widest mb-1">Ahorro Estimado (30% prevención)</h4>
                      <p className="text-2xl font-black text-zinc-900 dark:text-white">${totalSavings.toLocaleString('es-CL')} <span className="text-xs font-medium text-zinc-500">CLP</span></p>
                      <p className="text-[10px] text-zinc-500 mt-2">Basado en {estimatedPrevented} incidentes prevenidos estimados.</p>
                    </div>
                  </div>
                );
              })()}

              <div className="mt-8 p-6 bg-zinc-50 dark:bg-zinc-800/50 rounded-2xl border border-zinc-200 dark:border-white/5">
                <h4 className="text-sm font-bold text-zinc-900 dark:text-white mb-4">Impacto en Cotización Adicional (SUSESO)</h4>
                <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
                  Al mantener una tasa de siniestralidad baja, la empresa puede acceder a rebajas en la cotización adicional diferenciada.
                </p>
                <div className="flex items-center justify-between p-4 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-white/10">
                  <div>
                    <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Tasa Actual</p>
                    <p className="text-lg font-black text-zinc-900 dark:text-white">1.7%</p>
                  </div>
                  <ArrowRight className="w-5 h-5 text-zinc-400" />
                  <div className="text-right">
                    <p className="text-xs font-bold text-emerald-500 uppercase tracking-widest">Tasa Proyectada</p>
                    <p className="text-lg font-black text-emerald-500">0.85%</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Selector Column */}
            <div className="lg:col-span-1 space-y-4">
          <div className="bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 rounded-3xl p-6 shadow-sm">
            <h3 className="text-xs font-black text-zinc-900 dark:text-white uppercase tracking-widest mb-4">{t('suseso.select.incident', 'Seleccionar Incidente')}</h3>
            
            <div className="space-y-3 max-h-[500px] overflow-y-auto custom-scrollbar pr-2">
              {incidents.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-xs text-zinc-500 font-medium">No hay incidentes registrados en este proyecto.</p>
                </div>
              ) : (
                incidents.map(incident => (
                  <button
                    key={incident.id}
                    onClick={() => setSelectedIncidentId(incident.id)}
                    className={`w-full text-left p-4 rounded-2xl border transition-all ${
                      selectedIncidentId === incident.id 
                        ? 'bg-blue-50 dark:bg-blue-500/10 border-blue-500 ring-1 ring-blue-500/50' 
                        : 'bg-zinc-50 dark:bg-zinc-800/50 border-zinc-200 dark:border-white/5 hover:border-blue-300'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="text-sm font-bold text-zinc-900 dark:text-white truncate">{incident.title}</h4>
                      <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest shrink-0">
                        {new Date(incident.createdAt).toLocaleDateString('es-CL')}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-500 mt-1 line-clamp-2">{incident.description}</p>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Preview Column */}
        <div className="lg:col-span-2 space-y-4">
          {selectedIncident ? (
            <div className="bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 rounded-3xl p-6 shadow-sm flex flex-col h-full">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xs font-black text-zinc-900 dark:text-white uppercase tracking-widest">Vista Previa del Documento</h3>
                <div className="flex gap-2">
                  <button
                    onClick={handleExportPDF}
                    disabled={isGenerating}
                    className="flex items-center gap-2 px-4 py-2 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50"
                  >
                    <Download className="w-4 h-4" />
                    {isGenerating ? 'Generando...' : 'PDF'}
                  </button>
                  {/* §2.14 (Fase C.1, 2026-05-21): el botón "Enviar a SUSESO"
                      directo se removió — directiva 2.6 + cierre P0 SECURITY.
                      El flujo formal con folio + firma vive en el
                      SusesoFormBuilder de arriba; la empresa sube manualmente
                      al portal mutualidad. */}
                  <button
                    onClick={handleShareDocument}
                    disabled={isSavingToDrive || savedToDrive || !isOnline}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors disabled:opacity-70 shadow-lg ${
                      savedToDrive
                        ? 'bg-emerald-500 text-white hover:bg-emerald-600 shadow-emerald-500/20'
                        : driveStatus === 'error'
                        ? 'bg-red-500 text-white hover:bg-red-600 shadow-red-500/20'
                        : 'bg-blue-500 text-white hover:bg-blue-600 shadow-blue-500/20'
                    }`}
                  >
                    {isSavingToDrive ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Guardando...
                      </>
                    ) : savedToDrive ? (
                      <>
                        <CheckCircle2 className="w-4 h-4" />
                        Guardado en Drive
                      </>
                    ) : driveStatus === 'error' ? (
                      <>
                        <AlertTriangle className="w-4 h-4" />
                        No se pudo guardar
                      </>
                    ) : !isOnline ? (
                      <>
                        <AlertTriangle className="w-4 h-4" />
                        Requiere Conexión
                      </>
                    ) : (
                      <>
                        <HardDrive className="w-4 h-4" />
                        Guardar en Drive
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Document Preview Area */}
              <div className="flex-1 bg-zinc-100 dark:bg-zinc-800/50 rounded-2xl p-4 overflow-y-auto custom-scrollbar">
                <div id="suseso-form" className="bg-white p-8 rounded-xl shadow-sm max-w-[210mm] mx-auto min-h-[297mm] text-zinc-900">
                  {/* Form Header */}
                  <div className="border-b-2 border-zinc-900 pb-4 mb-6 flex justify-between items-start">
                    <div>
                      <h2 className="text-2xl font-black uppercase tracking-tighter">{activeTab}</h2>
                      <p className="text-xs font-bold uppercase tracking-widest text-zinc-500">
                        {activeTab === 'DIAT' ? 'Declaración Individual de Accidente de Trabajo' : 'Declaración Individual de Enfermedad Profesional'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Folio Interno</p>
                      <p className="text-lg font-mono font-bold">{selectedIncident.id.substring(0, 8).toUpperCase()}</p>
                    </div>
                  </div>

                  {/* Form Sections */}
                  <div className="space-y-6">
                    {/* Section A: Empleador */}
                    <div className="border border-zinc-300 rounded-lg p-4">
                      <h3 className="text-[10px] font-black uppercase tracking-widest bg-zinc-100 inline-block px-2 py-1 rounded mb-3">A. Identificación del Empleador</h3>
                      {!selectedProject?.companyName && (
                        <div className="mb-3 p-2 bg-amber-50 border border-amber-200 rounded text-[9px] text-amber-700 font-medium">
                          ⚠ Datos del empleador incompletos — completa Razón Social, RUT y Organismo Administrador en la configuración del proyecto.
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-[8px] font-bold uppercase text-zinc-500">Razón Social</p>
                          <p className={`text-sm font-medium border-b border-zinc-200 pb-1 ${!selectedProject?.companyName ? 'text-amber-600 italic' : ''}`}>
                            {selectedProject?.companyName || 'Sin configurar'}
                          </p>
                        </div>
                        <div>
                          <p className="text-[8px] font-bold uppercase text-zinc-500">RUT Empresa</p>
                          <p className={`text-sm font-medium border-b border-zinc-200 pb-1 ${!selectedProject?.companyRut ? 'text-amber-600 italic' : ''}`}>
                            {selectedProject?.companyRut || 'Sin configurar'}
                          </p>
                        </div>
                        <div>
                          <p className="text-[8px] font-bold uppercase text-zinc-500">Proyecto / Sucursal</p>
                          <p className="text-sm font-medium border-b border-zinc-200 pb-1">{selectedProject?.name || '—'}</p>
                        </div>
                        <div>
                          <p className="text-[8px] font-bold uppercase text-zinc-500">Organismo Administrador</p>
                          <p className="text-sm font-medium border-b border-zinc-200 pb-1">
                            {selectedProject?.mutualidad || 'Sin configurar'}
                          </p>
                        </div>
                        {selectedProject?.companyAddress && (
                          <div className="col-span-2">
                            <p className="text-[8px] font-bold uppercase text-zinc-500">Dirección</p>
                            <p className="text-sm font-medium border-b border-zinc-200 pb-1">{selectedProject.companyAddress}</p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Section B: Trabajador */}
                    <div className="border border-zinc-300 rounded-lg p-4">
                      <h3 className="text-[10px] font-black uppercase tracking-widest bg-zinc-100 inline-block px-2 py-1 rounded mb-3">B. Identificación del Trabajador</h3>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="col-span-2">
                          <p className="text-[8px] font-bold uppercase text-zinc-500">Nombre Completo</p>
                          <p className={`text-sm font-medium border-b border-zinc-200 pb-1 ${workerName.missing ? 'text-red-600' : ''}`}>{workerName.text}</p>
                        </div>
                        <div>
                          <p className="text-[8px] font-bold uppercase text-zinc-500">RUT</p>
                          <p className={`text-sm font-medium border-b border-zinc-200 pb-1 ${workerRut.missing ? 'text-red-600' : ''}`}>{workerRut.text}</p>
                        </div>
                        <div>
                          <p className="text-[8px] font-bold uppercase text-zinc-500">Profesión / Oficio</p>
                          <p className={`text-sm font-medium border-b border-zinc-200 pb-1 ${workerRole.missing ? 'text-red-600' : ''}`}>{workerRole.text}</p>
                        </div>
                      </div>
                    </div>

                    {/* Section C: Accidente/Enfermedad */}
                    <div className="border border-zinc-300 rounded-lg p-4">
                      <h3 className="text-[10px] font-black uppercase tracking-widest bg-zinc-100 inline-block px-2 py-1 rounded mb-3">
                        {activeTab === 'DIAT' ? 'C. Datos del Accidente' : 'C. Datos de la Enfermedad'}
                      </h3>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-[8px] font-bold uppercase text-zinc-500">Fecha</p>
                          <p className="text-sm font-medium border-b border-zinc-200 pb-1">{new Date(selectedIncident.createdAt).toLocaleDateString('es-CL')}</p>
                        </div>
                        <div>
                          <p className="text-[8px] font-bold uppercase text-zinc-500">Hora</p>
                          <p className="text-sm font-medium border-b border-zinc-200 pb-1">{new Date(selectedIncident.createdAt).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}</p>
                        </div>
                        <div className="col-span-2">
                          <p className="text-[8px] font-bold uppercase text-zinc-500">Descripción de lo ocurrido</p>
                          <p className="text-sm font-medium border-b border-zinc-200 pb-1 min-h-[60px]">{selectedIncident.description}</p>
                        </div>
                        <div className="col-span-2">
                          <p className="text-[8px] font-bold uppercase text-zinc-500">Lugar exacto</p>
                          <p className="text-sm font-medium border-b border-zinc-200 pb-1">{selectedIncident.metadata?.location || 'Instalaciones de la empresa'}</p>
                        </div>
                      </div>
                    </div>

                    {/* Footer / Signatures */}
                    <div className="pt-12 grid grid-cols-2 gap-8">
                      <div className="text-center">
                        <div className="border-b border-zinc-400 w-48 mx-auto mb-2"></div>
                        <p className="text-[8px] font-bold uppercase text-zinc-500">Firma Empleador / Representante</p>
                      </div>
                      <div className="text-center">
                        <div className="border-b border-zinc-400 w-48 mx-auto mb-2"></div>
                        <p className="text-[8px] font-bold uppercase text-zinc-500">Firma Trabajador (Si procede)</p>
                      </div>
                    </div>
                    
                    <div className="mt-8 text-center">
                      <p className="text-[8px] text-zinc-400 uppercase tracking-widest">Documento generado automáticamente por Praeventio Guard AI</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 rounded-3xl p-6 shadow-sm h-full flex flex-col items-center justify-center text-center">
              <div className="w-16 h-16 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center mb-4">
                <FileText className="w-8 h-8 text-zinc-400" />
              </div>
              <h3 className="text-sm font-black text-zinc-900 dark:text-white uppercase tracking-widest mb-2">Sin Selección</h3>
              <p className="text-xs text-zinc-500 max-w-sm">Selecciona un incidente de la lista para generar la vista previa del formulario SUSESO correspondiente.</p>
            </div>
          )}
        </div>
        </>
        )}
      </div>
    </div>
  );
}

// Sprint 28 Bucket B6 — wires the new folio-stamped DIAT/DIEP generator
// (POST /api/suseso/form). Kept as a sibling component so the legacy
// Gemini-metadata flow above remains untouched until the migration is
// complete. The tenantId is derived from the Firebase Auth custom claim
// (see oauthGoogle.ts /adminClaims). If the claim is absent we render a
// disabled note rather than breaking the page.
function SusesoBuilderSection() {
  const { user } = useFirebase();
  const [tenantId, setTenantId] = React.useState<string | null>(null);
  const [collapsed, setCollapsed] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const tokenResult = await user?.getIdTokenResult();
        const claim = tokenResult?.claims?.tenantId;
        if (!cancelled && typeof claim === 'string') setTenantId(claim);
      } catch {
        /* fallthrough — no tenant claim */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!user) return null;

  return (
    <div className="bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 rounded-3xl p-4 sm:p-6 shadow-sm">
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center justify-between"
      >
        <span className="text-sm font-bold uppercase tracking-widest text-zinc-700 dark:text-zinc-200">
          Generar declaración con folio + firma electrónica
        </span>
        <span className="text-xs text-zinc-500">{collapsed ? 'â–¾' : 'â–´'}</span>
      </button>
      {!collapsed && (
        <div className="mt-4">
          {tenantId ? (
            <SusesoFormBuilder
              tenantId={tenantId}
              reportedBy={{
                uid: user.uid,
                rut: '', // RUT del usuario debe venir del perfil; por ahora vacío
                fullName: user.displayName || user.email || 'Usuario',
              }}
            />
          ) : (
            <p className="text-sm text-zinc-500">
              Tu cuenta aún no está asociada a un tenant. Contacta al administrador.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
