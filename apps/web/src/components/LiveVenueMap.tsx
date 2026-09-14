'use client';

import React, { useRef, useState, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Html, Line } from '@react-three/drei';
import * as THREE from 'three';
import { BADMINTON_COURT_DIMENSIONS, FOOTBALL_PITCH_DIMENSIONS } from '@arena-flow/3d-engine';

export interface VenueTarget {
  id: string;
  name: string;
  venueType?: 'COURT' | 'PITCH';
  sport?: 'BADMINTON' | 'FOOTBALL' | string;
  match_id?: string;
  [key: string]: any;
}

export interface LiveVenueMapProps {
  matches: any[];
  courts?: any[];
  venues?: VenueTarget[];
  activeScorers?: Record<string, any>;
  onCourtSelect?: (match: any | null) => void;
  sport?: string;
}

// Spacing constants for multi-venue grids
const SPACING_COURT_X = 14;
const SPACING_COURT_Z = 20;
const SPACING_PITCH_X = 20;
const SPACING_PITCH_Z = 28;

// Dynamic grid coordinate solver
function getVenueGridPosition(index: number, totalVenues: number, isPitch: boolean) {
  let col = 0;
  let row = 0;
  let colsCount = totalVenues;
  let rowsCount = 1;

  if (totalVenues > 3) {
    colsCount = Math.ceil(totalVenues / 2);
    rowsCount = 2;
    col = index % colsCount;
    row = Math.floor(index / colsCount);
  } else {
    col = index;
  }

  const spacingX = isPitch ? SPACING_PITCH_X : SPACING_COURT_X;
  const spacingZ = isPitch ? SPACING_PITCH_Z : SPACING_COURT_Z;

  const x = col * spacingX - ((colsCount - 1) * spacingX) / 2;
  const z = row * spacingZ - ((rowsCount - 1) * spacingZ) / 2;

  return { x, z, colsCount, rowsCount };
}

function getParticipantDisplayName(participant: any, fallback: string = 'Team'): string {
  if (!participant) return fallback;
  if (participant.name) return participant.name;
  if (participant.display_name) return participant.display_name;
  if (participant.members && participant.members.length > 0) {
    return participant.members
      .map((m: any) => m.player?.display_name || m.player?.full_name || 'Player')
      .join(' / ');
  }
  return fallback;
}

