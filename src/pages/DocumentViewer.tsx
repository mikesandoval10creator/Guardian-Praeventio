import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { FileText, ArrowLeft, Download, Loader2, AlertTriangle } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useProject } from '../contexts/ProjectContext';

export function DocumentViewer() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { selectedProject } = useProject();
  const [document, setDocument] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchDocument = async () => {
      if (!id || !selectedProject) return;
      
      try {
        const docRef = doc(db, `projects/${selectedProject.id}/documents`, id);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
          setDocument({ id: docSnap.id, ...docSnap.data() });
        } else {
          setError('Documento no encontrado');
        }
      } catch (err) {
        console.error('Error fetching document:', err);
        setError('Error al cargar el documento');
      } finally {
        setLoading(false);
      }
    };

    fetchDocument();
  }, [id, selectedProject]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
      </div>
    );
  }

  if (error || !document) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="bg-red-500/10 border border-red-500/20 rounded-3xl p-8 text-center">
          <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-black text-white uppercase tracking-tighter mb-2">Error</h2>
          <p className="text-zinc-400">{error || 'Documento no encontrado'}</p>
          <button 
            onClick={() => navigate('/documents')}
            className="mt-6 px-6 py-3 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-sm font-bold transition-colors"
          >
            Volver a Documentos
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3 sm:gap-4">
          <button 
            onClick={() => navigate('/documents')}
            className="w-8 h-8 sm:w-10 sm:h-10 shrink-0 rounded-lg sm:rounded-xl bg-zinc-900 border border-white/10 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          >
            <ArrowLeft className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
          <div className="min-w-0">
            <h1 className="text-lg sm:text-2xl font-black text-white uppercase tracking-tighter truncate">{document.name || document.title}</h1>
            <p className="text-[8px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-1 truncate">
              {document.category || 'Documento'} • v{document.version || '1.0'} • {new Date(document.createdAt?.toDate() || document.uploadDate || new Date()).toLocaleDateString('es-CL')}
            </p>
          </div>
        </div>
        
        <div className="flex gap-2 w-full sm:w-auto">
          {document.url && (
            <a 
              href={document.url}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full sm:w-auto justify-center px-4 py-2.5 sm:py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-[10px] sm:text-xs font-bold uppercase tracking-widest flex items-center gap-2 transition-colors"
            >
              <Download className="w-4 h-4" />
              Descargar Original
            </a>
          )}
        </div>
      </div>

      {/* Content */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-2xl sm:rounded-3xl p-4 sm:p-8 text-zinc-900 shadow-2xl overflow-hidden"
      >
        {document.content ? (
          typeof document.content === 'string' ? (
            <div className="prose prose-zinc max-w-none">
              <div className="whitespace-pre-wrap font-sans text-zinc-800 leading-relaxed text-sm sm:text-lg">
                {document.content}
              </div>
            </div>
          ) : (
            <div className="space-y-6 sm:space-y-8">
              {/* Render structured JSON content */}
              {Object.entries(document.content).map(([key, value]: [string, any]) => (
                <div key={key}>
                  <h3 className="text-sm sm:text-lg font-black uppercase tracking-widest text-zinc-900 mb-3 sm:mb-4 border-b border-zinc-200 pb-2 break-words">
                    {key.replace(/([A-Z])/g, ' $1').trim()}
                  </h3>
                  {Array.isArray(value) ? (
                    <ul className="space-y-2">
                      {value.map((item, i) => (
                        <li key={i} className="flex items-start gap-2 sm:gap-3 text-xs sm:text-sm text-zinc-600">
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 sm:mt-2 flex-shrink-0" />
                          <span className="break-words" dangerouslySetInnerHTML={{ __html: typeof item === 'string' ? item : JSON.stringify(item) }} />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs sm:text-sm text-zinc-600 leading-relaxed break-words" dangerouslySetInnerHTML={{ __html: typeof value === 'string' ? value : JSON.stringify(value) }} />
                  )}
                </div>
              ))}
            </div>
          )
        ) : document.url ? (
          <div className="w-full flex flex-col items-center justify-center">
            {document.type?.includes('image') || document.name?.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
              <img src={document.url} alt={document.name} className="max-w-full h-auto rounded-xl shadow-lg" />
            ) : document.type?.includes('pdf') || document.name?.match(/\.pdf$/i) ? (
              <iframe src={document.url} className="w-full h-[500px] sm:h-[800px] rounded-xl border-none shadow-lg" title={document.name} />
            ) : (
              <div className="text-center py-10 sm:py-20">
                <FileText className="w-12 h-12 sm:w-16 sm:h-16 text-zinc-300 mx-auto mb-3 sm:mb-4" />
                <p className="text-zinc-500 text-xs sm:text-sm font-medium px-4">Este tipo de archivo no se puede previsualizar directamente.</p>
                <a 
                  href={document.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 mt-4 text-emerald-600 hover:text-emerald-700 font-bold text-xs sm:text-sm"
                >
                  <Download className="w-4 h-4" />
                  Descargar Archivo
                </a>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-10 sm:py-20">
            <FileText className="w-12 h-12 sm:w-16 sm:h-16 text-zinc-300 mx-auto mb-3 sm:mb-4" />
            <p className="text-zinc-500 text-xs sm:text-sm font-medium px-4">Este documento no tiene contenido estructurado ni archivo para visualizar.</p>
          </div>
        )}
      </motion.div>
    </div>
  );
}
