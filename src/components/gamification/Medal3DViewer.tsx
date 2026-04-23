import React, { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Cylinder, Text, Float } from '@react-three/drei';

function Medal({ title, color }: { title: string, color: string }) {
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

export function Medal3DViewer({ title = "SEMANA INVICTA", color = "#fbbf24" }: { title?: string, color?: string }) {
  return (
    <div className="w-full h-48 relative cursor-grab active:cursor-grabbing">
      <Canvas camera={{ position: [0, 0, 5], fov: 50 }} gl={{ powerPreference: 'low-power' }}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 10, 5]} intensity={1.5} />
        <pointLight position={[-10, -10, -5]} intensity={0.5} />
        <Medal title={title} color={color} />
      </Canvas>
    </div>
  );
}
