'use client';

import React, { useRef, useState, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Line } from '@react-three/drei';
import * as THREE from 'three';

function MiniBadmintonCourtModel({ reducedMotion }: { reducedMotion: boolean }) {
  const groupRef = useRef<THREE.Group>(null);
  const courtWidth = 6.1;
  const courtLength = 13.4;

  useFrame((_, delta) => {
    if (groupRef.current && !reducedMotion) {
      groupRef.current.rotation.y += delta * 0.12;
    }
  });

  return (
    <group ref={groupRef} position={[0, -0.4, 0]}>
      {/* Court Mat */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[courtWidth, courtLength]} />
        <meshStandardMaterial color="#14966B" roughness={0.7} metalness={0.1} />
      </mesh>

      {/* Surrounding apron */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.005, 0]} receiveShadow>
        <planeGeometry args={[courtWidth + 2, courtLength + 2]} />
        <meshStandardMaterial color="#0F7A56" roughness={0.8} />
      </mesh>

      {/* Outer Boundary Lines */}
      <Line
        points={[
          [-courtWidth / 2, 0.01, -courtLength / 2],
          [courtWidth / 2, 0.01, -courtLength / 2],
          [courtWidth / 2, 0.01, courtLength / 2],
          [-courtWidth / 2, 0.01, courtLength / 2],
          [-courtWidth / 2, 0.01, -courtLength / 2],
        ]}
        color="#FFFFFF"
        lineWidth={2}
      />

      {/* Center Net Line */}
      <Line
        points={[
          [-courtWidth / 2, 0.01, 0],
          [courtWidth / 2, 0.01, 0],
        ]}
        color="#FFFFFF"
        lineWidth={2}
      />

      {/* Short Service Lines (1.98m from net) */}
      <Line
        points={[
          [-courtWidth / 2, 0.01, 1.98],
          [courtWidth / 2, 0.01, 1.98],
        ]}
        color="#FFFFFF"
        lineWidth={1.5}
      />
      <Line
        points={[
          [-courtWidth / 2, 0.01, -1.98],
          [courtWidth / 2, 0.01, -1.98],
        ]}
        color="#FFFFFF"
        lineWidth={1.5}
      />

      {/* Center Service Lines */}
      <Line
        points={[
          [0, 0.01, 1.98],
          [0, 0.01, courtLength / 2],
        ]}
        color="#FFFFFF"
        lineWidth={1.5}
      />
      <Line
        points={[
          [0, 0.01, -1.98],
          [0, 0.01, -courtLength / 2],
        ]}
        color="#FFFFFF"
        lineWidth={1.5}
      />

      {/* Net Posts */}
      <mesh position={[-courtWidth / 2 - 0.1, 0.775, 0]}>
        <cylinderGeometry args={[0.04, 0.04, 1.55, 12]} />
        <meshStandardMaterial color="#344054" metalness={0.8} roughness={0.2} />
      </mesh>
      <mesh position={[courtWidth / 2 + 0.1, 0.775, 0]}>
        <cylinderGeometry args={[0.04, 0.04, 1.55, 12]} />
        <meshStandardMaterial color="#344054" metalness={0.8} roughness={0.2} />
      </mesh>

      {/* Net Plane */}
      <mesh position={[0, 1.15, 0]}>
        <planeGeometry args={[courtWidth + 0.2, 0.76]} />
        <meshStandardMaterial
          color="#182230"
          roughness={0.8}
          transparent
          opacity={0.65}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Top Net White Tape */}
      <mesh position={[0, 1.54, 0]}>
        <boxGeometry args={[courtWidth + 0.2, 0.05, 0.03]} />
        <meshStandardMaterial color="#FFFFFF" roughness={0.5} />
      </mesh>
    </group>
  );
}

