import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Folder, 
  FileText, 
  Search, 
  Plus, 
  Filter, 
  Download, 
  MoreVertical, 
  Clock, 
  Shield, 
  CheckCircle2,
  Loader2,
  X,
  Upload,
  RefreshCw,
  History,
  GitBranch,
  ArrowRight
} from 'lucide-react';
import { useFirestoreCollection } from '../hooks/useFirestoreCollection';
import { useProject } from '../contexts/ProjectContext';
import { db, serverTimestamp } from '../services/firebase';
import { collection, addDoc, deleteDoc, doc } from 'firebase/firestore';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useDocumentChain, useDocumentChangelog } from '../hooks/useDocumentVersioning';
import type { VersionStatus } from '../services/documents/documentVersioning';

import { AddDocumentModal } from '../components/documents/AddDocumentModal';
import { EditDocumentModal } from '../components/documents/EditDocumentModal';
import { ConfirmDialog } from '../components/shared/ConfirmDialog';
import { Tooltip } from '../components/shared/Tooltip';
import { DocumentHygienePanel } from '../components/documentHygiene/DocumentHygienePanel';
import { DocConfidenceCard } from '../components/documentHygiene/DocConfidenceCard';
import { computeDocumentConfidence } from '../services/documentHygiene/documentHygieneEngine';
import { useDocumentHygiene } from '../hooks/useDataQuality';

interface Document {
  id: string;
  name: string;
  type: string;
  category: string;
  version: string;
  status: 'Vigente' | 'Vencido' | 'Pendiente';
  updatedAt: string;
  url?: string;
  projectId: string;
  isPendingSync?: boolean;
}

import { useNavigate } from 'react-router-dom';
import { logger } from '../utils/logger';

