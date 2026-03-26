import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Upload, FileText, Loader2 } from 'lucide-react';
import { db, storage, collection, addDoc, serverTimestamp, ref, uploadBytes, getDownloadURL, handleFirestoreError, OperationType } from '../../services/firebase';
import { useZettelkasten } from '../../hooks/useZettelkasten';
import { NodeType } from '../../types';

interface AddDocumentModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
}

export function AddDocumentModal({ isOpen, onClose, projectId }: AddDocumentModalProps) {
  const [loading, setLoading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const { addNode } = useZettelkasten();
  const [formData, setFormData] = useState({
    name: '',
    category: 'SST',
    version: '1.0',
    status: 'Vigente' as 'Vigente' | 'Vencido' | 'Pendiente'
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      if (!formData.name) {
        // Auto-fill name from file name (without extension)
        setFormData(prev => ({ ...prev, name: selectedFile.name.split('.').slice(0, -1).join('.') }));
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !projectId) return;

    setLoading(true);
    try {
      // 1. Upload file to Firebase Storage
      const fileExtension = file.name.split('.').pop();
      const fileName = `${Date.now()}_${crypto.randomUUID()}.${fileExtension}`;
      const storageRef = ref(storage, `projects/${projectId}/documents/${fileName}`);
      
      await uploadBytes(storageRef, file);
      const downloadUrl = await getDownloadURL(storageRef);

      // 2. Save document metadata to Firestore
      const docRef = await addDoc(collection(db, `projects/${projectId}/documents`), {
        name: formData.name,
        type: fileExtension?.toUpperCase() || 'FILE',
        category: formData.category,
        version: formData.version,
        status: formData.status,
        url: downloadUrl,
        storagePath: storageRef.fullPath,
        updatedAt: new Date().toISOString(),
        projectId: projectId,
        createdAt: serverTimestamp()
      });

      // 3. Create Zettelkasten Node
      await addNode({
        type: NodeType.DOCUMENT,
        title: `Documento: ${formData.name}`,
        description: `Documento de categoría ${formData.category}, versión ${formData.version}.`,
        tags: ['Documento', formData.category, formData.status],
        projectId: projectId,
        connections: [],
        metadata: {
          documentId: docRef.id,
          url: downloadUrl,
          status: formData.status
        }
      });

      onClose();
      setFile(null);
      setFormData({ name: '', category: 'SST', version: '1.0', status: 'Vigente' });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `projects/${projectId}/documents`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="bg-zinc-900 border border-white/10 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl"
          >
            <div className="p-6 border-b border-white/5 flex justify-between items-center bg-gradient-to-r from-emerald-500/10 to-transparent">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                  <FileText className="w-6 h-6 text-emerald-500" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white">Subir Documento</h2>
                  <p className="text-xs text-zinc-400">Añade un nuevo archivo al repositorio</p>
                </div>
              </div>
              <button 
                onClick={onClose}
                className="p-2 hover:bg-white/10 rounded-xl transition-colors text-zinc-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-6">
              {/* File Upload Area */}
              <div 
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${
                  file ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-white/10 hover:border-white/20 hover:bg-white/5'
                }`}
              >
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileChange} 
                  className="hidden" 
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.png"
                />
                
                {file ? (
                  <div className="flex flex-col items-center gap-2">
                    <FileText className="w-8 h-8 text-emerald-500" />
                    <p className="text-sm font-bold text-white">{file.name}</p>
                    <p className="text-xs text-zinc-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <Upload className="w-8 h-8 text-zinc-500" />
                    <p className="text-sm font-bold text-white">Haz clic para seleccionar un archivo</p>
                    <p className="text-xs text-zinc-500">PDF, Word, Excel, JPG, PNG (Max 10MB)</p>
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-black text-zinc-500 uppercase tracking-widest mb-2">Nombre del Documento</label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full bg-zinc-800/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
                    placeholder="Ej. Matriz de Riesgos 2026"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-black text-zinc-500 uppercase tracking-widest mb-2">Categoría</label>
                    <select
                      value={formData.category}
                      onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                      className="w-full bg-zinc-800/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all appearance-none"
                    >
                      <option value="Legal">Legal</option>
                      <option value="Técnico">Técnico</option>
                      <option value="SST">SST</option>
                      <option value="Administrativo">Administrativo</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-black text-zinc-500 uppercase tracking-widest mb-2">Versión</label>
                    <input
                      type="text"
                      required
                      value={formData.version}
                      onChange={(e) => setFormData({ ...formData, version: e.target.value })}
                      className="w-full bg-zinc-800/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all"
                      placeholder="Ej. 1.0"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-black text-zinc-500 uppercase tracking-widest mb-2">Estado</label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                    className="w-full bg-zinc-800/50 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all appearance-none"
                  >
                    <option value="Vigente">Vigente</option>
                    <option value="Pendiente">Pendiente</option>
                    <option value="Vencido">Vencido</option>
                  </select>
                </div>
              </div>

              <div className="flex gap-3 pt-4 border-t border-white/5">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 px-4 py-3 rounded-xl text-sm font-bold text-white bg-zinc-800 hover:bg-zinc-700 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading || !file}
                  className="flex-1 px-4 py-3 rounded-xl text-sm font-bold text-white bg-emerald-500 hover:bg-emerald-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Subiendo...</span>
                    </>
                  ) : (
                    <span>Subir Documento</span>
                  )}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