function MiniFootballPitchModel({ reducedMotion }: { reducedMotion: boolean }) {
  const groupRef = useRef<THREE.Group>(null);
  const pitchWidth = 9.0;
  const pitchLength = 14.0;

  useFrame((_, delta) => {
    if (groupRef.current && !reducedMotion) {
      groupRef.current.rotation.y += delta * 0.12;
    }
  });

  // Generate circle points for center circle
  const centerCircleRadius = 1.8;
  const circleSegments = 32;
  const circlePoints: [number, number, number][] = [];
  for (let i = 0; i <= circleSegments; i++) {
    const theta = (i / circleSegments) * Math.PI * 2;
    circlePoints.push([
      Math.cos(theta) * centerCircleRadius,
      0.01,
      Math.sin(theta) * centerCircleRadius,
    ]);
  }

  return (
    <group ref={groupRef} position={[0, -0.4, 0]}>
      {/* Pitch Turf */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[pitchWidth, pitchLength]} />
        <meshStandardMaterial color="#1E7B48" roughness={0.75} metalness={0.05} />
      </mesh>

      {/* Pitch Apron */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.005, 0]} receiveShadow>
        <planeGeometry args={[pitchWidth + 1.8, pitchLength + 1.8]} />
        <meshStandardMaterial color="#17633A" roughness={0.85} />
      </mesh>

      {/* Outer Touchlines & Goal Lines */}
      <Line
        points={[
          [-pitchWidth / 2, 0.01, -pitchLength / 2],
          [pitchWidth / 2, 0.01, -pitchLength / 2],
          [pitchWidth / 2, 0.01, pitchLength / 2],
          [-pitchWidth / 2, 0.01, pitchLength / 2],
          [-pitchWidth / 2, 0.01, -pitchLength / 2],
        ]}
        color="#FFFFFF"
        lineWidth={2}
      />

      {/* Halfway Line */}
      <Line
        points={[
          [-pitchWidth / 2, 0.01, 0],
          [pitchWidth / 2, 0.01, 0],
        ]}
        color="#FFFFFF"
        lineWidth={2}
      />

      {/* Center Circle */}
      <Line points={circlePoints} color="#FFFFFF" lineWidth={1.5} />

      {/* Center Spot */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]}>
        <circleGeometry args={[0.08, 16]} />
        <meshBasicMaterial color="#FFFFFF" />
      </mesh>

      {/* Penalty Box A (North) */}
      <Line
        points={[
          [-2.6, 0.01, -pitchLength / 2],
          [-2.6, 0.01, -pitchLength / 2 + 2.2],
          [2.6, 0.01, -pitchLength / 2 + 2.2],
          [2.6, 0.01, -pitchLength / 2],
        ]}
        color="#FFFFFF"
        lineWidth={1.5}
      />

      {/* Penalty Box B (South) */}
      <Line
        points={[
          [-2.6, 0.01, pitchLength / 2],
          [-2.6, 0.01, pitchLength / 2 - 2.2],
          [2.6, 0.01, pitchLength / 2 - 2.2],
          [2.6, 0.01, pitchLength / 2],
        ]}
        color="#FFFFFF"
        lineWidth={1.5}
      />

      {/* Goal Posts A (North) */}
      <mesh position={[-1.2, 0.35, -pitchLength / 2]}>
        <cylinderGeometry args={[0.03, 0.03, 0.7, 8]} />
        <meshStandardMaterial color="#FFFFFF" metalness={0.6} roughness={0.3} />
      </mesh>
      <mesh position={[1.2, 0.35, -pitchLength / 2]}>
        <cylinderGeometry args={[0.03, 0.03, 0.7, 8]} />
        <meshStandardMaterial color="#FFFFFF" metalness={0.6} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.7, -pitchLength / 2]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.03, 0.03, 2.4, 8]} />
        <meshStandardMaterial color="#FFFFFF" metalness={0.6} roughness={0.3} />
      </mesh>

      {/* Goal Posts B (South) */}
      <mesh position={[-1.2, 0.35, pitchLength / 2]}>
        <cylinderGeometry args={[0.03, 0.03, 0.7, 8]} />
        <meshStandardMaterial color="#FFFFFF" metalness={0.6} roughness={0.3} />
      </mesh>
      <mesh position={[1.2, 0.35, pitchLength / 2]}>
        <cylinderGeometry args={[0.03, 0.03, 0.7, 8]} />
        <meshStandardMaterial color="#FFFFFF" metalness={0.6} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.7, pitchLength / 2]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.03, 0.03, 2.4, 8]} />
        <meshStandardMaterial color="#FFFFFF" metalness={0.6} roughness={0.3} />
      </mesh>
    </group>
  );
}

