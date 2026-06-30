import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  User as UserIcon,
  Shield, 
  Award, 
  Settings, 
  LogOut, 
  Bell, 
  Lock, 
  HelpCircle, 
  ChevronRight, 
  Activity, 
  MapPin, 
  MessageSquare, 
  Heart,
  Flame,
  Star,
  Trophy,
  Users,
  Target,
  Zap,
  CheckCircle2,
  TrendingUp
} from 'lucide-react';
import { Card, Button } from '../components/shared/Card';
import { useFirebase } from '../contexts/FirebaseContext';
import { logOut } from '../services/firebase';
import { useNavigate } from 'react-router-dom';
import { useFirestoreCollection } from '../hooks/useFirestoreCollection';
import { TrainingSession, SafetyPost, RiskNode, NodeType } from '../types';
import { motion } from 'framer-motion';
import { get, set } from 'idb-keyval';

import { MFASetupModal } from '../components/auth/MFASetupModal';
import { Medal3DViewer } from '../components/gamification/Medal3DViewer';

export function Profile() {
  const { t } = useTranslation();
  const { user, isAdmin } = useFirebase();
  const navigate = useNavigate();
  const [isMfaSetupOpen, setIsMfaSetupOpen] = useState(false);

  const { data: sessions } = useFirestoreCollection<TrainingSession>('training');

  const totalPoints = sessions.reduce((total, session) => {
    if (session.status === 'completed' && session.attendees?.includes(user?.uid || '')) {
      return total + (session.points || 100);
    }
    return total;
  }, 0);

  const completedCourses = sessions.filter(s => s.status === 'completed' && s.attendees?.includes(user?.uid || '')).length;
  const { data: posts } = useFirestoreCollection<SafetyPost>('safety_posts');
  const userPosts = posts.filter(p => p.userId === user?.uid).length;
  const userLikes = posts.reduce((total, p) => total + (p.likes.includes(user?.uid || '') ? 1 : 0), 0);

  const { data: nodes } = useFirestoreCollection<RiskNode>('nodes');
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentIncidents = nodes.filter(n => n.type === NodeType.INCIDENT && new Date(n.createdAt).getTime() > sevenDaysAgo).length;

  const memberSince = user?.metadata?.creationTime ? new Date(user.metadata.creationTime).getTime() : Date.now();
  const daysSinceMember = Math.floor((Date.now() - memberSince) / (24 * 60 * 60 * 1000));

  const handleLogout = async () => {
    await logOut();
    navigate('/login');
  };

  const achievements = [
    { id: 1, title: t('profile.achievements.first_steps.title', 'Primeros Pasos'), description: t('profile.achievements.first_steps.desc', 'Completa tu primera capacitación'), icon: Target, color: 'text-blue-500', bg: 'bg-blue-500/10', completed: completedCourses >= 1 },
    { id: 2, title: t('profile.achievements.active_guardian.title', 'Guardián Activo'), description: t('profile.achievements.active_guardian.desc', 'Publica 5 veces en el muro'), icon: MessageSquare, color: 'text-[#4db6ac] dark:text-[#d4af37]', bg: 'bg-[#4db6ac]/10', completed: userPosts >= 5 },
    { id: 3, title: t('profile.achievements.risk_expert.title', 'Experto en Riesgos'), description: t('profile.achievements.risk_expert.desc', 'Identifica 10 hallazgos'), icon: Shield, color: 'text-amber-500', bg: 'bg-amber-500/10', completed: totalPoints > 1000 },
    { id: 4, title: t('profile.achievements.safety_leader.title', 'Líder de Seguridad'), description: t('profile.achievements.safety_leader.desc', 'Llega al nivel 10'), icon: Trophy, color: 'text-purple-500', bg: 'bg-purple-500/10', completed: totalPoints > 5000 },
    { id: 5, title: t('profile.achievements.unbeaten_week.title', 'Semana Invicta'), description: t('profile.achievements.unbeaten_week.desc', 'Sin incidentes registrados en 7 días'), icon: Zap, color: 'text-amber-500', bg: 'bg-amber-500/10', completed: recentIncidents === 0 },
    { id: 6, title: t('profile.achievements.knowledge_curator.title', 'Curador del Conocimiento'), description: t('profile.achievements.knowledge_curator.desc', 'Recibe 10 likes en publicaciones'), icon: Heart, color: 'text-rose-500', bg: 'bg-rose-500/10', completed: userLikes >= 10 },
    { id: 7, title: t('profile.achievements.field_veteran.title', 'Veterano de Campo'), description: t('profile.achievements.field_veteran.desc', 'Lleva 30+ días en la plataforma'), icon: Star, color: 'text-indigo-500', bg: 'bg-indigo-500/10', completed: daysSinceMember >= 30 },
    { id: 8, title: t('profile.achievements.star_collaborator.title', 'Colaborador Estrella'), description: t('profile.achievements.star_collaborator.desc', 'Completa 3 o más capacitaciones'), icon: TrendingUp, color: 'text-teal-500', bg: 'bg-teal-500/10', completed: completedCourses >= 3 },
  ];

  return (
    <div className="max-w-2xl mx-auto space-y-8 pb-20">
      {/* Header Section - Duolingo Style */}
      <div className="flex items-start justify-between px-4">
        <div className="space-y-2">
          <h1 className="text-3xl font-black text-primary-token tracking-tight">{user?.displayName || t('profile.user_fallback', 'Usuario')}</h1>
          <p className="text-sm font-bold text-muted-token uppercase tracking-widest">{t('profile.joined_on', 'Se unió en Marzo 2024')}</p>
          <div className="flex items-center gap-4 pt-2">
            <div className="flex items-center gap-1">
              <Users className="w-4 h-4 text-[#4db6ac] dark:text-[#d4af37]" />
              <span className="text-xs font-black text-[#4db6ac] dark:text-[#d4af37]">{t('profile.following', '{{count}} Siguiendo', { count: 12 })}</span>
            </div>
            <div className="flex items-center gap-1">
              <Users className="w-4 h-4 text-[#4db6ac] dark:text-[#d4af37]" />
              <span className="text-xs font-black text-[#4db6ac] dark:text-[#d4af37]">{t('profile.followers', '{{count}} Seguidores', { count: 48 })}</span>
            </div>
          </div>
        </div>
        <div className="relative">
          <div className="w-24 h-24 rounded-3xl bg-elevated border-4 border-default-token overflow-hidden shadow-2xl rotate-3">
            {user?.photoURL ? (
              <img src={user.photoURL} alt={user.displayName || ''} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-[#4db6ac]">
                <UserIcon className="w-12 h-12 text-white" />
              </div>
            )}
          </div>
          <div className="absolute -bottom-2 -right-2 bg-surface p-1.5 rounded-xl shadow-lg border border-default-token">
            <div className="w-6 h-6 bg-[#4db6ac] rounded-lg flex items-center justify-center">
              <Shield className="w-3.5 h-3.5 text-white" />
            </div>
          </div>
        </div>
      </div>

      {/* 3D Medal Showcase */}
      <div className="px-2">
        <Card className="p-4 border-2 border-default-token rounded-[32px] overflow-hidden bg-gradient-to-b from-zinc-50 to-white dark:from-zinc-900 dark:to-black">
          <div className="text-center mb-2">
            <h2 className="text-sm font-black text-primary-token uppercase tracking-tighter">{t('profile.current_medal', 'Medalla Actual')}</h2>
            <p className="text-[10px] text-muted-token font-bold uppercase tracking-widest">{t('profile.spin_to_interact', 'Gira para interactuar')}</p>
          </div>
          <Medal3DViewer title={t('profile.medal_unbeaten_week', 'SEMANA INVICTA')} color="#fbbf24" />
        </Card>
      </div>

      {/* Stats Bar - The "Duolingo" Icons */}
      <div className="grid grid-cols-3 gap-3 px-2">
        <Card className="p-4 border-2 border-orange-500/20 bg-orange-500/5 flex flex-col items-center gap-1 rounded-3xl">
          <Flame className="w-6 h-6 text-orange-500 fill-orange-500" />
          <span className="text-xl font-black text-orange-600">12</span>
          <span className="text-[8px] font-black text-orange-500/60 uppercase tracking-widest">{t('profile.streak_days', 'Días Racha')}</span>
        </Card>
        <Card className="p-4 border-2 border-[#4db6ac]/20 dark:border-[#d4af37]/20 bg-[#4db6ac]/5 dark:bg-[#d4af37]/5 flex flex-col items-center gap-1 rounded-3xl">
          <Star className="w-6 h-6 text-[#4db6ac] dark:text-[#d4af37] fill-[#4db6ac] dark:fill-[#d4af37]" />
          <span className="text-xl font-black text-[#4db6ac] dark:text-[#d4af37]">{totalPoints}</span>
          <span className="text-[8px] font-black text-[#4db6ac]/60 dark:text-[#d4af37]/60 uppercase tracking-widest">{t('profile.total_xp', 'Total XP')}</span>
        </Card>
        <Card className="p-4 border-2 border-blue-500/20 bg-blue-500/5 flex flex-col items-center gap-1 rounded-3xl">
          <Trophy className="w-6 h-6 text-blue-500 fill-blue-500" />
          <span className="text-xl font-black text-blue-600">{t('profile.league_gold', 'Oro')}</span>
          <span className="text-[8px] font-black text-blue-500/60 uppercase tracking-widest">{t('profile.current_league', 'Liga Actual')}</span>
        </Card>
      </div>

      {/* Achievements Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between px-4">
          <h2 className="text-lg font-black text-primary-token uppercase tracking-tighter">{t('profile.achievements_title', 'Logros')}</h2>
          <button onClick={() => navigate('/gamification')} className="text-[10px] font-black text-[#4db6ac] dark:text-[#d4af37] uppercase tracking-widest hover:underline">{t('profile.view_all', 'Ver todos')}</button>
        </div>
        <div className="grid grid-cols-1 gap-3 px-2">
          {achievements.map((achievement) => (
            <Card key={achievement.id} className={`p-4 border-2 ${achievement.completed ? 'border-zinc-200 dark:border-zinc-800' : 'border-zinc-100 dark:border-zinc-900 opacity-50'} flex items-center gap-4 rounded-3xl transition-all hover:scale-[1.02]`}>
              <div className={`w-14 h-14 rounded-2xl ${achievement.bg} flex items-center justify-center shrink-0`}>
                <achievement.icon className={`w-7 h-7 ${achievement.color}`} />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-black text-primary-token uppercase tracking-tight">{achievement.title}</h3>
                <p className="text-xs text-muted-token font-medium">{achievement.description}</p>
                {achievement.completed && (
                  <div className="mt-2 h-1.5 w-full bg-elevated rounded-full overflow-hidden">
                    <div className="h-full bg-[#4db6ac] w-full" />
                  </div>
                )}
              </div>
              {achievement.completed ? (
                <CheckCircle2 className="w-6 h-6 text-[#4db6ac] dark:text-[#d4af37]" />
              ) : (
                <div className="w-6 h-6 rounded-full border-2 border-default-token" />
              )}
            </Card>
          ))}
        </div>
      </div>

      {/* Friends Activity */}
      <div className="space-y-4">
        <h2 className="text-lg font-black text-primary-token uppercase tracking-tighter px-4">{t('profile.friends', 'Amigos')}</h2>
        <Card className="mx-2 p-6 rounded-[32px] bg-zinc-900 border-none relative overflow-hidden">
          <div className="absolute top-0 right-0 p-8 opacity-10">
            <Users className="w-24 h-24 text-white" />
          </div>
          <div className="relative z-10 space-y-4">
            <p className="text-zinc-400 text-sm font-medium">{t('profile.friends_desc', 'Encuentra a tus compañeros de equipo y compite por ser el más seguro.')}</p>
            <Button className="bg-white text-black hover:bg-zinc-200 font-black text-[10px] uppercase tracking-widest py-3 px-8 rounded-2xl">
              {t('profile.add_friends', 'Añadir Amigos')}
            </Button>
          </div>
        </Card>
      </div>

      {/* Settings & Logout */}
      <div className="px-4 pt-8 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Button 
            variant="secondary" 
            onClick={() => setIsMfaSetupOpen(true)}
            className="flex items-center justify-center gap-2 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest border-2 border-default-token"
          >
            <Shield className="w-4 h-4" />
            MFA
          </Button>
          <Button 
            variant="secondary" 
            onClick={() => navigate('/settings')}
            className="flex items-center justify-center gap-2 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest border-2 border-default-token"
          >
            <Settings className="w-4 h-4" />
            {t('profile.settings', 'Ajustes')}
          </Button>
          <Button 
            variant="danger" 
            onClick={handleLogout}
            className="flex items-center justify-center gap-2 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest bg-rose-500 hover:bg-rose-600 text-white border-none"
          >
            <LogOut className="w-4 h-4" />
            {t('profile.logout', 'Salir')}
          </Button>
        </div>
      </div>

      <MFASetupModal 
        isOpen={isMfaSetupOpen} 
        onClose={() => setIsMfaSetupOpen(false)} 
        onComplete={async () => {
          await set('mfa_setup_completed', 'true');
          setIsMfaSetupOpen(false);
        }} 
      />
    </div>
  );
}
