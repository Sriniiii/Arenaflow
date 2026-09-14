export interface Vector3D {
  x: number;
  y: number;
  z: number;
}

export type SportType = 'BADMINTON' | 'FOOTBALL' | 'TENNIS' | 'VOLLEYBALL' | 'TABLE_TENNIS';

export type MatchStatus =
  | 'SCHEDULED'
  | 'READY'
  | 'LIVE'
  | 'PAUSED'
  | 'COMPLETED'
  | 'FINAL'
  | 'UNDER_REVIEW'
  | 'CANCELLED'
  | 'POSTPONED';

export type MatchOutcome =
  | 'COMPLETED'
  | 'WALKOVER'
  | 'RETIREMENT'
  | 'DEFAULT'
  | 'ABANDONED';

export interface ScoreState {
  scoreA: number;
  scoreB: number;
  winnerId?: string;
  isCompleted: boolean;
}

export interface PlayerProfile {
  id: string;
  fullName: string;
  displayName?: string;
  gender?: string;
}

export interface FootballCategoryRulesConfig {
  regulationHalfMinutes?: number;
  extraTimeEnabled?: boolean;
  extraTimeHalfMinutes?: number;
  penaltyShootoutEnabled?: boolean;
  maxSubstitutions?: number;
  allowDraw?: boolean;
  playersPerTeam?: number;
  pointsPerWin?: number;
  pointsPerDraw?: number;
  pointsPerLoss?: number;
  tieBreakOrder?: string[];
}

