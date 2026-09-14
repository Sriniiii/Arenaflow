import { Vector3D } from '@arena-flow/types';

export interface CourtDimensions {
  length: number;
  width: number;
  netHeight: number;
  netWidth: number;
}

export const BADMINTON_COURT_DIMENSIONS: CourtDimensions = {
  length: 13.4,
  width: 6.1,
  netHeight: 1.55,
  netWidth: 6.1,
};

export interface PitchDimensions {
  length: number;
  width: number;
  penaltyBoxLength: number;
  penaltyBoxWidth: number;
  goalBoxLength: number;
  goalBoxWidth: number;
  centerCircleRadius: number;
  goalWidth: number;
  goalHeight: number;
  goalDepth: number;
}

export const FOOTBALL_PITCH_DIMENSIONS: PitchDimensions = {
  length: 20.0,
  width: 12.0,
  penaltyBoxLength: 3.5,
  penaltyBoxWidth: 7.0,
  goalBoxLength: 1.5,
  goalBoxWidth: 4.0,
  centerCircleRadius: 2.5,
  goalWidth: 3.0,
  goalHeight: 1.0,
  goalDepth: 0.6,
};

export function getBadmintonCourtLines() {
  return {
    outerBoundary: [
      { x: -3.05, y: 0, z: -6.7 },
      { x: 3.05, y: 0, z: -6.7 },
      { x: 3.05, y: 0, z: 6.7 },
      { x: -3.05, y: 0, z: 6.7 },
      { x: -3.05, y: 0, z: -6.7 },
    ],
    netLine: [
      { x: -3.05, y: 0, z: 0 },
      { x: 3.05, y: 0, z: 0 },
    ],
  };
}

