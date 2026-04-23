import React, { useRef, useState, useMemo, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Box, Sphere, Cylinder, Text, Environment, ContactShadows } from '@react-three/drei';
import * as THREE from 'three';
import { MapPin, Activity, AlertTriangle, CheckCircle2 } from 'lucide-react';

// Instanced Workers for high performance
function InstancedWorkers({ workers }: { workers: WorkerData[] }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const hatRef = useRef<THREE.InstancedMesh>(null);
  
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = new THREE.Color();

  useFrame((state) => {
    if (!meshRef.current || !hatRef.current) return;

    workers.forEach((w, i) => {
      const isFallen = w.isFallen;
      const basePos = w.position;
      
      dummy.position.set(basePos[0], basePos[1], basePos[2]);
      dummy.rotation.set(0, 0, 0);

      if (isFallen) {
        dummy.rotation.x = Math.PI / 2;
        dummy.position.y = 0.3;
      } else {
        dummy.position.y = basePos[1] + 0.6 + Math.sin(state.clock.elapsedTime * 2 + i) * 0.1;
      }

      dummy.updateMatrix();
      meshRef.current!.setMatrixAt(i, dummy.matrix);

      // Hat position relative to body
      if (isFallen) {
        dummy.position.z += 0.8;
      } else {
        dummy.position.y += 0.8;
      }
      dummy.updateMatrix();
      hatRef.current!.setMatrixAt(i, dummy.matrix);

      // Set colors
      const statusColor = w.status === 'critical' ? '#f43f5e' : w.status === 'warning' ? '#f59e0b' : '#10b981';
      meshRef.current!.setColorAt(i, color.set(statusColor));
      hatRef.current!.setColorAt(i, color.set('#fbbf24'));
    });

    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true;
    hatRef.current.instanceMatrix.needsUpdate = true;
    if (hatRef.current.instanceColor) hatRef.current.instanceColor.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh ref={meshRef} args={[undefined, undefined, workers.length]}>
        <cylinderGeometry args={[0.3, 0.3, 1.2, 16]} />
        <meshStandardMaterial />
      </instancedMesh>
      <instancedMesh ref={hatRef} args={[undefined, undefined, workers.length]}>
        <sphereGeometry args={[0.25, 16, 16]} />
        <meshStandardMaterial />
      </instancedMesh>
      
      {/* Labels and Indicators (Not instanced for simplicity, but could be optimized further if needed) */}
      {workers.map((w, i) => {
        const statusColor = w.status === 'critical' ? '#f43f5e' : w.status === 'warning' ? '#f59e0b' : '#10b981';
        return (
          <group key={`w-label-${i}`} position={w.position}>
            <Text
              position={[0, 2, 0]}
              fontSize={0.2}
              color="white"
              anchorX="center"
              anchorY="middle"
              outlineWidth={0.02}
              outlineColor="black"
            >
              {w.id}
            </Text>
            <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0.5, 0.6, 32]} />
              <meshBasicMaterial color={statusColor} transparent opacity={w.isFallen ? 0.8 : 0.5} side={THREE.DoubleSide} />
            </mesh>
            {w.isFallen && (
              <mesh position={[0, 2.5, 0]}>
                 <planeGeometry args={[0.8, 0.8]} />
                 <meshBasicMaterial color="#f43f5e" transparent opacity={0.8} side={THREE.DoubleSide} />
                 <Text
                  position={[0, 0, 0.01]}
                  fontSize={0.4}
                  color="white"
                  anchorX="center"
                  anchorY="middle"
                >
                  !
                </Text>
              </mesh>
            )}
          </group>
        );
      })}
    </group>
  );
}

// A simple machinery representation (e.g., a crane or truck)
function Machinery({ position, status, type }: { position: [number, number, number], status: 'normal' | 'warning' | 'critical', type: 'crane' | 'truck' }) {
  const color = status === 'critical' ? '#f43f5e' : status === 'warning' ? '#f59e0b' : '#3b82f6';
  
  return (
    <group position={position}>
      {type === 'truck' ? (
        <group>
          <Box args={[2, 1, 4]} position={[0, 0.5, 0]}>
            <meshStandardMaterial color={color} />
          </Box>
          <Box args={[2, 1.5, 1.5]} position={[0, 1.25, 1.25]}>
            <meshStandardMaterial color="#e4e4e7" />
          </Box>
        </group>
      ) : (
        <group>
          <Box args={[1.5, 0.5, 1.5]} position={[0, 0.25, 0]}>
            <meshStandardMaterial color={color} />
          </Box>
          <Cylinder args={[0.2, 0.2, 4, 8]} position={[0, 2, 0]}>
            <meshStandardMaterial color="#e4e4e7" />
          </Cylinder>
          <Box args={[0.5, 0.5, 5]} position={[0, 4, 1.5]} rotation={[0.2, 0, 0]}>
            <meshStandardMaterial color={color} />
          </Box>
        </group>
      )}
    </group>
  );
}

