import React, { useState, useEffect } from 'react';
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
  Youtube
} from 'lucide-react';
import { collection, addDoc, updateDoc, doc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useFirestoreCollection } from '../hooks/useFirestoreCollection';
import { useProject } from '../contexts/ProjectContext';
import { useUniversalKnowledge } from '../contexts/UniversalKnowledgeContext';
import { useFirebase } from '../contexts/FirebaseContext';
import { useZettelkasten } from '../hooks/useZettelkasten';
import { generateSafetyCapsule, generateTrainingQuiz } from '../services/geminiService';
import { TrainingSession } from '../types';

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
  const { selectedProject } = useProject();
  const { user } = useFirebase();
  const { nodes, loading: nodesLoading } = useUniversalKnowledge();
  const [activeTab, setActiveTab] = useState<'all' | 'upcoming' | 'completed' | 'library'>('all');
  const [generatingCapsule, setGeneratingCapsule] = useState(false);
  const [capsule, setCapsule] = useState<string | null>(null);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [activeVideoSession, setActiveVideoSession] = useState<TrainingSession | null>(null);
  const [isQuizActive, setIsQuizActive] = useState(false);
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [quizAnswers, setQuizAnswers] = useState<number[]>([]);
  const [isQuizFinished, setIsQuizFinished] = useState(false);
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
  const { addNode } = useZettelkasten();

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
      const collectionRef = collection(db, 'training');
      await addDoc(collectionRef, {
        ...newSessionForm,
        date: new Date().toISOString(),
        status: 'scheduled',
        attendees: [],
        projectId: newSessionForm.isCurated ? null : selectedProject?.id
      });
      setIsCreatingSession(false);
      setNewSessionForm({ title: '', description: '', youtubeUrl: '', duration: 15, points: 100, isCurated: false });
    } catch (error) {
      console.error('Error creating session:', error);
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
      console.error('Error assigning session:', error);
    }
  };

  const handleCompleteVideo = async (session: TrainingSession) => {
    if (!selectedProject || !user) return;

    try {
      const docRef = doc(db, `projects/${selectedProject.id}/training`, session.id);
      const newAttendees = session.attendees?.includes(user.uid) 
        ? session.attendees 
        : [...(session.attendees || []), user.uid];

      await updateDoc(docRef, {
        status: 'completed',
        attendees: newAttendees
      });
      setActiveVideoSession(null);
      setIsQuizActive(false);
      setIsQuizFinished(false);
      setQuizQuestions([]);
      setQuizAnswers([]);
      setCurrentQuestionIndex(0);
    } catch (error) {
      console.error('Error completing video:', error);
    }
  };

  const handleStartQuiz = async () => {
    if (!activeVideoSession) return;
    setIsGeneratingQuiz(true);
    try {
      const questions = await generateTrainingQuiz(activeVideoSession.title, activeVideoSession.description);
      setQuizQuestions(questions);
      setIsQuizActive(true);
      setCurrentQuestionIndex(0);
      setQuizAnswers([]);
      setIsQuizFinished(false);
    } catch (error) {
      console.error('Error generating quiz:', error);
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
    setGeneratingCapsule(true);
    try {
      // Find nodes connected to the user (heuristic: nodes with user's name or relevant tags)
      const userNodes = nodes.filter(n => 
        n.title.toLowerCase().includes(user?.displayName?.toLowerCase() || '') ||
        n.description.toLowerCase().includes(user?.displayName?.toLowerCase() || '') ||
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
      console.error('Error generating capsule:', error);
    } finally {
      setGeneratingCapsule(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-white uppercase tracking-tighter flex items-center gap-3">
            <BookOpen className="w-8 h-8 text-emerald-500" />
            Capacitaciones & Formación
          </h1>
          <p className="text-zinc-400 mt-1 font-medium italic">"El conocimiento es la primera línea de defensa"</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={handleGenerateCapsule}
            disabled={generatingCapsule}
            className="flex items-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white px-6 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all shadow-lg shadow-blue-500/20 active:scale-95 disabled:opacity-50"
          >
            {generatingCapsule ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            <span>Cápsula de Seguridad IA</span>
          </button>
          <button 
            onClick={() => setIsCreatingSession(true)}
            className="flex items-center gap-2 bg-zinc-900 border border-white/10 hover:bg-zinc-800 text-white px-6 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all active:scale-95"
          >
            <Plus className="w-4 h-4" />
            <span>Nueva Sesión</span>
          </button>
        </div>
      </div>

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
                  className="p-3 hover:bg-white/5 rounded-full transition-colors text-zinc-500 hover:text-white"
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
                  <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                    <Shield className="w-5 h-5" />
                  </div>
                  <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest max-w-[200px]">
                    Capacitación completada con éxito. Registro guardado en la Red Neuronal.
                  </p>
                </div>
                <button 
                  onClick={() => setCapsule(null)}
                  className="px-8 py-4 rounded-2xl bg-emerald-500 text-white font-black text-[10px] uppercase tracking-widest hover:bg-emerald-400 transition-all flex items-center gap-2 shadow-lg shadow-emerald-500/20"
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
              className="bg-zinc-900 border border-white/10 rounded-[40px] w-full max-w-xl overflow-hidden flex flex-col shadow-2xl"
            >
              <div className="p-8 border-b border-white/5 flex justify-between items-center">
                <h2 className="text-xl font-black text-white uppercase tracking-tighter">Nueva Capacitación</h2>
                <button 
                  onClick={() => setIsCreatingSession(false)}
                  className="p-3 hover:bg-white/5 rounded-full transition-colors text-zinc-500 hover:text-white"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <form onSubmit={handleCreateSession} className="p-8 space-y-6">
                <div>
                  <label className="block text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">Título</label>
                  <input
                    type="text"
                    required
                    value={newSessionForm.title}
                    onChange={e => setNewSessionForm({...newSessionForm, title: e.target.value})}
                    className="w-full bg-zinc-900/50 border border-white/10 rounded-2xl p-4 text-white focus:outline-none focus:border-emerald-500 transition-colors"
                    placeholder="Ej. Uso correcto de arnés"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">Descripción</label>
                  <textarea
                    required
                    value={newSessionForm.description}
                    onChange={e => setNewSessionForm({...newSessionForm, description: e.target.value})}
                    className="w-full bg-zinc-900/50 border border-white/10 rounded-2xl p-4 text-white focus:outline-none focus:border-emerald-500 transition-colors resize-none h-24"
                    placeholder="Detalles de la capacitación..."
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">URL del Video (YouTube)</label>
                  <div className="relative">
                    <Youtube className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
                    <input
                      type="url"
                      value={newSessionForm.youtubeUrl}
                      onChange={e => setNewSessionForm({...newSessionForm, youtubeUrl: e.target.value})}
                      className="w-full bg-zinc-900/50 border border-white/10 rounded-2xl py-4 pl-12 pr-4 text-white focus:outline-none focus:border-emerald-500 transition-colors"
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
                      className="w-full bg-zinc-900/50 border border-white/10 rounded-2xl p-4 text-white focus:outline-none focus:border-emerald-500 transition-colors"
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
                      className="w-full bg-zinc-900/50 border border-white/10 rounded-2xl p-4 text-white focus:outline-none focus:border-emerald-500 transition-colors"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-3 p-4 rounded-2xl bg-white/5 border border-white/5">
                  <input 
                    type="checkbox"
                    id="isCurated"
                    checked={newSessionForm.isCurated}
                    onChange={e => setNewSessionForm({...newSessionForm, isCurated: e.target.checked})}
                    className="w-5 h-5 rounded border-white/10 bg-zinc-900 text-emerald-500 focus:ring-emerald-500"
                  />
                  <label htmlFor="isCurated" className="text-[10px] font-black text-zinc-400 uppercase tracking-widest cursor-pointer">
                    Añadir a la Biblioteca Global (Curación)
                  </label>
                </div>

                <div className="pt-4 flex justify-end">
                  <button 
                    type="submit"
                    className="px-8 py-4 rounded-2xl bg-emerald-500 text-white font-black text-[10px] uppercase tracking-widest hover:bg-emerald-400 transition-all shadow-lg shadow-emerald-500/20"
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
                    <Youtube className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-xl font-black text-white uppercase tracking-tighter">{activeVideoSession.title}</h2>
                    <p className="text-[10px] font-bold text-red-500 uppercase tracking-widest">Capacitación Interactiva</p>
                  </div>
                </div>
                <button 
                  onClick={() => setActiveVideoSession(null)}
                  className="p-3 hover:bg-white/5 rounded-full transition-colors text-zinc-500 hover:text-white"
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
                    <Youtube className="w-16 h-16 mb-4 opacity-50" />
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
                  disabled={isGeneratingQuiz}
                  className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-black text-[10px] uppercase tracking-widest hover:from-amber-400 hover:to-orange-500 transition-all flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20 disabled:opacity-50"
                >
                  {isGeneratingQuiz ? <Loader2 className="w-4 h-4 animate-spin" /> : <Brain className="w-4 h-4" />}
                  Validar Conocimiento (Quiz IA)
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
              className="bg-zinc-900 border border-white/10 rounded-[40px] w-full max-w-2xl overflow-hidden flex flex-col shadow-2xl"
            >
              <div className="p-8 border-b border-white/5 flex justify-between items-center bg-gradient-to-r from-amber-500/10 to-transparent">
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
                    className="p-3 hover:bg-white/5 rounded-full transition-colors text-zinc-500 hover:text-white"
                  >
                    <X className="w-6 h-6" />
                  </button>
                )}
              </div>

              <div className="p-10 space-y-8">
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
                      <div className={`w-32 h-32 rounded-full flex items-center justify-center border-4 ${calculateQuizScore() >= 70 ? 'border-emerald-500 bg-emerald-500/10' : 'border-rose-500 bg-rose-500/10'}`}>
                        <span className={`text-4xl font-black ${calculateQuizScore() >= 70 ? 'text-emerald-500' : 'text-rose-500'}`}>
                          {calculateQuizScore()}%
                        </span>
                      </div>
                      {calculateQuizScore() >= 70 && (
                        <motion.div 
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          className="absolute -top-2 -right-2 w-10 h-10 bg-emerald-500 rounded-full flex items-center justify-center text-white shadow-lg"
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
                          className="w-full py-5 bg-emerald-500 hover:bg-emerald-400 text-white font-black text-xs uppercase tracking-widest rounded-2xl shadow-lg shadow-emerald-500/20 transition-all"
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

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {[
          { label: 'Total Sesiones', value: allSessions.length, icon: BookOpen, color: 'text-blue-500', bg: 'bg-blue-500/10' },
          { label: 'Completadas', value: allSessions.filter(s => s.status === 'completed').length, icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
          { label: 'Programadas', value: allSessions.filter(s => s.status === 'scheduled').length, icon: Clock, color: 'text-amber-500', bg: 'bg-amber-500/10' },
          { label: 'Participantes', value: allSessions.reduce((acc, s) => acc + (s.attendees?.length || 0), 0), icon: Users, color: 'text-indigo-500', bg: 'bg-indigo-500/10' },
        ].map((stat, i) => (
          <div key={i} className="bg-zinc-900/50 border border-white/10 rounded-3xl p-6 shadow-xl hover:border-white/20 transition-all">
            <div className="flex items-center gap-4 mb-4">
              <div className={`w-12 h-12 ${stat.bg} rounded-2xl flex items-center justify-center border border-white/5`}>
                <stat.icon className={`w-6 h-6 ${stat.color}`} />
              </div>
              <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">{stat.label}</span>
            </div>
            <div className="text-4xl font-black text-white tracking-tighter">{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Tabs & Search */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex bg-zinc-900/50 p-1.5 rounded-2xl border border-white/10 self-start shadow-inner">
          {[
            { id: 'all', label: 'Mis Cursos' },
            { id: 'library', label: 'Biblioteca Global' },
            { id: 'upcoming', label: 'Próximas' },
            { id: 'completed', label: 'Completadas' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                activeTab === tab.id 
                  ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20' 
                  : 'text-zinc-500 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="relative w-full md:w-80 group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500 group-focus-within:text-emerald-500 transition-colors" />
          <input
            type="text"
            placeholder="Buscar capacitación..."
            className="w-full bg-zinc-900/50 border border-white/10 rounded-2xl py-3.5 pl-12 pr-6 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 transition-all shadow-inner"
          />
        </div>
      </div>

      {/* Sessions Grid */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-32 gap-4">
          <Loader2 className="w-10 h-10 text-emerald-500 animate-spin" />
          <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Cargando Conocimiento...</p>
        </div>
      ) : filteredSessions.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {filteredSessions.map((session, index) => (
            <motion.div
              key={session.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className="bg-zinc-900/50 border border-white/10 rounded-[32px] p-8 hover:border-emerald-500/30 transition-all group shadow-xl hover:shadow-emerald-500/5"
            >
              <div className="flex justify-between items-start mb-6">
                <div className="flex items-center gap-4">
                  <div className={`w-14 h-14 rounded-2xl flex items-center justify-center border border-white/5 ${
                    session.status === 'completed' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500'
                  }`}>
                    {session.status === 'completed' ? <Award className="w-7 h-7" /> : <Play className="w-7 h-7" />}
                  </div>
                  <div>
                    <h3 className="font-black text-white text-xl uppercase tracking-tight group-hover:text-emerald-400 transition-colors">{session.title}</h3>
                    <div className="flex items-center gap-3 text-[10px] text-zinc-500 font-black uppercase tracking-widest mt-1">
                      <Clock className="w-3.5 h-3.5" />
                      <span>{new Date(session.date).toLocaleDateString()} · {session.duration} min</span>
                      {session.points && (
                        <>
                          <span className="w-1 h-1 rounded-full bg-zinc-700" />
                          <span className="text-amber-500 flex items-center gap-1">
                            <Award className="w-3.5 h-3.5" />
                            {session.points} PTS
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className={`px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest ${
                    session.status === 'completed' ? 'bg-emerald-500 text-white' : 'bg-amber-500 text-black'
                  }`}>
                    {session.status === 'completed' ? 'Completada' : 'Programada'}
                  </span>
                  {session.youtubeUrl && (
                    <span className="flex items-center gap-1 text-[9px] font-black text-red-500 uppercase tracking-widest bg-red-500/10 px-2 py-1 rounded-md border border-red-500/20">
                      <Youtube className="w-3 h-3" />
                      Video
                    </span>
                  )}
                </div>
              </div>

              <p className="text-zinc-400 text-sm mb-8 line-clamp-2 font-medium leading-relaxed">
                {session.description || 'Sin descripción detallada para esta sesión de capacitación.'}
              </p>

              <div className="flex items-center justify-between pt-6 border-t border-white/5">
                <div className="flex items-center gap-3">
                  <div className="flex -space-x-3">
                    {[1, 2, 3].map((_, i) => (
                      <div key={i} className="w-8 h-8 rounded-full bg-zinc-800 border-2 border-zinc-950 flex items-center justify-center text-[10px] font-black text-zinc-500 shadow-lg">
                        U
                      </div>
                    ))}
                  </div>
                  <span className="text-[10px] text-zinc-500 font-black uppercase tracking-widest">
                    {session.attendees?.length || 0} participantes
                  </span>
                </div>
                {session.isCurated ? (
                  <button 
                    onClick={() => handleAssignToProject(session)}
                    className="px-6 py-2.5 rounded-xl bg-blue-500 text-white font-black text-[10px] uppercase tracking-widest hover:bg-blue-400 transition-all shadow-lg shadow-blue-500/20"
                  >
                    Asignar a mi Proyecto
                  </button>
                ) : session.youtubeUrl ? (
                  <button 
                    onClick={() => setActiveVideoSession(session)}
                    className="text-red-500 hover:text-red-400 text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-all active:scale-95"
                  >
                    <Youtube className="w-4 h-4" />
                    <span>Ver Video</span>
                  </button>
                ) : (
                  <button className="text-emerald-500 hover:text-emerald-400 text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-all active:scale-95">
                    <span>Ver Detalles</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="bg-zinc-900/50 border border-dashed border-white/10 rounded-[40px] p-24 text-center shadow-inner">
          <div className="w-24 h-24 bg-zinc-800 rounded-[32px] flex items-center justify-center mx-auto mb-8 border border-white/5 shadow-2xl">
            <BookOpen className="w-12 h-12 text-zinc-600" />
          </div>
          <h3 className="text-2xl font-black text-white mb-3 uppercase tracking-tight">No hay capacitaciones activas</h3>
          <p className="text-zinc-500 max-w-md mx-auto font-medium leading-relaxed">
            Programa tu primera sesión de capacitación o genera una <span className="text-blue-500">Cápsula IA</span> para empezar a fortalecer la cultura preventiva.
          </p>
        </div>
      )}
    </div>
  );
}
