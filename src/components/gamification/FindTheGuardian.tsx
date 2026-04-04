import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Target, Shield, CheckCircle2, AlertCircle, Trophy, Star, X, ZoomIn, ZoomOut } from 'lucide-react';
import { useNotifications } from '../../contexts/NotificationContext';
import confetti from 'canvas-confetti';

interface HiddenItem {
  id: string;
  name: string;
  description: string;
  x: number; // Percentage 0-100
  y: number; // Percentage 0-100
  radius: number; // Percentage radius for hit detection
  found: boolean;
  icon: React.ReactNode;
  points: number;
}

export function FindTheGuardian() {
  const [items, setItems] = useState<HiddenItem[]>([
    {
      id: 'guardian',
      name: 'Guardián Praeventio',
      description: 'El núcleo de IA vigilando la operación.',
      x: 75,
      y: 35,
      radius: 5,
      found: false,
      icon: <Shield className="w-4 h-4 text-indigo-500" />,
      points: 500
    },
    {
      id: 'extintor',
      name: 'Extintor Obstruido',
      description: 'Condición insegura: Equipo de emergencia bloqueado.',
      x: 20,
      y: 80,
      radius: 4,
      found: false,
      icon: <AlertCircle className="w-4 h-4 text-rose-500" />,
      points: 200
    },
    {
      id: 'casco',
      name: 'Trabajador sin Casco',
      description: 'Falta de EPP crítico en zona de riesgo.',
      x: 45,
      y: 60,
      radius: 4,
      found: false,
      icon: <AlertCircle className="w-4 h-4 text-amber-500" />,
      points: 300
    },
    {
      id: 'arnes',
      name: 'Arnés Mal Enganchado',
      description: 'Riesgo de caída a distinto nivel.',
      x: 85,
      y: 15,
      radius: 4,
      found: false,
      icon: <AlertCircle className="w-4 h-4 text-rose-500" />,
      points: 400
    }
  ]);

  const [score, setScore] = useState(0);
  const [gameComplete, setGameComplete] = useState(false);
  const [showHint, setShowHint] = useState<string | null>(null);
  const [clickFeedback, setClickFeedback] = useState<{ x: number, y: number, success: boolean } | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const { addNotification } = useNotifications();
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // Placeholder image for the industrial scene
  const imageUrl = "https://images.unsplash.com/photo-1504307651254-35680f356dfd?q=80&w=2070&auto=format&fit=crop";

  useEffect(() => {
    const allFound = items.every(item => item.found);
    if (allFound && items.length > 0 && !gameComplete) {
      setGameComplete(true);
      confetti({
        particleCount: 150,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#4f46e5', '#10b981', '#f59e0b']
      });
      addNotification({
        title: '¡Misión Completada!',
        message: `Has encontrado todos los elementos y ganado ${score} puntos.`,
        type: 'success'
      });
    }
  }, [items, gameComplete, score, addNotification]);

  const handleImageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isDragging) return;

    if (!imageRef.current) return;
    const rect = imageRef.current.getBoundingClientRect();
    
    // Calculate click coordinates relative to the original image size (accounting for zoom and pan)
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    
    const percentX = (clickX / rect.width) * 100;
    const percentY = (clickY / rect.width) * 100 * (rect.width / rect.height); // Adjust for aspect ratio if needed, but simpler to just use width/height percentages directly if the container matches image aspect ratio.
    
    // Simpler percentage calculation based on the rendered image dimensions
    const pX = (clickX / rect.width) * 100;
    const pY = (clickY / rect.height) * 100;

    let foundItem = false;

    const newItems = items.map(item => {
      if (item.found) return item;

      // Calculate distance between click and item center
      const dx = pX - item.x;
      const dy = pY - item.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Adjust hit radius based on zoom to make it easier when zoomed in
      const effectiveRadius = item.radius * (1 / zoom) * 1.5; // Slightly larger hit area

      if (distance <= effectiveRadius) {
        foundItem = true;
        setScore(prev => prev + item.points);
        addNotification({
          title: '¡Elemento Encontrado!',
          message: `+${item.points} pts: ${item.name}`,
          type: 'success'
        });
        return { ...item, found: true };
      }
      return item;
    });

    setClickFeedback({ x: pX, y: pY, success: foundItem });
    setTimeout(() => setClickFeedback(null), 1000);

    if (foundItem) {
      setItems(newItems);
    } else {
      // Optional: Penalty for wrong clicks to prevent spamming
      // setScore(prev => Math.max(0, prev - 10));
    }
  };

  const handleZoomIn = () => setZoom(prev => Math.min(prev + 0.5, 3));
  const handleZoomOut = () => {
    setZoom(prev => {
      const newZoom = Math.max(prev - 0.5, 1);
      if (newZoom === 1) setPan({ x: 0, y: 0 });
      return newZoom;
    });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoom > 1) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging && zoom > 1) {
      setPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-zinc-900 p-6 rounded-3xl border border-white/10">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-indigo-500/20 flex items-center justify-center border border-indigo-500/30">
            <Target className="w-8 h-8 text-indigo-400" />
          </div>
          <div>
            <h2 className="text-2xl font-black text-white uppercase tracking-tight">Ojo de Águila</h2>
            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Encuentra los riesgos y al Guardián</p>
          </div>
        </div>
        
        <div className="flex items-center gap-6 bg-black/50 p-4 rounded-2xl border border-white/5">
          <div className="text-center">
            <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">Puntuación</p>
            <div className="flex items-center justify-center gap-2">
              <Trophy className="w-5 h-5 text-amber-500" />
              <span className="text-2xl font-black text-white">{score}</span>
            </div>
          </div>
          <div className="w-px h-10 bg-white/10" />
          <div className="text-center">
            <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">Encontrados</p>
            <div className="text-2xl font-black text-white">
              <span className="text-emerald-500">{items.filter(i => i.found).length}</span>
              <span className="text-zinc-600">/{items.length}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Game Area */}
        <div className="lg:col-span-3 relative bg-zinc-950 rounded-3xl border border-white/10 overflow-hidden min-h-[500px] flex items-center justify-center">
          
          {/* Controls */}
          <div className="absolute top-4 right-4 z-20 flex flex-col gap-2">
            <button onClick={handleZoomIn} className="w-10 h-10 bg-black/80 backdrop-blur-md rounded-xl border border-white/10 flex items-center justify-center text-white hover:bg-white/10 transition-colors">
              <ZoomIn className="w-5 h-5" />
            </button>
            <button onClick={handleZoomOut} disabled={zoom === 1} className="w-10 h-10 bg-black/80 backdrop-blur-md rounded-xl border border-white/10 flex items-center justify-center text-white hover:bg-white/10 transition-colors disabled:opacity-50">
              <ZoomOut className="w-5 h-5" />
            </button>
          </div>

          <div 
            className={`relative w-full h-full overflow-hidden ${zoom > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair'}`}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            <motion.div
              className="w-full h-full relative"
              animate={{ 
                scale: zoom,
                x: zoom > 1 ? pan.x : 0,
                y: zoom > 1 ? pan.y : 0
              }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              style={{ transformOrigin: 'center center' }}
            >
              <img 
                ref={imageRef}
                src={imageUrl} 
                alt="Escena Industrial" 
                className="w-full h-full object-cover pointer-events-none select-none"
                draggable={false}
              />
              
              {/* Click Overlay */}
              <div 
                className="absolute inset-0 z-10"
                onClick={handleImageClick}
              />

              {/* Found Items Markers */}
              <AnimatePresence>
                {items.filter(i => i.found).map(item => (
                  <motion.div
                    key={item.id}
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="absolute z-20 pointer-events-none"
                    style={{ left: `${item.x}%`, top: `${item.y}%`, transform: 'translate(-50%, -50%)' }}
                  >
                    <div className="w-12 h-12 rounded-full border-4 border-emerald-500 flex items-center justify-center bg-emerald-500/20 backdrop-blur-sm shadow-[0_0_20px_rgba(16,185,129,0.5)]">
                      <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>

              {/* Click Feedback Animation */}
              <AnimatePresence>
                {clickFeedback && (
                  <motion.div
                    initial={{ scale: 0, opacity: 1 }}
                    animate={{ scale: 2, opacity: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.5 }}
                    className="absolute z-20 pointer-events-none"
                    style={{ left: `${clickFeedback.x}%`, top: `${clickFeedback.y}%`, transform: 'translate(-50%, -50%)' }}
                  >
                    <div className={`w-8 h-8 rounded-full border-2 ${clickFeedback.success ? 'border-emerald-500 bg-emerald-500/20' : 'border-rose-500 bg-rose-500/20'}`} />
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          </div>

          {gameComplete && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute inset-0 z-30 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center p-8 text-center"
            >
              <div className="w-24 h-24 bg-emerald-500/20 rounded-full flex items-center justify-center mb-6 border border-emerald-500/50">
                <Trophy className="w-12 h-12 text-emerald-400" />
              </div>
              <h3 className="text-4xl font-black text-white uppercase tracking-tighter mb-2">¡Visión Perfecta!</h3>
              <p className="text-zinc-400 font-medium mb-8 max-w-md">Has identificado todos los riesgos y al Guardián Praeventio. Tu agudeza visual previene accidentes.</p>
              
              <div className="flex items-center gap-4 mb-8">
                <div className="bg-zinc-900 px-6 py-4 rounded-2xl border border-white/10">
                  <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">Puntuación Final</p>
                  <p className="text-3xl font-black text-amber-500">{score}</p>
                </div>
                <div className="bg-zinc-900 px-6 py-4 rounded-2xl border border-white/10">
                  <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">Precisión</p>
                  <p className="text-3xl font-black text-emerald-500">100%</p>
                </div>
              </div>

              <button 
                onClick={() => {
                  setItems(items.map(i => ({ ...i, found: false })));
                  setScore(0);
                  setGameComplete(false);
                  setZoom(1);
                  setPan({x:0, y:0});
                }}
                className="px-8 py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-black uppercase tracking-widest text-sm transition-colors"
              >
                Jugar de Nuevo
              </button>
            </motion.div>
          )}
        </div>

        {/* Sidebar / List */}
        <div className="bg-zinc-900 rounded-3xl border border-white/10 p-6 flex flex-col h-full">
          <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-6">Objetivos de Búsqueda</h3>
          
          <div className="space-y-4 flex-1 overflow-y-auto pr-2 custom-scrollbar">
            {items.map((item) => (
              <div 
                key={item.id}
                className={`p-4 rounded-2xl border transition-all ${item.found ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-black/50 border-white/5 hover:border-white/20'}`}
                onMouseEnter={() => setShowHint(item.id)}
                onMouseLeave={() => setShowHint(null)}
              >
                <div className="flex items-start gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${item.found ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-800 text-zinc-500'}`}>
                    {item.found ? <CheckCircle2 className="w-5 h-5" /> : item.icon}
                  </div>
                  <div>
                    <h4 className={`text-sm font-bold ${item.found ? 'text-emerald-400' : 'text-zinc-300'}`}>
                      {item.name}
                    </h4>
                    <p className="text-xs text-zinc-500 mt-1 line-clamp-2">{item.description}</p>
                    
                    <div className="flex items-center gap-2 mt-2">
                      <Star className={`w-3 h-3 ${item.found ? 'text-amber-500' : 'text-zinc-600'}`} />
                      <span className={`text-[10px] font-black uppercase tracking-widest ${item.found ? 'text-amber-500' : 'text-zinc-600'}`}>
                        {item.points} pts
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 p-4 bg-indigo-500/10 rounded-2xl border border-indigo-500/20">
            <div className="flex items-start gap-3">
              <Shield className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
              <p className="text-xs text-indigo-300 font-medium leading-relaxed">
                Explora la imagen, haz zoom si es necesario y haz clic en los riesgos o en el Guardián para ganar puntos.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
