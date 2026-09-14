// Re-export core types
export * from './types';

// Re-export standings & tie-break calculations
export {
  calculateStandings,
  sortStandings,
  generateTieBreakExplanations,
  isMatchCompleted,
  extractParticipantId,
  extractParticipantName,
} from './standings';

// Re-export player statistics, streaks & form
export {
  calculatePlayerStats,
  calculateRecentForm,
  isPlayerInParticipant,
} from './player';

// Re-export head-to-head calculations
export {
  calculateHeadToHead,
} from './h2h';

// Re-export badminton-specific analytics
export {
  calculateBadmintonAnalytics,
} from './badminton';

// Re-export match-level analytics
export {
  calculateMatchAnalytics,
} from './match';

// Re-export tournament, category, leaderboards & records
export {
  calculateTournamentStats,
  calculateCategoryStats,
  calculateTournamentRecords,
  calculateLeaderboards,
} from './tournament';

// Re-export football-specific analytics & player/team statistics
export {
  calculateFootballPlayerStats,
  calculateFootballTeamStats,
  calculateFootballAnalytics,
  calculateFootballLeaderboards,
} from './football';

// Re-export sport abstraction & registry
export {
  ISportAnalyticsProvider,
  BadmintonAnalyticsProvider,
  FootballAnalyticsProvider,
  SportAnalyticsRegistry,
} from './abstraction';
