import React, { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Cylinder, Text, Float } from '@react-three/drei';
import { useTranslation } from 'react-i18next';
import {
  PLATONIC_SOLIDS,
  type PolyhedronShape,
  type AchievementProgress,
} from '../../services/euler/polyhedronAchievements';

/**
 * Medal3DViewer — Fase 10 Euler-Matrix.
 *
 * Renderiza una medalla 3D. Si se pasa `polyhedronShape`, en lugar de
 * la moneda clásica se renderiza el sólido platónico correspondiente
 * usando las geometrías nativas de Three.js (sin deps adicionales):
 *  - tetrahedron → TetrahedronGeometry
 *  - cube        → BoxGeometry
 *  - octahedron  → OctahedronGeometry
 *  - dodecahedron→ DodecahedronGeometry
 *  - icosahedron → IcosahedronGeometry
 *
 * Si además se pasa `progress`, la opacidad del wireframe sobre la
 * forma indica progreso parcial — un poliedro incompleto se muestra
 * más translúcido. Esto da feedback visual sin reescribir la
 * geometría: el usuario ve el "fantasma" del logro objetivo.
 */

function Medal({ title, color }: { title: string; color: string }) {
  const meshRef = useRef<any>(null);

  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.rotation.y = state.clock.getElapsedTime() * 0.5;
    }
  });

  return (
    <Float speed={2} rotationIntensity={0.5} floatIntensity={0.5}>
      <group ref={meshRef}>
        {/* Main Coin Body */}
        <Cylinder args={[2, 2, 0.2, 64]} rotation={[Math.PI / 2, 0, 0]}>
          <meshStandardMaterial color={color} metalness={0.8} roughness={0.2} />
        </Cylinder>
        {/* Inner Ring */}
        <Cylinder args={[1.8, 1.8, 0.22, 64]} rotation={[Math.PI / 2, 0, 0]}>
          <meshStandardMaterial color="#ffffff" metalness={0.9} roughness={0.1} />
        </Cylinder>
        {/* Text */}
        <Text position={[0, 0, 0.12]} fontSize={0.35} color="#000000" anchorX="center" anchorY="middle" fontWeight="bold">
          {title}
        </Text>
        <Text position={[0, 0, -0.12]} rotation={[0, Math.PI, 0]} fontSize={0.35} color="#000000" anchorX="center" anchorY="middle" fontWeight="bold">
          {title}
        </Text>
      </group>
    </Float>
  );
}

/**
 * 3D mesh of a Platonic solid. Uses Three.js built-in geometries —
 * zero new deps. Opacity is driven by `completionPercent` so an
 * incomplete polyhedron renders as a translucent "ghost" of the
 * fully-unlocked solid.
 */
function PolyhedronMedal({
  shape,
  color,
  completionPercent,
}: {
  shape: PolyhedronShape;
  color: string;
  completionPercent: number;
}) {
  const meshRef = useRef<any>(null);

  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.rotation.y = state.clock.getElapsedTime() * 0.5;
      meshRef.current.rotation.x = state.clock.getElapsedTime() * 0.2;
    }
  });

  // Opacity scales 0.3 .. 1.0 with completion. A 0% polyhedron is
  // still visible (ghosted) so the user sees their target.
  const opacity = 0.3 + (Math.max(0, Math.min(100, completionPercent)) / 100) * 0.7;
  const radius = 1.5;

  // Map shape → Three.js geometry. We render via JSX primitives so
  // R3F handles disposal correctly.
  const geometryNode = (() => {
    switch (shape) {
      case 'tetrahedron':
        return <tetrahedronGeometry args={[radius, 0]} />;
      case 'cube':
        // BoxGeometry uses width/height/depth, not a radius.
        return <boxGeometry args={[radius * 1.4, radius * 1.4, radius * 1.4]} />;
      case 'octahedron':
        return <octahedronGeometry args={[radius, 0]} />;
      case 'dodecahedron':
        return <dodecahedronGeometry args={[radius, 0]} />;
      case 'icosahedron':
        return <icosahedronGeometry args={[radius, 0]} />;
    }
  })();

  return (
    <Float speed={1.5} rotationIntensity={0.4} floatIntensity={0.4}>
      <group ref={meshRef}>
        {/* Solid body */}
        <mesh>
          {geometryNode}
          <meshStandardMaterial
            color={color}
            metalness={0.7}
            roughness={0.25}
            transparent
            opacity={opacity}
          />
        </mesh>
        {/* Wireframe overlay — always fully visible so edges read clearly */}
        <mesh>
          {geometryNode}
          <meshStandardMaterial color="#ffffff" wireframe wireframeLinewidth={2} transparent opacity={0.6} />
        </mesh>
      </group>
    </Float>
  );
}

interface Medal3DViewerProps {
  title?: string;
  color?: string;
  /**
   * If provided, renders a Platonic-solid-shaped medal instead of
   * the default coin. Used to visualize polyhedron-based achievements
   * (Fase 10, V-E+F=2).
   */
  polyhedronShape?: PolyhedronShape;
  /**
   * Optional progress info — controls opacity so partially-unlocked
   * polyhedrons read as ghosted versions of the full solid.
   */
  progress?: AchievementProgress;
}

export function Medal3DViewer({
  title,
  color = '#fbbf24',
  polyhedronShape,
  progress,
}: Medal3DViewerProps) {
  const { t } = useTranslation();
  const medalTitle = title ?? t('medal_viewer.default_title');
  const completion = progress?.completionPercent ?? 100;

  return (
    <div className="w-full h-48 relative cursor-grab active:cursor-grabbing">
      <Canvas camera={{ position: [0, 0, 5], fov: 50 }} gl={{ powerPreference: 'low-power' }}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 10, 5]} intensity={1.5} />
        <pointLight position={[-10, -10, -5]} intensity={0.5} />
        {polyhedronShape ? (
          <PolyhedronMedal
            shape={polyhedronShape}
            color={color}
            completionPercent={completion}
          />
        ) : (
          <Medal title={medalTitle} color={color} />
        )}
      </Canvas>
      {polyhedronShape && progress && (
        <div className="absolute bottom-1 left-1 right-1 text-center text-[10px] text-white/80 font-mono uppercase tracking-widest pointer-events-none">
          {/* Tiny readout. Translation is handled where this component
              is consumed; we only show the raw V-E+F count here as a
              language-neutral mini-label. */}
          V{progress.unlockedV}/{PLATONIC_SOLIDS[polyhedronShape].V} ·
          E{progress.unlockedE}/{PLATONIC_SOLIDS[polyhedronShape].E} ·
          F{progress.unlockedF}/{PLATONIC_SOLIDS[polyhedronShape].F}
        </div>
      )}
    </div>
  );
}