// -------------------------------------------------------------
// 1. BADMINTON COURT MESH
// -------------------------------------------------------------
function BadmintonCourtMesh({
  venue,
  activeMatch,
  isScorerActive,
  index,
  totalVenues,
  isSelected,
  onSelect,
  reducedMotion
}: {
  venue: VenueTarget;
  activeMatch: any;
  isScorerActive: boolean;
  index: number;
  totalVenues: number;
  isSelected: boolean;
  onSelect: () => void;
  reducedMotion: boolean;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);
  const width = BADMINTON_COURT_DIMENSIONS.width;
  const length = BADMINTON_COURT_DIMENSIONS.length;

  const { x: xPos, z: zPos } = getVenueGridPosition(index, totalVenues, false);

  let glowColor = '#334155';
  let isTense = false;
  let liveScoreText = '';

  if (activeMatch) {
    const games = activeMatch.games || [];
    const activeGame = games.find((g: any) => g.status === 'LIVE') || games[games.length - 1];

    if (activeGame) {
      const scoreA = activeGame.participant_a_score || 0;
      const scoreB = activeGame.participant_b_score || 0;
      liveScoreText = `${scoreA} - ${scoreB}`;

      if (scoreA >= 20 || scoreB >= 20) {
        isTense = true;
      }
    }

    if (activeMatch.status === 'LIVE' || activeMatch.status === 'UNDER_REVIEW') {
      glowColor = isTense ? '#f97316' : '#10b981';
    } else if (activeMatch.status === 'PAUSED') {
      glowColor = '#eab308';
    } else if (activeMatch.status === 'READY') {
      glowColor = '#3b82f6';
    }
  }

  useFrame((state) => {
    if (meshRef.current && !reducedMotion) {
      const material = meshRef.current.material as THREE.MeshStandardMaterial;
      if (activeMatch && (activeMatch.status === 'LIVE' || activeMatch.status === 'UNDER_REVIEW')) {
        const pulse = Math.sin(state.clock.getElapsedTime() * 1.6) * 0.08 + 0.92;
        material.emissive.set(glowColor).multiplyScalar(pulse);
      } else if (activeMatch && activeMatch.status === 'PAUSED') {
        material.emissive.set(glowColor).multiplyScalar(0.4);
      } else if (activeMatch && activeMatch.status === 'READY') {
        material.emissive.set(glowColor).multiplyScalar(0.25);
      } else {
        material.emissive.setHex(0x000000);
      }
    }
  });

  return (
    <group position={[xPos, 0, zPos]}>
      {/* 3D Court Platform */}
      <mesh position={[0, 0.025, 0]} receiveShadow>
        <boxGeometry args={[width + 0.6, 0.05, length + 0.6]} />
        <meshStandardMaterial color="#1e293b" roughness={0.8} />
      </mesh>

      {/* Court Floor mesh (Badminton Green Mat) */}
      <mesh
        ref={meshRef}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.051, 0]}
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
      >
        <planeGeometry args={[width, length]} />
        <meshStandardMaterial
          color={hovered || isSelected ? '#10b981' : '#15803d'}
          roughness={0.6}
          metalness={0.1}
          emissiveIntensity={0.5}
        />
      </mesh>

      {/* Net posts & net */}
      <group position={[0, 0.05, 0]}>
        <mesh position={[-width / 2, 0.775, 0]}>
          <cylinderGeometry args={[0.03, 0.03, 1.55]} />
          <meshStandardMaterial color="#e2e8f0" metalness={0.8} roughness={0.2} />
        </mesh>
        <mesh position={[width / 2, 0.775, 0]}>
          <cylinderGeometry args={[0.03, 0.03, 1.55]} />
          <meshStandardMaterial color="#e2e8f0" metalness={0.8} roughness={0.2} />
        </mesh>
        <mesh position={[0, 1.17, 0]}>
          <boxGeometry args={[width, 0.76, 0.01]} />
          <meshStandardMaterial color="#991b1b" transparent opacity={0.6} wireframe />
        </mesh>
      </group>

      {/* Court Markings */}
      <group position={[0, 0.053, 0]}>
        <Line
          points={[
            [-width / 2, 0, -length / 2],
            [width / 2, 0, -length / 2],
            [width / 2, 0, length / 2],
            [-width / 2, 0, length / 2],
            [-width / 2, 0, -length / 2]
          ]}
          color="#ffffff"
          lineWidth={2.5}
        />
        <Line points={[[-width / 2, 0, 0], [width / 2, 0, 0]]} color="#ffffff" lineWidth={2.5} />
        <Line points={[[0, 0, -length / 2], [0, 0, -1.98]]} color="#ffffff" lineWidth={2.0} />
        <Line points={[[0, 0, 1.98], [0, 0, length / 2]]} color="#ffffff" lineWidth={2.0} />
        <Line points={[[-width / 2, 0, -1.98], [width / 2, 0, -1.98]]} color="#ffffff" lineWidth={2.0} />
        <Line points={[[-width / 2, 0, 1.98], [width / 2, 0, 1.98]]} color="#ffffff" lineWidth={2.0} />
      </group>

      {/* HTML Billboard above the court */}
      <Html position={[0, 2.6, 0]} center distanceFactor={10}>
        <div 
          onClick={onSelect}
          className={`flex flex-col items-center select-none cursor-pointer p-2.5 rounded-lg border text-center shadow-lg transition duration-200 w-[145px] ${
            isSelected 
              ? 'bg-slate-900 border-indigo-500 scale-105 shadow-indigo-500/20 ring-2 ring-indigo-400' 
              : 'bg-slate-950/95 border-slate-800 hover:border-slate-650'
          }`}
        >
          <div className="flex items-center gap-1.5 justify-center">
            <span className="text-[9px] text-gray-400 font-extrabold uppercase tracking-wider">
              {venue.name}
            </span>
            {activeMatch && (activeMatch.status === 'LIVE' || activeMatch.status === 'UNDER_REVIEW') && (
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 live-dot-slow" />
            )}
          </div>
          
          {activeMatch ? (
            <div className="mt-1 space-y-0.5 border-t border-slate-850 pt-1 w-full">
              <div className="text-[10px] font-bold text-white truncate max-w-[130px]">
                {getParticipantDisplayName(activeMatch.participant_a, 'Player A')}
              </div>
              <div className="text-[10px] font-black text-emerald-400 font-mono my-0.5">
                {liveScoreText || '0 - 0'}
              </div>
              <div className="text-[10px] font-bold text-white truncate max-w-[130px]">
                {getParticipantDisplayName(activeMatch.participant_b, 'Player B')}
              </div>
              <span className={`inline-block px-1.5 py-0.5 rounded text-[7px] font-black uppercase tracking-wider scale-90 ${
                activeMatch.status === 'LIVE' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
              }`}>
                {activeMatch.status}
              </span>
            </div>
          ) : (
            <div className="mt-1 text-[9px] text-gray-500 font-extrabold uppercase tracking-wider border-t border-slate-850 pt-1 w-full">
              Idle
            </div>
          )}
        </div>
      </Html>
    </group>
  );
}

