import React from 'react';
import { motion } from 'framer-motion';
import { Navigation, RotateCcw } from 'lucide-react';
import { useDeadReckoning } from '../../hooks/useDeadReckoning';

interface VectorialEvacuationMapProps {
  showDeadReckoning?: boolean;
}

export function VectorialEvacuationMap({ showDeadReckoning = false }: VectorialEvacuationMapProps) {
  const { position, heading, stepCount, isActive, start, stop, reset } = useDeadReckoning();

  return (
    <div className="relative w-full h-full bg-zinc-900 rounded-2xl overflow-hidden border border-zinc-800">
      <svg
        viewBox="0 0 800 600"
        className="w-full h-full"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
          </pattern>
          <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill="#10b981" />
          </marker>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />

        {/* Building Outline */}
        <path d="M 100 100 L 700 100 L 700 500 L 100 500 Z" fill="rgba(255,255,255,0.02)" stroke="rgba(255,255,255,0.2)" strokeWidth="2" />

        {/* Rooms */}
        <rect x="100" y="100" width="200" height="200" fill="rgba(59,130,246,0.1)" stroke="rgba(59,130,246,0.3)" strokeWidth="1" />
        <text x="200" y="200" fill="rgba(255,255,255,0.5)" fontSize="14" textAnchor="middle" dominantBaseline="middle">Sector A</text>

        <rect x="300" y="100" width="400" height="200" fill="rgba(16,185,129,0.1)" stroke="rgba(16,185,129,0.3)" strokeWidth="1" />
        <text x="500" y="200" fill="rgba(255,255,255,0.5)" fontSize="14" textAnchor="middle" dominantBaseline="middle">Planta Principal</text>

        <rect x="100" y="300" width="300" height="200" fill="rgba(245,158,11,0.1)" stroke="rgba(245,158,11,0.3)" strokeWidth="1" />
        <text x="250" y="400" fill="rgba(255,255,255,0.5)" fontSize="14" textAnchor="middle" dominantBaseline="middle">Bodega</text>

        <rect x="400" y="300" width="300" height="200" fill="rgba(244,63,94,0.1)" stroke="rgba(244,63,94,0.3)" strokeWidth="1" />
        <text x="550" y="400" fill="rgba(255,255,255,0.5)" fontSize="14" textAnchor="middle" dominantBaseline="middle">Zona HAZMAT</text>

        {/* Evacuation Routes */}
        <motion.path d="M 200 250 L 200 450 L 350 450" fill="none" stroke="#10b981" strokeWidth="4" strokeDasharray="10, 10" markerEnd="url(#arrowhead)" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 2, repeat: Infinity, ease: "linear" }} />
        <motion.path d="M 500 250 L 500 450 L 350 450" fill="none" stroke="#10b981" strokeWidth="4" strokeDasharray="10, 10" markerEnd="url(#arrowhead)" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 2, repeat: Infinity, ease: "linear" }} />

        {/* Exit Point */}
        <circle cx="350" cy="450" r="15" fill="#10b981" className="animate-pulse" />
        <text x="350" y="480" fill="#10b981" fontSize="12" textAnchor="middle" fontWeight="bold">Salida Segura</text>

        {/* Dead Reckoning marker — only rendered when active */}
        {showDeadReckoning && isActive && (
          <>
            {/* Heading ray */}
            <line
              x1={position.x} y1={position.y}
              x2={position.x + Math.sin(heading * Math.PI / 180) * 32}
              y2={position.y - Math.cos(heading * Math.PI / 180) * 32}
              stroke="#60a5fa" strokeWidth="2" opacity={0.6}
            />
            {/* Accuracy ring */}
            <circle cx={position.x} cy={position.y} r="22" fill="rgba(96,165,250,0.06)" stroke="rgba(96,165,250,0.25)" strokeWidth="1" strokeDasharray="4 4" />
            {/* Position dot */}
            <motion.circle cx={position.x} cy={position.y} r="8" fill="#3b82f6" stroke="white" strokeWidth="2" animate={{ scale: [1, 1.18, 1] }} transition={{ duration: 1.2, repeat: Infinity }} />
            <text x={position.x} y={position.y - 20} fill="#93c5fd" fontSize="10" textAnchor="middle" fontWeight="bold">TÚ</text>
          </>
        )}
      </svg>

      {/* Controls overlay */}
      {showDeadReckoning && (
        <div className="absolute bottom-3 left-3 flex items-center gap-2">
          <button
            onClick={isActive ? stop : start}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${
              isActive ? 'bg-blue-500/20 border-blue-500/50 text-blue-400' : 'border-zinc-700 text-zinc-400 hover:border-zinc-500 bg-black/60'
            }`}
          >
            <Navigation className="w-3 h-3" />
            {isActive ? `Nav ON · ${stepCount} pasos` : 'Navegación Inercial'}
          </button>
          {isActive && (
            <button onClick={reset} className="p-1.5 rounded-lg border border-zinc-700 text-zinc-500 hover:text-white bg-black/60 transition-colors">
              <RotateCcw className="w-3 h-3" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