// The main 3D Scene
function Scene({ workers, machinery }: { workers: any[], machinery: any[] }) {
  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 10, 5]} intensity={1} castShadow />
      <Environment preset="city" />
      
      {/* Ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[50, 50]} />
        <meshStandardMaterial color="#27272a" />
        <gridHelper args={[50, 50, '#3f3f46', '#3f3f46']} rotation={[Math.PI / 2, 0, 0]} />
      </mesh>

      {/* Workers using InstancedMesh */}
      <InstancedWorkers workers={workers} />

      {/* Machinery */}
      {machinery.map((m, i) => (
        <Machinery key={`m-${i}`} position={m.position} status={m.status} type={m.type} />
      ))}

      <ContactShadows position={[0, 0.01, 0]} opacity={0.4} scale={50} blur={2} far={10} />
      <OrbitControls makeDefault minPolarAngle={0} maxPolarAngle={Math.PI / 2.1} />
    </>
  );
}

export interface WorkerData {
  id: string;
  position: [number, number, number];
  status: 'normal' | 'warning' | 'critical';
  isFallen?: boolean;
}

export interface MachineryData {
  id: string;
  type: 'crane' | 'truck';
  position: [number, number, number];
  status: 'normal' | 'warning' | 'critical';
}

interface DigitalTwinProps {
  workers?: WorkerData[];
  machinery?: MachineryData[];
}

export function DigitalTwin({ workers: propWorkers, machinery: propMachinery }: DigitalTwinProps) {
  // Mock data fallback
  const fallbackWorkers: WorkerData[] = [
    { id: 'W-01', position: [-2, 0, 2], status: 'normal' },
    { id: 'W-02', position: [3, 0, -1], status: 'warning' },
    { id: 'W-03', position: [0, 0, 4], status: 'normal' },
    { id: 'W-04', position: [-4, 0, -3], status: 'critical' },
  ];

  const fallbackMachinery: MachineryData[] = [
    { id: 'M-01', type: 'truck', position: [5, 0, 5], status: 'normal' },
    { id: 'M-02', type: 'crane', position: [-5, 0, 0], status: 'warning' },
  ];

  const workers = propWorkers || fallbackWorkers;
  const machinery = propMachinery || fallbackMachinery;

  return (
    <div className="bg-zinc-900/50 border border-white/10 rounded-3xl overflow-hidden flex flex-col h-[500px]">
      <div className="p-4 border-b border-white/5 flex items-center justify-between bg-zinc-950/50">
        <div className="flex items-center gap-3">
          <div className="bg-emerald-500/20 p-2 rounded-xl border border-emerald-500/30">
            <MapPin className="w-5 h-5 text-emerald-500" />
          </div>
          <div>
            <h3 className="text-sm font-black uppercase tracking-widest text-white">Digital Twin 3D</h3>
            <p className="text-[10px] font-medium text-zinc-500">Simulación en Tiempo Real</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Live</span>
          </div>
        </div>
      </div>

      <div className="flex-1 relative">
        {/* Legend Overlay */}
        <div className="absolute top-4 left-4 z-10 bg-black/50 backdrop-blur-md border border-white/10 rounded-xl p-3 space-y-2">
          <h4 className="text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-2">Estado</h4>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-3 h-3 text-emerald-500" />
            <span className="text-[10px] font-medium text-zinc-300">Normal</span>
          </div>
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-3 h-3 text-amber-500" />
            <span className="text-[10px] font-medium text-zinc-300">Advertencia</span>
          </div>
          <div className="flex items-center gap-2">
            <Activity className="w-3 h-3 text-rose-500" />
            <span className="text-[10px] font-medium text-zinc-300">Crítico</span>
          </div>
        </div>

        <Canvas camera={{ position: [10, 10, 10], fov: 50 }} gl={{ powerPreference: 'low-power' }}>
          <Scene workers={workers} machinery={machinery} />
        </Canvas>
      </div>
    </div>
  );
}