export function Documents() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('Todos');
  const [isAdding, setIsAdding] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [docToEdit, setDocToEdit] = useState<Document | null>(null);
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const isOnline = useOnlineStatus();
  const [selectedVersionDocId, setSelectedVersionDocId] = useState<string | null>(null);
  const versionChain = useDocumentChain(selectedProject?.id ?? null, selectedVersionDocId);
  const versionChangelog = useDocumentChangelog(selectedProject?.id ?? null, selectedVersionDocId);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (activeDropdown && !(e.target as Element).closest('.dropdown-container')) {
        setActiveDropdown(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [activeDropdown]);

  const [deleteDocId, setDeleteDocId] = useState<string | null>(null);

  const handleDelete = (docId: string) => setDeleteDocId(docId);

  const doDeleteDoc = async () => {
    if (!selectedProject || !deleteDocId) return;
    try {
      await deleteDoc(doc(db, `projects/${selectedProject.id}/documents`, deleteDocId));
    } catch (error) {
      logger.error('Error deleting document:', error);
    } finally {
      setDeleteDocId(null);
    }
  };

  const { data: documents, loading } = useFirestoreCollection<Document>(
    selectedProject ? `projects/${selectedProject.id}/documents` : null
  );

  // Salud documental REAL: el backend deriva firmas/accesos/acuses/vínculos
  // desde Firestore (documents + read_receipts + nodes). Ya no fabricamos
  // los campos de higiene client-side.
  const hygiene = useDocumentHygiene(selectedProject?.id ?? null);
  const hygieneDocs = useMemo(
    () => hygiene.data?.documents ?? [],
    [hygiene.data]
  );

  // Documento de menor confianza — foco del prevencionista (DocConfidenceCard).
  const lowestConfidenceDoc = useMemo(() => {
    if (hygieneDocs.length === 0) return null;
    return [...hygieneDocs].sort(
      (a, b) =>
        computeDocumentConfidence(a).score - computeDocumentConfidence(b).score
    )[0];
  }, [hygieneDocs]);

  const categories = ['Todos', 'Legal', 'Técnico', 'SST', 'Administrativo'];

  const filteredDocs = (documents || []).filter(doc => {
    const matchesSearch = (doc.name || '').toLowerCase().includes(String(searchTerm || '').toLowerCase());
    const matchesCategory = activeCategory === 'Todos' || doc.category === activeCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <div data-testid="documents-page" className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-zinc-900 dark:text-white uppercase tracking-tighter leading-tight">{t('documents.title', 'Gestión Documental')}</h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            {t('documents.subtitle', 'Repositorio Central de Evidencia y Cumplimiento')}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <button 
            onClick={() => setIsAdding(true)}
            className="bg-white text-black px-6 py-3 sm:py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-zinc-200 transition-all shadow-xl shadow-white/5 flex items-center justify-center gap-2 w-full sm:w-auto disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Upload className="w-4 h-4" />
            <span>{t('documents.upload', 'Subir Documento')}</span>
          </button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { label: t('documents.statValid', 'Vigentes'), value: (documents || []).filter(d => d.status === 'Vigente').length, icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
          { label: t('documents.statExpiring', 'Por Vencer'), value: (documents || []).filter(d => d.status === 'Pendiente').length, icon: Clock, color: 'text-amber-500', bg: 'bg-amber-500/10' },
          { label: t('documents.statCritical', 'Críticos'), value: (documents || []).filter(d => d.status === 'Vencido').length, icon: Shield, color: 'text-red-500', bg: 'bg-red-500/10' },
        ].map((stat, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/5 rounded-3xl p-6 flex items-center gap-4 shadow-sm"
          >
            <div className={`w-12 h-12 rounded-2xl ${stat.bg} flex items-center justify-center border border-white/5`}>
              <stat.icon className={`w-6 h-6 ${stat.color}`} />
            </div>
            <div>
              <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">{stat.label}</p>
              <p className="text-xl font-black text-zinc-900 dark:text-white tracking-tight">{stat.value}</p>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <DocumentHygienePanel documents={hygieneDocs} />
        {lowestConfidenceDoc && (
          <DocConfidenceCard document={lowestConfidenceDoc} />
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            type="text"
            placeholder={t('documents.searchPlaceholder', 'Buscar documentos...')}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-white/10 rounded-xl sm:rounded-2xl py-3 sm:py-4 pl-10 sm:pl-12 pr-4 text-xs sm:text-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all shadow-sm"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-4 sm:px-6 py-2.5 sm:py-4 rounded-xl sm:rounded-2xl text-[8px] sm:text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap border ${
                activeCategory === cat 
                  ? 'bg-emerald-500 text-white border-emerald-500 shadow-lg shadow-emerald-500/20' 
                  : 'bg-white dark:bg-zinc-900/50 text-zinc-500 border-zinc-200 dark:border-white/5 hover:border-zinc-300 dark:hover:border-white/10 hover:text-zinc-900 dark:hover:text-white shadow-sm'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Documents List */}
      <div className="bg-white dark:bg-zinc-900/30 border border-zinc-200 dark:border-white/5 rounded-2xl sm:rounded-[2.5rem] overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[600px]">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-white/5">
                <th className="px-4 sm:px-6 py-3 sm:py-4 text-[8px] font-black text-zinc-500 uppercase tracking-widest">{t('documents.fileName', 'Nombre del Archivo')}</th>
                <th className="px-4 sm:px-6 py-3 sm:py-4 text-[8px] font-black text-zinc-500 uppercase tracking-widest">{t('documents.category', 'Categoría')}</th>
                <th className="px-4 sm:px-6 py-3 sm:py-4 text-[8px] font-black text-zinc-500 uppercase tracking-widest">{t('documents.version', 'Versión')}</th>
                <th className="px-4 sm:px-6 py-3 sm:py-4 text-[8px] font-black text-zinc-500 uppercase tracking-widest">{t('documents.status', 'Estado')}</th>
                <th className="px-4 sm:px-6 py-3 sm:py-4 text-[8px] font-black text-zinc-500 uppercase tracking-widest">{t('documents.lastModified', 'Última Modificación')}</th>
                <th className="px-4 sm:px-6 py-3 sm:py-4 text-[8px] font-black text-zinc-500 uppercase tracking-widest">{t('documents.actions', 'Acciones')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-white/5">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 sm:px-6 py-10 sm:py-20 text-center">
                    <Loader2 className="w-6 h-6 sm:w-8 sm:h-8 text-emerald-500 animate-spin mx-auto mb-3 sm:mb-4" />
                    <p className="text-[8px] sm:text-[10px] font-black text-zinc-500 uppercase tracking-widest">{t('documents.syncing', 'Sincronizando Archivos...')}</p>
                  </td>
                </tr>
              ) : filteredDocs.length > 0 ? (
                filteredDocs.map((doc) => (
                  <tr key={doc.id} className="group hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors">
                    <td className="px-4 sm:px-6 py-3 sm:py-4">
                      <div 
                        className="flex items-center gap-2 sm:gap-3 cursor-pointer"
                        onClick={() => navigate(`/documents/${doc.id}`)}
                      >
                        <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center border border-zinc-200 dark:border-white/5 shrink-0">
                          <FileText className="w-4 h-4 sm:w-5 sm:h-5 text-zinc-400" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs sm:text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-tight hover:text-emerald-500 dark:hover:text-emerald-400 transition-colors truncate">{doc.name}</p>
                          <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest truncate">{doc.type || 'Documento IA'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 sm:px-6 py-3 sm:py-4">
                      <span className="text-[8px] sm:text-[9px] font-bold text-zinc-400 uppercase tracking-wider">{doc.category}</span>
                    </td>
                    <td className="px-4 sm:px-6 py-3 sm:py-4">
                      <span className="text-[8px] sm:text-[9px] font-bold text-zinc-400 uppercase tracking-wider">v{doc.version || '1.0'}</span>
                    </td>
                    <td className="px-4 sm:px-6 py-3 sm:py-4">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded-md text-[8px] font-black uppercase tracking-widest whitespace-nowrap ${
                          doc.status === 'Vigente' ? 'bg-emerald-500/10 text-emerald-500' :
                          doc.status === 'Vencido' ? 'bg-red-500/10 text-red-500' : 'bg-amber-500/10 text-amber-500'
                        }`}>
                          {doc.status}
                        </span>
                        {doc.isPendingSync && (
                          <span className="px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-500 text-[8px] font-black uppercase tracking-widest flex items-center gap-1">
                            <RefreshCw className="w-2 h-2 animate-spin" />
                            Pendiente
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 sm:px-6 py-3 sm:py-4">
                      <span className="text-[8px] sm:text-[9px] font-bold text-zinc-500 uppercase tracking-wider whitespace-nowrap">
                        {new Date(doc.updatedAt || (doc as any).uploadDate || (doc as any).createdAt || new Date()).toLocaleDateString('es-CL')}
                      </span>
                    </td>
                    <td className="px-4 sm:px-6 py-3 sm:py-4">
                      <div className="flex items-center gap-1 sm:gap-2">
                        {/* Sprint 20 19th-wave (Bucket C): native title= → Tooltip primitive (WCAG 2.1 AA 1.4.13). aria-label preserved as primary SR semantic. */}
                        <Tooltip content="Ver Documento">
                          <button
                            onClick={() => navigate(`/documents/${doc.id}`)}
                            className="p-1.5 sm:p-2 hover:bg-zinc-200 dark:hover:bg-white/10 rounded-lg text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-all"
                            aria-label={`Ver documento ${doc.name}`}
                          >
                            <FileText className="w-3 h-3 sm:w-4 sm:h-4" aria-hidden="true" />
                          </button>
                        </Tooltip>
                        {doc.url ? (
                          <Tooltip content="Descargar Original">
                            <a
                              href={doc.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1.5 sm:p-2 hover:bg-zinc-200 dark:hover:bg-white/10 rounded-lg text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-all"
                              aria-label={`Descargar archivo original de ${doc.name}`}
                            >
                              <Download className="w-3 h-3 sm:w-4 sm:h-4" aria-hidden="true" />
                            </a>
                          </Tooltip>
                        ) : (
                          <Tooltip content="Sin archivo original">
                            <button disabled className="p-1.5 sm:p-2 rounded-lg text-zinc-400 dark:text-zinc-600 cursor-not-allowed" aria-label="Sin archivo original disponible">
                              <Download className="w-3 h-3 sm:w-4 sm:h-4" aria-hidden="true" />
                            </button>
                          </Tooltip>
                        )}
                        <div className="relative dropdown-container">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveDropdown(activeDropdown === doc.id ? null : doc.id);
                            }}
                            className="p-1.5 sm:p-2 hover:bg-zinc-200 dark:hover:bg-white/10 rounded-lg text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-all"
                            aria-label={`Más opciones para ${doc.name}`}
                            aria-haspopup="menu"
                            aria-expanded={activeDropdown === doc.id}
                          >
                            <MoreVertical className="w-3 h-3 sm:w-4 sm:h-4" aria-hidden="true" />
                          </button>
                          <AnimatePresence>
                            {activeDropdown === doc.id && (
                              <motion.div 
                                initial={{ opacity: 0, scale: 0.95, y: -10 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.95, y: -10 }}
                                transition={{ duration: 0.15 }}
                                className="absolute right-0 mt-1 w-32 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-white/10 rounded-xl shadow-xl z-20 overflow-hidden"
                              >
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDocToEdit(doc);
                                    setIsEditing(true);
                                    setActiveDropdown(null);
                                  }}
                                  className="w-full text-left px-4 py-2.5 text-xs text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors"
                                >
                                  {t('documents.edit', 'Editar')}
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedVersionDocId(doc.id);
                                    setActiveDropdown(null);
                                  }}
                                  className="w-full text-left px-4 py-2.5 text-xs text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors flex items-center gap-2"
                                >
                                  <History className="w-3 h-3" />
                                  {t('documents.versionHistory', 'Historial')}
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDelete(doc.id);
                                    setActiveDropdown(null);
                                  }}
                                  className="w-full text-left px-4 py-2.5 text-xs text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-colors"
                                >
                                  {t('documents.delete', 'Eliminar')}
                                </button>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-4 sm:px-6 py-10 sm:py-20 text-center">
                    <Folder className="w-8 h-8 sm:w-12 sm:h-12 text-zinc-300 dark:text-zinc-800 mx-auto mb-3 sm:mb-4" />
                    <p className="text-[10px] sm:text-sm font-bold text-zinc-500 uppercase tracking-widest">{t('documents.noResults', 'No se encontraron documentos')}</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      
      {selectedProject && (
        <>
          <AddDocumentModal 
            isOpen={isAdding} 
            onClose={() => setIsAdding(false)} 
            projectId={selectedProject.id} 
          />
          <EditDocumentModal
            isOpen={isEditing}
            onClose={() => {
              setIsEditing(false);
              setDocToEdit(null);
            }}
            document={docToEdit}
            projectId={selectedProject.id}
          />
        </>
      )}
      <ConfirmDialog
        isOpen={!!deleteDocId}
        title={t('documents.deleteTitle', 'Eliminar documento')}
        message={t('documents.deleteConfirm', '¿Estás seguro? El documento se eliminará permanentemente.')}
        confirmLabel={t('documents.delete', 'Eliminar')}
        danger
        onConfirm={doDeleteDoc}
        onCancel={() => setDeleteDocId(null)}
      />

      <AnimatePresence>
        {selectedVersionDocId && (
          <motion.div
            key="version-history-panel"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
          >
            <div
              onClick={() => setSelectedVersionDocId(null)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ duration: 0.2 }}
              className="relative bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-emerald-500/30 rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl shadow-emerald-500/10 flex flex-col max-h-[85vh]"
            >
              <div className="p-6 border-b border-zinc-200 dark:border-white/5 flex items-center justify-between bg-emerald-50 dark:bg-gradient-to-r dark:from-emerald-500/10 dark:to-transparent shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-500 shrink-0">
                    <History className="w-5 h-5 sm:w-6 sm:h-6" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-lg font-black text-zinc-900 dark:text-white uppercase tracking-tight truncate">{t('documents.versionHistoryTitle', 'Historial de Versiones')}</h2>
                    <p className="text-[10px] text-emerald-600 dark:text-emerald-300 font-bold uppercase tracking-widest truncate">{t('documents.versionHistorySubtitle', 'Cadena de control documental')}</p>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedVersionDocId(null)}
                  className="p-2 hover:bg-zinc-200 dark:hover:bg-white/10 rounded-xl transition-colors text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white shrink-0"
                  aria-label={t('common.close', 'Cerrar')}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 overflow-y-auto custom-scrollbar flex-1 bg-white dark:bg-zinc-900 space-y-4">
                {versionChain.loading ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-3">
                    <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
                    <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">{t('documents.loadingVersions', 'Cargando versiones...')}</p>
                  </div>
                ) : versionChain.error ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-3">
                    <Shield className="w-8 h-8 text-red-500" />
                    <p className="text-xs font-bold text-red-500">{t('documents.versionError', 'Error al cargar versiones')}</p>
                  </div>
                ) : versionChain.data?.chain?.versions?.length ? (
                  <div className="space-y-3">
                    {[...versionChain.data.chain.versions]
                      .sort((a, b) => b.versionId.localeCompare(a.versionId, undefined, { numeric: true }))
                      .map((v, i) => {
                        const statusColors: Record<VersionStatus, string> = {
                          draft: 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300',
                          in_review: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
                          approved: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
                          superseded: 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500',
                          retired: 'bg-red-500/10 text-red-500',
                        };
                        const statusLabels: Record<VersionStatus, string> = {
                          draft: t('documents.vs_draft', 'Borrador'),
                          in_review: t('documents.vs_in_review', 'En revisión'),
                          approved: t('documents.vs_approved', 'Aprobado'),
                          superseded: t('documents.vs_superseded', 'Reemplazado'),
                          retired: t('documents.vs_retired', 'Retirado'),
                        };
                        return (
                          <motion.div
                            key={v.versionId}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: i * 0.05 }}
                            className="flex items-start gap-3 p-3 rounded-xl bg-zinc-50 dark:bg-white/[0.02] border border-zinc-200 dark:border-white/5 hover:border-emerald-500/30 dark:hover:border-emerald-500/20 transition-colors"
                          >
                            <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-500/10 flex items-center justify-center shrink-0 mt-0.5">
                              <GitBranch className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-black text-zinc-900 dark:text-white">v{v.versionId}</span>
                                <span className={`px-2 py-0.5 rounded-md text-[8px] font-black uppercase tracking-widest ${statusColors[v.status]}`}>
                                  {statusLabels[v.status]}
                                </span>
                              </div>
                              <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1 truncate">{v.changeNotes || t('documents.noChangeNotes', 'Sin notas de cambio')}</p>
                              <p className="text-[9px] text-zinc-400 dark:text-zinc-600 mt-1 uppercase tracking-wider">
                                {new Date(v.createdAt).toLocaleDateString('es-CL', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                              </p>
                            </div>
                            {v.replacesVersionId && (
                              <div className="flex items-center gap-1 text-[9px] text-zinc-400 dark:text-zinc-600 shrink-0 mt-1">
                                <ArrowRight className="w-3 h-3" />
                                <span className="uppercase tracking-wider">{v.replacesVersionId}</span>
                              </div>
                            )}
                          </motion.div>
                        );
                      })
                    }
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 gap-3">
                    <Folder className="w-8 h-8 text-zinc-300 dark:text-zinc-700" />
                    <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">{t('documents.noVersions', 'Sin versiones registradas')}</p>
                  </div>
                )}

                {versionChangelog.data?.changelog?.length ? (
                  <div className="pt-4 border-t border-zinc-200 dark:border-white/5">
                    <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-3">{t('documents.changelog', 'Registro de cambios')}</h3>
                    <div className="space-y-2">
                      {versionChangelog.data.changelog.map((entry) => (
                        <div key={entry.versionId} className="flex items-start gap-2 text-[10px]">
                          <span className="font-black text-zinc-900 dark:text-white shrink-0">v{entry.versionId}</span>
                          <span className="text-zinc-500 dark:text-zinc-400 truncate">{entry.changeNotes}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="p-6 border-t border-zinc-200 dark:border-white/5 bg-zinc-50 dark:bg-zinc-900/50 shrink-0">
                <button
                  onClick={() => setSelectedVersionDocId(null)}
                  className="w-full px-4 py-3 rounded-xl text-xs font-black text-zinc-600 dark:text-white uppercase tracking-widest hover:bg-zinc-200 dark:hover:bg-white/5 transition-colors"
                >
                  {t('documents.closeHistory', 'Cerrar')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
