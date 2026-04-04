import { useState } from 'react';
import { milestones } from '../data/milestones';
import { Card } from '../components/shared/Card';
import { History as HistoryIcon, Globe, MapPin, Filter, Pause, Play } from 'lucide-react';
import { motion } from 'framer-motion';

export function History() {
  const [activeTab, setActiveTab] = useState<'Todos' | 'Global' | 'Chile'>('Todos');
  const [isPaused, setIsPaused] = useState(false);

  const filteredMilestones = milestones.filter(
    (m) => activeTab === 'Todos' || m.region === activeTab
  );

  // Duplicate array to create a seamless infinite loop
  const loopedMilestones = [...filteredMilestones, ...filteredMilestones];

  return (
    <div className="flex flex-col h-full w-full p-2 sm:p-4 overflow-hidden relative">
      <style>{`
        @keyframes scroll-timeline {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .animate-scroll-timeline {
          animation: scroll-timeline ${filteredMilestones.length * 3}s linear infinite;
          will-change: transform;
        }
        .animate-scroll-timeline.paused {
          animation-play-state: paused;
        }
        .mask-edges {
          mask-image: linear-gradient(to right, transparent, black 10%, black 90%, transparent);
          -webkit-mask-image: linear-gradient(to right, transparent, black 10%, black 90%, transparent);
        }
      `}</style>
      
      {/* Header */}
      <div className="flex-none flex flex-col items-center text-center mb-4 z-10">
        <div className="bg-zinc-100 dark:bg-zinc-800/50 p-2.5 rounded-2xl mb-2 border border-white/5 shadow-lg backdrop-blur-sm">
          <HistoryIcon className="w-5 h-5 text-emerald-500" />
        </div>
        <h2 className="text-xl sm:text-2xl font-black uppercase tracking-tighter leading-tight text-zinc-900 dark:text-white">Historia de la Seguridad</h2>
        <p className="text-[10px] sm:text-xs text-zinc-500 dark:text-zinc-400 max-w-md mt-1">
          Evolución de la prevención de riesgos a nivel global y en Chile.
        </p>
      </div>

      {/* Controls */}
      <div className="flex-none flex justify-center items-center gap-3 mb-4 z-10">
        <div className="inline-flex items-center p-1 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md rounded-xl border border-zinc-200 dark:border-white/10 shadow-xl">
          {(['Todos', 'Global', 'Chile'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`relative px-3 py-1.5 text-[10px] sm:text-xs font-bold uppercase tracking-wider rounded-lg transition-colors ${
                activeTab === tab
                  ? 'text-emerald-700 dark:text-white'
                  : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
              }`}
            >
              {activeTab === tab && (
                <motion.div
                  layoutId="activeTab"
                  className="absolute inset-0 bg-emerald-100 dark:bg-emerald-500/20 border border-emerald-200 dark:border-emerald-500/50 rounded-lg"
                  transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
                />
              )}
              <span className="relative z-10 flex items-center gap-1.5">
                {tab === 'Global' && <Globe className="w-3 h-3" />}
                {tab === 'Chile' && <MapPin className="w-3 h-3" />}
                {tab === 'Todos' && <Filter className="w-3 h-3" />}
                {tab}
              </span>
            </button>
          ))}
        </div>
        
        <button 
          onClick={() => setIsPaused(!isPaused)} 
          className="p-2 rounded-xl bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md border border-zinc-200 dark:border-white/10 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all shadow-xl"
          title={isPaused ? "Reanudar línea de tiempo" : "Pausar línea de tiempo"}
        >
          {isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
        </button>
      </div>

      {/* Timeline Area */}
      <div className="flex-1 relative w-full flex items-center overflow-hidden mask-edges min-h-[300px]">
        {/* Central Axis Line */}
        <div className="absolute left-0 right-0 h-0.5 bg-gradient-to-r from-emerald-500/0 via-emerald-500/30 to-emerald-500/0 top-1/2 -translate-y-1/2 z-0" />
        
        {/* Scrolling Track */}
        <div 
          className={`flex items-center w-max animate-scroll-timeline ${isPaused ? 'paused' : ''}`}
          onMouseEnter={() => setIsPaused(true)}
          onMouseLeave={() => setIsPaused(false)}
        >
          {loopedMilestones.map((milestone, index) => {
            const isTop = index % 2 === 0;
            const isGlobal = milestone.region === 'Global';
            
            return (
              <div key={`${index}-${milestone.year}-${milestone.title}`} className="relative h-64 sm:h-80 w-60 sm:w-72 flex flex-col justify-center shrink-0 group">
                
                {/* Central Dot */}
                <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border-2 z-10 transition-transform duration-300 group-hover:scale-150 ${
                  isGlobal ? 'bg-white dark:bg-zinc-900 border-blue-500' : 'bg-white dark:bg-zinc-900 border-red-500'
                }`} />
                
                {/* Stem */}
                <div className={`absolute left-1/2 -translate-x-1/2 w-px transition-all duration-300 group-hover:w-0.5 ${
                  isGlobal ? 'bg-blue-500/30 group-hover:bg-blue-500/60' : 'bg-red-500/30 group-hover:bg-red-500/60'
                } ${isTop ? 'bottom-1/2 h-8 sm:h-12' : 'top-1/2 h-8 sm:h-12'}`} />

                {/* Card Container */}
                <div className={`absolute w-full px-3 transition-transform duration-300 ${
                  isTop ? 'bottom-1/2 mb-8 sm:mb-12 group-hover:-translate-y-2' : 'top-1/2 mt-8 sm:mt-12 group-hover:translate-y-2'
                }`}>
                  <Card className={`p-4 h-full bg-white/90 dark:bg-zinc-900/90 backdrop-blur-xl border-t-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/90 transition-colors shadow-xl dark:shadow-2xl ${
                    isGlobal ? 'border-t-blue-500 border-zinc-200 dark:border-white/5' : 'border-t-red-500 border-zinc-200 dark:border-white/5'
                  }`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-lg font-black text-zinc-900 dark:text-white tracking-tighter">{milestone.year}</span>
                      <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/5 ${
                        isGlobal ? 'text-blue-600 dark:text-blue-400' : 'text-red-600 dark:text-red-400'
                      }`}>
                        {isGlobal ? <Globe className="w-2.5 h-2.5" /> : <MapPin className="w-2.5 h-2.5" />}
                        <span className="text-[8px] font-black uppercase tracking-widest">{milestone.region}</span>
                      </div>
                    </div>
                    <h3 className="text-xs font-bold text-zinc-800 dark:text-zinc-100 uppercase tracking-tight mb-1.5 leading-snug line-clamp-2" title={milestone.title}>
                      {milestone.title}
                    </h3>
                    <p className="text-[10px] text-zinc-600 dark:text-zinc-400 leading-relaxed line-clamp-3" title={milestone.description}>
                      {milestone.description}
                    </p>
                  </Card>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
