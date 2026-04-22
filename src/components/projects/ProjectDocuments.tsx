import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { 
  FileText, 
  Upload, 
  Download, 
  Trash2, 
  Loader2, 
  File, 
  CheckCircle2, 
  AlertCircle,
  Search,
  Filter,
  WifiOff,
  RefreshCw
} from 'lucide-react';
import { 
  storage, 
  db, 
  ref, 
  uploadBytes, 
  getDownloadURL, 
  deleteObject, 
  collection, 
  addDoc, 
  query, 
  where, 
  onSnapshot,
  deleteDoc,
  doc
} from '../../services/firebase';
import { useFirebase } from '../../contexts/FirebaseContext';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { useFirestoreCollection } from '../../hooks/useFirestoreCollection';

interface ProjectDocument {
  id: string;
  name: string;
  url: string;
  type: string;
  size: number;
  projectId: string;
  uploadedBy: string;
  createdAt: string;
  isPendingSync?: boolean;
}

interface ProjectDocumentsProps {
  projectId: string;
}

export function ProjectDocuments({ projectId }: ProjectDocumentsProps) {
  const [uploading, setUploading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const { user } = useFirebase();
  const isOnline = useOnlineStatus();

  const { data: documents, loading } = useFirestoreCollection<ProjectDocument>(
    'project_documents',
    [where('projectId', '==', projectId)]
  );

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    setUploading(true);
    try {
      if (!isOnline) {
        const { saveForSync } = await import('../../utils/pwa-offline');
        await saveForSync({
          type: 'upload',
          collection: 'project_documents',
          file: file,
          data: {
            storagePath: `projects/${projectId}/documents/${Date.now()}_${file.name}`,
            documentData: {
              name: file.name,
              type: file.type,
              size: file.size,
              projectId,
              uploadedBy: user.uid,
              createdAt: new Date().toISOString()
            }
          }
        });
        alert('Archivo guardado para sincronización. Se subirá cuando recuperes la conexión.');
      } else {
        // Compress images before uploading to reduce Storage costs and upload time
        let fileToUpload = file;
        if (file.type.startsWith('image/')) {
          const { compressImage } = await import('../../utils/imageCompression');
          fileToUpload = await compressImage(file, { maxSizeMB: 1, maxWidthOrHeight: 1920 });
        }
        const storageRef = ref(storage, `projects/${projectId}/documents/${Date.now()}_${fileToUpload.name}`);
        const snapshot = await uploadBytes(storageRef, fileToUpload);
        const url = await getDownloadURL(snapshot.ref);

        await addDoc(collection(db, 'project_documents'), {
          name: file.name,
          url,
          type: fileToUpload.type,
          size: fileToUpload.size,
          projectId,
          uploadedBy: user.uid,
          createdAt: new Date().toISOString()
        });
      }
    } catch (error) {
      console.error('Error uploading file:', error);
      alert('Error al subir el archivo. Verifica los permisos de almacenamiento.');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (docId: string, url: string) => {
    if (!window.confirm('¿Estás seguro de eliminar este documento?')) return;

    try {
      // Delete from Storage
      const storageRef = ref(storage, url);
      await deleteObject(storageRef);

      // Delete from Firestore
      await deleteDoc(doc(db, 'project_documents', docId));
    } catch (error) {
      console.error('Error deleting document:', error);
      // Even if storage delete fails (e.g. file already gone), try to clean up firestore
      await deleteDoc(doc(db, 'project_documents', docId));
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const filteredDocs = documents.filter(d => 
    (d.name || '').toLowerCase().includes(String(searchTerm || '').toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
            <FileText className="w-5 h-5 text-blue-500" />
          </div>
          <div>
            <h3 className="text-lg font-black text-white uppercase tracking-tight">Documentación del Proyecto</h3>
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Planos, PTS, Certificados y más</p>
          </div>
        </div>
        
        <label 
          className={`cursor-pointer px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-all border ${
            !isOnline || uploading
              ? 'bg-zinc-800/50 text-zinc-500 border-white/5 cursor-not-allowed'
              : 'bg-zinc-800 hover:bg-zinc-700 text-white border-white/5'
          }`}
          title={!isOnline ? 'Requiere conexión a internet' : ''}
        >
          {!isOnline ? (
            <WifiOff className="w-4 h-4" />
          ) : uploading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Upload className="w-4 h-4" />
          )}
          <span>{!isOnline ? 'Requiere Conexión' : uploading ? 'Subiendo...' : 'Subir Documento'}</span>
          <input 
            type="file" 
            className="hidden" 
            onChange={handleFileUpload} 
            disabled={uploading || !isOnline} 
          />
        </label>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
        <input
          type="text"
          placeholder="Buscar documentos..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full bg-zinc-900/50 border border-white/10 rounded-xl py-3 pl-11 pr-4 text-xs text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all"
        />
      </div>

      {/* Docs List */}
      <div className="grid grid-cols-1 gap-3">
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          </div>
        ) : filteredDocs.length > 0 ? (
          filteredDocs.map((doc) => (
            <motion.div
              key={doc.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="bg-zinc-900/30 border border-white/5 rounded-2xl p-4 flex items-center justify-between group hover:border-white/10 transition-all"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center text-zinc-500 group-hover:text-blue-500 transition-colors">
                  <File className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm font-bold text-white truncate max-w-[200px] md:max-w-md">{doc.name}</p>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-[9px] font-black text-zinc-500 uppercase">{formatSize(doc.size)}</span>
                    <span className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">
                      {new Date(doc.createdAt).toLocaleDateString('es-CL')}
                    </span>
                    {doc.isPendingSync && (
                      <span className="px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-500 text-[8px] font-black uppercase tracking-widest flex items-center gap-1">
                        <RefreshCw className="w-2 h-2 animate-spin" />
                        Pendiente
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={doc.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 hover:bg-white/5 rounded-lg text-zinc-400 hover:text-white transition-all"
                >
                  <Download className="w-4 h-4" />
                </a>
                <button
                  onClick={() => handleDelete(doc.id, doc.url)}
                  disabled={!isOnline}
                  title={!isOnline ? 'Requiere conexión a internet' : ''}
                  className={`p-2 rounded-lg transition-all ${
                    !isOnline 
                      ? 'text-zinc-600 cursor-not-allowed' 
                      : 'hover:bg-red-500/10 text-zinc-400 hover:text-red-500'
                  }`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          ))
        ) : (
          <div className="text-center py-12 bg-zinc-900/20 rounded-3xl border border-dashed border-white/5">
            <FileText className="w-12 h-12 text-zinc-800 mx-auto mb-4" />
            <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">No hay documentos cargados</p>
          </div>
        )}
      </div>
    </div>
  );
}
