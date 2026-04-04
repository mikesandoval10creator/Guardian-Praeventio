import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Award, Star, Zap, Shield, Trophy, Target, Flame, Crown, Play, CheckCircle2, Lock, Eye, BookOpen, X, Loader2, AlertCircle, LucideIcon } from 'lucide-react';
import { useFirebase } from '../contexts/FirebaseContext';
import { validateRiskImageClick } from '../services/geminiService';
import { useGamification } from '../hooks/useGamification';
import { useFirestoreCollection } from '../hooks/useFirestoreCollection';
import confetti from 'canvas-confetti';
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../services/firebase';
import { PremiumFeatureGuard } from '../components/shared/PremiumFeatureGuard';
import { ExtinguisherSimulator } from '../components/gamification/ExtinguisherSimulator';

interface LeaderboardUser {
  id: string;
  name: string;
  role: string;
  points: number;
  medals: number;
  isCurrentUser: boolean;
}

interface Medal {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  color: string;
  unlocked: boolean;
  progress: number;
  total: number;
}

export function Gamification() {
  const { user } = useFirebase();
  const { stats, addPoints, unlockMedal, completeChallenge } = useGamification();
  const [activeTab, setActiveTab] = useState<'perfil' | 'medals' | 'games' | 'ranking'>('perfil');
  const [activeGame, setActiveGame] = useState<string | null>(null);
  const [validatingClick, setValidatingClick] = useState(false);
  const [gameResult, setGameResult] = useState<any>(null);
  const [clickPos, setClickPos] = useState<{x: number, y: number} | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardUser[]>([]);
  const [foundObjects, setFoundObjects] = useState<string[]>([]);
  const imageRef = useRef<HTMLImageElement>(null);

  // Check if daily challenge is completed today
  const today = new Date().toISOString().split('T')[0];
  const dailyChallengeCompleted = stats.completedChallenges?.['daily_mission']?.startsWith(today);
  const [dailyProgress, setDailyProgress] = useState(0);

  const handleClaimDaily = () => {
    if (!dailyChallengeCompleted && dailyProgress >= 100) {
      completeChallenge('daily_mission', 150);
      triggerConfetti();
    }
  };

  useEffect(() => {
    if (activeTab === 'ranking') {
      const fetchLeaderboard = async () => {
        try {
          const q = query(collection(db, 'user_stats'), orderBy('points', 'desc'), limit(10));
          const querySnapshot = await getDocs(q);
          const users: LeaderboardUser[] = [];
          querySnapshot.forEach((doc) => {
            const data = doc.data();
            users.push({
              id: doc.id,
              name: data.displayName || 'Usuario Anónimo',
              role: data.role || 'Usuario',
              points: data.points || 0,
              medals: data.medals?.length || 0,
              isCurrentUser: doc.id === user?.uid
            });
          });
          setLeaderboard(users);
        } catch (error) {
          console.error("Error fetching leaderboard:", error);
        }
      };
      fetchLeaderboard();
    }
  }, [activeTab, user]);

  const triggerConfetti = () => {
    const duration = 3 * 1000;
    const animationEnd = Date.now() + duration;
    const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 1000 };

    const randomInRange = (min: number, max: number) => Math.random() * (max - min) + min;

    const interval: any = setInterval(function() {
      const timeLeft = animationEnd - Date.now();

      if (timeLeft <= 0) {
        return clearInterval(interval);
      }

      const particleCount = 50 * (timeLeft / duration);
      confetti({
        ...defaults, particleCount,
        origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 }
      });
      confetti({
        ...defaults, particleCount,
        origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 }
      });
    }, 250);
  };

  const handleImageClick = async (e: React.MouseEvent<HTMLImageElement>) => {
    if (!imageRef.current || validatingClick || !activeGame) return;

    const rect = imageRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    setClickPos({ x, y });
    setValidatingClick(true);
    setGameResult(null);

    try {
      // Convert image to base64
      const canvas = document.createElement('canvas');
      canvas.width = imageRef.current.naturalWidth;
      canvas.height = imageRef.current.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(imageRef.current, 0, 0);
        const base64 = canvas.toDataURL('image/jpeg');
        const gameContext = games.find(g => g.id === activeGame)?.description || '';
        const result = await validateRiskImageClick(base64, x, y, rect.width, rect.height, gameContext);
        setGameResult(result);
        if (result.isRisk) {
          const game = games.find(g => g.id === activeGame);
          const pointsToAward = game?.points || 50;
          
          if (game?.type === 'find_objects' && result.foundObject) {
            if (!foundObjects.includes(result.foundObject)) {
              setFoundObjects(prev => [...prev, result.foundObject]);
              await addPoints(pointsToAward, `Objeto encontrado: ${result.foundObject}`);
              triggerConfetti();
            }
          } else {
            await addPoints(pointsToAward, `Riesgo detectado en ${game?.title}`);
            triggerConfetti();
          }
          
          if (!dailyChallengeCompleted) {
            setDailyProgress(prev => Math.min(prev + 50, 100));
          }
        }
      }
    } catch (error) {
      console.error("Error validating click:", error);
    } finally {
      setValidatingClick(false);
    }
  };

  const medals: Medal[] = [
    { id: '1', title: 'Guardián Novato', description: 'Completa tu primera capacitación en el AI Hub.', icon: Shield, color: 'text-emerald-500', unlocked: stats.medals.includes('1'), progress: stats.medals.includes('1') ? 1 : 0, total: 1 },
    { id: '2', title: 'Ojo de Águila', description: 'Reporta 5 hallazgos de seguridad validados.', icon: Eye, color: 'text-blue-500', unlocked: stats.medals.includes('2'), progress: stats.medals.includes('2') ? 5 : 2, total: 5 },
    { id: '3', title: 'Maestro del EPP', description: 'Mantén un 100% de cumplimiento en EPP por 30 días.', icon: Crown, color: 'text-amber-500', unlocked: stats.medals.includes('3'), progress: 12, total: 30 },
    { id: '4', title: 'Héroe Preventivo', description: 'Participa en 3 simulacros de emergencia.', icon: Zap, color: 'text-rose-500', unlocked: stats.medals.includes('4'), progress: 1, total: 3 },
    { id: '5', title: 'Sabio de la Norma', description: 'Aprueba 10 Quizzes de normativas con 100%.', icon: BookOpen, color: 'text-indigo-500', unlocked: stats.medals.includes('5'), progress: 4, total: 10 },
    { id: '6', title: 'Racha Imparable', description: 'Inicia sesión 7 días consecutivos.', icon: Flame, color: 'text-orange-500', unlocked: stats.medals.includes('6') || stats.loginStreak >= 7, progress: Math.min(stats.loginStreak, 7), total: 7 },
  ];

  React.useEffect(() => {
    if (stats.loginStreak >= 7 && !stats.medals.includes('6')) {
      unlockMedal('6');
    }
  }, [stats.loginStreak, stats.medals, unlockMedal]);

  const { data: firestoreGames, loading: loadingGames } = useFirestoreCollection<any>('gamification_content');

  const games = firestoreGames.length > 0 ? firestoreGames.map(g => ({
    ...g,
    locked: stats.points < (g.requiredPoints || 0)
  })) : [
    {
      id: 'g1',
      title: 'Buscando al Guardián',
      description: 'Encuentra al Guardián Praeventio (casco blanco, lentes verdes) y 3 extintores ocultos en la faena.',
      thumbnail: 'https://images.unsplash.com/photo-1541888086425-d81bb19240f5?auto=format&fit=crop&q=80&w=800',
      fallbackThumbnail: 'https://images.unsplash.com/photo-1541888086425-d81bb19240f5?auto=format&fit=crop&q=80&w=800',
      points: 100,
      locked: false,
      requiredPoints: 0,
      type: 'find_objects',
      objectsToFind: ['Guardián Praeventio', 'Extintor 1', 'Extintor 2', 'Extintor 3']
    },
    {
      id: 'g2',
      title: 'La Garra del EPP',
      description: 'Identifica al trabajador que no está usando el EPP correcto.',
      thumbnail: 'https://images.unsplash.com/photo-1504328345606-18bbc8c9d7d1?auto=format&fit=crop&q=80&w=800',
      fallbackThumbnail: 'https://images.unsplash.com/photo-1504328345606-18bbc8c9d7d1?auto=format&fit=crop&q=80&w=800',
      points: 100,
      locked: stats.points < 100,
      requiredPoints: 100
    },
    {
      id: 'g3',
      title: 'Simulador de Extintores',
      description: 'Identifica el riesgo de incendio en la imagen.',
      thumbnail: 'https://images.unsplash.com/photo-1605810230434-7631ac76ec81?auto=format&fit=crop&q=80&w=800',
      fallbackThumbnail: 'https://images.unsplash.com/photo-1605810230434-7631ac76ec81?auto=format&fit=crop&q=80&w=800',
      points: 150,
      locked: stats.points < 200,
      requiredPoints: 200
    }
  ];

  return (
    <PremiumFeatureGuard featureName="Gamificación y Recompensas" description="Motiva a tu equipo con un sistema de medallas, desafíos diarios y rankings basados en su participación en seguridad.">
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8 w-full overflow-hidden box-border">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4 sm:gap-6">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-500 border border-amber-500/20 shrink-0">
              <Trophy className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <h1 className="text-xl sm:text-2xl md:text-3xl lg:text-4xl font-black text-white uppercase tracking-tighter leading-tight">Gamificación</h1>
          </div>
          <p className="text-[10px] sm:text-xs md:text-sm text-zinc-500 font-medium">Recompensas, Medallas y Aprendizaje Interactivo</p>
        </div>
        <div className="flex items-center justify-between sm:justify-end gap-4 bg-zinc-900/50 border border-white/5 rounded-2xl p-4 w-full md:w-auto">
          <div className="flex flex-col items-start sm:items-end">
            <span className="text-[8px] sm:text-[9px] md:text-[10px] font-black text-zinc-500 uppercase tracking-widest">Puntos Totales</span>
            <span className="text-lg sm:text-xl md:text-2xl font-black text-amber-500">{stats.points.toLocaleString()} PTS</span>
          </div>
          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-amber-500/20 flex items-center justify-center border-2 border-amber-500 shrink-0">
            <Star className="w-5 h-5 sm:w-6 sm:h-6 text-amber-500 fill-amber-500" />
          </div>
        </div>
      </header>

      {/* Daily Challenge */}
      <div className={`bg-gradient-to-r ${dailyChallengeCompleted ? 'from-emerald-500/20 to-teal-500/10 border-emerald-500/30' : 'from-amber-500/20 to-orange-500/10 border-amber-500/30'} border rounded-3xl p-6 relative overflow-hidden transition-colors duration-500`}>
        <div className={`absolute -right-10 -top-10 w-40 h-40 ${dailyChallengeCompleted ? 'bg-emerald-500/20' : 'bg-amber-500/20'} rounded-full blur-3xl transition-colors duration-500`} />
        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className={`w-14 h-14 rounded-2xl ${dailyChallengeCompleted ? 'bg-emerald-500/20 text-emerald-500 border-emerald-500/30' : 'bg-amber-500/20 text-amber-500 border-amber-500/30'} flex items-center justify-center border shrink-0 transition-colors duration-500`}>
              {dailyChallengeCompleted ? <CheckCircle2 className="w-7 h-7" /> : <Flame className="w-7 h-7" />}
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h2 className="text-base sm:text-lg font-black text-white uppercase tracking-tight">Misión Diaria</h2>
                <span className={`${dailyChallengeCompleted ? 'bg-emerald-500' : 'bg-amber-500'} text-white text-[8px] sm:text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full transition-colors duration-500`}>
                  +150 PTS
                </span>
              </div>
              <p className={`text-xs sm:text-sm ${dailyChallengeCompleted ? 'text-emerald-200/70' : 'text-amber-200/70'} transition-colors duration-500`}>
                {dailyChallengeCompleted ? '¡Misión completada! Vuelve mañana para un nuevo desafío.' : 'Completa 1 juego interactivo y reporta 1 hallazgo de seguridad.'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4 w-full md:w-auto">
            {!dailyChallengeCompleted && (
              <div className="flex-1 md:w-48">
                <div className="flex justify-between text-[10px] font-black uppercase tracking-widest text-amber-500/70 mb-2">
                  <span>Progreso</span>
                  <span>{dailyProgress}%</span>
                </div>
                <div className="h-2 w-full bg-black/40 rounded-full overflow-hidden border border-amber-500/20">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${dailyProgress}%` }}
                    className="h-full bg-amber-500 rounded-full"
                  />
                </div>
              </div>
            )}
            <button 
              onClick={handleClaimDaily}
              disabled={dailyChallengeCompleted || dailyProgress < 100}
              className={`px-4 sm:px-6 py-2.5 sm:py-3 rounded-xl text-[10px] sm:text-xs font-black uppercase tracking-widest transition-colors shadow-lg shrink-0 ${
                dailyChallengeCompleted 
                  ? 'bg-emerald-500/20 text-emerald-500 border border-emerald-500/30 cursor-not-allowed shadow-none'
                  : dailyProgress >= 100
                    ? 'bg-emerald-500 hover:bg-emerald-400 text-white shadow-emerald-500/20 animate-pulse'
                    : 'bg-zinc-800 text-zinc-500 border border-zinc-700 cursor-not-allowed shadow-none'
              }`}
            >
              {dailyChallengeCompleted ? 'Completado' : dailyProgress >= 100 ? 'Reclamar' : 'En Progreso'}
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-col sm:flex-row bg-zinc-900/50 p-1.5 rounded-2xl border border-white/10 self-start shadow-inner w-full sm:w-fit gap-1 sm:gap-0">
        <button
          onClick={() => setActiveTab('perfil')}
          className={`flex-1 sm:flex-none px-2 sm:px-8 py-2.5 sm:py-3 rounded-xl text-[9px] sm:text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-1.5 sm:gap-2 ${
            activeTab === 'perfil' 
              ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/20' 
              : 'text-zinc-500 hover:text-white'
          }`}
        >
          <Shield className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          Perfil
        </button>
        <button
          onClick={() => setActiveTab('medals')}
          className={`flex-1 sm:flex-none px-2 sm:px-8 py-2.5 sm:py-3 rounded-xl text-[9px] sm:text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-1.5 sm:gap-2 ${
            activeTab === 'medals' 
              ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/20' 
              : 'text-zinc-500 hover:text-white'
          }`}
        >
          <Award className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          Medallas
        </button>
        <button
          onClick={() => setActiveTab('games')}
          className={`flex-1 sm:flex-none px-2 sm:px-8 py-2.5 sm:py-3 rounded-xl text-[9px] sm:text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-1.5 sm:gap-2 ${
            activeTab === 'games' 
              ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20' 
              : 'text-zinc-500 hover:text-white'
          }`}
        >
          <Target className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          Juegos
        </button>
        <button
          onClick={() => setActiveTab('ranking')}
          className={`flex-1 sm:flex-none px-2 sm:px-8 py-2.5 sm:py-3 rounded-xl text-[9px] sm:text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-1.5 sm:gap-2 ${
            activeTab === 'ranking' 
              ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20' 
              : 'text-zinc-500 hover:text-white'
          }`}
        >
          <Crown className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          Ranking
        </button>
      </div>

      <AnimatePresence mode="wait">
        {activeTab === 'perfil' ? (
          <motion.div
            key="perfil"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-8"
          >
            {/* Profile HUD */}
            <div className="bg-zinc-900 rounded-3xl p-6 border border-zinc-800 shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-10">
                <Shield className="w-48 h-48 text-amber-500" />
              </div>

              <div className="relative z-10 flex flex-col md:flex-row gap-8">
                {/* Avatar & Class */}
                <div className="flex flex-col items-center gap-4">
                  <div className="relative">
                    <div className="w-32 h-32 rounded-2xl bg-zinc-800 border-2 border-amber-500 flex items-center justify-center overflow-hidden">
                      {user?.photoURL ? (
                        <img src={user.photoURL} alt="Avatar" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-5xl font-black text-zinc-600">{user?.displayName?.[0] || 'U'}</span>
                      )}
                    </div>
                    <div className="absolute -bottom-3 -right-3 bg-amber-500 text-zinc-900 p-2 rounded-xl shadow-lg font-black text-xs uppercase tracking-widest">
                      LVL {Math.floor(stats.points / 1000) + 1}
                    </div>
                  </div>
                  <div className="text-center">
                    <h2 className="text-xl font-black text-white uppercase tracking-tight">{user?.displayName || 'Usuario'}</h2>
                    <p className="text-amber-500 font-mono text-sm uppercase tracking-widest">Guardián Novato</p>
                  </div>
                </div>

                {/* XP & Stats */}
                <div className="flex-1 flex flex-col justify-center space-y-6">
                  <div>
                    <div className="flex justify-between items-end mb-2">
                      <span className="text-xs font-black text-zinc-400 uppercase tracking-widest">Experiencia (XP)</span>
                      <span className="text-sm font-black text-amber-500">{stats.points} / {(Math.floor(stats.points / 1000) + 1) * 1000}</span>
                    </div>
                    <div className="h-4 bg-zinc-800 rounded-full overflow-hidden border border-zinc-700">
                      <motion.div 
                        className="h-full bg-amber-500"
                        initial={{ width: 0 }}
                        animate={{ width: `${(stats.points % 1000) / 10}%` }}
                        transition={{ type: 'spring', bounce: 0.4 }}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div className="bg-zinc-800/50 rounded-xl p-4 border border-zinc-700/50 text-center">
                      <Trophy className="w-6 h-6 text-amber-500 mx-auto mb-2" />
                      <p className="text-2xl font-black text-white">{stats.medals.length}</p>
                      <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Medallas</p>
                    </div>
                    <div className="bg-zinc-800/50 rounded-xl p-4 border border-zinc-700/50 text-center">
                      <Flame className="w-6 h-6 text-orange-500 mx-auto mb-2" />
                      <p className="text-2xl font-black text-white">{stats.loginStreak}</p>
                      <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Racha Días</p>
                    </div>
                    <div className="bg-zinc-800/50 rounded-xl p-4 border border-zinc-700/50 text-center">
                      <Target className="w-6 h-6 text-emerald-500 mx-auto mb-2" />
                      <p className="text-2xl font-black text-white">{Object.keys(stats.completedChallenges || {}).length}</p>
                      <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Misiones</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        ) : activeTab === 'medals' ? (
          <motion.div
            key="medals"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
          >
            {medals.map((medal, i) => (
              <div 
                key={medal.id}
                className={`relative overflow-hidden rounded-3xl p-6 border transition-all ${
                  medal.unlocked 
                    ? 'bg-zinc-900/80 border-white/10 hover:border-amber-500/30' 
                    : 'bg-zinc-900/30 border-white/5 opacity-75'
                }`}
              >
                {medal.unlocked && (
                  <div className="absolute -right-6 -top-6 w-24 h-24 bg-amber-500/10 rounded-full blur-2xl" />
                )}
                
                <div className="flex items-start gap-4 mb-4 relative z-10">
                  <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 border ${
                    medal.unlocked 
                      ? `bg-white/5 border-white/10 ${medal.color}` 
                      : 'bg-zinc-800 border-zinc-700 text-zinc-600'
                  }`}>
                    <medal.icon className="w-7 h-7" />
                  </div>
                  <div>
                    <h3 className={`font-black uppercase tracking-tight ${medal.unlocked ? 'text-white' : 'text-zinc-500'}`}>
                      {medal.title}
                    </h3>
                    <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
                      {medal.description}
                    </p>
                  </div>
                </div>

                <div className="space-y-2 relative z-10">
                  <div className="flex justify-between text-[10px] font-black uppercase tracking-widest">
                    <span className={medal.unlocked ? 'text-amber-500' : 'text-zinc-600'}>Progreso</span>
                    <span className={medal.unlocked ? 'text-white' : 'text-zinc-500'}>{medal.progress} / {medal.total}</span>
                  </div>
                  <div className="h-2 w-full bg-zinc-800 rounded-full overflow-hidden">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${(medal.progress / medal.total) * 100}%` }}
                      className={`h-full rounded-full ${medal.unlocked ? 'bg-amber-500' : 'bg-zinc-600'}`}
                    />
                  </div>
                </div>

                {medal.unlocked && (
                  <div className="absolute top-4 right-4 text-amber-500">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                )}
              </div>
            ))}
          </motion.div>
        ) : activeTab === 'games' ? (
          <motion.div
            key="games"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="grid grid-cols-1 md:grid-cols-3 gap-8"
          >
            {games.map((game, i) => (
              <div 
                key={game.id}
                className="group relative bg-zinc-900 border border-white/10 rounded-[32px] overflow-hidden hover:border-indigo-500/30 transition-all shadow-xl"
              >
                <div className="relative h-48 overflow-hidden">
                  <img 
                    src={game.thumbnail} 
                    alt={game.title}
                    onError={(e) => { e.currentTarget.src = game.fallbackThumbnail; }}
                    className={`w-full h-full object-cover transition-transform duration-500 group-hover:scale-110 ${game.locked ? 'grayscale opacity-50' : ''}`}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 via-zinc-900/50 to-transparent" />
                  
                  {game.locked && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center backdrop-blur-sm bg-black/40">
                      <div className="w-12 h-12 rounded-full bg-zinc-800/80 flex items-center justify-center text-zinc-400 border border-white/10 mb-2">
                        <Lock className="w-5 h-5" />
                      </div>
                      <span className="text-white/70 font-black uppercase tracking-widest text-[10px] bg-black/60 px-3 py-1 rounded-full border border-white/10">
                        Requiere {game.requiredPoints} PTS
                      </span>
                    </div>
                  )}

                  <div className="absolute top-4 right-4 bg-black/60 backdrop-blur-md border border-white/10 px-3 py-1.5 rounded-xl flex items-center gap-1.5">
                    <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
                    <span className="text-[10px] font-black text-white uppercase tracking-widest">+{game.points} PTS</span>
                  </div>
                </div>

                <div className="p-6 space-y-4">
                  <div>
                    <h3 className="text-lg font-black text-white uppercase tracking-tight group-hover:text-indigo-400 transition-colors">
                      {game.title}
                    </h3>
                    <p className="text-sm text-zinc-400 mt-2 leading-relaxed">
                      {game.description}
                    </p>
                  </div>

                    <button 
                      disabled={game.locked}
                      onClick={() => setActiveGame(game.id)}
                      className={`w-full py-3.5 rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 transition-all ${
                        game.locked 
                          ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed' 
                          : 'bg-indigo-500 hover:bg-indigo-400 text-white shadow-lg shadow-indigo-500/20'
                      }`}
                    >
                      {game.locked ? `Desbloquea con ${game.requiredPoints} PTS` : (
                        <>
                          <Play className="w-4 h-4" />
                          Jugar Ahora
                        </>
                      )}
                    </button>
                </div>
              </div>
            ))}
          </motion.div>
        ) : (
          <motion.div
            key="ranking"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="bg-zinc-900/50 border border-white/10 rounded-3xl p-6 md:p-8"
          >
            <div className="flex items-center justify-between mb-8">
              <div>
                <h2 className="text-xl font-black text-white uppercase tracking-tight">Top Guardianes</h2>
                <p className="text-sm text-zinc-400">Los usuarios con mayor puntuación en prevención.</p>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 flex items-center justify-center text-emerald-500 border border-emerald-500/20">
                <Crown className="w-6 h-6" />
              </div>
            </div>

            <div className="space-y-4">
              {leaderboard.length > 0 ? leaderboard.map((player, index) => (
                <div 
                  key={player.id}
                  className={`flex items-center justify-between p-4 rounded-2xl border transition-all ${
                    player.isCurrentUser 
                      ? 'bg-emerald-500/10 border-emerald-500/30 ring-1 ring-emerald-500/50' 
                      : 'bg-zinc-800/50 border-white/5 hover:border-white/10'
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-lg ${
                      index === 0 ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/20' :
                      index === 1 ? 'bg-zinc-300 text-zinc-800' :
                      index === 2 ? 'bg-amber-700 text-white' :
                      'bg-zinc-800 text-zinc-500'
                    }`}>
                      #{index + 1}
                    </div>
                    <div>
                      <h3 className={`font-bold ${player.isCurrentUser ? 'text-emerald-400' : 'text-white'}`}>
                        {player.name}
                      </h3>
                      <p className="text-xs text-zinc-500">{player.role}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="hidden sm:flex flex-col items-end">
                      <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Medallas</span>
                      <div className="flex items-center gap-1 text-zinc-300">
                        <Award className="w-3.5 h-3.5 text-amber-500" />
                        <span className="font-bold">{player.medals}</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Puntos</span>
                      <div className="flex items-center gap-1 text-amber-500">
                        <Star className="w-3.5 h-3.5 fill-amber-500" />
                        <span className="font-black text-lg">{player.points.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )) : (
                <div className="text-center py-12 text-zinc-500">
                  <Loader2 className="w-8 h-8 mx-auto mb-4 animate-spin opacity-50" />
                  <p>Cargando ranking...</p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Game Modal */}
      <AnimatePresence>
        {activeGame === 'g3' ? (
          <ExtinguisherSimulator 
            onComplete={(points) => {
              addPoints(points, 'Simulador de Extintores completado');
              setActiveGame(null);
            }} 
            onClose={() => setActiveGame(null)} 
          />
        ) : activeGame && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 backdrop-blur-xl">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 40 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 40 }}
              className="bg-zinc-900 border border-white/10 rounded-[32px] w-full max-w-4xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
            >
              <div className="p-6 border-b border-white/10 flex items-center justify-between shrink-0 bg-zinc-900/50">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-indigo-500/20 flex items-center justify-center text-indigo-500 border border-indigo-500/20">
                    <Target className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-xl font-black text-white uppercase tracking-tight">{games.find(g => g.id === activeGame)?.title}</h2>
                    <p className="text-sm text-zinc-400">{games.find(g => g.id === activeGame)?.description}</p>
                  </div>
                </div>
                <button 
                  onClick={() => {
                    setActiveGame(null);
                    setGameResult(null);
                    setClickPos(null);
                    setFoundObjects([]);
                  }}
                  className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 overflow-y-auto custom-scrollbar flex-1">
                {games.find(g => g.id === activeGame)?.type === 'find_objects' && (
                  <div className="mb-4 flex flex-wrap gap-2">
                    {games.find(g => g.id === activeGame)?.objectsToFind?.map((obj, idx) => {
                      const isFound = foundObjects.some(found => String(found || '').toLowerCase().includes(String(obj || '').toLowerCase()) || String(obj || '').toLowerCase().includes(String(found || '').toLowerCase()));
                      return (
                        <div key={idx} className={`px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest border flex items-center gap-2 ${
                          isFound 
                            ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400' 
                            : 'bg-zinc-800 border-white/10 text-zinc-400'
                        }`}>
                          {isFound ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Target className="w-3.5 h-3.5" />}
                          {obj}
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="relative rounded-2xl overflow-hidden border border-white/10 cursor-crosshair">
                  <img 
                    ref={imageRef}
                    src={games.find(g => g.id === activeGame)?.thumbnail.replace('w=800', 'w=1200')} 
                    onError={(e) => { e.currentTarget.src = games.find(g => g.id === activeGame)?.fallbackThumbnail?.replace('w=800', 'w=1200') || ''; }}
                    alt="Faena"
                    className="w-full h-auto"
                    onClick={handleImageClick}
                    crossOrigin="anonymous"
                  />
                  
                  {clickPos && (
                    <div 
                      className="absolute w-8 h-8 -ml-4 -mt-4 rounded-full border-2 border-amber-500 bg-amber-500/20 animate-pulse pointer-events-none"
                      style={{ left: clickPos.x, top: clickPos.y }}
                    />
                  )}

                  {validatingClick && (
                    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center">
                      <div className="bg-zinc-900 border border-white/10 p-6 rounded-2xl flex flex-col items-center gap-4">
                        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
                        <p className="text-sm font-bold text-white uppercase tracking-widest">Analizando Riesgo...</p>
                      </div>
                    </div>
                  )}
                </div>

                <AnimatePresence>
                  {gameResult && (
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`mt-6 p-6 rounded-2xl border ${
                        gameResult.isRisk 
                          ? 'bg-rose-500/10 border-rose-500/30' 
                          : 'bg-emerald-500/10 border-emerald-500/30'
                      }`}
                    >
                      <div className="flex items-start gap-4">
                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 border ${
                          gameResult.isRisk 
                            ? 'bg-rose-500/20 border-rose-500/30 text-rose-500' 
                            : 'bg-emerald-500/20 border-emerald-500/30 text-emerald-500'
                        }`}>
                          {gameResult.isRisk ? <AlertCircle className="w-6 h-6" /> : <CheckCircle2 className="w-6 h-6" />}
                        </div>
                        <div>
                          <h3 className={`text-lg font-black uppercase tracking-tight ${
                            gameResult.isRisk ? 'text-rose-500' : 'text-emerald-500'
                          }`}>
                            {gameResult.isRisk ? '¡Objetivo Encontrado!' : 'Sigue buscando...'}
                          </h3>
                          {gameResult.isRisk && gameResult.foundObject && (
                            <p className="text-white font-medium mt-1">Objeto: {gameResult.foundObject}</p>
                          )}
                          {gameResult.isRisk && gameResult.riskDescription && (
                            <p className="text-white font-medium mt-1">{gameResult.riskDescription}</p>
                          )}
                          <p className="text-zinc-400 text-sm mt-2 leading-relaxed">{gameResult.explanation}</p>
                          
                          {gameResult.isRisk && (
                            <div className="mt-4 inline-flex items-center gap-2 bg-amber-500/20 text-amber-500 px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-widest border border-amber-500/30">
                              <Star className="w-4 h-4 fill-amber-500" />
                              +{games.find(g => g.id === activeGame)?.points || 50} Puntos
                            </div>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
    </PremiumFeatureGuard>
  );
}

