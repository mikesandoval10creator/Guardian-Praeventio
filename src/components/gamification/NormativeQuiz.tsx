import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { BookOpen, CheckCircle2, AlertTriangle, ArrowRight, RefreshCw, Trophy, X, Loader2 } from 'lucide-react';
import confetti from 'canvas-confetti';
import { generateTrainingQuiz } from '../../services/geminiService';

interface NormativeQuizProps {
  onComplete: (points: number) => void;
  onClose: () => void;
}

interface Question {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export function NormativeQuiz({ onComplete, onClose }: NormativeQuizProps) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [isAnswered, setIsAnswered] = useState(false);
  const [score, setScore] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [gameFinished, setGameFinished] = useState(false);

  useEffect(() => {
    const fetchQuiz = async () => {
      try {
        setIsLoading(true);
        const quizData = await generateTrainingQuiz(
          "Normativa Chilena de Seguridad", 
          "Ley 16.744 sobre accidentes del trabajo y enfermedades profesionales, y DS 594 sobre condiciones sanitarias y ambientales básicas en los lugares de trabajo."
        );
        setQuestions(quizData);
      } catch (error) {
        console.error("Error fetching quiz:", error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchQuiz();
  }, []);

  const handleOptionSelect = (index: number) => {
    if (isAnswered) return;
    setSelectedOption(index);
    setIsAnswered(true);
    
    if (index === questions[currentQuestionIndex].correctIndex) {
      setScore(prev => prev + 1);
    }
  };

  const handleNextQuestion = () => {
    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex(prev => prev + 1);
      setSelectedOption(null);
      setIsAnswered(false);
    } else {
      setGameFinished(true);
      if (score === questions.length) {
        triggerConfetti();
      }
    }
  };

  const handleComplete = () => {
    // Calculate points based on score
    const pointsEarned = Math.round((score / questions.length) * 200);
    onComplete(pointsEarned);
  };

  const triggerConfetti = () => {
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 }
    });
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-white/10 rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col relative">
        <div className="p-6 border-b border-white/5 flex items-center justify-between bg-gradient-to-r from-indigo-500/10 to-transparent">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center text-indigo-500">
              <BookOpen className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-black text-white uppercase tracking-tight">Desafío Normativo</h2>
              <p className="text-xs text-indigo-400 font-bold uppercase tracking-widest">Quiz Generado por IA</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-xl transition-colors text-zinc-400 hover:text-white">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-8 flex flex-col min-h-[400px] relative">
          {isLoading ? (
            <div className="flex-1 flex flex-col items-center justify-center">
              <Loader2 className="w-12 h-12 text-indigo-500 animate-spin mb-4" />
              <p className="text-zinc-400 font-bold uppercase tracking-widest">Generando preguntas...</p>
            </div>
          ) : gameFinished ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex-1 flex flex-col items-center justify-center text-center"
            >
              <div className={`w-24 h-24 rounded-full flex items-center justify-center mb-6 ${
                score === questions.length ? 'bg-emerald-500/20 text-emerald-500' : 'bg-amber-500/20 text-amber-500'
              }`}>
                {score === questions.length ? <Trophy className="w-12 h-12" /> : <AlertTriangle className="w-12 h-12" />}
              </div>
              <h3 className="text-3xl font-black text-white uppercase tracking-tighter mb-2">
                {score === questions.length ? '¡Puntaje Perfecto!' : '¡Quiz Completado!'}
              </h3>
              <p className="text-zinc-400 mb-8 text-lg">
                Has respondido correctamente {score} de {questions.length} preguntas.
              </p>
              <button
                onClick={handleComplete}
                className="flex items-center gap-2 px-8 py-4 bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl font-black uppercase tracking-widest transition-colors"
              >
                <CheckCircle2 className="w-5 h-5" />
                Reclamar {Math.round((score / questions.length) * 200)} Puntos
              </button>
            </motion.div>
          ) : questions.length > 0 ? (
            <div className="flex flex-col h-full">
              <div className="flex justify-between items-center mb-6">
                <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">
                  Pregunta {currentQuestionIndex + 1} de {questions.length}
                </span>
                <div className="flex gap-1">
                  {questions.map((_, idx) => (
                    <div key={idx} className={`w-8 h-2 rounded-full ${
                      idx < currentQuestionIndex ? 'bg-indigo-500' :
                      idx === currentQuestionIndex ? 'bg-indigo-500/50' : 'bg-zinc-800'
                    }`} />
                  ))}
                </div>
              </div>

              <h3 className="text-xl font-bold text-white mb-8 leading-relaxed">
                {questions[currentQuestionIndex].question}
              </h3>

              <div className="space-y-3 mb-8">
                {questions[currentQuestionIndex].options.map((option, index) => {
                  const isCorrect = index === questions[currentQuestionIndex].correctIndex;
                  const isSelected = selectedOption === index;
                  
                  let buttonClass = "bg-zinc-800/50 border-white/10 hover:bg-zinc-800 hover:border-white/20 text-zinc-300";
                  
                  if (isAnswered) {
                    if (isCorrect) {
                      buttonClass = "bg-emerald-500/20 border-emerald-500/50 text-emerald-400";
                    } else if (isSelected) {
                      buttonClass = "bg-rose-500/20 border-rose-500/50 text-rose-400";
                    } else {
                      buttonClass = "bg-zinc-900 border-white/5 text-zinc-600 opacity-50";
                    }
                  }

                  return (
                    <button
                      key={index}
                      onClick={() => handleOptionSelect(index)}
                      disabled={isAnswered}
                      className={`w-full text-left p-4 rounded-xl border transition-all flex items-center justify-between ${buttonClass}`}
                    >
                      <span>{option}</span>
                      {isAnswered && isCorrect && <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />}
                      {isAnswered && isSelected && !isCorrect && <X className="w-5 h-5 text-rose-500 shrink-0" />}
                    </button>
                  );
                })}
              </div>

              <AnimatePresence>
                {isAnswered && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`p-4 rounded-xl border mb-6 ${
                      selectedOption === questions[currentQuestionIndex].correctIndex
                        ? 'bg-emerald-500/10 border-emerald-500/20'
                        : 'bg-amber-500/10 border-amber-500/20'
                    }`}
                  >
                    <p className={`text-sm ${
                      selectedOption === questions[currentQuestionIndex].correctIndex ? 'text-emerald-400' : 'text-amber-400'
                    }`}>
                      <span className="font-bold uppercase tracking-widest mr-2">Explicación:</span>
                      {questions[currentQuestionIndex].explanation}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="mt-auto flex justify-end">
                <button
                  onClick={handleNextQuestion}
                  disabled={!isAnswered}
                  className={`px-6 py-3 rounded-xl font-black uppercase tracking-widest transition-all flex items-center gap-2 ${
                    isAnswered 
                      ? 'bg-indigo-500 hover:bg-indigo-600 text-white' 
                      : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                  }`}
                >
                  {currentQuestionIndex < questions.length - 1 ? 'Siguiente Pregunta' : 'Ver Resultados'}
                  <ArrowRight className="w-5 h-5" />
                </button>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-zinc-500">
              No se pudieron cargar las preguntas.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
