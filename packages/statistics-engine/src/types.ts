import { MatchStatus, ScoreState } from '@arena-flow/types';

/**
 * Standard Standing Entry for Round Robin and Group Stages
 */
export interface StandingEntry {
  id?: string;
  standings_id?: string;
  participant_id: string;
  participantId?: string; // camelCase alias
  participant_name?: string;
  participantName?: string;
  played: number;
  won: number;
  lost: number;
  draws?: number;
  drawn?: number;
  points?: number; // Total league points (e.g. 3 for win, 1 for draw in football)
  league_points?: number;
  points_for: number; // Badminton points or Football Goals For
  pointsFor?: number; // camelCase alias
  points_against: number; // Badminton points conceded or Football Goals Against
  pointsAgainst?: number; // camelCase alias
  points_diff: number;
  pointDifference?: number; // camelCase alias
  goals_for?: number; // Football Goals For
  goalsFor?: number;
  goals_against?: number; // Football Goals Against
  goalsAgainst?: number;
  goal_diff?: number; // Football Goal Difference
  goal_difference?: number;
  goalDifference?: number;
  fair_play_points?: number; // Football Fair Play Points (negative penalty for cards)
  fairPlayPoints?: number;
  yellow_cards?: number;
  yellowCards?: number;
  second_yellows?: number;
  secondYellows?: number;
  red_cards?: number;
  redCards?: number;
  games_won: number;
  gamesWon?: number; // camelCase alias
  games_lost: number;
  gamesLost?: number; // camelCase alias
  games_diff: number;
  gameDifference?: number; // camelCase alias
  win_percentage: number;
  winPercentage?: number; // camelCase alias
  rank: number;
  is_manually_resolved: boolean;
  manual_rank_override?: number | null;
  tieBreakReason?: string;
  tieBreakDetails?: {
    ruleApplied: string;
    comparedWith?: string;
    valuesCompared?: string;
  };
  qualificationStatus?: 'QUALIFIED' | 'ELIMINATED' | 'PENDING' | null;
}

export interface FairPlayConfig {
  yellowCardWeight: number; // default: -1
  secondYellowWeight: number; // default: -3 (net total penalty for 2 yellows resulting in dismissal)
  directRedCardWeight: number; // default: -4
  yellowPlusDirectRedWeight: number; // default: -5
}

export const DEFAULT_FAIR_PLAY_CONFIG: FairPlayConfig = {
  yellowCardWeight: -1,
  secondYellowWeight: -3,
  directRedCardWeight: -4,
  yellowPlusDirectRedWeight: -5,
};

export interface StandingsOptions {
  sport?: 'BADMINTON' | 'FOOTBALL' | string;
  pointsPerWin?: number;
  pointsPerDraw?: number;
  pointsPerLoss?: number;
  tieBreakOrder?: string[];
  fairPlayConfig?: Partial<FairPlayConfig>;
}

/**
 * Football Specific Player Statistics
 */
export interface FootballPlayerStats {
  playerId: string;
  playerName?: string;
  teamId?: string;
  teamName?: string;
  matchesPlayed: number;
  matchesWon: number;
  matchesDrawn: number;
  matchesLost: number;
  appearances: number;
  starts: number;
  substitutionsIn: number;
  substitutionsOut: number;
  minutesPlayed: number | null;
  goals: number; // Excludes shootout penalty kicks
  assists: number;
  yellowCards: number;
  secondYellows: number;
  redCards: number; // Total red cards
  directRedCards: number;
  ownGoals: number;
  cleanSheetAppearances: number;
  winPercentage: number;
  recentForm: FormResultType[];
  formDetails?: FormEntry[];
}

/**
 * Football Specific Team Statistics
 */
export interface FootballTeamStats {
  teamId: string;
  teamName?: string;
  matchesPlayed: number;
  matchesWon: number;
  matchesDrawn: number;
  matchesLost: number;
  points: number;
  goalsFor: number; // Excludes shootouts
  goalsAgainst: number; // Excludes shootouts
  goalDifference: number;
  cleanSheets: number;
  winPercentage: number;
  recentForm: FormResultType[];
  formDetails?: FormEntry[];
}

/**
 * Football Specific Analytics
 */
export interface FootballAnalytics {
  totalGoals: number;
  averageGoalsPerMatch: number;
  totalYellowCards: number;
  totalRedCards: number;
  totalSubstitutions: number;
  cleanSheetMatches: number;
  penaltyShootoutDecidedMatches: number;
  extraTimeDecidedMatches: number;
  regulationDecidedMatches: number;
  drawMatches: number;
}

/**
 * Football Leaderboards Result
 */
export interface FootballLeaderboardsResult {
  topScorers: LeaderboardEntry[];
  topAssists: LeaderboardEntry[];
  mostAppearances: LeaderboardEntry[];
  disciplinary: LeaderboardEntry[];
  cleanSheets: LeaderboardEntry[];
  teamStandings?: StandingEntry[];
}

/**
 * Standings Calculation Result
 */