// -------------------------------------------------------------
// 2. FOOTBALL 3D PITCH MESH
// -------------------------------------------------------------
function FootballPitchMesh({
  venue,
  activeMatch,
  isScorerActive,
  index,
  totalVenues,
  isSelected,
  onSelect,
  reducedMotion
}: {
  venue: VenueTarget;
  activeMatch: any;
  isScorerActive: boolean;
  index: number;
  totalVenues: number;
  isSelected: boolean;
  onSelect: () => void;
  reducedMotion: boolean;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);
  const width = FOOTBALL_PITCH_DIMENSIONS.width; // 12.0
  const length = FOOTBALL_PITCH_DIMENSIONS.length; // 20.0

  const { x: xPos, z: zPos } = getVenueGridPosition(index, totalVenues, true);

  let glowColor = '#334155';
  let liveScoreText = '0 - 0';
  let phaseText = 'PRE MATCH';
  let isShootout = false;

  if (activeMatch) {
    const sA = activeMatch.score_a ?? 0;
    const sB = activeMatch.score_b ?? 0;
    liveScoreText = `${sA} - ${sB}`;

    if (activeMatch.shootout_score) {
      const psoA = activeMatch.shootout_score.score_a ?? activeMatch.shootout_score_a;
      const psoB = activeMatch.shootout_score.score_b ?? activeMatch.shootout_score_b;
      if (psoA !== undefined && psoB !== undefined) {
        liveScoreText += ` (${psoA}-${psoB} PSO)`;
        isShootout = true;
      }
    }

    if (activeMatch.match_phase) {
      phaseText = activeMatch.match_phase.replace(/_/g, ' ');
    } else if (activeMatch.status === 'COMPLETED') {
      phaseText = 'FULL TIME';
    } else if (activeMatch.status === 'LIVE') {
      phaseText = 'LIVE';
    } else {
      phaseText = activeMatch.status || 'SCHEDULED';
    }

    if (activeMatch.status === 'LIVE' || activeMatch.status === 'UNDER_REVIEW') {
      glowColor = isShootout ? '#f97316' : '#10b981';
    } else if (activeMatch.status === 'PAUSED') {
      glowColor = '#eab308';
    } else if (activeMatch.status === 'READY') {
      glowColor = '#3b82f6';
    }
  }

  useFrame((state) => {
    if (meshRef.current && !reducedMotion) {
      const material = meshRef.current.material as THREE.MeshStandardMaterial;
      if (activeMatch && (activeMatch.status === 'LIVE' || activeMatch.status === 'UNDER_REVIEW')) {
        const pulse = Math.sin(state.clock.getElapsedTime() * 1.6) * 0.08 + 0.92;
        material.emissive.set(glowColor).multiplyScalar(pulse);
      } else if (activeMatch && activeMatch.status === 'PAUSED') {
        material.emissive.set(glowColor).multiplyScalar(0.4);
      } else if (activeMatch && activeMatch.status === 'READY') {
        material.emissive.set(glowColor).multiplyScalar(0.25);
      } else {
        material.emissive.setHex(0x000000);
      }
    }
  });

  // Precalculate circle points for center circle
  const centerCircleRadius = FOOTBALL_PITCH_DIMENSIONS.centerCircleRadius;
  const circlePoints: [number, number, number][] = [];
  for (let i = 0; i <= 32; i++) {
    const theta = (i / 32) * Math.PI * 2;
    circlePoints.push([
      Math.cos(theta) * centerCircleRadius,
      0,
      Math.sin(theta) * centerCircleRadius
    ]);
  }

  return (
    <group position={[xPos, 0, zPos]}>
      {/* 3D Pitch Apron / Stadium Concrete Surrounding */}
      <mesh position={[0, 0.02, 0]} receiveShadow>
        <boxGeometry args={[width + 1.6, 0.04, length + 1.6]} />
        <meshStandardMaterial color="#0f172a" roughness={0.85} />
      </mesh>

      {/* Turf Surface (Alternating Grass Stripe Layers for Rich Realism) */}
      <mesh
        ref={meshRef}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.045, 0]}
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
      >
        <planeGeometry args={[width, length]} />
        <meshStandardMaterial
          color={hovered || isSelected ? '#15803d' : '#14693a'}
          roughness={0.7}
          metalness={0.05}
          emissiveIntensity={0.4}
        />
      </mesh>

      {/* Alternating Pitch Mowing Stripes */}
      {[-3, -1, 1, 3].map((posMultiplier, sIdx) => (
        <mesh
          key={sIdx}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.046, (posMultiplier * length) / 8]}
        >
          <planeGeometry args={[width, length / 4]} />
          <meshStandardMaterial
            color="#1b7a44"
            roughness={0.75}
            transparent
            opacity={0.35}
          />
        </mesh>
      ))}

      {/* Pitch Markings Group */}
      <group position={[0, 0.048, 0]}>
        {/* Perimeter Touchlines & Goal Lines */}
        <Line
          points={[
            [-width / 2, 0, -length / 2],
            [width / 2, 0, -length / 2],
            [width / 2, 0, length / 2],
            [-width / 2, 0, length / 2],
            [-width / 2, 0, -length / 2]
          ]}
          color="#ffffff"
          lineWidth={2.5}
        />

        {/* Halfway Line */}
        <Line
          points={[
            [-width / 2, 0, 0],
            [width / 2, 0, 0]
          ]}
          color="#ffffff"
          lineWidth={2.5}
        />

        {/* Center Circle */}
        <Line points={circlePoints} color="#ffffff" lineWidth={2.0} />

        {/* Center Spot */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
          <circleGeometry args={[0.12, 16]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>

        {/* North Penalty Area (Team A Goal Box) */}
        <Line
          points={[
            [-FOOTBALL_PITCH_DIMENSIONS.penaltyBoxWidth / 2, 0, -length / 2],
            [-FOOTBALL_PITCH_DIMENSIONS.penaltyBoxWidth / 2, 0, -length / 2 + FOOTBALL_PITCH_DIMENSIONS.penaltyBoxLength],
            [FOOTBALL_PITCH_DIMENSIONS.penaltyBoxWidth / 2, 0, -length / 2 + FOOTBALL_PITCH_DIMENSIONS.penaltyBoxLength],
            [FOOTBALL_PITCH_DIMENSIONS.penaltyBoxWidth / 2, 0, -length / 2]
          ]}
          color="#ffffff"
          lineWidth={2.0}
        />

        {/* North Goal Area (6-yard box) */}
        <Line
          points={[
            [-FOOTBALL_PITCH_DIMENSIONS.goalBoxWidth / 2, 0, -length / 2],
            [-FOOTBALL_PITCH_DIMENSIONS.goalBoxWidth / 2, 0, -length / 2 + FOOTBALL_PITCH_DIMENSIONS.goalBoxLength],
            [FOOTBALL_PITCH_DIMENSIONS.goalBoxWidth / 2, 0, -length / 2 + FOOTBALL_PITCH_DIMENSIONS.goalBoxLength],
            [FOOTBALL_PITCH_DIMENSIONS.goalBoxWidth / 2, 0, -length / 2]
          ]}
          color="#ffffff"
          lineWidth={1.8}
        />

        {/* North Penalty Spot */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, -length / 2 + 2.4]}>
          <circleGeometry args={[0.1, 16]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>

        {/* South Penalty Area (Team B Goal Box) */}
        <Line
          points={[
            [-FOOTBALL_PITCH_DIMENSIONS.penaltyBoxWidth / 2, 0, length / 2],
            [-FOOTBALL_PITCH_DIMENSIONS.penaltyBoxWidth / 2, 0, length / 2 - FOOTBALL_PITCH_DIMENSIONS.penaltyBoxLength],
            [FOOTBALL_PITCH_DIMENSIONS.penaltyBoxWidth / 2, 0, length / 2 - FOOTBALL_PITCH_DIMENSIONS.penaltyBoxLength],
            [FOOTBALL_PITCH_DIMENSIONS.penaltyBoxWidth / 2, 0, length / 2]
          ]}
          color="#ffffff"
          lineWidth={2.0}
        />

        {/* South Goal Area (6-yard box) */}
        <Line
          points={[
            [-FOOTBALL_PITCH_DIMENSIONS.goalBoxWidth / 2, 0, length / 2],
            [-FOOTBALL_PITCH_DIMENSIONS.goalBoxWidth / 2, 0, length / 2 - FOOTBALL_PITCH_DIMENSIONS.goalBoxLength],
            [FOOTBALL_PITCH_DIMENSIONS.goalBoxWidth / 2, 0, length / 2 - FOOTBALL_PITCH_DIMENSIONS.goalBoxLength],
            [FOOTBALL_PITCH_DIMENSIONS.goalBoxWidth / 2, 0, length / 2]
          ]}
          color="#ffffff"
          lineWidth={1.8}
        />

        {/* South Penalty Spot */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, length / 2 - 2.4]}>
          <circleGeometry args={[0.1, 16]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>

        {/* Corner Arcs */}
        {[
          [-width / 2, -length / 2, 0],
          [width / 2, -length / 2, Math.PI / 2],
          [width / 2, length / 2, Math.PI],
          [-width / 2, length / 2, (Math.PI * 3) / 2]
        ].map(([cx, cz, rot], aIdx) => (
          <group key={aIdx} position={[cx, 0.001, cz]} rotation={[0, rot, 0]}>
            <Line
              points={[
                [0, 0, 0.6],
                [0.42, 0, 0.42],
                [0.6, 0, 0]
              ]}
              color="#ffffff"
              lineWidth={1.5}
            />
          </group>
        ))}
      </group>

      {/* 3D Goal Posts North (Side A) */}
      <group position={[0, 0.05, -length / 2]}>
        <mesh position={[-FOOTBALL_PITCH_DIMENSIONS.goalWidth / 2, FOOTBALL_PITCH_DIMENSIONS.goalHeight / 2, 0]}>
          <cylinderGeometry args={[0.04, 0.04, FOOTBALL_PITCH_DIMENSIONS.goalHeight, 12]} />
          <meshStandardMaterial color="#f8fafc" metalness={0.7} roughness={0.2} />
        </mesh>
        <mesh position={[FOOTBALL_PITCH_DIMENSIONS.goalWidth / 2, FOOTBALL_PITCH_DIMENSIONS.goalHeight / 2, 0]}>
          <cylinderGeometry args={[0.04, 0.04, FOOTBALL_PITCH_DIMENSIONS.goalHeight, 12]} />
          <meshStandardMaterial color="#f8fafc" metalness={0.7} roughness={0.2} />
        </mesh>
        <mesh position={[0, FOOTBALL_PITCH_DIMENSIONS.goalHeight, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.04, 0.04, FOOTBALL_PITCH_DIMENSIONS.goalWidth + 0.08, 12]} />
          <meshStandardMaterial color="#f8fafc" metalness={0.7} roughness={0.2} />
        </mesh>
        {/* Goal Net Box */}
        <mesh position={[0, FOOTBALL_PITCH_DIMENSIONS.goalHeight / 2, -FOOTBALL_PITCH_DIMENSIONS.goalDepth / 2]}>
          <boxGeometry args={[FOOTBALL_PITCH_DIMENSIONS.goalWidth, FOOTBALL_PITCH_DIMENSIONS.goalHeight, FOOTBALL_PITCH_DIMENSIONS.goalDepth]} />
          <meshStandardMaterial color="#cbd5e1" wireframe transparent opacity={0.4} />
        </mesh>
      </group>

      {/* 3D Goal Posts South (Side B) */}
      <group position={[0, 0.05, length / 2]}>
        <mesh position={[-FOOTBALL_PITCH_DIMENSIONS.goalWidth / 2, FOOTBALL_PITCH_DIMENSIONS.goalHeight / 2, 0]}>
          <cylinderGeometry args={[0.04, 0.04, FOOTBALL_PITCH_DIMENSIONS.goalHeight, 12]} />
          <meshStandardMaterial color="#f8fafc" metalness={0.7} roughness={0.2} />
        </mesh>
        <mesh position={[FOOTBALL_PITCH_DIMENSIONS.goalWidth / 2, FOOTBALL_PITCH_DIMENSIONS.goalHeight / 2, 0]}>
          <cylinderGeometry args={[0.04, 0.04, FOOTBALL_PITCH_DIMENSIONS.goalHeight, 12]} />
          <meshStandardMaterial color="#f8fafc" metalness={0.7} roughness={0.2} />
        </mesh>
        <mesh position={[0, FOOTBALL_PITCH_DIMENSIONS.goalHeight, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.04, 0.04, FOOTBALL_PITCH_DIMENSIONS.goalWidth + 0.08, 12]} />
          <meshStandardMaterial color="#f8fafc" metalness={0.7} roughness={0.2} />
        </mesh>
        {/* Goal Net Box */}
        <mesh position={[0, FOOTBALL_PITCH_DIMENSIONS.goalHeight / 2, FOOTBALL_PITCH_DIMENSIONS.goalDepth / 2]}>
          <boxGeometry args={[FOOTBALL_PITCH_DIMENSIONS.goalWidth, FOOTBALL_PITCH_DIMENSIONS.goalHeight, FOOTBALL_PITCH_DIMENSIONS.goalDepth]} />
          <meshStandardMaterial color="#cbd5e1" wireframe transparent opacity={0.4} />
        </mesh>
      </group>

      {/* HTML Overlay Billboard above the Football Pitch */}
      <Html position={[0, 3.2, 0]} center distanceFactor={11}>
        <div 
          onClick={onSelect}
          className={`flex flex-col items-center select-none cursor-pointer p-3 rounded-xl border text-center shadow-xl transition duration-200 w-[160px] ${
            isSelected 
              ? 'bg-slate-900/98 border-emerald-500 scale-105 shadow-emerald-500/20 ring-2 ring-emerald-400' 
              : 'bg-slate-950/95 border-slate-800 hover:border-slate-650'
          }`}
        >
          <div className="flex items-center gap-1.5 justify-center w-full">
            <span className="text-[10px] text-emerald-400 font-extrabold uppercase tracking-wider truncate max-w-[125px]">
              ⚽ {venue.name}
            </span>
            {activeMatch && (activeMatch.status === 'LIVE' || activeMatch.status === 'UNDER_REVIEW') && (
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 live-dot-slow" />
            )}
          </div>
          
          {activeMatch ? (
            <div className="mt-1.5 space-y-1 border-t border-slate-850 pt-1.5 w-full">
              <div className="text-[11px] font-bold text-white truncate max-w-[145px]">
                {getParticipantDisplayName(activeMatch.participant_a, 'Team A')}
              </div>
              <div className="text-sm font-black text-emerald-400 font-mono tracking-wider py-0.5">
                {liveScoreText}
              </div>
              <div className="text-[11px] font-bold text-white truncate max-w-[145px]">
                {getParticipantDisplayName(activeMatch.participant_b, 'Team B')}
              </div>
              <div className="pt-0.5">
                <span className={`inline-block px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider ${
                  activeMatch.status === 'LIVE' 
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
                    : activeMatch.status === 'COMPLETED'
                    ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                    : 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                }`}>
                  {phaseText}
                </span>
              </div>
            </div>
          ) : (
            <div className="mt-1.5 text-[9px] text-gray-500 font-extrabold uppercase tracking-wider border-t border-slate-850 pt-1.5 w-full">
              Idle Pitch
            </div>
          )}
        </div>
      </Html>
    </group>
  );
}

