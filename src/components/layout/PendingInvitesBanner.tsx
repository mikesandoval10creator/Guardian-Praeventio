import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { UserPlus, Check, X, Loader2 } from 'lucide-react';
import { db, collection, query, where, onSnapshot } from '../../services/firebase';
import { auth } from '../../services/firebase';
import { useFirebase } from '../../contexts/FirebaseContext';

interface PendingInvite {
  id: string;
  projectId: string;
  projectName: string;
  invitedRole: string;
  token: string;
}

export const PendingInvitesBanner: React.FC = () => {
  const { user } = useFirebase();
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [processing, setProcessing] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!user?.email) return;

    const q = query(
      collection(db, 'invitations'),
      where('invitedEmail', '==', user.email),
      where('status', '==', 'pending')
    );

    const unsub = onSnapshot(q, snapshot => {
      const pending = snapshot.docs.map(doc => ({
        id: doc.id,
        projectId: doc.data().projectId,
        projectName: doc.data().projectName,
        invitedRole: doc.data().invitedRole,
        token: doc.data().token,
      }));
      setInvites(pending);
    });

    return () => unsub();
  }, [user?.email]);

  const visible = invites.filter(i => !dismissed.has(i.id));
  if (visible.length === 0) return null;

  const handleAccept = async (invite: PendingInvite) => {
    if (!auth.currentUser) return;
    setProcessing(invite.id);
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetch(`/api/invitations/${invite.token}/accept`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Error al aceptar');
      }
      // Firestore onSnapshot will remove this invite from the list automatically
    } catch (err) {
      console.error('Error accepting invitation:', err);
    } finally {
      setProcessing(null);
    }
  };

  const handleDismiss = (id: string) => {
    setDismissed(prev => new Set(prev).add(id));
  };

  const ROLE_LABELS: Record<string, string> = {
    gerente: 'Gerente', prevencionista: 'Prevencionista', supervisor: 'Supervisor',
    director_obra: 'Director de Obra', medico_ocupacional: 'Médico Ocupacional',
    operario: 'Operario', contratista: 'Contratista',
  };

  return (
    <AnimatePresence>
      {visible.map(invite => (
        <motion.div
          key={invite.id}
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, height: 0 }}
          className="bg-emerald-600 text-white px-4 py-3 flex items-center gap-3 text-sm"
        >
          <UserPlus className="w-4 h-4 shrink-0" />
          <p className="flex-1 text-sm">
            Te han invitado al proyecto{' '}
            <span className="font-bold">{invite.projectName}</span>
            {' '}como{' '}
            <span className="font-bold">{ROLE_LABELS[invite.invitedRole] || invite.invitedRole}</span>
          </p>
          <button
            onClick={() => handleAccept(invite)}
            disabled={processing === invite.id}
            className="flex items-center gap-1.5 bg-white text-emerald-700 px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-emerald-50 transition-colors disabled:opacity-60"
          >
            {processing === invite.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            Aceptar
          </button>
          <button
            onClick={() => handleDismiss(invite.id)}
            className="p-1 rounded-lg hover:bg-emerald-500 transition-colors"
            title="Ignorar"
          >
            <X className="w-4 h-4" />
          </button>
        </motion.div>
      ))}
    </AnimatePresence>
  );
};