export interface StandingsResult {
  sortedEntries: StandingEntry[];
  hasTies: boolean;
  tieBreakExplanations?: Record<string, string>;
}

/**
 * Recent Form Values
 */
export type FormResultType = 'W' | 'L' | 'D' | 'W.O.' | 'DEFAULT' | 'RET' | 'BYE';

export interface FormEntry {
  matchId: string;
  result: FormResultType;
  outcome?: string | null;
  isWin: boolean;
  opponentId?: string | null;
  opponentName?: string | null;
  date?: string | null;
  scoreDisplay?: string;
}

/**
 * Player Career / Tournament Statistics
 */
export interface PlayerStats {
  playerId: string;
  playerName?: string;
  matchesPlayed: number;
  matchesWon: number;
  matchesLost: number;
  winPercentage: number;
  gamesPlayed: number;
  gamesWon: number;
  gamesLost: number;
  gameDifference: number;
  gameWinPercentage: number;
  pointsScored: number;
  pointsConceded: number;
  pointDifference: number;
  averagePointsPerMatch: number;
  averagePointsPerGame: number;
  averagePointsConcededPerGame: number;
  longestWinningStreak: number;
  currentWinningStreak: number;
  longestLosingStreak: number;
  currentLosingStreak: number;
  recentForm: FormResultType[];
  formDetails?: FormEntry[];
  walkoversReceived: number;
  walkoversSuffered: number;
  defaultsReceived: number;
  defaultsSuffered: number;
  retirementsReceived: number;
  retirementsGiven: number;
  byes: number;
  tournamentAppearances: number;
}

/**
 * Head-to-Head Individual Game Score
 */
export interface HeadToHeadGameScore {
  gameNumber: number;
  playerAScore: number;
  playerBScore: number;
}

/**
 * Head-to-Head Individual Match Summary
 */
export interface HeadToHeadMatchSummary {
  matchId: string;
  date?: string | null;
  winnerId?: string | null;
  outcome?: string | null;
  categoryName?: string | null;
  scores: HeadToHeadGameScore[];
}

/**
 * Head-to-Head Comparison Result
 */
export interface HeadToHeadStats {
  playerAId: string;
  playerBId: string;
  playerAName?: string;
  playerBName?: string;
  matchesPlayed: number;
  playerAWins: number;
  playerBWins: number;
  playerAWinPercentage: number;
  playerBWinPercentage: number;
  playerAGamesWon: number;
  playerBGamesWon: number;
  playerAPoints: number;
  playerBPoints: number;
  pointDifferential: number;
  mostRecentWinner: string | null;
  recentMeetings: HeadToHeadMatchSummary[];
  matchHistory: HeadToHeadMatchSummary[];
}

/**
 * Category Level Statistics Breakdown
 */
export interface CategoryStats {
  categoryId: string;
  categoryName?: string;
  format?: string;
  participantCount: number;
  totalMatches: number;
  completedMatches: number;
  liveMatches: number;
  scheduledMatches: number;
  pausedMatches: number;
  gamesPlayed: number;
  pointsPlayed: number;
  averageMatchDuration: number | null;
  averagePointsPerGame: number;
  averageGamesPerMatch: number;
  walkoverCount: number;
  defaultCount: number;
  retirementCount: number;
  byeCount: number;
  normalCompletedCount: number;
  totalGames?: number; // legacy alias
  totalPoints?: number; // legacy alias
  standings?: StandingsResult;
}

/**
 * Court Level Utilization Breakdown
 */
export interface CourtUtilizationStats {
  courtId: string;
  courtName?: string;
  matchesAssigned: number;
  matchesCompleted: number;
  isCurrentlyInUse: boolean;
}

/**
 * Badminton Specific Analytics
 */
export interface ClosestGameRecord {
  matchId: string;
  gameNumber: number;
  scoreA: number;
  scoreB: number;
  margin: number;
}

export interface BadmintonAnalytics {
  totalRallies: number;
  averageRallyPointsPerGame: number;
  gamesWon21Plus: number;
  gamesWon11To20: number;
  deuceGames: number;
  capped30PointGames: number;
  straightGameWins: number;
  threeGameWins: number;
  comebackWins: number;
  closestGames: ClosestGameRecord[];
  largestWinningMargin: ClosestGameRecord | null;
}

/**
 * Match Specific Analytics
 */
export interface MatchAnalytics {
  matchId: string;
  participantA: { id: string; name?: string };
  participantB: { id: string; name?: string } | null;
  winnerId: string | null;
  outcome: string | null;
  status: string;
  totalGames: number;
  totalPoints: number;
  pointDifferential: number;
  gameDifferential: number;
  isStraightGames: boolean;
  isThreeGames: boolean;
  largestGameMargin: number;
  closestGameMargin: number;
  durationMinutes: number | null;
  startTime: string | null;
  completionTime: string | null;
  courtId: string | null;
  roundId: string | null;
  categoryId: string | null;
}

/**
 * Tournament Records & Highlights
 */
