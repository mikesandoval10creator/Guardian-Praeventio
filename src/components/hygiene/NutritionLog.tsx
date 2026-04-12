import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Droplet, Apple, Coffee, Flame, AlertCircle, CheckCircle2 } from 'lucide-react';

export function NutritionLog() {
  const [hydration, setHydration] = useState(0);
  const [calories, setCalories] = useState(0);
  const [lastMeal, setLastMeal] = useState<string | null>(null);
  
  // Mock data for metabolic rate based on current time and activity
  const metabolicRate = 2400; // Base daily calories
  const currentBurn = Math.floor((new Date().getHours() / 24) * metabolicRate);
  
  const hydrationGoal = 3000; // 3 liters
  const hydrationPercent = Math.min(100, (hydration / hydrationGoal) * 100);

  const addWater = () => {
    setHydration(prev => Math.min(prev + 250, hydrationGoal));
  };

  const addMeal = (type: string, cals: number) => {
    setCalories(prev => prev + cals);
    setLastMeal(type);
  };

  return (
    <div className="bg-zinc-900/50 border border-white/10 rounded-3xl p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-orange-500/20 flex items-center justify-center text-orange-500">
          <Apple className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-lg font-black text-white uppercase tracking-tight">Bitácora Nutricional</h3>
          <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Campamento & Terreno</p>
        </div>
      </div>

      {/* Hydration Tracker */}
      <div className="mb-6">
        <div className="flex justify-between items-end mb-2">
          <div className="flex items-center gap-2">
            <Droplet className="w-4 h-4 text-blue-400" />
            <span className="text-xs font-bold text-zinc-300">Hidratación</span>
          </div>
          <span className="text-xs font-black text-blue-400">{hydration} / {hydrationGoal} ml</span>
        </div>
        <div className="h-2 w-full bg-zinc-800 rounded-full overflow-hidden mb-3">
          <motion.div 
            className="h-full bg-blue-500 rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${hydrationPercent}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>
        <button 
          onClick={addWater}
          className="w-full py-2 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 rounded-xl text-xs font-bold uppercase tracking-widest transition-colors flex items-center justify-center gap-2"
        >
          <Plus className="w-3 h-3" />
          Añadir 250ml (Vaso)
        </button>
      </div>

      {/* Metabolic Rate & Calories */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="bg-zinc-800/50 rounded-2xl p-3 border border-white/5">
          <div className="flex items-center gap-2 mb-1">
            <Flame className="w-3 h-3 text-orange-500" />
            <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Gasto Est.</span>
          </div>
          <div className="text-lg font-black text-white">{currentBurn} <span className="text-[10px] text-zinc-500 font-normal">kcal</span></div>
        </div>
        <div className="bg-zinc-800/50 rounded-2xl p-3 border border-white/5">
          <div className="flex items-center gap-2 mb-1">
            <Apple className="w-3 h-3 text-emerald-500" />
            <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Ingesta</span>
          </div>
          <div className="text-lg font-black text-white">{calories} <span className="text-[10px] text-zinc-500 font-normal">kcal</span></div>
        </div>
      </div>

      {/* Quick Add Meals */}
      <div>
        <h4 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-3">Registro Rápido</h4>
        <div className="grid grid-cols-3 gap-2">
          <button 
            onClick={() => addMeal('Desayuno', 500)}
            className="flex flex-col items-center justify-center gap-1 p-2 bg-zinc-800 hover:bg-zinc-700 rounded-xl transition-colors"
          >
            <Coffee className="w-4 h-4 text-amber-500" />
            <span className="text-[9px] font-bold text-zinc-300">Desayuno</span>
          </button>
          <button 
            onClick={() => addMeal('Almuerzo', 800)}
            className="flex flex-col items-center justify-center gap-1 p-2 bg-zinc-800 hover:bg-zinc-700 rounded-xl transition-colors"
          >
            <Apple className="w-4 h-4 text-rose-500" />
            <span className="text-[9px] font-bold text-zinc-300">Almuerzo</span>
          </button>
          <button 
            onClick={() => addMeal('Snack', 200)}
            className="flex flex-col items-center justify-center gap-1 p-2 bg-zinc-800 hover:bg-zinc-700 rounded-xl transition-colors"
          >
            <Apple className="w-4 h-4 text-emerald-500" />
            <span className="text-[9px] font-bold text-zinc-300">Snack Sano</span>
          </button>
        </div>
      </div>

      {/* Recommendations */}
      <div className="mt-4 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-start gap-3">
        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
        <p className="text-xs text-emerald-200 leading-relaxed">
          <strong>Recomendación:</strong> Por la alta radiación y altitud actual, prioriza jugos naturales ricos en antioxidantes y mantén la hidratación por encima de 2.5L.
        </p>
      </div>
    </div>
  );
}

function Plus(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  )
}
