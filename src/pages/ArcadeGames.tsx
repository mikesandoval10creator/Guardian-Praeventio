import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Gamepad2, Trophy, Star, AlertTriangle, ShieldAlert, Zap, BookOpen, Loader2, CheckCircle2, X } from 'lucide-react';
import { Card, Button } from '../components/shared/Card';
import { useProject } from '../contexts/ProjectContext';
import { useUniversalKnowledge } from '../contexts/UniversalKnowledgeContext';
import { NodeType } from '../types';
import { generateEmergencyScenario } from '../services/geminiService';

export function ArcadeGames() {
  const [gameState, setGameState] = useState<'start' | 'playing' | 'gameover' | 'won'>('start');
  const [score, setScore] = useState(0);
  const [tokens, setTokens] = useState(5);
  const [showScenario, setShowScenario] = useState(false);
  const [scenarioLoading, setScenarioLoading] = useState(false);
  const [scenario, setScenario] = useState<any>(null);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const { nodes } = useUniversalKnowledge();
  const { selectedProject } = useProject();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>(0);
  
  // Game state refs for the animation loop
  const playerRef = useRef({ x: 50, y: 150, width: 30, height: 30, speed: 5, dy: 0 });
  const hazardsRef = useRef<{x: number, y: number, width: number, height: number, type: 'fire' | 'spill', speed: number}[]>([]);
  const frameCountRef = useRef(0);

  const loadHistoricalScenario = async () => {
    setShowScenario(true);
    setScenario(null);
    setSelectedAnswer(null);
    setScenarioLoading(true);
    try {
      // Use the worst 3 incidents from project nodes as context
      const incidents = nodes
        .filter(n => n.type === NodeType.INCIDENT && (!selectedProject || n.projectId === selectedProject.id))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 3);
      const context = incidents.length > 0
        ? incidents.map(i => `${i.title}: ${i.description || ''}`).join('\n')
        : 'Incidente genérico de obra: trabajador sin EPP en zona HAZMAT';
      const result = await generateEmergencyScenario(context);
      setScenario(result);
    } catch {
      setScenario({
        title: 'Escape de Gas en Bodega',
        situation: 'Detectas olor a gas cerca de la bodega de químicos. Hay 3 trabajadores dentro.',
        options: [
          'Entrar inmediatamente a sacar a los trabajadores',
          'Activar alarma, evacuar y llamar a emergencias desde afuera',
          'Abrir todas las ventanas y esperar',
          'Ignorar el olor y continuar el turno'
        ],
        correct: 1,
        explanation: 'Nunca entres a un área con escape de gas sin EPP adecuado. La acción correcta es activar la alarma, evacuar y llamar desde afuera.'
      });
    } finally {
      setScenarioLoading(false);
    }
  };

  const startGame = () => {
    if (tokens <= 0) return;
    setTokens(prev => prev - 1);
    setGameState('playing');
    setScore(0);
    playerRef.current = { x: 50, y: 150, width: 30, height: 30, speed: 5, dy: 0 };
    hazardsRef.current = [];
    frameCountRef.current = 0;
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (gameState !== 'playing') return;
    if (e.key === 'ArrowUp') playerRef.current.dy = -playerRef.current.speed;
    if (e.key === 'ArrowDown') playerRef.current.dy = playerRef.current.speed;
  };

  const handleKeyUp = (e: KeyboardEvent) => {
    if (gameState !== 'playing') return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') playerRef.current.dy = 0;
  };

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [gameState]);

  const updateGame = () => {
    if (gameState !== 'playing') return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Update player
    playerRef.current.y += playerRef.current.dy;
    
    // Boundaries
    if (playerRef.current.y < 0) playerRef.current.y = 0;
    if (playerRef.current.y + playerRef.current.height > canvas.height) {
      playerRef.current.y = canvas.height - playerRef.current.height;
    }

    // Draw player (Worker)
    ctx.fillStyle = '#3b82f6'; // Blue
    ctx.fillRect(playerRef.current.x, playerRef.current.y, playerRef.current.width, playerRef.current.height);
    // Hardhat
    ctx.fillStyle = '#eab308'; // Yellow
    ctx.fillRect(playerRef.current.x - 2, playerRef.current.y - 5, playerRef.current.width + 4, 10);

    // Manage hazards
    frameCountRef.current++;
    if (frameCountRef.current % 60 === 0) { // Spawn every ~1 second
      const type = Math.random() > 0.5 ? 'fire' : 'spill';
      hazardsRef.current.push({
        x: canvas.width,
        y: Math.random() * (canvas.height - 30),
        width: 30,
        height: 30,
        type,
        speed: 3 + Math.random() * 2 + (score / 500) // Increase speed over time
      });
    }

    // Update and draw hazards
    for (let i = hazardsRef.current.length - 1; i >= 0; i--) {
      const hazard = hazardsRef.current[i];
      hazard.x -= hazard.speed;

      // Draw hazard
      if (hazard.type === 'fire') {
        ctx.fillStyle = '#f97316'; // Orange
      } else {
        ctx.fillStyle = '#8b5cf6'; // Violet
      }
      ctx.fillRect(hazard.x, hazard.y, hazard.width, hazard.height);

      // Collision detection
      if (
        playerRef.current.x < hazard.x + hazard.width &&
        playerRef.current.x + playerRef.current.width > hazard.x &&
        playerRef.current.y < hazard.y + hazard.height &&
        playerRef.current.y + playerRef.current.height > hazard.y
      ) {
        setGameState('gameover');
        return; // Stop updating
      }

      // Remove off-screen hazards and increase score
      if (hazard.x + hazard.width < 0) {
        hazardsRef.current.splice(i, 1);
        setScore(prev => prev + 10);
      }
    }

    // Win condition
    if (score >= 1000) {
      setGameState('won');
      return;
    }

    requestRef.current = requestAnimationFrame(updateGame);
  };

  useEffect(() => {
    if (gameState === 'playing') {
      requestRef.current = requestAnimationFrame(updateGame);
    }
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [gameState, score]); // include score to ensure it updates correctly inside the loop if needed, though refs are better for loop state

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white uppercase tracking-tighter leading-tight flex items-center gap-3">
            <Gamepad2 className="w-8 h-8 text-fuchsia-500" />
            Arcade de Seguridad
          </h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            Gamificación y Refuerzo Positivo
          </p>
        </div>
        <div className="px-4 py-2 rounded-xl border flex items-center gap-2 text-yellow-500 bg-yellow-500/10 border-yellow-500/20">
          <Star className="w-5 h-5 fill-current" />
          <span className="font-bold uppercase tracking-wider text-sm">
            {tokens} Tokens Disponibles
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Game Area */}
        <Card className="p-0 border-white/5 lg:col-span-2 overflow-hidden relative bg-zinc-900 flex flex-col items-center justify-center min-h-[400px]">
          
          {/* Canvas */}
          <canvas 
            ref={canvasRef} 
            width={600} 
            height={300} 
            className="bg-zinc-950 border border-white/10 rounded-lg shadow-2xl max-w-full"
            style={{ display: gameState === 'playing' ? 'block' : 'none' }}
          />

          {/* Overlays */}
          {gameState === 'start' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm p-6 text-center">
              <Gamepad2 className="w-16 h-16 text-fuchsia-500 mb-4" />
              <h2 className="text-2xl font-black text-white uppercase tracking-widest mb-2">Evasión de Riesgos</h2>
              <p className="text-zinc-400 mb-6 max-w-md">Usa las flechas Arriba y Abajo para esquivar los peligros (fuego y derrames). Sobrevive hasta alcanzar 1000 puntos.</p>
              <Button onClick={startGame} disabled={tokens <= 0} className="bg-fuchsia-600 hover:bg-fuchsia-500 text-white px-8 py-3 text-lg">
                Insertar Token
              </Button>
            </div>
          )}

          {gameState === 'gameover' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-rose-900/80 backdrop-blur-sm p-6 text-center">
              <AlertTriangle className="w-16 h-16 text-rose-500 mb-4" />
              <h2 className="text-3xl font-black text-white uppercase tracking-widest mb-2">¡Incidente!</h2>
              <p className="text-rose-200 mb-6 text-xl">Puntuación: {score}</p>
              <Button onClick={startGame} disabled={tokens <= 0} className="bg-rose-600 hover:bg-rose-500 text-white px-8 py-3">
                Reintentar (1 Token)
              </Button>
            </div>
          )}

          {gameState === 'won' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-emerald-900/80 backdrop-blur-sm p-6 text-center">
              <Trophy className="w-16 h-16 text-yellow-500 mb-4" />
              <h2 className="text-3xl font-black text-white uppercase tracking-widest mb-2">¡Cero Daño!</h2>
              <p className="text-emerald-200 mb-6 text-xl">Has completado el turno sin incidentes.</p>
              <Button onClick={() => setGameState('start')} className="bg-emerald-600 hover:bg-emerald-500 text-white px-8 py-3">
                Volver al Menú
              </Button>
            </div>
          )}

          {/* HUD */}
          {gameState === 'playing' && (
            <div className="absolute top-4 right-4 bg-black/50 backdrop-blur-md px-4 py-2 rounded-lg border border-white/10">
              <span className="text-xl font-black text-white">{score} PTS</span>
            </div>
          )}
        </Card>

        {/* Scenario Panel */}
        <Card className="p-6 border-white/5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-amber-500" />
              Historia Real
            </h2>
            <Button
              onClick={loadHistoricalScenario}
              disabled={scenarioLoading}
              className="bg-amber-600 hover:bg-amber-500 text-white text-xs px-4 py-2 h-auto"
            >
              {scenarioLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Generar Escenario IA'}
            </Button>
          </div>

          <AnimatePresence>
            {showScenario && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
                {scenarioLoading ? (
                  <div className="flex flex-col items-center gap-3 py-6">
                    <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
                    <p className="text-xs text-zinc-400">Generando escenario desde incidentes históricos...</p>
                  </div>
                ) : scenario && (
                  <>
                    <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl">
                      <p className="text-xs font-black text-amber-400 uppercase tracking-widest mb-1">{scenario.title}</p>
                      <p className="text-sm text-zinc-300 leading-relaxed">{scenario.situation}</p>
                    </div>

                    <div className="space-y-2">
                      {(scenario.options || []).map((opt: string, i: number) => (
                        <button
                          key={i}
                          onClick={() => setSelectedAnswer(i)}
                          disabled={selectedAnswer !== null}
                          className={`w-full text-left px-4 py-3 rounded-xl border text-xs font-medium transition-all ${
                            selectedAnswer === null
                              ? 'border-zinc-700 text-zinc-300 hover:border-zinc-500'
                              : i === scenario.correct
                                ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400'
                                : selectedAnswer === i
                                  ? 'border-rose-500 bg-rose-500/10 text-rose-400'
                                  : 'border-zinc-800 text-zinc-600'
                          }`}
                        >
                          <span className="font-black mr-2">{String.fromCharCode(65 + i)}.</span> {opt}
                        </button>
                      ))}
                    </div>

                    {selectedAnswer !== null && (
                      <motion.div
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={`p-3 rounded-xl border flex gap-3 ${
                          selectedAnswer === scenario.correct
                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                            : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                        }`}
                      >
                        <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                        <p className="text-xs leading-relaxed">{scenario.explanation}</p>
                      </motion.div>
                    )}
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {!showScenario && (
            <p className="text-xs text-zinc-500 text-center py-4">
              Genera un escenario basado en incidentes reales de tu proyecto para entrenarte.
            </p>
          )}
        </Card>

        {/* Info Panel */}
        <Card className="p-6 border-white/5 space-y-6">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Zap className="w-5 h-5 text-fuchsia-500" />
            Gamificación
          </h2>

          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-zinc-900 border border-white/5">
              <h3 className="text-sm font-bold text-zinc-300 mb-2">¿Cómo obtener Tokens?</h3>
              <ul className="space-y-2 text-xs text-zinc-400">
                <li className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  Completar capacitaciones (+2)
                </li>
                <li className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  Reportar incidentes reales (+5)
                </li>
                <li className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  Turno sin accidentes (+10)
                </li>
              </ul>
            </div>

            <div className="p-4 rounded-xl bg-zinc-900 border border-white/5">
              <h3 className="text-sm font-bold text-zinc-300 mb-2">Recompensas</h3>
              <ul className="space-y-2 text-xs text-zinc-400">
                <li className="flex items-center justify-between">
                  <span>Café en casino</span>
                  <span className="text-yellow-500 font-bold">500 PTS</span>
                </li>
                <li className="flex items-center justify-between">
                  <span>Día libre extra</span>
                  <span className="text-yellow-500 font-bold">10000 PTS</span>
                </li>
              </ul>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
