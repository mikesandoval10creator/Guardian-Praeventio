import React, { useState, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Box, Sphere, Cylinder, Text } from '@react-three/drei';
import { Card } from '../shared/Card';
import { Map, AlertTriangle, ShieldAlert, Users } from 'lucide-react';

function EvacuationRoute() {
  return (
    <group>
      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]}>
        <planeGeometry args={[20, 20]} />
        <meshStandardMaterial color="#1f2937" />
      </mesh>

      {/* Walls / Obstacles */}
      <Box position={[-2, 0.5, -2]} args={[4, 2, 1]}>
        <meshStandardMaterial color="#374151" />
      </Box>
      <Box position={[3, 0.5, 2]} args={[1, 2, 6]}>
        <meshStandardMaterial color="#374151" />
      </Box>

      {/* Hazard Zone */}
      <Cylinder position={[-3, 0, 3]} args={[2, 2, 0.1, 32]}>
        <meshStandardMaterial color="#ef4444" opacity={0.5} transparent />
      </Cylinder>
      <Text position={[-3, 1, 3]} color="#ef4444" fontSize={0.5} rotation={[0, Math.PI / 4, 0]}>
        PELIGRO
      </Text>

      {/* Safe Zone */}
      <Cylinder position={[5, 0, -5]} args={[3, 3, 0.1, 32]}>
        <meshStandardMaterial color="#10b981" opacity={0.5} transparent />
      </Cylinder>
      <Text position={[5, 1, -5]} color="#10b981" fontSize={0.5} rotation={[0, -Math.PI / 4, 0]}>
        ZONA SEGURA
      </Text>

      {/* Evacuation Path (simulated with small spheres) */}
      {[
        [-1, 0, 0],
        [0, 0, -1],
        [1, 0, -2],
        [2, 0, -3],
        [3, 0, -4],
        [4, 0, -4.5],
      ].map((pos, i) => (
        <Sphere key={i} position={[pos[0], 0.1, pos[2]]} args={[0.2, 16, 16]}>
          <meshStandardMaterial color="#3b82f6" />
        </Sphere>
      ))}
    </group>
  );
}

function AnimatedWorker() {
  const meshRef = useRef<any>(null);
  
  useFrame((state) => {
    if (meshRef.current) {
      // Simple back and forth movement along the path
      const t = state.clock.getElapsedTime();
      const progress = (Math.sin(t) + 1) / 2; // 0 to 1
      
      // Interpolate between start [-1, 0, 0] and end [5, 0, -5] roughly
      meshRef.current.position.x = -1 + progress * 6;
      meshRef.current.position.z = 0 - progress * 5;
    }
  });

  return (
    <Sphere ref={meshRef} position={[-1, 0.5, 0]} args={[0.3, 16, 16]}>
      <meshStandardMaterial color="#f59e0b" />
    </Sphere>
  );
}

export function TacticalSimulation3D() {
  const [isPlaying, setIsPlaying] = useState(true);

  return (
    <Card className="p-6 border-zinc-800 bg-black/40 overflow-hidden">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-500/20 rounded-lg">
            <Map className="w-6 h-6 text-indigo-500" />
          </div>
          <div>
            <h2 className="text-xl font-black text-white uppercase tracking-tight">Simulación Táctica 3D</h2>
            <p className="text-sm text-zinc-400 font-medium">Entrenamiento de Memoria Muscular</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={() => setIsPlaying(!isPlaying)}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold uppercase tracking-widest transition-colors"
          >
            {isPlaying ? 'Pausar' : 'Reproducir'}
          </button>
        </div>
      </div>

      <div className="h-[400px] w-full rounded-2xl overflow-hidden border border-zinc-800 relative">
        <Canvas camera={{ position: [0, 8, 10], fov: 50 }}>
          <ambientLight intensity={0.5} />
          <pointLight position={[10, 10, 10]} intensity={1} />
          <EvacuationRoute />
          {isPlaying && <AnimatedWorker />}
          <OrbitControls enablePan={true} enableZoom={true} enableRotate={true} />
        </Canvas>
        
        {/* Overlay UI */}
        <div className="absolute top-4 left-4 flex flex-col gap-2">
          <div className="px-3 py-1.5 bg-black/60 backdrop-blur-md rounded-lg border border-white/10 flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-rose-500" />
            <span className="text-xs font-bold text-white uppercase tracking-wider">Fuego en Sector 3</span>
          </div>
          <div className="px-3 py-1.5 bg-black/60 backdrop-blur-md rounded-lg border border-white/10 flex items-center gap-2">
            <Users className="w-4 h-4 text-emerald-500" />
            <span className="text-xs font-bold text-white uppercase tracking-wider">Evacuando: 12</span>
          </div>
        </div>
      </div>
      
      <div className="mt-4 grid grid-cols-3 gap-4">
        <div className="p-3 bg-zinc-900/50 rounded-xl border border-zinc-800">
          <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mb-1">Tiempo Estimado</p>
          <p className="text-lg font-black text-white">02:45</p>
        </div>
        <div className="p-3 bg-zinc-900/50 rounded-xl border border-zinc-800">
          <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mb-1">Cuellos de Botella</p>
          <p className="text-lg font-black text-amber-500">Pasillo B</p>
        </div>
        <div className="p-3 bg-zinc-900/50 rounded-xl border border-zinc-800">
          <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mb-1">Ruta Alternativa</p>
          <p className="text-lg font-black text-emerald-500">Disponible</p>
        </div>
      </div>
    </Card>
  );
}