// -------------------------------------------------------------
// 3. CAMERA CONTROLLER
// -------------------------------------------------------------
function CameraController({
  selectedIndex,
  totalVenues,
  isPitchMode,
  controlsRef
}: {
  selectedIndex: number | null;
  totalVenues: number;
  isPitchMode: boolean;
  controlsRef: React.RefObject<any>;
}) {
  useFrame((state) => {
    const targetPos = new THREE.Vector3();
    const targetLookAt = new THREE.Vector3();

    if (selectedIndex !== null) {
      const { x, z } = getVenueGridPosition(selectedIndex, totalVenues, isPitchMode);
      const focusHeight = isPitchMode ? 9.5 : 7.2;
      const focusDepth = isPitchMode ? 13.5 : 10.2;
      targetPos.set(x, focusHeight, z + focusDepth);
      targetLookAt.set(x, 0, z);
    } else {
      const colsCount = totalVenues <= 3 ? totalVenues : Math.ceil(totalVenues / 2);
      const rowsCount = totalVenues <= 3 ? 1 : 2;
      const multiplier = isPitchMode ? 1.3 : 1.0;
      const defaultHeight = Math.max(10 * multiplier, (colsCount * 5.5 + rowsCount * 3.5) * multiplier);
      const defaultDepth = Math.max(13 * multiplier, (colsCount * 7.5 + rowsCount * 4.5) * multiplier);
      targetPos.set(0, defaultHeight, defaultDepth);
      targetLookAt.set(0, 0, 0);
    }

    state.camera.position.lerp(targetPos, 0.05);

    if (controlsRef.current) {
      controlsRef.current.target.lerp(targetLookAt, 0.05);
      controlsRef.current.update();
    } else {
      state.camera.lookAt(targetLookAt);
    }
  });

  return null;
}

