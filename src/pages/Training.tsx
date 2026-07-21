import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play,
  CheckCircle2,
  Clock,
  Users,
  Plus,
  Search,
  BookOpen,
  Award,
  BarChart3,
  Zap,
  Brain,
  Loader2,
  ChevronRight,
  Shield,
  X,
  Video,
  Gamepad2,
  WifiOff,
  Download,
  FileSpreadsheet
} from 'lucide-react';
import { collection, addDoc, updateDoc, doc, setDoc, where } from 'firebase/firestore';
import { generateTrainingCertificate } from '../utils/trainingCertificate';
import { awardPoints } from '../services/gamificationService';
import { db } from '../services/firebase';
import { useFirestoreCollection } from '../hooks/useFirestoreCollection';
import { useProject } from '../contexts/ProjectContext';
import { useUniversalKnowledge } from '../contexts/UniversalKnowledgeContext';
import { useFirebase } from '../contexts/FirebaseContext';
import { useRiskEngine } from '../hooks/useRiskEngine';
import {
  createInitialCard,
  type LearningCard,
} from '../services/spacedRepetition/spacedRepetitionScheduler';
import { generateSafetyCapsule, generateTrainingQuiz } from '../services/geminiService';
import { TrainingSession } from '../types';
import { FindTheGuardian } from '../components/gamification/FindTheGuardian';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { saveForSync } from '../utils/pwa-offline';
import { useSubscription } from '../contexts/SubscriptionContext';
import { PostTrainingAdModal } from '../components/shared/PostTrainingAdModal';
import { prepareInterstitial, canShowAd, recordAdShown } from '../services/adService';
import { useEmergency } from '../contexts/EmergencyContext';
import { logger } from '../utils/logger';
import { EmptyState } from '../components/shared/EmptyState';
import { CsvImportExportModal } from '../components/etl/CsvImportExportModal';
import {
  useMicrotrainingCatalog,
  useMicrotrainingRecommendation,
  useMicrotrainingCerts,
  submitMicrotrainingSession,
} from '../hooks/useMicrotraining';
import type { RiskCategory } from '../services/microtraining/lightningTrainingService';
import { SpacedRepetitionReviewQueue } from '../components/spacedRepetition/SpacedRepetitionReviewQueue';
import { SafetyCapsules } from '../components/safety/SafetyCapsules';
import { OnboardingTrackProgressPanel } from '../components/roleOnboarding/OnboardingTrackProgressPanel';
import type { OnboardingTrack, UserOnboardingProgress, OnboardingStatus } from '../services/roleOnboarding/roleOnboardingTracks';

interface QuizQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

const getYoutubeVideoId = (url: string) => {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
};

