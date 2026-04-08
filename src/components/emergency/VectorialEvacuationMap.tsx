import React from 'react';
import { motion } from 'framer-motion';

export function VectorialEvacuationMap() {
  return (
    <div className="relative w-full h-full bg-zinc-900 rounded-2xl overflow-hidden border border-zinc-800">
      <svg
        viewBox="0 0 800 600"
        className="w-full h-full"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Background Grid */}
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />

        {/* Building Outline */}
        <path
          d="M 100 100 L 700 100 L 700 500 L 100 500 Z"
          fill="rgba(255,255,255,0.02)"
          stroke="rgba(255,255,255,0.2)"
          strokeWidth="2"
        />

        {/* Rooms / Zones */}
        <rect x="100" y="100" width="200" height="200" fill="rgba(59,130,246,0.1)" stroke="rgba(59,130,246,0.3)" strokeWidth="1" />
        <text x="200" y="200" fill="rgba(255,255,255,0.5)" fontSize="14" textAnchor="middle" dominantBaseline="middle" className="font-mono uppercase tracking-widest">Sector A</text>

        <rect x="300" y="100" width="400" height="200" fill="rgba(16,185,129,0.1)" stroke="rgba(16,185,129,0.3)" strokeWidth="1" />
        <text x="500" y="200" fill="rgba(255,255,255,0.5)" fontSize="14" textAnchor="middle" dominantBaseline="middle" className="font-mono uppercase tracking-widest">Planta Principal</text>

        <rect x="100" y="300" width="300" height="200" fill="rgba(245,158,11,0.1)" stroke="rgba(245,158,11,0.3)" strokeWidth="1" />
        <text x="250" y="400" fill="rgba(255,255,255,0.5)" fontSize="14" textAnchor="middle" dominantBaseline="middle" className="font-mono uppercase tracking-widest">Bodega</text>

        <rect x="400" y="300" width="300" height="200" fill="rgba(244,63,94,0.1)" stroke="rgba(244,63,94,0.3)" strokeWidth="1" />
        <text x="550" y="400" fill="rgba(255,255,255,0.5)" fontSize="14" textAnchor="middle" dominantBaseline="middle" className="font-mono uppercase tracking-widest">Zona HAZMAT</text>

        {/* Evacuation Routes (Arrows) */}
        <defs>
          <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill="#10b981" />
          </marker>
        </defs>

        <motion.path
          d="M 200 250 L 200 450 L 350 450"
          fill="none"
          stroke="#10b981"
          strokeWidth="4"
          strokeDasharray="10, 10"
          markerEnd="url(#arrowhead)"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
        />

        <motion.path
          d="M 500 250 L 500 450 L 350 450"
          fill="none"
          stroke="#10b981"
          strokeWidth="4"
          strokeDasharray="10, 10"
          markerEnd="url(#arrowhead)"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
        />

        {/* Exit Point */}
        <circle cx="350" cy="450" r="15" fill="#10b981" className="animate-pulse" />
        <text x="350" y="480" fill="#10b981" fontSize="12" textAnchor="middle" className="font-black uppercase tracking-widest">Salida Segura</text>
      </svg>
    </div>
  );
}
