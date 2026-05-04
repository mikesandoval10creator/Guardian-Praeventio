import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useFirebase } from '../../contexts/FirebaseContext';
import { Bell, X } from 'lucide-react';

interface PendingInvite {
  id: string;
  projectName: string;
  invitedRole: string;
  token: string;
  expiresAt: string;
}

export function PendingInvitesBanner() {
  const { t } = useTranslation();
  const { user } = useFirebase();
  const navigate = useNavigate();
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!user?.email) return;

    const q = query(
      collection(db, 'invitations'),
      where('invitedEmail', '==', user.email),
      where('status', '==', 'pending')
    );

    const unsub = onSnapshot(q, snapshot => {
      const now = new Date();
      setInvites(
        snapshot.docs
          .map(d => ({ id: d.id, ...(d.data() as Omit<PendingInvite, 'id'>) }))
          .filter(inv => new Date(inv.expiresAt) > now)
      );
      setDismissed(false);
    });

    return unsub;
  }, [user?.email]);

  if (dismissed || invites.length === 0) return null;

  const first = invites[0];

  return (
    <div className="mx-3 mt-2 mb-0 bg-[#4db6ac]/10 border border-[#4db6ac]/30 rounded-xl px-4 py-2.5 flex items-center gap-3">
      <Bell className="w-4 h-4 text-[#4db6ac] shrink-0" />
      <p className="text-xs font-bold text-[#4db6ac] flex-1">
        {invites.length === 1
          ? (
            <>
              {t('pending_invites.single_prefix', 'Tienes una invitación pendiente a ')}
              <span className="text-white">{first.projectName}</span>
            </>
          )
          : (
            <>
              {t('pending_invites.multiple_prefix', 'Tienes ')}
              <span className="text-white">{invites.length}</span>
              {t('pending_invites.multiple_suffix', ' invitaciones de equipo pendientes')}
            </>
          )
        }
      </p>
      <button
        onClick={() => navigate(`/invite?token=${first.token}`)}
        className="text-[10px] font-black uppercase tracking-wider text-[#4db6ac] hover:text-[#3a9e95] transition-colors whitespace-nowrap"
      >
        {t('pending_invites.cta_view', 'Ver')}
      </button>
      <button
        onClick={() => setDismissed(true)}
        className="text-zinc-500 hover:text-zinc-300 transition-colors"
        aria-label={t('pending_invites.dismiss_aria', 'Descartar')}
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