export function Training() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();
  const { user } = useFirebase();
  const { nodes, loading: nodesLoading } = useUniversalKnowledge();
  const { plan, isPremium } = useSubscription();
  const { isEmergencyActive } = useEmergency();
  const [activeTab, setActiveTab] = useState<'all' | 'upcoming' | 'completed' | 'library' | 'gamification'>('all');
  const [adTrainingTitle, setAdTrainingTitle] = useState<string | null>(null);
  const [generatingCapsule, setGeneratingCapsule] = useState(false);
  const [capsule, setCapsule] = useState<string | null>(null);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [isCsvModalOpen, setIsCsvModalOpen] = useState(false);
  const [syncToast, setSyncToast] = useState<string | null>(null);
  const [activeVideoSession, setActiveVideoSession] = useState<TrainingSession | null>(null);
  const [isQuizActive, setIsQuizActive] = useState(false);
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [quizAnswers, setQuizAnswers] = useState<number[]>([]);
  const [isQuizFinished, setIsQuizFinished] = useState(false);
  const [quizPointsAwarded, setQuizPointsAwarded] = useState(false);
  const [isGeneratingQuiz, setIsGeneratingQuiz] = useState(false);
  const [newSessionForm, setNewSessionForm] = useState({
    title: '',
    description: '',
    youtubeUrl: '',
    duration: 15,
    points: 100,
    isCurated: false
  });

  const { data: allSessions, loading } = useFirestoreCollection<TrainingSession>('training');
  const { addNode } = useRiskEngine();
  const isOnline = useOnlineStatus();

  const detectedRisks = useMemo(() => {
    const riskKeywords: Record<string, string> = {
      altura: 'altura',
      electrico: 'electrico',
      eléctrico: 'electrico',
      hazmat: 'hazmat',
      químico: 'hazmat',
      quimico: 'hazmat',
      ergo: 'ergo',
      ergonómico: 'ergo',
      ergonomico: 'ergo',
      'línea de fuego': 'lineas_de_fuego',
      'linea de fuego': 'lineas_de_fuego',
      confinado: 'espacio_confinado',
      espacio_confinado: 'espacio_confinado',
      ruido: 'ruido',
    };
    const found = new Set<string>();
    for (const n of nodes) {
      if (n.type !== 'Riesgo') continue;
      const hay = `${n.title} ${n.description} ${(n.tags || []).join(' ')}`.toLowerCase();
      for (const [kw, cat] of Object.entries(riskKeywords)) {
        if (hay.includes(kw)) found.add(cat);
      }
    }
    return [...found] as RiskCategory[];
  }, [nodes]);

  const microCatalog = useMicrotrainingCatalog(selectedProject?.id ?? null);
  const microRecommendation = useMicrotrainingRecommendation(
    selectedProject?.id ?? null,
    user?.uid ?? null,
    detectedRisks,
  );
  const microCerts = useMicrotrainingCerts(selectedProject?.id ?? null, user?.uid ?? null);

  const [activeMicroModule, setActiveMicroModule] = useState<string | null>(null);
  const [microAnswers, setMicroAnswers] = useState<number[]>([]);
  const [microQuizDone, setMicroQuizDone] = useState(false);
  const [microResult, setMicroResult] = useState<{ score: number; certified: boolean } | null>(null);
  const [microSubmitting, setMicroSubmitting] = useState(false);

  // Award quiz_passed points exactly once per quiz attempt with score >= 70
  useEffect(() => {
    if (isQuizFinished && !quizPointsAwarded && calculateQuizScore() >= 70) {
      setQuizPointsAwarded(true);
      awardPoints('quiz_passed');
    }
    if (!isQuizFinished) setQuizPointsAwarded(false);
  }, [isQuizFinished]);

  // Preload native AdMob interstitial so it's ready when training completes (free plan only)
  useEffect(() => {
    if (activeVideoSession && !isPremium) {
      prepareInterstitial();
    }
  }, [activeVideoSession, isPremium]);

  const filteredSessions = allSessions.filter(session => {
    if (activeTab === 'library') return session.isCurated;
    if (selectedProject && session.projectId !== selectedProject.id && !session.isCurated) return false;
    if (activeTab === 'upcoming') return session.status === 'scheduled';
    if (activeTab === 'completed') return session.status === 'completed';
    return true;
  });

  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      const sessionData = {
        ...newSessionForm,
        date: new Date().toISOString(),
        status: 'scheduled',
        attendees: [],
        projectId: newSessionForm.isCurated ? null : selectedProject?.id
      };

      if (!isOnline) {
        await saveForSync({
          type: 'create',
          collection: 'training',
          data: sessionData
        });
        setSyncToast('Sesión guardada — se sincronizará cuando haya conexión.');
        setTimeout(() => setSyncToast(null), 4000);
      } else {
        const collectionRef = collection(db, 'training');
        await addDoc(collectionRef, sessionData);
      }
      
      setIsCreatingSession(false);
      setNewSessionForm({ title: '', description: '', youtubeUrl: '', duration: 15, points: 100, isCurated: false });
    } catch (error) {
      logger.error('Error creating session:', error);
    }
  };

  const handleAssignToProject = async (session: TrainingSession) => {
    if (!selectedProject) return;
    try {
      const collectionRef = collection(db, 'training');
      await addDoc(collectionRef, {
        ...session,
        id: undefined,
        projectId: selectedProject.id,
        isCurated: false,
        status: 'scheduled',
        attendees: [],
        date: new Date().toISOString()
      });
      setActiveTab('all');
    } catch (error) {
      logger.error('Error assigning session:', error);
    }
  };

  const handleCompleteVideo = async (session: TrainingSession) => {
    if (!selectedProject || !user) return;

    // Guard: training already completed — clear UI but skip ad
    if (session.status === 'completed') {
      setActiveVideoSession(null);
      setIsQuizActive(false);
      setIsQuizFinished(false);
      setQuizQuestions([]);
      setQuizAnswers([]);
      setCurrentQuestionIndex(0);
      return;
    }

    try {
      const docRef = doc(db, 'training', session.id);
      const newAttendees = session.attendees?.includes(user.uid)
        ? session.attendees
        : [...(session.attendees || []), user.uid];

      // Codex P2 PR #317 round 2: persist `completedAt` ISO string
      // so the CPHS monthly draft (server/routes/sprintK.ts) puede
      // contar la sesión en el mes en que SE IMPARTIÓ, no en el mes
      // del `date` programado original. Cuando la sesión se agenda en
      // mayo y se completa en junio el indicador mensual de capacitación
      // estaba reportando el mes equivocado.
      await updateDoc(docRef, {
        status: 'completed',
        attendees: newAttendees,
        completedAt: new Date().toISOString()
      });

      // Persistir una tarjeta de repetición espaciada (SM-2) para que el
      // trabajador realmente repase este tema después. Antes esto era
      // fire-and-forget sobre un endpoint de compute puro y la tarjeta se
      // descartaba: el loop quedaba abierto (se creaba, nadie repasaba). Ahora
      // se guarda en `learning_cards` (reglas owner-scoped) y la cola de repaso
      // de esta misma página la levanta. Id por trabajador+sesión.
      try {
        const cardId = `${session.id}__${user.uid}`;
        const card = createInitialCard(
          cardId,
          user.uid,
          session.title,
          new Date().toISOString(),
        );
        await setDoc(doc(db, 'learning_cards', cardId), {
          ...card,
          projectId: selectedProject.id,
        });
      } catch (err) {
        logger.warn('learningCard.persist.failed', { err: String(err) });
      }

      setActiveVideoSession(null);
      setIsQuizActive(false);
      setIsQuizFinished(false);
      setQuizQuestions([]);
      setQuizAnswers([]);
      setCurrentQuestionIndex(0);

      awardPoints('training_completed');

      if (!isPremium && !isEmergencyActive && (await canShowAd())) {
        await recordAdShown();
        setTimeout(() => setAdTrainingTitle(session.title), 400);
      }
    } catch (error) {
      logger.error('Error completing video:', error);
    }
  };

  const handleStartQuiz = async () => {
    if (!activeVideoSession || !isOnline) return;
    setIsGeneratingQuiz(true);
    try {
      const questions = await generateTrainingQuiz(activeVideoSession.title, activeVideoSession.description ?? '');
      setQuizQuestions(questions);
      setIsQuizActive(true);
      setCurrentQuestionIndex(0);
      setQuizAnswers([]);
      setIsQuizFinished(false);
    } catch (error) {
      logger.error('Error generating quiz:', error);
    } finally {
      setIsGeneratingQuiz(false);
    }
  };

  const handleAnswerQuiz = (optionIndex: number) => {
    const newAnswers = [...quizAnswers];
    newAnswers[currentQuestionIndex] = optionIndex;
    setQuizAnswers(newAnswers);

    if (currentQuestionIndex < quizQuestions.length - 1) {
      setCurrentQuestionIndex(currentQuestionIndex + 1);
    } else {
      setIsQuizFinished(true);
    }
  };

  const calculateQuizScore = () => {
    let correct = 0;
    quizQuestions.forEach((q, i) => {
      if (q.correctIndex === quizAnswers[i]) correct++;
    });
    return (correct / quizQuestions.length) * 100;
  };

  const handleGenerateCapsule = async () => {
    if (!isOnline) return;
    setGeneratingCapsule(true);
    try {
      // Find nodes connected to the user (heuristic: nodes with user's name or relevant tags)
      const userNodes = nodes.filter(n => 
        (n.title || '').toLowerCase().includes(String(user?.displayName || '').toLowerCase()) ||
        (n.description || '').toLowerCase().includes(String(user?.displayName || '').toLowerCase()) ||
        n.type === 'Riesgo' || n.type === 'Incidente'
      ).slice(0, 10);

      const context = userNodes.map(n => `- [${n.type}] ${n.title}: ${n.description}`).join('\n');
      const content = await generateSafetyCapsule(
        user?.displayName || 'Trabajador',
        'Operador', // Default role
        context
      );
      setCapsule(content);

      if (selectedProject && user) {
        // Save to Firestore
        const capsuleRef = await addDoc(collection(db, `projects/${selectedProject.id}/training_capsules`), {
          projectId: selectedProject.id,
          userId: user.uid,
          userName: user.displayName || 'Usuario',
          content: content,
          createdAt: new Date().toISOString()
        });

        // Save to Zettelkasten
        await addNode({
          type: 'DOCUMENT' as any,
          title: `Cápsula de Seguridad: ${user.displayName || 'Usuario'}`,
          description: `Cápsula de seguridad generada por IA para ${user.displayName || 'Usuario'}.`,
          tags: ['capacitacion', 'ia', 'capsula'],
          projectId: selectedProject.id,
          connections: [],
          metadata: {
            capsuleId: capsuleRef.id,
            userId: user.uid,
            content: content
          }
        });
      }
    } catch (error) {
      logger.error('Error generating capsule:', error);
    } finally {
      setGeneratingCapsule(false);
    }
  };

  const handleMicroModuleClick = (moduleId: string) => {
    setActiveMicroModule(moduleId);
    setMicroAnswers([]);
    setMicroQuizDone(false);
    setMicroResult(null);
  };

  const handleMicroAnswer = (blockIndex: number, optionIndex: number) => {
    const next = [...microAnswers];
    next[blockIndex] = optionIndex;
    setMicroAnswers(next);
  };

  const handleMicroSubmit = async () => {
    if (!selectedProject || !user || !activeMicroModule || !microCatalog.data) return;
    const mod = microCatalog.data.modules.find((m) => m.id === activeMicroModule);
    if (!mod) return;
    setMicroSubmitting(true);
    try {
      const quizBlocks = mod.content
        .map((b, i) => ({ ...b, idx: i }))
        .filter((b) => b.kind === 'quiz');
      const answers = quizBlocks.map((b) => ({
        blockIndex: b.idx,
        selectedIndex: microAnswers[b.idx] ?? 0,
      }));
      const res = await submitMicrotrainingSession(selectedProject.id, {
        workerUid: user.uid,
        moduleId: mod.id,
        startedAt: Date.now(),
        completedAt: Date.now(),
        answers,
      });
      setMicroResult({ score: res.score, certified: res.certified });
      setMicroQuizDone(true);
      microCerts.refetch();
    } catch {
    } finally {
      setMicroSubmitting(false);
    }
  };

  const activeMicroModuleData = microCatalog.data?.modules.find(
    (m) => m.id === activeMicroModule,
  );

  // Tarjetas de repaso espaciado del trabajador en este proyecto. La query SIEMPRE
  // restringe por workerUid (== uid) para que las reglas owner-scoped la aprueben
  // sin get() — un sentinela '__none__' devuelve vacío hasta que hay user/proyecto.
  const { data: learningCards } = useFirestoreCollection<LearningCard>(
    'learning_cards',
    [
      where('workerUid', '==', user?.uid ?? '__none__'),
      where('projectId', '==', selectedProject?.id ?? '__none__'),
    ],
  );

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      <AnimatePresence>
        {syncToast && (
          <motion.div
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl shadow-xl bg-[#4db6ac] text-white text-sm font-bold flex items-center gap-3"
          >
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            {syncToast}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-white uppercase tracking-tighter flex items-center gap-3">
            <BookOpen className="w-6 h-6 sm:w-8 sm:h-8 text-[#4db6ac] dark:text-[#d4af37]" />
            {t('training.title', 'Capacitaciones & Formación')}
          </h1>
          <p className="text-muted-token mt-1 font-medium italic text-xs sm:text-base">{t('training.tagline', '"El conocimiento es la primera línea de defensa"')}</p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
          <button 
            onClick={handleGenerateCapsule}
            disabled={generatingCapsule || !isOnline}
            title={!isOnline ? 'Requiere conexión a internet' : ''}
            className={`flex items-center justify-center gap-2 px-4 sm:px-6 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all active:scale-95 disabled:opacity-50 ${
              !isOnline ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed' : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-lg shadow-blue-500/20'
            }`}
          >
            {generatingCapsule ? <Loader2 className="w-4 h-4 animate-spin" /> : !isOnline ? <WifiOff className="w-4 h-4" /> : <Zap className="w-4 h-4" />}
            <span>{!isOnline ? 'Requiere Conexión' : 'Cápsula de Seguridad IA'}</span>
          </button>
          <button
            onClick={() => setIsCsvModalOpen(true)}
            className="flex items-center justify-center gap-2 px-4 sm:px-6 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all active:scale-95 bg-teal-600 hover:bg-teal-700 text-white shadow-lg shadow-teal-500/20"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Import/Export CSV</span>
          </button>
          <button
            onClick={() => setIsCreatingSession(true)}
            className="flex items-center justify-center gap-2 px-4 sm:px-6 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all active:scale-95 bg-zinc-900 border border-white/10 hover:bg-zinc-800 text-white"
          >
            <Plus className="w-4 h-4" />
            <span>{t('training.newSession', 'Nueva Sesión')}</span>
          </button>
        </div>
      </div>

      {/* Repaso programado (SM-2) — monta el huérfano SpacedRepetitionReviewQueue.
          Cierra el loop: las tarjetas que esta página crea al completar una
          capacitación se repasan aquí; cada calificación reprograma el intervalo
          y persiste en `learning_cards`. */}
      {selectedProject && learningCards.length > 0 && (
        <section className="space-y-3" data-testid="training-spaced-repetition">
          <h2 className="text-sm font-black text-white uppercase tracking-tight flex items-center gap-2">
            <Brain className="w-4 h-4 text-emerald-400" />
            Repaso programado
          </h2>
          <SpacedRepetitionReviewQueue
            cards={learningCards}
            onUpdateCard={(updated) => {
              void updateDoc(doc(db, 'learning_cards', updated.id), {
                reviewCount: updated.reviewCount,
                easeFactor: updated.easeFactor,
                intervalDays: updated.intervalDays,
                nextReviewAt: updated.nextReviewAt,
                ...(updated.lastQuality !== undefined
                  ? { lastQuality: updated.lastQuality }
                  : {}),
              });
            }}
          />
        </section>
      )}

      {/* Wire SafetyCapsules — AI-generated micro-training capsules.
          Self-contained (own state + Gemini call). Placed here so workers
          see personalized safety content alongside their training sessions. */}
      <SafetyCapsules />

      <CsvImportExportModal
        isOpen={isCsvModalOpen}
        onClose={() => setIsCsvModalOpen(false)}
        entityType="training"
        projectId={selectedProject?.id ?? null}
      />

      {/* AI Capsule Modal */}
      <AnimatePresence>
        {capsule && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 backdrop-blur-xl">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 40 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 40 }}
              className="bg-zinc-900 border border-white/10 rounded-[40px] w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl"
            >
              <div className="p-8 border-b border-white/5 flex justify-between items-center bg-gradient-to-r from-blue-500/10 to-transparent">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-blue-500/20 flex items-center justify-center text-blue-400">
                    <Brain className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-xl font-black text-white uppercase tracking-tighter">Cápsula de Seguridad Personalizada</h2>
                    <p className="text-[10px] font-bold text-blue-500 uppercase tracking-widest">Mentoría El Guardián AI</p>
                  </div>
                </div>
                <button
                  onClick={() => setCapsule(null)}
                  aria-label="Cerrar"
                  className="p-2.5 min-w-[44px] min-h-[44px] hover:bg-white/5 rounded-full transition-colors text-zinc-500 hover:text-white flex items-center justify-center"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-10 custom-scrollbar">
                <div className="prose prose-invert max-w-none">
                  <div className="whitespace-pre-wrap font-sans text-zinc-300 leading-relaxed text-lg">
                    {capsule}
                  </div>
                </div>
              </div>

              <div className="p-8 border-t border-white/5 bg-zinc-900/50 flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-[#4db6ac]/10 dark:bg-[#d4af37]/10 flex items-center justify-center text-[#4db6ac] dark:text-[#d4af37]">
                    <Shield className="w-5 h-5" />
                  </div>
                  <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest max-w-[200px]">
                    Capacitación completada con éxito. Registro guardado en la Red Neuronal.
                  </p>
                </div>
                <button 
                  onClick={() => setCapsule(null)}
                  className="px-8 py-4 rounded-2xl bg-[#4db6ac] text-white font-black text-[10px] uppercase tracking-widest hover:bg-[#3a9e95] transition-all flex items-center gap-2 shadow-lg shadow-[#4db6ac]/20"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Entendido, Guardián
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {isCreatingSession && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 backdrop-blur-xl">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 40 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 40 }}
              className="bg-zinc-900 border border-white/10 rounded-[40px] w-full max-w-xl overflow-hidden flex flex-col shadow-2xl max-h-[90vh]"
            >
              <div className="p-8 border-b border-white/5 flex justify-between items-center shrink-0">
                <h2 className="text-xl font-black text-white uppercase tracking-tighter">{t('training.newTraining', 'Nueva Capacitación')}</h2>
                <button
                  onClick={() => setIsCreatingSession(false)}
                  aria-label="Cerrar"
                  className="p-2.5 min-w-[44px] min-h-[44px] hover:bg-white/5 rounded-full transition-colors text-zinc-500 hover:text-white flex items-center justify-center"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <form onSubmit={handleCreateSession} className="p-8 space-y-6 overflow-y-auto custom-scrollbar">
                <div>
                  <label className="block text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">Título</label>
                  <input
                    type="text"
                    required
                    value={newSessionForm.title}
                    onChange={e => setNewSessionForm({...newSessionForm, title: e.target.value})}
                    className="w-full bg-zinc-900/50 border border-white/10 rounded-2xl p-4 text-white focus:outline-none focus:border-[#4db6ac] transition-colors"
                    placeholder="Ej. Uso correcto de arnés"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">Descripción</label>
                  <textarea
                    required
                    value={newSessionForm.description}
                    onChange={e => setNewSessionForm({...newSessionForm, description: e.target.value})}
                    className="w-full bg-zinc-900/50 border border-white/10 rounded-2xl p-4 text-white focus:outline-none focus:border-[#4db6ac] transition-colors resize-none h-24"
                    placeholder="Detalles de la capacitación..."
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">URL del Video (YouTube)</label>
                  <div className="relative">
                    <Video className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
                    <input
                      type="url"
                      value={newSessionForm.youtubeUrl}
                      onChange={e => setNewSessionForm({...newSessionForm, youtubeUrl: e.target.value})}
                      className="w-full bg-zinc-900/50 border border-white/10 rounded-2xl py-4 pl-12 pr-4 text-white focus:outline-none focus:border-[#4db6ac] transition-colors"
                      placeholder="https://youtube.com/watch?v=..."
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">Duración (min)</label>
                    <input
                      type="number"
                      required
                      min="1"
                      value={newSessionForm.duration}
                      onChange={e => setNewSessionForm({...newSessionForm, duration: parseInt(e.target.value)})}
                      className="w-full bg-zinc-900/50 border border-white/10 rounded-2xl p-4 text-white focus:outline-none focus:border-[#4db6ac] transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">Puntos (Gamificación)</label>
                    <input
                      type="number"
                      required
                      min="0"
                      value={newSessionForm.points}
                      onChange={e => setNewSessionForm({...newSessionForm, points: parseInt(e.target.value)})}
                      className="w-full bg-zinc-900/50 border border-white/10 rounded-2xl p-4 text-white focus:outline-none focus:border-[#4db6ac] transition-colors"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-3 p-4 rounded-2xl bg-white/5 border border-white/5">
                  <input 
                    type="checkbox"
                    id="isCurated"
                    checked={newSessionForm.isCurated}
                    onChange={e => setNewSessionForm({...newSessionForm, isCurated: e.target.checked})}
                    className="w-5 h-5 rounded border-white/10 bg-zinc-900 text-[#4db6ac] focus:ring-[#4db6ac]"
                  />
                  <label htmlFor="isCurated" className="text-[10px] font-black text-zinc-400 uppercase tracking-widest cursor-pointer">
                    Añadir a la Biblioteca Global (Curación)
                  </label>
                </div>

                <div className="pt-4 flex justify-end">
                  <button 
                    type="submit"
                    className="px-8 py-4 rounded-2xl bg-[#4db6ac] text-white font-black text-[10px] uppercase tracking-widest hover:bg-[#3a9e95] transition-all shadow-lg shadow-[#4db6ac]/20"
                  >
                    Crear Capacitación
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}

        {activeVideoSession && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 backdrop-blur-xl">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 40 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 40 }}
              className="bg-zinc-900 border border-white/10 rounded-[40px] w-full max-w-4xl overflow-hidden flex flex-col shadow-2xl"
            >
              <div className="p-8 border-b border-white/5 flex justify-between items-center bg-gradient-to-r from-red-500/10 to-transparent">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-red-500/20 flex items-center justify-center text-red-500">
                    <Video className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-xl font-black text-white uppercase tracking-tighter">{activeVideoSession.title}</h2>
                    <p className="text-[10px] font-bold text-red-500 uppercase tracking-widest">Capacitación Interactiva</p>
                  </div>
                </div>
                <button
                  onClick={() => setActiveVideoSession(null)}
                  aria-label="Cerrar"
                  className="p-2.5 min-w-[44px] min-h-[44px] hover:bg-white/5 rounded-full transition-colors text-zinc-500 hover:text-white flex items-center justify-center"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="p-8 bg-black">
                {activeVideoSession.youtubeUrl && getYoutubeVideoId(activeVideoSession.youtubeUrl) ? (
                  <div className="relative w-full aspect-video rounded-2xl overflow-hidden border border-white/10">
                    <iframe
                      src={`https://www.youtube.com/embed/${getYoutubeVideoId(activeVideoSession.youtubeUrl)}?autoplay=1&rel=0`}
                      title="YouTube video player"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                      className="absolute inset-0 w-full h-full"
                    ></iframe>
                  </div>
                ) : (
                  <div className="w-full aspect-video bg-zinc-900 rounded-2xl border border-white/10 flex flex-col items-center justify-center text-zinc-500">
                    <Video className="w-16 h-16 mb-4 opacity-50" />
                    <p className="font-medium">Video no disponible o URL inválida.</p>
                  </div>
                )}
              </div>

              <div className="p-8 border-t border-white/5 bg-zinc-900/50 flex flex-col sm:flex-row justify-between items-center gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-500">
                    <Award className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Recompensa</p>
                    <p className="text-sm font-black text-amber-500">+{activeVideoSession.points || 100} Puntos</p>
                  </div>
                </div>
                <button 
                  onClick={() => setActiveVideoSession(null)}
                  className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-zinc-800 text-white font-black text-[10px] uppercase tracking-widest hover:bg-zinc-700 transition-all flex items-center justify-center gap-2"
                >
                  Cerrar
                </button>
                <button 
                  onClick={handleStartQuiz}
                  disabled={isGeneratingQuiz || !isOnline}
                  title={!isOnline ? 'Requiere conexión a internet' : ''}
                  className={`w-full sm:w-auto px-8 py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all flex items-center justify-center gap-2 disabled:opacity-50 ${
                    !isOnline ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed' : 'bg-gradient-to-r from-amber-500 to-orange-600 text-white hover:from-amber-400 hover:to-orange-500 shadow-lg shadow-amber-500/20'
                  }`}
                >
                  {isGeneratingQuiz ? <Loader2 className="w-4 h-4 animate-spin" /> : !isOnline ? <WifiOff className="w-4 h-4" /> : <Brain className="w-4 h-4" />}
                  {isOnline ? 'Validar Conocimiento (Quiz IA)' : 'Requiere Conexión'}
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {isQuizActive && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/95 backdrop-blur-2xl">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 40 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 40 }}
              className="bg-zinc-900 border border-white/10 rounded-[40px] w-full max-w-2xl overflow-hidden flex flex-col shadow-2xl max-h-[90vh]"
            >
              <div className="p-8 border-b border-white/5 flex justify-between items-center bg-gradient-to-r from-amber-500/10 to-transparent shrink-0">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-amber-500/20 flex items-center justify-center text-amber-500">
                    <Brain className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-xl font-black text-white uppercase tracking-tighter">Quiz de Validación</h2>
                    <p className="text-[10px] font-bold text-amber-500 uppercase tracking-widest">
                      Pregunta {currentQuestionIndex + 1} de {quizQuestions.length}
                    </p>
                  </div>
                </div>
                {!isQuizFinished && (
                  <button
                    onClick={() => setIsQuizActive(false)}
                    aria-label="Cerrar"
                    className="p-2.5 min-w-[44px] min-h-[44px] hover:bg-white/5 rounded-full transition-colors text-zinc-500 hover:text-white flex items-center justify-center"
                  >
                    <X className="w-6 h-6" />
                  </button>
                )}
              </div>

              <div className="p-10 space-y-8 overflow-y-auto custom-scrollbar">
                {!isQuizFinished ? (
                  <>
                    <div className="space-y-4">
                      <h3 className="text-lg font-bold text-white leading-tight">
                        {quizQuestions[currentQuestionIndex].question}
                      </h3>
                      <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                        <motion.div 
                          className="h-full bg-amber-500"
                          initial={{ width: 0 }}
                          animate={{ width: `${((currentQuestionIndex + 1) / quizQuestions.length) * 100}%` }}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3">
                      {quizQuestions[currentQuestionIndex].options.map((option, idx) => (
                        <button
                          key={idx}
                          onClick={() => handleAnswerQuiz(idx)}
                          className="w-full p-5 bg-white/5 border border-white/5 rounded-2xl text-left text-sm font-medium text-zinc-300 hover:bg-white/10 hover:border-amber-500/50 transition-all group flex items-center gap-4"
                        >
                          <div className="w-8 h-8 rounded-xl bg-zinc-800 flex items-center justify-center text-[10px] font-black group-hover:bg-amber-500 group-hover:text-white transition-colors">
                            {String.fromCharCode(65 + idx)}
                          </div>
                          {option}
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="text-center space-y-8 py-10">
                    <div className="relative inline-block">
                      <div className={`w-32 h-32 rounded-full flex items-center justify-center border-4 ${calculateQuizScore() >= 70 ? 'border-[#4db6ac] bg-[#4db6ac]/10' : 'border-rose-500 bg-rose-500/10'}`}>
                        <span className={`text-4xl font-black ${calculateQuizScore() >= 70 ? 'text-[#4db6ac] dark:text-[#d4af37]' : 'text-rose-500'}`}>
                          {calculateQuizScore()}%
                        </span>
                      </div>
                      {calculateQuizScore() >= 70 && (
                        <motion.div 
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          className="absolute -top-2 -right-2 w-10 h-10 bg-[#4db6ac] rounded-full flex items-center justify-center text-white shadow-lg"
                        >
                          <CheckCircle2 className="w-6 h-6" />
                        </motion.div>
                      )}
                    </div>

                    <div className="space-y-2">
                      <h3 className="text-2xl font-black text-white uppercase tracking-tighter">
                        {calculateQuizScore() >= 70 ? '¡Excelente Trabajo!' : 'Sigue Intentándolo'}
                      </h3>
                      <p className="text-zinc-500 text-sm font-medium">
                        {calculateQuizScore() >= 70 
                          ? 'Has validado tus conocimientos correctamente. Los puntos han sido acreditados a tu perfil.' 
                          : 'No has alcanzado el puntaje mínimo (70%). Te recomendamos ver el video nuevamente.'}
                      </p>
                    </div>

                    <div className="pt-4 flex flex-col gap-3">
                      {calculateQuizScore() >= 70 ? (
                        <button 
                          onClick={() => handleCompleteVideo(activeVideoSession!)}
                          className="w-full py-5 bg-[#4db6ac] hover:bg-[#3a9e95] text-white font-black text-xs uppercase tracking-widest rounded-2xl shadow-lg shadow-[#4db6ac]/20 transition-all"
                        >
                          Finalizar y Reclamar Recompensa
                        </button>
                      ) : (
                        <button 
                          onClick={() => {
                            setIsQuizActive(false);
                            setIsQuizFinished(false);
                            setCurrentQuestionIndex(0);
                            setQuizAnswers([]);
                          }}
                          className="w-full py-5 bg-zinc-800 hover:bg-zinc-700 text-white font-black text-xs uppercase tracking-widest rounded-2xl transition-all"
                        >
                          Volver a Intentar
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {activeMicroModuleData && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 backdrop-blur-xl">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 40 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 40 }}
              className="bg-zinc-900 border border-white/10 rounded-[40px] w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl"
            >
              <div className="p-8 border-b border-white/5 flex justify-between items-center bg-gradient-to-r from-amber-500/10 to-transparent shrink-0">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-amber-500/20 flex items-center justify-center text-amber-500">
                    <Zap className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-xl font-black text-white uppercase tracking-tighter">{activeMicroModuleData.title}</h2>
                    <p className="text-[10px] font-bold text-amber-500 uppercase tracking-widest">{activeMicroModuleData.durationMinutes} min · Lightning Training</p>
                  </div>
                </div>
                <button
                  onClick={() => setActiveMicroModule(null)}
                  aria-label="Cerrar"
                  className="p-2.5 min-w-[44px] min-h-[44px] hover:bg-white/5 rounded-full transition-colors text-zinc-500 hover:text-white flex items-center justify-center"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-6 custom-scrollbar">
                {!microQuizDone ? (
                  activeMicroModuleData.content.map((block, i) => (
                    block.kind === 'text' ? (
                      <div key={i} className="bg-white/5 border border-white/5 rounded-2xl p-6">
                        <p className="text-zinc-300 text-sm leading-relaxed font-medium whitespace-pre-wrap">{block.payload.body}</p>
                      </div>
                    ) : block.kind === 'quiz' ? (
                      <div key={i} className="space-y-4">
                        <p className="text-white font-bold text-base leading-tight">{block.payload.question}</p>
                        <div className="grid grid-cols-1 gap-3">
                          {block.payload.options.map((opt, oi) => (
                            <button
                              key={oi}
                              onClick={() => handleMicroAnswer(i, oi)}
                              className={`w-full p-5 border rounded-2xl text-left text-sm font-medium transition-all flex items-center gap-4 ${
                                microAnswers[i] === oi
                                  ? 'bg-amber-500/20 border-amber-500/50 text-white'
                                  : 'bg-white/5 border-white/5 text-zinc-300 hover:bg-white/10 hover:border-white/10'
                              }`}
                            >
                              <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-[10px] font-black transition-colors ${
                                microAnswers[i] === oi ? 'bg-amber-500 text-white' : 'bg-zinc-800 text-zinc-500'
                              }`}>
                                {String.fromCharCode(65 + oi)}
                              </div>
                              {opt}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null
                  ))
                ) : (
                  <div className="text-center space-y-8 py-10">
                    <div className="relative inline-block">
                      <div className={`w-32 h-32 rounded-full flex items-center justify-center border-4 ${microResult?.certified ? 'border-[#4db6ac] bg-[#4db6ac]/10' : 'border-rose-500 bg-rose-500/10'}`}>
                        <span className={`text-4xl font-black ${microResult?.certified ? 'text-[#4db6ac]' : 'text-rose-500'}`}>
                          {microResult?.score ?? 0}%
                        </span>
                      </div>
                      {microResult?.certified && (
                        <motion.div
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          className="absolute -top-2 -right-2 w-10 h-10 bg-[#4db6ac] rounded-full flex items-center justify-center text-white shadow-lg"
                        >
                          <CheckCircle2 className="w-6 h-6" />
                        </motion.div>
                      )}
                    </div>
                    <div className="space-y-2">
                      <h3 className="text-2xl font-black text-white uppercase tracking-tighter">
                        {microResult?.certified ? '¡Certificado!' : 'Sigue practicando'}
                      </h3>
                      <p className="text-zinc-500 text-sm font-medium">
                        {microResult?.certified
                          ? 'Has aprobado el módulo lightning. Tu certificado ha sido registrado.'
                          : 'No alcanzaste el puntaje mínimo. Intenta de nuevo.'}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="p-8 border-t border-white/5 bg-zinc-900/50 flex justify-end gap-3 shrink-0">
                <button
                  onClick={() => setActiveMicroModule(null)}
                  className="px-8 py-4 rounded-2xl bg-zinc-800 text-white font-black text-[10px] uppercase tracking-widest hover:bg-zinc-700 transition-all"
                >
                  Cerrar
                </button>
                {!microQuizDone && (
                  <button
                    onClick={handleMicroSubmit}
                    disabled={microSubmitting}
                    className="px-8 py-4 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-black text-[10px] uppercase tracking-widest hover:from-amber-400 hover:to-orange-500 transition-all shadow-lg shadow-amber-500/20 flex items-center gap-2 disabled:opacity-50"
                  >
                    {microSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                    Enviar
                  </button>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Stats Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-6">
        {[
          { label: 'Total Sesiones', value: allSessions.length, icon: BookOpen, color: 'text-blue-500', bg: 'bg-blue-500/10' },
          { label: 'Completadas', value: allSessions.filter(s => s.status === 'completed').length, icon: CheckCircle2, color: 'text-[#4db6ac] dark:text-[#d4af37]', bg: 'bg-[#4db6ac]/10' },
          { label: 'Programadas', value: allSessions.filter(s => s.status === 'scheduled').length, icon: Clock, color: 'text-amber-500', bg: 'bg-amber-500/10' },
          { label: 'Participantes', value: allSessions.reduce((acc, s) => acc + (s.attendees?.length || 0), 0), icon: Users, color: 'text-indigo-500', bg: 'bg-indigo-500/10' },
        ].map((stat, i) => (
          <div key={i} className="bg-zinc-900/50 border border-white/10 rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-xl hover:border-white/20 transition-all">
            <div className="flex items-center gap-2 sm:gap-4 mb-2 sm:mb-4">
              <div className={`w-8 h-8 sm:w-12 sm:h-12 ${stat.bg} rounded-xl sm:rounded-2xl flex items-center justify-center border border-white/5`}>
                <stat.icon className={`w-4 h-4 sm:w-6 sm:h-6 ${stat.color}`} />
              </div>
              <span className="text-[8px] sm:text-[10px] font-black text-zinc-500 uppercase tracking-widest truncate">{stat.label}</span>
            </div>
            <div className="text-2xl sm:text-4xl font-black text-white tracking-tighter">{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Lightning Training */}
      {(microCatalog.data || microRecommendation.data?.module) && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-gradient-to-br from-amber-500/10 via-zinc-900/50 to-orange-600/5 border border-amber-500/20 rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-xl"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4 sm:mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-amber-500/20 flex items-center justify-center text-amber-500">
                <Zap className="w-5 h-5 sm:w-6 sm:h-6" />
              </div>
              <div>
                <h2 className="text-base sm:text-lg font-black text-white uppercase tracking-tighter">Lightning Training</h2>
                <p className="text-[8px] sm:text-[10px] font-bold text-amber-500 uppercase tracking-widest">Micro-capacitaciones 3-5 min</p>
              </div>
            </div>
            {microCerts.data && microCerts.data.certs.length > 0 && (
              <div className="flex items-center gap-2">
                <Award className="w-4 h-4 text-[#4db6ac]" />
                <span className="text-[10px] font-black text-[#4db6ac] uppercase tracking-widest">
                  {microCerts.data.certs.length} certificado{microCerts.data.certs.length > 1 ? 's' : ''}
                </span>
              </div>
            )}
          </div>

          {microRecommendation.data?.module && (
            <div className="bg-white/5 border border-amber-500/30 rounded-2xl p-4 sm:p-5 mb-4 sm:mb-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3 sm:gap-4">
                <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center text-amber-500 shrink-0">
                  <Brain className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-[8px] sm:text-[10px] font-black text-amber-500 uppercase tracking-widest">Recomendado para ti</p>
                  <p className="text-sm sm:text-base font-black text-white truncate">{microRecommendation.data.module.title}</p>
                  <p className="text-[10px] text-zinc-500 font-medium">{microRecommendation.data.module.durationMinutes} min · {microRecommendation.data.module.riskCategory}</p>
                </div>
              </div>
              <button
                onClick={() => handleMicroModuleClick(microRecommendation.data!.module!.id)}
                className="w-full sm:w-auto px-6 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-black text-[10px] uppercase tracking-widest hover:from-amber-400 hover:to-orange-500 transition-all shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2 shrink-0"
              >
                <Play className="w-4 h-4" />
                Iniciar
              </button>
            </div>
          )}

          {microCatalog.data && microCatalog.data.modules.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {microCatalog.data.modules.map((mod) => {
                const isCertified = microCerts.data?.certs.some((c) => c.moduleId === mod.id);
                return (
                  <button
                    key={mod.id}
                    onClick={() => handleMicroModuleClick(mod.id)}
                    className={`p-4 rounded-2xl border text-left transition-all flex items-center gap-3 ${
                      isCertified
                        ? 'bg-[#4db6ac]/10 border-[#4db6ac]/30 hover:border-[#4db6ac]/50'
                        : 'bg-white/5 border-white/5 hover:border-amber-500/30 hover:bg-white/10'
                    }`}
                  >
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                      isCertified ? 'bg-[#4db6ac]/20 text-[#4db6ac]' : 'bg-amber-500/20 text-amber-500'
                    }`}>
                      {isCertified ? <CheckCircle2 className="w-5 h-5" /> : <Zap className="w-5 h-5" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-black text-white truncate">{mod.title}</p>
                      <p className="text-[10px] text-zinc-500 font-medium">{mod.durationMinutes} min · {mod.riskCategory}</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-zinc-600 shrink-0" />
                  </button>
                );
              })}
            </div>
          )}

          {microRecommendation.data?.reason && !microRecommendation.data.module && (
            <p className="text-xs text-zinc-500 font-medium text-center py-2">{microRecommendation.data.reason}</p>
          )}
        </motion.div>
      )}

      {/* Tabs & Search */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div className="flex bg-zinc-900/50 p-1.5 rounded-2xl border border-white/10 self-start shadow-inner overflow-x-auto custom-scrollbar max-w-full">
          {[
            { id: 'all', label: 'Mis Cursos' },
            { id: 'library', label: 'Biblioteca Global' },
            { id: 'upcoming', label: 'Próximas' },
            { id: 'completed', label: 'Completadas' },
            { id: 'gamification', label: 'Gamificación', icon: <Gamepad2 className="w-4 h-4 mr-2 inline-block" /> },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-4 sm:px-6 py-2 sm:py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${
                activeTab === tab.id 
                  ? 'bg-[#4db6ac] text-white shadow-lg shadow-[#4db6ac]/20'
                  : 'text-zinc-500 hover:text-white'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
        <div className="relative w-full md:w-80 group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500 group-focus-within:text-[#4db6ac] dark:group-focus-within:text-[#d4af37] transition-colors" />
          <input
            type="text"
            placeholder="Buscar capacitación..."
            className="w-full bg-zinc-900/50 border border-white/10 rounded-2xl py-3.5 pl-12 pr-6 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#4db6ac]/50 transition-all shadow-inner"
          />
        </div>
      </div>

      {/* Content Area */}
      {activeTab === 'gamification' ? (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
        >
          <FindTheGuardian />
        </motion.div>
      ) : loading ? (
        <div className="flex flex-col items-center justify-center py-32 gap-4">
          <Loader2 className="w-10 h-10 text-[#4db6ac] dark:text-[#d4af37] animate-spin" />
          <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Cargando Conocimiento...</p>
        </div>
      ) : filteredSessions.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-8">
          {filteredSessions.map((session, index) => (
            <motion.div
              key={session.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className="bg-zinc-900/50 border border-white/10 rounded-2xl sm:rounded-[32px] p-4 sm:p-8 hover:border-[#4db6ac]/30 transition-all group shadow-xl hover:shadow-[#4db6ac]/5 flex flex-col"
            >
              <div className="flex flex-col sm:flex-row justify-between items-start gap-4 mb-4 sm:mb-6">
                <div className="flex items-center gap-3 sm:gap-4 w-full sm:w-auto">
                  <div className={`w-10 h-10 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl flex items-center justify-center border border-white/5 shrink-0 ${
                    session.status === 'completed' ? 'bg-[#4db6ac]/10 text-[#4db6ac] dark:text-[#d4af37]' : 'bg-amber-500/10 text-amber-500'
                  }`}>
                    {session.status === 'completed' ? <Award className="w-5 h-5 sm:w-7 sm:h-7" /> : <Play className="w-5 h-5 sm:w-7 sm:h-7" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-black text-white text-base sm:text-xl uppercase tracking-tight group-hover:text-[#d4af37] transition-colors truncate">{session.title}</h3>
                    <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-[8px] sm:text-[10px] text-zinc-500 font-black uppercase tracking-widest mt-1">
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                        <span>{new Date(session.date).toLocaleDateString()} · {session.duration} min</span>
                      </div>
                      {session.points && (
                        <div className="flex items-center gap-1">
                          <span className="w-1 h-1 rounded-full bg-zinc-700 hidden sm:block" />
                          <span className="text-amber-500 flex items-center gap-1">
                            <Award className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                            {session.points} PTS
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex flex-row sm:flex-col items-center sm:items-end w-full sm:w-auto justify-between sm:justify-end gap-2 shrink-0">
                  <span className={`px-3 sm:px-4 py-1 sm:py-1.5 rounded-full text-[8px] sm:text-[9px] font-black uppercase tracking-widest ${
                    session.status === 'completed' ? 'bg-[#4db6ac] text-white' : 'bg-amber-500 text-black'
                  }`}>
                    {session.status === 'completed' ? 'Completada' : 'Programada'}
                  </span>
                  {session.youtubeUrl && (
                    <span className="flex items-center gap-1 text-[8px] sm:text-[9px] font-black text-red-500 uppercase tracking-widest bg-red-500/10 px-2 py-1 rounded-md border border-red-500/20">
                      <Video className="w-3 h-3" />
                      Video
                    </span>
                  )}
                </div>
              </div>

              <p className="text-secondary-token text-xs sm:text-sm mb-4 sm:mb-8 line-clamp-2 font-medium leading-relaxed flex-1">
                {session.description || 'Sin descripción detallada para esta sesión de capacitación.'}
              </p>

              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 sm:pt-6 border-t border-white/5 mt-auto">
                <div className="flex items-center justify-between sm:justify-start w-full sm:w-auto gap-3">
                  <div className="flex -space-x-2 sm:-space-x-3">
                    {[1, 2, 3].map((_, i) => (
                      <div key={i} className="w-6 h-6 sm:w-8 sm:h-8 rounded-full bg-zinc-800 border-2 border-zinc-950 flex items-center justify-center text-[8px] sm:text-[10px] font-black text-zinc-500 shadow-lg">
                        U
                      </div>
                    ))}
                  </div>
                  <span className="text-[8px] sm:text-[10px] text-zinc-500 font-black uppercase tracking-widest">
                    {session.attendees?.length || 0} participantes
                  </span>
                </div>
                {session.isCurated ? (
                  <button 
                    onClick={() => handleAssignToProject(session)}
                    className="w-full sm:w-auto px-4 sm:px-6 py-2 sm:py-2.5 rounded-xl bg-blue-500 text-white font-black text-[10px] uppercase tracking-widest hover:bg-blue-400 transition-all shadow-lg shadow-blue-500/20"
                  >
                    Asignar a mi Proyecto
                  </button>
                ) : session.youtubeUrl ? (
                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    {session.status === 'completed' && (
                      <button
                        onClick={() => generateTrainingCertificate(
                          session.title,
                          user?.displayName || 'Participante',
                          selectedProject?.name || 'Proyecto',
                          session.date
                        )}
                        className="justify-center text-amber-500 hover:text-amber-400 text-[10px] font-black uppercase tracking-widest flex items-center gap-1 transition-all active:scale-95"
                        title="Descargar certificado"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={() => setActiveVideoSession(session)}
                      className="flex-1 sm:flex-none justify-center text-red-500 hover:text-red-400 text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-all active:scale-95 bg-red-500/10 sm:bg-transparent py-2 sm:py-0 rounded-xl sm:rounded-none"
                    >
                      <Video className="w-4 h-4" />
                      <span>{session.status === 'completed' ? 'Repetir' : 'Ver Video'}</span>
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setActiveVideoSession(session)}
                    className="w-full sm:w-auto justify-center text-[#4db6ac] dark:text-[#d4af37] hover:text-[#3a9e95] dark:hover:text-[#d4af37] text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-all active:scale-95 bg-[#4db6ac]/10 sm:bg-transparent py-2 sm:py-0 rounded-xl sm:rounded-none"
                  >
                    <span>Ver Detalles</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="bg-zinc-900/50 border border-dashed border-white/10 rounded-[40px] shadow-inner">
          <EmptyState
            mascot
            title="No hay capacitaciones activas"
            description="Programa tu primera sesión de capacitación o genera una Cápsula IA para empezar a fortalecer la cultura preventiva."
            action={{ label: 'Crear Sesión', onClick: () => setIsCreatingSession(true) }}
          />
        </div>
      )}

      {/* Wire OnboardingTrackProgressPanel — role-based onboarding track
          progress visualization. Renders with a placeholder track until real
          roleOnboarding data is wired from the user's profile. */}
      {user && (() => {
        const placeholderTrack: OnboardingTrack = {
          role: 'worker',
          trackId: 'track_v1_worker',
          steps: [],
          estimatedTotalMinutes: 0,
          completionThresholdPct: 80,
        };
        const placeholderProgress: UserOnboardingProgress = {
          userUid: user.uid,
          role: 'worker',
          completedStepIds: [],
          startedAt: new Date().toISOString(),
        };
        const placeholderStatus: OnboardingStatus = {
          trackId: 'track_v1_worker',
          totalSteps: 0,
          completedSteps: 0,
          completedPct: 0,
          blockedSteps: 0,
          canOperate: false,
          remainingMinutes: 0,
          trackCompleted: false,
        };
        return (
          <OnboardingTrackProgressPanel
            track={placeholderTrack}
            progress={placeholderProgress}
            status={placeholderStatus}
          />
        );
      })()}

      {adTrainingTitle && (
        <PostTrainingAdModal
          trainingTitle={adTrainingTitle}
          onClose={() => setAdTrainingTitle(null)}
        />
      )}
    </div>
  );
}
