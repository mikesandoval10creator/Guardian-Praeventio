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
  Send
} from 'lucide-react';
import { useZettelkasten } from '../hooks/useZettelkasten';
import { useProject } from '../contexts/ProjectContext';
import { NodeType } from '../types';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

export function SusesoReports() {
  const { nodes } = useZettelkasten();
  const { selectedProject } = useProject();
  const [activeTab, setActiveTab] = useState<'DIAT' | 'DIEP'>('DIAT');
  const [selectedIncidentId, setSelectedIncidentId] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSending, setIsSending] = useState(false);

  // Filter incidents for the current project
  const incidents = nodes.filter(n => n.type === NodeType.INCIDENT && (!selectedProject || n.projectId === selectedProject.id));
  const selectedIncident = incidents.find(i => i.id === selectedIncidentId);

  const handleExportPDF = async () => {
    if (!selectedIncident) return;
    setIsGenerating(true);
    try {
      const reportElement = document.getElementById('suseso-form');
      if (!reportElement) return;

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
      console.error("Error exporting PDF:", error);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleShareDocument = async () => {
    if (!selectedIncident) return;
    setIsSending(true);
    try {
      const reportElement = document.getElementById('suseso-form');
      if (!reportElement) return;

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
      const pdfBlob = pdf.output('blob');
      const fileName = `${activeTab}_${selectedIncident.title.replace(/\s+/g, '_')}.pdf`;
      const file = new File([pdfBlob], fileName, { type: 'application/pdf' });

      if (navigator.share && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `Reporte ${activeTab}`,
          text: `Reporte ${activeTab} generado por Praeventio Guard`,
        });
      } else {
        // Fallback to download if Web Share API is not supported
        pdf.save(fileName);
        alert('Documento descargado. Puedes subirlo manualmente a tu Google Drive u otro almacenamiento en la nube para derivarlo a la SUSESO.');
      }
    } catch (error) {
      console.error("Error sharing PDF:", error);
      alert('Hubo un error al intentar compartir el documento.');
    } finally {
      setIsSending(false);
    }
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
            <h1 className="text-2xl font-black uppercase tracking-tighter text-zinc-900 dark:text-white">Reportes SUSESO</h1>
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Generación de DIAT y DIEP</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 p-1.5 bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 rounded-2xl sm:rounded-3xl w-full overflow-x-auto custom-scrollbar shadow-sm">
        {[
          { id: 'DIAT', label: 'DIAT (Accidentes)', icon: AlertTriangle },
          { id: 'DIEP', label: 'DIEP (Enfermedades)', icon: Activity },
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
        {/* Selector Column */}
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 rounded-3xl p-6 shadow-sm">
            <h3 className="text-xs font-black text-zinc-900 dark:text-white uppercase tracking-widest mb-4">Seleccionar Incidente</h3>
            
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
                  <button
                    onClick={handleShareDocument}
                    disabled={isSending}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-600 transition-colors disabled:opacity-50 shadow-lg shadow-blue-500/20"
                  >
                    <Send className="w-4 h-4" />
                    {isSending ? 'Procesando...' : 'Guardar en Drive / Compartir'}
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
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-[8px] font-bold uppercase text-zinc-500">Razón Social</p>
                          <p className="text-sm font-medium border-b border-zinc-200 pb-1">Praeventio Guard S.A.</p>
                        </div>
                        <div>
                          <p className="text-[8px] font-bold uppercase text-zinc-500">RUT</p>
                          <p className="text-sm font-medium border-b border-zinc-200 pb-1">76.123.456-7</p>
                        </div>
                        <div className="col-span-2">
                          <p className="text-[8px] font-bold uppercase text-zinc-500">Proyecto / Sucursal</p>
                          <p className="text-sm font-medium border-b border-zinc-200 pb-1">{selectedProject?.name || 'Casa Matriz'}</p>
                        </div>
                      </div>
                    </div>

                    {/* Section B: Trabajador */}
                    <div className="border border-zinc-300 rounded-lg p-4">
                      <h3 className="text-[10px] font-black uppercase tracking-widest bg-zinc-100 inline-block px-2 py-1 rounded mb-3">B. Identificación del Trabajador</h3>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="col-span-2">
                          <p className="text-[8px] font-bold uppercase text-zinc-500">Nombre Completo</p>
                          <p className="text-sm font-medium border-b border-zinc-200 pb-1">{selectedIncident.metadata?.workerName || 'No especificado'}</p>
                        </div>
                        <div>
                          <p className="text-[8px] font-bold uppercase text-zinc-500">RUT</p>
                          <p className="text-sm font-medium border-b border-zinc-200 pb-1">{selectedIncident.metadata?.workerRut || '12.345.678-9'}</p>
                        </div>
                        <div>
                          <p className="text-[8px] font-bold uppercase text-zinc-500">Profesión / Oficio</p>
                          <p className="text-sm font-medium border-b border-zinc-200 pb-1">{selectedIncident.metadata?.workerRole || 'Operario'}</p>
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
      </div>
    </div>
  );
}