export interface TournamentRecords {
  longestMatchDuration: { matchId: string; durationMinutes: number; participantAName?: string; participantBName?: string } | null;
  shortestMatchDuration: { matchId: string; durationMinutes: number; participantAName?: string; participantBName?: string } | null;
  largestGameMargin: { matchId: string; gameNumber: number; winnerScore: number; loserScore: number; margin: number } | null;
  closestGame: { matchId: string; gameNumber: number; winnerScore: number; loserScore: number; margin: number } | null;
  mostPointsInAGame: { matchId: string; gameNumber: number; totalPoints: number; scoreA: number; scoreB: number } | null;
  mostPointsInAMatch: { matchId: string; totalPoints: number } | null;
  longestWinningStreak: { playerId: string; playerName?: string; streak: number } | null;
  mostWins: { playerId: string; playerName?: string; wins: number } | null;
  mostGamesPlayed: { playerId: string; playerName?: string; games: number } | null;
}

/**
 * Leaderboard Entry
 */
export interface LeaderboardEntry {
  rank: number;
  playerId: string;
  playerName?: string;
  value: number;
  secondaryValue?: number;
  matchesPlayed?: number;
}

/**
 * Leaderboards Result
 */
export interface LeaderboardsResult {
  minMatchesThreshold: number;
  mostWins: LeaderboardEntry[];
  highestWinPercentage: LeaderboardEntry[];
  mostGamesWon: LeaderboardEntry[];
  highestGameWinPercentage: LeaderboardEntry[];
  mostPointsScored: LeaderboardEntry[];
  bestPointDifferential: LeaderboardEntry[];
  longestWinningStreak: LeaderboardEntry[];
  mostMatchesPlayed: LeaderboardEntry[];
}

/**
 * Tournament Aggregated Operational & Performance Statistics
 */
export interface TournamentStats {
  totalParticipants: number;
  registeredParticipants: number;
  approvedParticipants: number;
  totalMatches: number;
  scheduledMatches: number;
  readyMatches: number;
  liveMatches: number;
  pausedMatches: number;
  completedMatches: number;
  finalizedMatches: number;
  matchesUnderReview: number;
  cancelledMatches: number;
  totalGames: number;
  totalPoints: number;
  averagePointsPerGame: number;
  averageGamesPerMatch: number;
  averageMatchDurationMinutes: number | null;
  averagePointsPerMatch: number; // legacy alias
  walkovers: number;
  defaults: number;
  retirements: number;
  byes: number;
  normalCompletedMatches: number;
  completionPercentage: number;
  liveMatchPercentage: number;
  completedMatchPercentage: number;
  categoryStats: CategoryStats[];
  courtUtilization?: CourtUtilizationStats[];
  records?: TournamentRecords;
  leaderboards?: LeaderboardsResult;
  badmintonAnalytics?: BadmintonAnalytics;
}

/**
 * Minimal Game Shape accepted by statistics engine
 */
export interface GameDataInput {
  game_number?: number;
  gameNumber?: number;
  participant_a_score?: number | null;
  participant_b_score?: number | null;
  scoreA?: number | null;
  scoreB?: number | null;
  winner_id?: string | null;
  winnerId?: string | null;
  status?: string | null;
  isCompleted?: boolean | null;
}

/**
 * Minimal Member Shape accepted by statistics engine
 */
export interface MemberDataInput {
  player_id?: string | null;
  playerId?: string | null;
  player?: {
    id: string;
    full_name?: string;
    display_name?: string;
    gender?: string;
  } | null;
}

/**
 * Minimal Participant Shape accepted by statistics engine
 */
export interface ParticipantDataInput {
  id: string;
  name?: string;
  category_id?: string | null;
  participant_type?: 'INDIVIDUAL' | 'TEAM' | 'SINGLES' | 'DOUBLES' | string;
  status?: string;
  members?: MemberDataInput[] | null;
}

/**
 * Minimal Match Shape accepted by statistics engine
 */
export interface MatchDataInput {
  id: string;
  category_id?: string | null;
  court_id?: string | null;
  round_id?: string | null;
  participant_a_id?: string | null;
  participant_b_id?: string | null;
  winner_id?: string | null;
  status: string;
  outcome?: 'COMPLETED' | 'WALKOVER' | 'RETIREMENT' | 'DEFAULT' | 'BYE' | string | null;
  score_a?: number | null;
  score_b?: number | null;
  scoreA?: number | null;
  scoreB?: number | null;
  halftime_score?: { scoreA?: number; scoreB?: number; score_a?: number; score_b?: number } | null;
  extra_time_score?: { scoreA?: number; scoreB?: number; score_a?: number; score_b?: number } | null;
  match_phase?: string | null;
  shootout_score?: any;
  lineup_data?: any;
  scheduled_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  ended_at?: string | null;
  duration_minutes?: number | null;
  games?: GameDataInput[] | null;
  events?: any[] | null;
  match_events?: any[] | null;
  participant_a?: ParticipantDataInput | null;
  participant_b?: ParticipantDataInput | null;
  court?: { id?: string; name?: string } | null;
  category?: {
    id?: string;
    name?: string;
    format?: string;
    sport?: string;
    rules_config?: any;
  } | null;
}
