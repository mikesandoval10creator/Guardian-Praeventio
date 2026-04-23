import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ShieldCheck, Loader2, AlertTriangle, LogIn, CheckCircle2, UserCheck } from 'lucide-react';
import { useFirebase } from '../contexts/FirebaseContext';
import { signInWithGoogle, auth } from '../services/firebase';

interface InviteInfo {
  projectName: string;
  invitedRole: string;
  invitedEmail: string;
  expiresAt: string;
}

const ROLE_LABELS: Record<string, string> = {
  gerente: 'Gerente de Prevención',
  prevencionista: 'Prevencionista de Riesgos',
  supervisor: 'Supervisor',
  director_obra: 'Director de Obra',
  medico_ocupacional: 'Médico Ocupacional',
  operario: 'Operario',
  contratista: 'Contratista',
};

export function InviteAccept() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const navigate = useNavigate();
  const { user } = useFirebase();

  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  // Load invite info (no auth required)
  useEffect(() => {
    if (!token) { setInfoError('Token de invitación inválido.'); return; }
    fetch(`/api/invitations/info/${token}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) setInfoError(data.error);
        else setInfo(data);
      })
      .catch(() => setInfoError('No se pudo cargar la invitación.'));
  }, [token]);

  // Auto-accept once user is authenticated and info is loaded
  useEffect(() => {
    if (!user || !info || accepted || accepting) return;
    handleAccept();
  }, [user, info]);

  const handleAccept = async () => {
    if (!user || accepting) return;
    setAccepting(true);
    setAcceptError(null);
    try {
      const idToken = await auth.currentUser!.getIdToken();
      const res = await fetch(`/api/invitations/${token}/accept`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al aceptar la invitación');
      setAccepted(true);
      setTimeout(() => navigate('/projects'), 2500);
    } catch (err: any) {
      setAcceptError(err.message || 'Error desconocido');
    } finally {
      setAccepting(false);
    }
  };

  const handleSignIn = async () => {
    setSigningIn(true);
    try {
      await signInWithGoogle();
      // After sign-in, the useEffect above will trigger handleAccept
    } catch {
      setAcceptError('No se pudo iniciar sesión. Intenta de nuevo.');
    } finally {
      setSigningIn(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
      {/* Background glow */}
      <div className="absolute inset-0 bg-gradient-to-br from-emerald-950/30 via-zinc-950 to-blue-950/20 pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="relative z-10 w-full max-w-md"
      >
        {/* Card */}
        <div className="bg-zinc-900 border border-white/10 rounded-3xl overflow-hidden shadow-2xl">
          {/* Header */}
          <div className="bg-zinc-800/50 px-8 pt-8 pb-6 text-center border-b border-white/5">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-4">
              <ShieldCheck className="w-7 h-7 text-emerald-500" />
            </div>
            <p className="text-[10px] font-black uppercase tracking-widest text-emerald-500 mb-1">Praeventio Guard</p>
            <h1 className="text-xl font-black text-white uppercase tracking-tight">Invitación de Equipo</h1>
          </div>

          <div className="px-8 py-7 space-y-6">
            {/* Loading info */}
            {!info && !infoError && (
              <div className="flex justify-center py-6">
                <Loader2 className="w-7 h-7 text-emerald-500 animate-spin" />
              </div>
            )}

            {/* Error loading info */}
            {infoError && (
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                <AlertTriangle className="w-10 h-10 text-rose-500" />
                <p className="text-sm font-bold text-white">Invitación no disponible</p>
                <p className="text-xs text-zinc-400">{infoError}</p>
                <button onClick={() => navigate('/')} className="mt-2 text-xs font-black uppercase tracking-widest text-emerald-500 hover:text-emerald-400 transition-colors">
                  Ir al Inicio
                </button>
              </div>
            )}

            {/* Invite details */}
            {info && !accepted && (
              <>
                <div className="space-y-3">
                  <div className="bg-zinc-800/50 rounded-2xl p-4 text-center">
                    <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500 mb-1">Proyecto</p>
                    <p className="text-lg font-black text-white">{info.projectName}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-zinc-800/50 rounded-2xl p-4 text-center">
                      <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500 mb-1">Tu rol</p>
                      <p className="text-sm font-black text-emerald-400">{ROLE_LABELS[info.invitedRole] || info.invitedRole}</p>
                    </div>
                    <div className="bg-zinc-800/50 rounded-2xl p-4 text-center">
                      <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500 mb-1">Expira</p>
                      <p className="text-sm font-black text-zinc-300">{new Date(info.expiresAt).toLocaleDateString('es-CL')}</p>
                    </div>
                  </div>
                </div>

                {/* Accepting state */}
                {accepting && (
                  <div className="flex flex-col items-center gap-2 py-2">
                    <Loader2 className="w-6 h-6 text-emerald-500 animate-spin" />
                    <p className="text-xs text-zinc-400 uppercase tracking-widest font-bold">Aceptando invitación...</p>
                  </div>
                )}

                {/* Accept error */}
                {acceptError && (
                  <div className="flex items-center gap-2 text-rose-500 text-xs font-bold bg-rose-500/10 border border-rose-500/20 rounded-xl p-3">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    {acceptError}
                  </div>
                )}

                {/* Action: user not logged in */}
                {!user && !accepting && (
                  <div className="space-y-3">
                    <p className="text-xs text-zinc-400 text-center">
                      Inicia sesión con la cuenta <span className="text-white font-bold">{info.invitedEmail}</span> para aceptar.
                    </p>
                    <button
                      onClick={handleSignIn}
                      disabled={signingIn}
                      className="w-full flex items-center justify-center gap-3 py-3.5 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-white font-black uppercase tracking-widest text-sm transition-colors disabled:opacity-50"
                    >
                      {signingIn ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
                      {signingIn ? 'Iniciando...' : 'Aceptar con Google'}
                    </button>
                  </div>
                )}

                {/* Action: user logged in, waiting for auto-accept */}
                {user && !accepting && !acceptError && (
                  <div className="flex items-center gap-2 text-xs text-zinc-400 justify-center">
                    <UserCheck className="w-4 h-4 text-emerald-500" />
                    Sesión activa como <span className="text-white font-bold ml-1">{user.email}</span>
                  </div>
                )}

                {/* Manual retry if needed */}
                {user && !accepting && acceptError && (
                  <button
                    onClick={handleAccept}
                    className="w-full py-3 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-white font-black uppercase tracking-widest text-sm transition-colors"
                  >
                    Reintentar
                  </button>
                )}
              </>
            )}

            {/* Success state */}
            {accepted && (
              <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center gap-3 py-6 text-center">
                <CheckCircle2 className="w-12 h-12 text-emerald-500" />
                <p className="text-lg font-black text-white uppercase tracking-tight">¡Bienvenido al equipo!</p>
                <p className="text-sm text-zinc-400">Redirigiendo a Proyectos...</p>
                <Loader2 className="w-4 h-4 text-emerald-500 animate-spin mt-1" />
              </motion.div>
            )}
          </div>
        </div>

        <p className="text-center text-[10px] text-zinc-600 mt-4 font-bold uppercase tracking-widest">
          © {new Date().getFullYear()} Praeventio Guard
        </p>
      </motion.div>
    </div>
  );
}
