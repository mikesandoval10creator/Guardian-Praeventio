import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, UserPlus, Trash2, Mail, Shield, Loader2, CheckCircle2, AlertCircle, Crown } from 'lucide-react';
import { auth } from '../../services/firebase';
import { useFirebase } from '../../contexts/FirebaseContext';
import { Project } from '../../contexts/ProjectContext';

interface Member {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string | null;
  role: string;
  isCreator: boolean;
}

interface PendingInvitation {
  id: string;
  invitedEmail: string;
  invitedRole: string;
  createdAt: string;
  expiresAt: string;
}

const PROJECT_ROLES = [
  { value: 'gerente', label: 'Gerente' },
  { value: 'prevencionista', label: 'Prevencionista' },
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'director_obra', label: 'Director de Obra' },
  { value: 'medico_ocupacional', label: 'Médico Ocupacional' },
  { value: 'operario', label: 'Operario' },
  { value: 'contratista', label: 'Contratista' },
];

interface Props {
  project: Project;
  onClose: () => void;
}

export const TeamManagementModal: React.FC<Props> = ({ project, onClose }) => {
  const { user } = useFirebase();
  const [members, setMembers] = useState<Member[]>([]);
  const [pendingInvitations, setPendingInvitations] = useState<PendingInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('prevencionista');
  const [isSending, setIsSending] = useState(false);
  const [removingUid, setRemovingUid] = useState<string | null>(null);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const getToken = async () => {
    if (!auth.currentUser) throw new Error('Not authenticated');
    return auth.currentUser.getIdToken();
  };

  const loadMembers = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getToken();
      const res = await fetch(`/api/projects/${project.id}/members`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to load members');
      const data = await res.json();
      setMembers(data.members || []);
      setPendingInvitations(data.pendingInvitations || []);
    } catch {
      setFeedback({ type: 'error', msg: 'Error al cargar los miembros del equipo.' });
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => { loadMembers(); }, [loadMembers]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setIsSending(true);
    setFeedback(null);
    try {
      const token = await getToken();
      const res = await fetch(`/api/projects/${project.id}/invite`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ invitedEmail: inviteEmail.trim(), invitedRole: inviteRole }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al enviar invitación');
      setFeedback({ type: 'success', msg: `Invitación enviada a ${inviteEmail.trim()}` });
      setInviteEmail('');
      await loadMembers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al enviar invitación';
      setFeedback({ type: 'error', msg });
    } finally {
      setIsSending(false);
    }
  };

  const handleRemoveMember = async (uid: string) => {
    setRemovingUid(uid);
    setFeedback(null);
    try {
      const token = await getToken();
      const res = await fetch(`/api/projects/${project.id}/members/${uid}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Error al eliminar miembro');
      }
      await loadMembers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al eliminar miembro';
      setFeedback({ type: 'error', msg });
    } finally {
      setRemovingUid(null);
    }
  };

  const handleCancelInvite = async (inviteId: string, invitedEmail: string) => {
    setCancelingId(inviteId);
    setFeedback(null);
    try {
      const token = await getToken();
      const res = await fetch(`/api/projects/${project.id}/invite`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteId }),
      });
      if (!res.ok) throw new Error('Error al cancelar la invitación');
      setFeedback({ type: 'success', msg: `Invitación a ${invitedEmail} cancelada` });
      await loadMembers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al cancelar invitación';
      setFeedback({ type: 'error', msg });
    } finally {
      setCancelingId(null);
    }
  };

  const isCreator = project.createdBy === user?.uid;
  const roleLabel = (role: string) => PROJECT_ROLES.find(r => r.value === role)?.label || role;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-3xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-zinc-100 dark:border-white/10 shrink-0">
          <div>
            <h2 className="text-lg font-black uppercase tracking-tight">Gestionar Equipo</h2>
            <p className="text-xs text-zinc-500 mt-0.5 truncate">{project.name}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-white/10 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Feedback */}
          <AnimatePresence>
            {feedback && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className={`flex items-center gap-2 p-3 rounded-xl text-sm ${
                  feedback.type === 'success'
                    ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'
                    : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
                }`}
              >
                {feedback.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
                <span>{feedback.msg}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Invite form — only visible to creator */}
          {isCreator && (
            <div>
              <h3 className="text-xs font-black uppercase tracking-widest text-zinc-500 mb-3">Invitar al equipo</h3>
              <form onSubmit={handleInvite} className="space-y-3">
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  placeholder="correo@empresa.cl"
                  className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  required
                />
                <div className="flex gap-2">
                  <select
                    value={inviteRole}
                    onChange={e => setInviteRole(e.target.value)}
                    className="flex-1 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-white/10 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    {PROJECT_ROLES.map(r => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    disabled={isSending || !inviteEmail.trim()}
                    className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-sm font-bold transition-colors"
                  >
                    {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                    Invitar
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Current members */}
          <div>
            <h3 className="text-xs font-black uppercase tracking-widest text-zinc-500 mb-3">
              Equipo actual {!loading && `(${members.length})`}
            </h3>
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
              </div>
            ) : (
              <ul className="space-y-2">
                {members.map(member => (
                  <li key={member.uid} className="flex items-center gap-3 p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl">
                    <div className="w-9 h-9 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center shrink-0 text-sm font-bold text-emerald-700 dark:text-emerald-300 overflow-hidden">
                      {member.photoURL ? (
                        <img src={member.photoURL} alt="" className="w-full h-full object-cover" />
                      ) : (
                        member.displayName.charAt(0).toUpperCase()
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-bold truncate">{member.displayName}</p>
                        {member.isCreator && <Crown className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
                      </div>
                      <p className="text-xs text-zinc-500 truncate">{member.email}</p>
                    </div>
                    <span className="text-xs bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 px-2 py-0.5 rounded-lg font-medium shrink-0">
                      {roleLabel(member.role)}
                    </span>
                    {isCreator && !member.isCreator && (
                      <button
                        onClick={() => handleRemoveMember(member.uid)}
                        disabled={removingUid === member.uid}
                        className="p-1.5 rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50 shrink-0"
                        title="Eliminar del proyecto"
                      >
                        {removingUid === member.uid ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Pending invitations */}
          {pendingInvitations.length > 0 && (
            <div>
              <h3 className="text-xs font-black uppercase tracking-widest text-zinc-500 mb-3">
                Invitaciones pendientes ({pendingInvitations.length})
              </h3>
              <ul className="space-y-2">
                {pendingInvitations.map(invite => (
                  <li key={invite.id} className="flex items-center gap-3 p-3 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-500/20 rounded-xl">
                    <Mail className="w-4 h-4 text-amber-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{invite.invitedEmail}</p>
                      <p className="text-xs text-zinc-500">{roleLabel(invite.invitedRole)} · Expira {new Date(invite.expiresAt).toLocaleDateString('es-CL')}</p>
                    </div>
                    {isCreator && (
                      <button
                        onClick={() => handleCancelInvite(invite.id, invite.invitedEmail)}
                        disabled={cancelingId === invite.id}
                        className="p-1.5 rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50 shrink-0"
                        title="Cancelar invitación"
                      >
                        {cancelingId === invite.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-zinc-100 dark:border-white/10 shrink-0">
          <p className="text-xs text-center text-zinc-400 flex items-center justify-center gap-1.5">
            <Shield className="w-3.5 h-3.5" />
            Los miembros acceden solo a los datos de este proyecto
          </p>
        </div>
      </motion.div>
    </div>
  );
};
