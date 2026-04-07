import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Calendar, Clock, MapPin, Type, FileText, Loader2, Trash2, Edit2, Save } from 'lucide-react';
import { useProject } from '../../contexts/ProjectContext';
import { db, serverTimestamp } from '../../services/firebase';
import { doc, updateDoc, deleteDoc } from 'firebase/firestore';

interface Event {
  id: string;
  title: string;
  description: string;
  date: string;
  time: string;
  location: string;
  type: 'Capacitación' | 'Inspección' | 'Auditoría' | 'Reunión';
  projectId: string;
}

interface EventDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  event: Event | null;
}

export function EventDetailsModal({ isOpen, onClose, event }: EventDetailsModalProps) {
  const { selectedProject } = useProject();
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState<Partial<Event>>({});

  React.useEffect(() => {
    if (event) {
      setFormData(event);
      setIsEditing(false);
    }
  }, [event]);

  if (!event) return null;

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProject || !event.id) return;

    setLoading(true);
    try {
      const eventRef = doc(db, `projects/${selectedProject.id}/events`, event.id);
      await updateDoc(eventRef, {
        ...formData,
        updatedAt: serverTimestamp()
      });
      setIsEditing(false);
    } catch (error) {
      console.error('Error updating event:', error);
      alert('Error al actualizar el evento');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedProject || !event.id) return;
    if (!window.confirm('¿Estás seguro de que deseas eliminar este evento?')) return;

    setLoading(true);
    try {
      const eventRef = doc(db, `projects/${selectedProject.id}/events`, event.id);
      await deleteDoc(eventRef);
      onClose();
    } catch (error) {
      console.error('Error deleting event:', error);
      alert('Error al eliminar el evento');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
        >
          <div
            onClick={onClose}
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-emerald-500/30 rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl shadow-emerald-500/10 flex flex-col max-h-[90vh]"
          >
            <div className="p-6 border-b border-zinc-200 dark:border-white/5 flex items-center justify-between bg-gradient-to-r from-emerald-500/10 to-transparent shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center text-emerald-500 shrink-0">
                  <Calendar className="w-5 h-5 sm:w-6 sm:h-6" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-black text-zinc-900 dark:text-white uppercase tracking-tight truncate">
                    {isEditing ? 'Editar Evento' : 'Detalles del Evento'}
                  </h2>
                  <p className="text-[10px] text-emerald-600 dark:text-emerald-300 font-bold uppercase tracking-widest truncate">
                    {event.type}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {!isEditing && (
                  <>
                    <button
                      onClick={() => setIsEditing(true)}
                      className="p-2 hover:bg-zinc-100 dark:hover:bg-white/10 rounded-xl transition-colors text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white shrink-0"
                      title="Editar"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={handleDelete}
                      className="p-2 hover:bg-rose-50 dark:hover:bg-rose-500/20 rounded-xl transition-colors text-zinc-500 dark:text-zinc-400 hover:text-rose-600 dark:hover:text-rose-500 shrink-0"
                      title="Eliminar"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </>
                )}
                <button
                  onClick={onClose}
                  className="p-2 hover:bg-zinc-100 dark:hover:bg-white/10 rounded-xl transition-colors text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white shrink-0"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="overflow-y-auto custom-scrollbar flex-1">
              {isEditing ? (
                <form id="edit-event-form" onSubmit={handleUpdate} className="p-6 space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">
                      Título del Evento
                    </label>
                    <div className="relative">
                      <Type className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                      <input
                        type="text"
                        required
                        value={formData.title || ''}
                        onChange={e => setFormData({ ...formData, title: e.target.value })}
                        className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-white/10 rounded-xl py-3 pl-11 pr-4 text-sm text-zinc-900 dark:text-white focus:outline-none focus:border-emerald-500 transition-colors"
                        placeholder="Ej: Capacitación de Altura"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">
                        Fecha
                      </label>
                      <div className="relative">
                        <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                        <input
                          type="date"
                          required
                          value={formData.date || ''}
                          onChange={e => setFormData({ ...formData, date: e.target.value })}
                          className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-white/10 rounded-xl py-3 pl-11 pr-4 text-sm text-zinc-900 dark:text-white focus:outline-none focus:border-emerald-500 transition-colors"
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">
                        Hora
                      </label>
                      <div className="relative">
                        <Clock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                        <input
                          type="time"
                          required
                          value={formData.time || ''}
                          onChange={e => setFormData({ ...formData, time: e.target.value })}
                          className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-white/10 rounded-xl py-3 pl-11 pr-4 text-sm text-zinc-900 dark:text-white focus:outline-none focus:border-emerald-500 transition-colors"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">
                      Ubicación
                    </label>
                    <div className="relative">
                      <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                      <input
                        type="text"
                        required
                        value={formData.location || ''}
                        onChange={e => setFormData({ ...formData, location: e.target.value })}
                        className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-white/10 rounded-xl py-3 pl-11 pr-4 text-sm text-zinc-900 dark:text-white focus:outline-none focus:border-emerald-500 transition-colors"
                        placeholder="Ej: Sala de Reuniones 1"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">
                      Tipo de Evento
                    </label>
                    <select
                      value={formData.type || 'Reunión'}
                      onChange={e => setFormData({ ...formData, type: e.target.value as any })}
                      className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-white/10 rounded-xl py-3 px-4 text-sm text-zinc-900 dark:text-white focus:outline-none focus:border-emerald-500 transition-colors appearance-none"
                    >
                      <option value="Capacitación">Capacitación</option>
                      <option value="Inspección">Inspección</option>
                      <option value="Auditoría">Auditoría</option>
                      <option value="Reunión">Reunión</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">
                      Descripción
                    </label>
                    <div className="relative">
                      <FileText className="absolute left-4 top-4 w-4 h-4 text-zinc-500" />
                      <textarea
                        required
                        value={formData.description || ''}
                        onChange={e => setFormData({ ...formData, description: e.target.value })}
                        className="w-full bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-white/10 rounded-xl py-3 pl-11 pr-4 text-sm text-zinc-900 dark:text-white focus:outline-none focus:border-emerald-500 transition-colors min-h-[100px] resize-none"
                        placeholder="Detalles del evento..."
                      />
                    </div>
                  </div>
                </form>
              ) : (
                <div className="p-6 space-y-6">
                  <div>
                    <h3 className="text-xl font-black text-zinc-900 dark:text-white">{event.title}</h3>
                    <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-2 whitespace-pre-wrap">{event.description}</p>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-zinc-50 dark:bg-zinc-950 p-4 rounded-xl border border-zinc-200 dark:border-white/5">
                      <div className="flex items-center gap-2 text-zinc-500 mb-1">
                        <Calendar className="w-4 h-4" />
                        <span className="text-[10px] font-black uppercase tracking-widest">Fecha</span>
                      </div>
                      <p className="text-sm font-medium text-zinc-900 dark:text-white">{event.date}</p>
                    </div>
                    <div className="bg-zinc-50 dark:bg-zinc-950 p-4 rounded-xl border border-zinc-200 dark:border-white/5">
                      <div className="flex items-center gap-2 text-zinc-500 mb-1">
                        <Clock className="w-4 h-4" />
                        <span className="text-[10px] font-black uppercase tracking-widest">Hora</span>
                      </div>
                      <p className="text-sm font-medium text-zinc-900 dark:text-white">{event.time}</p>
                    </div>
                    <div className="col-span-2 bg-zinc-50 dark:bg-zinc-950 p-4 rounded-xl border border-zinc-200 dark:border-white/5">
                      <div className="flex items-center gap-2 text-zinc-500 mb-1">
                        <MapPin className="w-4 h-4" />
                        <span className="text-[10px] font-black uppercase tracking-widest">Ubicación</span>
                      </div>
                      <p className="text-sm font-medium text-zinc-900 dark:text-white">{event.location}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="p-6 border-t border-zinc-200 dark:border-white/5 bg-zinc-50 dark:bg-zinc-900 shrink-0 flex gap-3">
              {isEditing ? (
                <>
                  <button
                    type="button"
                    onClick={() => setIsEditing(false)}
                    className="flex-1 py-3 px-4 rounded-xl font-black text-xs uppercase tracking-widest text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200 dark:hover:bg-white/5 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    form="edit-event-form"
                    disabled={loading}
                    className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white py-3 px-4 rounded-xl font-black text-xs uppercase tracking-widest transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    <span>Guardar</span>
                  </button>
                </>
              ) : (
                <button
                  onClick={onClose}
                  className="w-full py-3 px-4 rounded-xl font-black text-xs uppercase tracking-widest text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200 dark:hover:bg-white/5 transition-colors border border-zinc-200 dark:border-white/10"
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