// -------------------------------------------------------------
// 4. MAIN LIVE VENUE MAP COMPONENT
// -------------------------------------------------------------
export default function LiveVenueMap({
  matches,
  courts,
  venues: propVenues,
  activeScorers = {},
  onCourtSelect,
  sport
}: LiveVenueMapProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const controlsRef = useRef<any>(null);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
      setReducedMotion(mql.matches);
      const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
      mql.addEventListener('change', handler);
      return () => mql.removeEventListener('change', handler);
    }
  }, []);

  // Normalize venue targets
  const unifiedVenues: VenueTarget[] = React.useMemo(() => {
    if (propVenues && propVenues.length > 0) {
      return propVenues;
    }
    if (courts && courts.length > 0) {
      return courts.map((c) => {
        const isPitch = c.venue_type === 'PITCH' || c.sport === 'FOOTBALL' || sport?.toUpperCase() === 'FOOTBALL';
        return {
          ...c,
          venueType: isPitch ? 'PITCH' : 'COURT',
          sport: isPitch ? 'FOOTBALL' : 'BADMINTON'
        };
      });
    }
    return [];
  }, [propVenues, courts, sport]);

  const hasPitches = unifiedVenues.some((v) => v.venueType === 'PITCH');

  const handleSelect = (idx: number | null, venue: VenueTarget | null) => {
    setSelectedIndex(idx);
    if (onCourtSelect) {
      if (idx === null || !venue) {
        onCourtSelect(null);
      } else {
        const activeMatch = matches.find(
          (m) =>
            (venue.match_id && m.id === venue.match_id) ||
            (m.court_id === venue.id && (m.status === 'LIVE' || m.status === 'UNDER_REVIEW' || m.status === 'PAUSED'))
        ) || matches.find(
          (m) =>
            (venue.match_id && m.id === venue.match_id) ||
            (m.court_id === venue.id && m.status === 'READY')
        ) || (venue.match_id ? matches.find(m => m.id === venue.match_id) : null);

        onCourtSelect(activeMatch || { id: `empty-${venue.id}`, court: venue, venue });
      }
    }
  };

  return (
    <div className="w-full h-[380px] sm:h-[460px] md:h-[520px] lg:h-[560px] bg-[#0c1017] border border-[#E4E7EC] rounded-xl overflow-hidden relative shadow-sm">
      <Canvas 
        camera={{ position: [0, hasPitches ? 14 : 9, hasPitches ? 18 : 12], fov: 42 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onClick={() => handleSelect(null, null)}
      >
        <ambientLight intensity={0.65} />
        <directionalLight position={[12, 22, 12]} intensity={1.35} castShadow />
        <pointLight position={[-12, 12, -12]} intensity={0.5} />

        {/* Stadium floor platform context */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
          <planeGeometry args={[300, 300]} />
          <meshStandardMaterial color="#0b0f19" roughness={0.9} metalness={0.1} />
        </mesh>

        {/* Stadium venue grid lines */}
        <gridHelper args={[200, 50, '#1e293b', '#0f172a']} position={[0, 0.005, 0]} />

        {unifiedVenues.map((venue, idx) => {
          const activeMatch = matches.find(
            (m) =>
              (venue.match_id && m.id === venue.match_id) ||
              (m.court_id === venue.id && (m.status === 'LIVE' || m.status === 'UNDER_REVIEW' || m.status === 'PAUSED'))
          ) || matches.find(
            (m) =>
              (venue.match_id && m.id === venue.match_id) ||
              (m.court_id === venue.id && m.status === 'READY')
          ) || (venue.match_id ? matches.find(m => m.id === venue.match_id) : null);

          const isScorerActive = activeMatch ? !!activeScorers[activeMatch.id] : false;

          if (venue.venueType === 'PITCH') {
            return (
              <FootballPitchMesh
                key={venue.id || `pitch-${idx}`}
                venue={venue}
                activeMatch={activeMatch}
                isScorerActive={isScorerActive}
                index={idx}
                totalVenues={unifiedVenues.length}
                isSelected={selectedIndex === idx}
                onSelect={() => handleSelect(idx, venue)}
                reducedMotion={reducedMotion}
              />
            );
          }

          return (
            <BadmintonCourtMesh
              key={venue.id || `court-${idx}`}
              venue={venue}
              activeMatch={activeMatch}
              isScorerActive={isScorerActive}
              index={idx}
              totalVenues={unifiedVenues.length}
              isSelected={selectedIndex === idx}
              onSelect={() => handleSelect(idx, venue)}
              reducedMotion={reducedMotion}
            />
          );
        })}

        <CameraController 
          selectedIndex={selectedIndex} 
          totalVenues={unifiedVenues.length} 
          isPitchMode={hasPitches}
          controlsRef={controlsRef} 
        />
        <OrbitControls 
          ref={controlsRef}
          enableZoom={true} 
          enablePan={false}
          maxPolarAngle={Math.PI / 2.2}
          minDistance={3}
          maxDistance={50}
        />
      </Canvas>

      {/* Top Left Badge */}
      <div className="absolute top-4 left-4 pointer-events-none bg-white/90 backdrop-blur border border-[#E4E7EC] px-3 py-1.5 rounded-md text-[10px] text-[#344054] font-semibold uppercase tracking-wider shadow-sm flex items-center gap-1.5">
        <span>{hasPitches ? '⚽ 3D Live Stadium & Pitch Map' : '🏸 3D Live Arena Map'}</span>
      </div>

      {/* Bottom Right Controls Help */}
      <div className="absolute bottom-4 right-4 pointer-events-none bg-white/90 backdrop-blur border border-[#E4E7EC] px-3 py-1.5 rounded-md text-[10px] text-[#667085] font-semibold uppercase tracking-wider shadow-sm">
        Drag to rotate | Scroll to zoom | Click to focus
      </div>

      {/* Top Right Reset View Button */}
      {selectedIndex !== null ? (
        <button
          onClick={() => handleSelect(null, null)}
          className="absolute top-4 right-4 bg-[#14966B] hover:bg-[#10805B] text-white text-[10px] font-semibold px-3 py-1.5 rounded-md transition uppercase tracking-wider shadow-sm"
        >
          Reset View
        </button>
      ) : (
        <button
          onClick={() => {
            if (controlsRef.current) {
              controlsRef.current.reset();
            }
          }}
          className="absolute top-4 right-4 bg-white hover:bg-[#F9FAFB] border border-[#D0D5DD] text-[#344054] text-[10px] font-semibold px-3 py-1.5 rounded-md transition uppercase tracking-wider shadow-sm"
        >
          Reset View
        </button>
      )}
    </div>
  );
}