export interface ThreeCanvasProps {
  sport?: 'BADMINTON' | 'FOOTBALL';
  showSportToggle?: boolean;
}

export default function ThreeCanvas({ sport: initialSport = 'BADMINTON', showSportToggle = true }: ThreeCanvasProps) {
  const [selectedSport, setSelectedSport] = useState<'BADMINTON' | 'FOOTBALL'>(initialSport);
  const [reducedMotion, setReducedMotion] = useState(false);
  const controlsRef = useRef<any>(null);

  const handleResetView = () => {
    if (controlsRef.current) {
      controlsRef.current.reset();
    }
  };

  useEffect(() => {
    setSelectedSport(initialSport);
  }, [initialSport]);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      setReducedMotion(mediaQuery.matches);
      const listener = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
      mediaQuery.addEventListener('change', listener);
      return () => mediaQuery.removeEventListener('change', listener);
    }
  }, []);

  return (
    <div className="w-full h-full min-h-[260px] flex items-center justify-center relative bg-[#0B111E] rounded-xl overflow-hidden shadow-inner select-none">
      <Canvas
        camera={{ position: [0, 9, 13], fov: 38 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
      >
        <ambientLight intensity={0.75} />
        <directionalLight position={[10, 16, 10]} intensity={1.3} castShadow />
        <pointLight position={[-10, 12, -10]} intensity={0.5} />
        
        {selectedSport === 'FOOTBALL' ? (
          <MiniFootballPitchModel reducedMotion={reducedMotion} />
        ) : (
          <MiniBadmintonCourtModel reducedMotion={reducedMotion} />
        )}
        
        <OrbitControls
          ref={controlsRef}
          enableZoom={true}
          enablePan={false}
          minDistance={6}
          maxDistance={24}
          maxPolarAngle={Math.PI / 2.2}
        />
      </Canvas>

      {/* Top Left Badge */}
      <div className="absolute top-3 left-3 pointer-events-none">
        <span className="text-[10px] font-semibold uppercase text-emerald-300 bg-emerald-950/70 px-2.5 py-1 rounded-md border border-emerald-500/20 tracking-wider flex items-center gap-1.5 shadow-sm">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          3D Arena Simulation
        </span>
      </div>

      {/* Sport Selector Toggle */}
      {showSportToggle && (
        <div className="absolute top-3 right-3 flex items-center bg-slate-900/80 backdrop-blur-md rounded-lg p-0.5 border border-slate-700/50 shadow-md">
          <button
            type="button"
            onClick={() => setSelectedSport('BADMINTON')}
            className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition ${
              selectedSport === 'BADMINTON'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Badminton
          </button>
          <button
            type="button"
            onClick={() => setSelectedSport('FOOTBALL')}
            className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition ${
              selectedSport === 'FOOTBALL'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Football
          </button>
        </div>
      )}

      {/* Reset View Button */}
      <button
        type="button"
        onClick={handleResetView}
        className="absolute bottom-3 right-3 text-[10px] font-medium text-slate-300 hover:text-white bg-slate-900/80 hover:bg-slate-800/90 backdrop-blur-md px-2.5 py-1 rounded-md border border-slate-700/50 shadow-sm transition flex items-center gap-1.5"
        title="Reset 3D camera view"
      >
        <svg className="w-3 h-3 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        <span>Reset View</span>
      </button>
    </div>
  );
}
