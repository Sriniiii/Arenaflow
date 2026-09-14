import {
  ISportRules,
  MatchEvent,
  MatchSide
} from '../../core/types';

export type FootballMatchPhase =
  | 'PRE_MATCH'
  | 'FIRST_HALF'
  | 'HALFTIME'
  | 'SECOND_HALF'
  | 'FULL_TIME'
  | 'EXTRA_TIME_FIRST_HALF'
  | 'EXTRA_TIME_HALFTIME'
  | 'EXTRA_TIME_SECOND_HALF'
  | 'PENALTY_SHOOTOUT'
  | 'COMPLETED'
  | 'ABANDONED';

export type FootballDecisionMethod =
  | 'REGULATION'
  | 'EXTRA_TIME'
  | 'PENALTY_SHOOTOUT'
  | 'WALKOVER'
  | 'DEFAULT'
  | 'RETIREMENT'
  | 'ABANDONED';

export type FootballEventType =
  | 'SET_LINEUP'
  | 'START_FIRST_HALF'
  | 'END_FIRST_HALF'
  | 'START_SECOND_HALF'
  | 'END_SECOND_HALF'
  | 'START_EXTRA_TIME_FIRST_HALF'
  | 'END_EXTRA_TIME_FIRST_HALF'
  | 'START_EXTRA_TIME_SECOND_HALF'
  | 'END_EXTRA_TIME_SECOND_HALF'
  | 'START_PENALTY_SHOOTOUT'
  | 'PENALTY_KICK'
  | 'GOAL'
  | 'OWN_GOAL'
  | 'YELLOW_CARD'
  | 'RED_CARD'
  | 'SUBSTITUTION'
  | 'PAUSE_MATCH'
  | 'RESUME_MATCH'
  | 'DECLARE_OUTCOME'
  | 'UNDO';

export interface FootballPlayerInfo {
  id: string;
  name?: string;
  jerseyNumber?: number;
  position?: 'GK' | 'DEF' | 'MID' | 'FWD' | 'SUB' | string;
  isSuspended?: boolean;
}

export interface FootballTeamInfo {
  id: string;
  name?: string;
  squad: FootballPlayerInfo[];
}

export interface FootballLineup {
  startingXI: string[];
  substitutes: string[];
  captainId?: string;
  positions?: Record<string, string>;
}

export interface FootballMatchConfig {
  participantA?: FootballTeamInfo;
  participantB?: FootballTeamInfo;
  initialLineupA?: FootballLineup;
  initialLineupB?: FootballLineup;
  regulationHalfMinutes: number; // default: 45
  extraTimeEnabled: boolean; // default: false
  extraTimeHalfMinutes: number; // default: 15
  penaltyShootoutEnabled: boolean; // default: false
  maxSubstitutions: number; // default: 5
  allowDraw: boolean; // default: true
  playersPerTeam: number; // default: 11
  minimumStartingXI: number; // default: 11
}

export const DEFAULT_FOOTBALL_CONFIG: FootballMatchConfig = {
  regulationHalfMinutes: 45,
  extraTimeEnabled: false,
  extraTimeHalfMinutes: 15,
  penaltyShootoutEnabled: false,
  maxSubstitutions: 5,
  allowDraw: true,
  playersPerTeam: 11,
  minimumStartingXI: 11
};

export interface FootballCardRecord {
  id: string;
  team: MatchSide;
  playerId: string;
  minute: number;
  addedMinute?: number;
  type: 'YELLOW' | 'RED';
  isSecondYellow?: boolean;
  reason?: string;
}

export interface FootballGoalRecord {
  id: string;
  team: MatchSide; // The team that gets credited with the goal (+1 score)
  scorerPlayerId?: string; // Player who scored (undefined if own goal or unknown)
  assistPlayerId?: string;
  isOwnGoal: boolean;
  concedingPlayerId?: string; // Player who scored own goal against their own team
  concedingTeam?: MatchSide; // Team of the player who scored the own goal
  minute: number;
  addedMinute?: number;
  phase: FootballMatchPhase;
}

export interface FootballSubstitutionRecord {
  id: string;
  team: MatchSide;
  playerOffId: string;
  playerOnId: string;
  minute: number;
  addedMinute?: number;
}

export interface PenaltyShootoutKick {
  id: string;
  team: MatchSide;
  kickerPlayerId: string;
  kickNumber: number;
  scored: boolean;
}

export interface FootballShootoutState {
  kicks: PenaltyShootoutKick[];
  scoreA: number; // Shootout score A only
  scoreB: number; // Shootout score B only
  isCompleted: boolean;
  winnerId?: 'PARTICIPANT_A' | 'PARTICIPANT_B';
}

export interface FootballTeamState {
  teamId: string;
  lineup: FootballLineup | null;
  activePlayersOnPitch: string[];
  benchPlayers: string[];
  substitutedOutPlayers: string[];
  sentOffPlayers: string[];
  substitutionsCount: number;
  yellowCards: Record<string, number>;
  redCards: string[];
  captainId?: string;
}

export interface FootballMatchState {
  phase: FootballMatchPhase;
  scoreA: number; // Official regulation/ET score A
  scoreB: number; // Official regulation/ET score B
  halftimeScore: { scoreA: number; scoreB: number } | null;
  extraTimeScore: { scoreA: number; scoreB: number } | null;
  shootoutState: FootballShootoutState | null;
  goals: FootballGoalRecord[];
  cards: FootballCardRecord[];
  substitutions: FootballSubstitutionRecord[];
  teamAState: FootballTeamState;
  teamBState: FootballTeamState;
  winnerId?: 'PARTICIPANT_A' | 'PARTICIPANT_B' | 'DRAW';
  decisionMethod?: FootballDecisionMethod;
  isCompleted: boolean;
  isAbandoned: boolean;
  isPaused: boolean;
  eventHistory: MatchEvent[];
  processedEventIds: string[];
  config: FootballMatchConfig;
}

/**
 * Pure, authoritative lineup validation with zero database/browser/network dependencies.
 * Enforces explicit Standard Football policy: exactly playersPerTeam (default 11) starters.
 */
export function validateLineup(
  lineup: FootballLineup,
  teamInfo?: FootballTeamInfo,
  playersPerTeam: number = 11
): { isValid: boolean; reason?: string } {
  if (!lineup) {
    return { isValid: false, reason: 'Lineup is required' };
  }

  const { startingXI, substitutes, captainId } = lineup;

  if (!Array.isArray(startingXI) || !Array.isArray(substitutes)) {
    return { isValid: false, reason: 'startingXI and substitutes must be arrays' };
  }

  // 1. Check Starting XI count (Standard Football: exactly playersPerTeam)
  const expectedStartingCount = playersPerTeam;

  if (startingXI.length !== expectedStartingCount) {
    return {
      isValid: false,
      reason: `Starting XI must contain exactly ${expectedStartingCount} players, got ${startingXI.length}`
    };
  }

  // 2. Check for duplicate players across Starting XI and substitutes
  const allPlayerIds = [...startingXI, ...substitutes];
  const uniquePlayerIds = new Set(allPlayerIds);
  if (uniquePlayerIds.size !== allPlayerIds.length) {
    return { isValid: false, reason: 'Lineup contains duplicate players' };
  }

  // 3. If squad is provided, verify all players belong to squad and are not suspended
  if (teamInfo?.squad && teamInfo.squad.length > 0) {
    const squadMap = new Map(teamInfo.squad.map((p) => [p.id, p]));

    for (const pId of allPlayerIds) {
      const pInfo = squadMap.get(pId);
      if (!pInfo) {
        return { isValid: false, reason: `Player ${pId} is not in team squad` };
      }
      if (pInfo.isSuspended) {
        return { isValid: false, reason: `Player ${pId} is suspended and cannot be selected` };
      }
    }
  }

  // 4. Captain must be in Starting XI
  if (captainId && startingXI.length > 0) {
    if (!startingXI.includes(captainId)) {
      return { isValid: false, reason: `Captain (${captainId}) must be in the Starting XI` };
    }
  }

  return { isValid: true };
}

/**
 * Normalizes event types to canonical FootballEventType
 */
export function normalizeFootballEventType(rawType: string): FootballEventType {
  const upper = (rawType || '').toUpperCase().trim();
  switch (upper) {
    case 'START_MATCH':
    case 'START_FIRST_HALF':
      return 'START_FIRST_HALF';
    case 'HALFTIME':
    case 'END_FIRST_HALF':
      return 'END_FIRST_HALF';
    case 'SECOND_HALF_START':
    case 'START_SECOND_HALF':
      return 'START_SECOND_HALF';
    case 'END_REGULATION':
    case 'END_SECOND_HALF':
      return 'END_SECOND_HALF';
    case 'EXTRA_TIME_START':
    case 'START_EXTRA_TIME_FIRST_HALF':
      return 'START_EXTRA_TIME_FIRST_HALF';
    case 'EXTRA_TIME_HALFTIME':
    case 'END_EXTRA_TIME_FIRST_HALF':
      return 'END_EXTRA_TIME_FIRST_HALF';
    case 'EXTRA_TIME_SECOND_HALF_START':
    case 'START_EXTRA_TIME_SECOND_HALF':
      return 'START_EXTRA_TIME_SECOND_HALF';
    case 'EXTRA_TIME_END':
    case 'END_EXTRA_TIME_SECOND_HALF':
      return 'END_EXTRA_TIME_SECOND_HALF';
    case 'START_PENALTY_SHOOTOUT':
      return 'START_PENALTY_SHOOTOUT';
    case 'PENALTY_KICK':
      return 'PENALTY_KICK';
    case 'GOAL':
      return 'GOAL';
    case 'OWN_GOAL':
      return 'OWN_GOAL';
    case 'YELLOW_CARD':
      return 'YELLOW_CARD';
    case 'RED_CARD':
      return 'RED_CARD';
    case 'SUBSTITUTION':
      return 'SUBSTITUTION';
    case 'MATCH_PAUSED':
    case 'PAUSE_MATCH':
      return 'PAUSE_MATCH';
    case 'MATCH_RESUMED':
    case 'RESUME_MATCH':
      return 'RESUME_MATCH';
    case 'DECLARE_OUTCOME':
      return 'DECLARE_OUTCOME';
    case 'SET_LINEUP':
      return 'SET_LINEUP';
    case 'UNDO':
      return 'UNDO';
    default:
      return upper as FootballEventType;
  }
}

export class FootballRules implements ISportRules<FootballMatchState, MatchEvent> {
  readonly sportId: string = 'FOOTBALL';

  getInitialState(userConfig?: Partial<FootballMatchConfig>): FootballMatchState {
    const config: FootballMatchConfig = {
      ...DEFAULT_FOOTBALL_CONFIG,
      ...userConfig
    };

    const teamAId = config.participantA?.id || 'PARTICIPANT_A';
    const teamBId = config.participantB?.id || 'PARTICIPANT_B';

    const lineupA = config.initialLineupA || null;
    const lineupB = config.initialLineupB || null;

    const teamAState: FootballTeamState = {
      teamId: teamAId,
      lineup: lineupA,
      activePlayersOnPitch: lineupA ? [...lineupA.startingXI] : [],
      benchPlayers: lineupA ? [...lineupA.substitutes] : [],
      substitutedOutPlayers: [],
      sentOffPlayers: [],
      substitutionsCount: 0,
      yellowCards: {},
      redCards: [],
      captainId: lineupA?.captainId
    };

    const teamBState: FootballTeamState = {
      teamId: teamBId,
      lineup: lineupB,
      activePlayersOnPitch: lineupB ? [...lineupB.startingXI] : [],
      benchPlayers: lineupB ? [...lineupB.substitutes] : [],
      substitutedOutPlayers: [],
      sentOffPlayers: [],
      substitutionsCount: 0,
      yellowCards: {},
      redCards: [],
      captainId: lineupB?.captainId
    };

    return {
      phase: 'PRE_MATCH',
      scoreA: 0,
      scoreB: 0,
      halftimeScore: null,
      extraTimeScore: null,
      shootoutState: null,
      goals: [],
      cards: [],
      substitutions: [],
      teamAState,
      teamBState,
      winnerId: undefined,
      decisionMethod: undefined,
      isCompleted: false,
      isAbandoned: false,
      isPaused: false,
      eventHistory: [],
      processedEventIds: [],
      config
    };
  }

  validateEvent(
    state: FootballMatchState,
    event: MatchEvent
  ): { isValid: boolean; reason?: string } {
    if (state.processedEventIds.includes(event.id)) {
      return { isValid: false, reason: 'Event has already been processed' };
    }

    const rawType = event.type || (event as any).event_type || '';
    const eType = normalizeFootballEventType(rawType);
    const meta = event.metadata || (event as any) || {};

    if (eType === 'UNDO') {
      return { isValid: true };
    }

    if (state.isCompleted) {
      return { isValid: false, reason: 'Match is already completed' };
    }

    if (state.isAbandoned) {
      return { isValid: false, reason: 'Match has been abandoned' };
    }

    switch (eType) {
      case 'SET_LINEUP': {
        if (state.phase !== 'PRE_MATCH') {
          return { isValid: false, reason: 'Lineups can only be submitted during PRE_MATCH phase' };
        }
        const teamSide = (meta.team || meta.side || '').toUpperCase() as MatchSide;
        if (teamSide !== 'A' && teamSide !== 'B') {
          return { isValid: false, reason: 'Lineup event must specify team A or B' };
        }
        const lineup = meta.lineup;
        if (!lineup || !Array.isArray(lineup.startingXI) || !Array.isArray(lineup.substitutes)) {
          return { isValid: false, reason: 'Lineup must contain startingXI and substitutes arrays in metadata.lineup' };
        }
        const canonicalLineup: FootballLineup = {
          startingXI: [...lineup.startingXI],
          substitutes: [...lineup.substitutes],
          captainId: lineup.captainId,
          positions: lineup.positions || {}
        };
        const teamInfo = teamSide === 'A' ? state.config.participantA : state.config.participantB;
        return validateLineup(canonicalLineup, teamInfo, state.config.playersPerTeam);
      }

      case 'START_FIRST_HALF': {
        if (state.phase !== 'PRE_MATCH') {
          return { isValid: false, reason: `Cannot start first half from phase: ${state.phase}` };
        }
        return { isValid: true };
      }

      case 'END_FIRST_HALF': {
        if (state.phase !== 'FIRST_HALF') {
          return { isValid: false, reason: `Cannot end first half from phase: ${state.phase}` };
        }
        return { isValid: true };
      }

      case 'START_SECOND_HALF': {
        if (state.phase !== 'HALFTIME') {
          return { isValid: false, reason: `Cannot start second half from phase: ${state.phase}` };
        }
        return { isValid: true };
      }

      case 'END_SECOND_HALF': {
        if (state.phase !== 'SECOND_HALF') {
          return { isValid: false, reason: `Cannot end regulation from phase: ${state.phase}` };
        }
        return { isValid: true };
      }

      case 'START_EXTRA_TIME_FIRST_HALF': {
        if (state.phase !== 'FULL_TIME') {
          return { isValid: false, reason: `Cannot start extra time from phase: ${state.phase}` };
        }
        if (!state.config.extraTimeEnabled) {
          return { isValid: false, reason: 'Extra time is not enabled for this match' };
        }
        if (state.scoreA !== state.scoreB) {
          return { isValid: false, reason: 'Cannot start extra time when regulation is not tied' };
        }
        return { isValid: true };
      }

      case 'END_EXTRA_TIME_FIRST_HALF': {
        if (state.phase !== 'EXTRA_TIME_FIRST_HALF') {
          return { isValid: false, reason: `Cannot end extra time first half from phase: ${state.phase}` };
        }
        return { isValid: true };
      }

      case 'START_EXTRA_TIME_SECOND_HALF': {
        if (state.phase !== 'EXTRA_TIME_HALFTIME') {
          return { isValid: false, reason: `Cannot start extra time second half from phase: ${state.phase}` };
        }
        return { isValid: true };
      }

      case 'END_EXTRA_TIME_SECOND_HALF': {
        if (state.phase !== 'EXTRA_TIME_SECOND_HALF') {
          return { isValid: false, reason: `Cannot end extra time second half from phase: ${state.phase}` };
        }
        return { isValid: true };
      }

      case 'START_PENALTY_SHOOTOUT': {
        if (state.phase !== 'FULL_TIME' && state.phase !== 'EXTRA_TIME_SECOND_HALF') {
          return { isValid: false, reason: `Cannot start penalty shootout from phase: ${state.phase}` };
        }
        if (!state.config.penaltyShootoutEnabled) {
          return { isValid: false, reason: 'Penalty shootout is not enabled for this match' };
        }
        if (state.scoreA !== state.scoreB) {
          return { isValid: false, reason: 'Cannot start shootout when match is not tied' };
        }
        return { isValid: true };
      }

      case 'PENALTY_KICK': {
        if (state.phase !== 'PENALTY_SHOOTOUT') {
          return { isValid: false, reason: 'Penalty kick is only allowed during PENALTY_SHOOTOUT phase' };
        }
        if (state.shootoutState?.isCompleted) {
          return { isValid: false, reason: 'Penalty shootout is already completed' };
        }
        const team = (meta.team || meta.side || '').toUpperCase() as MatchSide;
        if (team !== 'A' && team !== 'B') {
          return { isValid: false, reason: 'Penalty kick must specify team A or B' };
        }
        return { isValid: true };
      }

      case 'GOAL': {
        if (
          state.phase !== 'FIRST_HALF' &&
          state.phase !== 'SECOND_HALF' &&
          state.phase !== 'EXTRA_TIME_FIRST_HALF' &&
          state.phase !== 'EXTRA_TIME_SECOND_HALF'
        ) {
          return { isValid: false, reason: `Goals can only be scored during active play, current phase: ${state.phase}` };
        }
        const team = (meta.team || meta.side || '').toUpperCase() as MatchSide;
        if (team !== 'A' && team !== 'B') {
          return { isValid: false, reason: 'Goal must specify scoring team A or B' };
        }
        const scorerId = meta.scorerPlayerId || meta.playerId;
        const teamState = team === 'A' ? state.teamAState : state.teamBState;
        if (scorerId && teamState.lineup && !teamState.activePlayersOnPitch.includes(scorerId)) {
          return { isValid: false, reason: `Scorer ${scorerId} is not currently active on the pitch` };
        }
        return { isValid: true };
      }

      case 'OWN_GOAL': {
        if (
          state.phase !== 'FIRST_HALF' &&
          state.phase !== 'SECOND_HALF' &&
          state.phase !== 'EXTRA_TIME_FIRST_HALF' &&
          state.phase !== 'EXTRA_TIME_SECOND_HALF'
        ) {
          return { isValid: false, reason: `Own goals can only be scored during active play, current phase: ${state.phase}` };
        }
        const concedingTeam = (meta.concedingTeam || meta.team || meta.side || '').toUpperCase() as MatchSide;
        if (concedingTeam !== 'A' && concedingTeam !== 'B') {
          return { isValid: false, reason: 'Own goal must specify conceding team A or B' };
        }
        const playerPlayerId = meta.playerPlayerId || meta.playerId;
        const concedingTeamState = concedingTeam === 'A' ? state.teamAState : state.teamBState;
        if (playerPlayerId && concedingTeamState.lineup && !concedingTeamState.activePlayersOnPitch.includes(playerPlayerId)) {
          return { isValid: false, reason: `Player ${playerPlayerId} is not currently active on the pitch` };
        }
        return { isValid: true };
      }

      case 'YELLOW_CARD': {
        const team = (meta.team || meta.side || '').toUpperCase() as MatchSide;
        if (team !== 'A' && team !== 'B') {
          return { isValid: false, reason: 'Card must specify team A or B' };
        }
        const playerId = meta.playerId;
        if (!playerId) {
          return { isValid: false, reason: 'Card must specify playerId' };
        }
        const teamState = team === 'A' ? state.teamAState : state.teamBState;
        if (teamState.sentOffPlayers.includes(playerId)) {
          return { isValid: false, reason: `Player ${playerId} has already been sent off` };
        }
        return { isValid: true };
      }

      case 'RED_CARD': {
        const team = (meta.team || meta.side || '').toUpperCase() as MatchSide;
        if (team !== 'A' && team !== 'B') {
          return { isValid: false, reason: 'Card must specify team A or B' };
        }
        const playerId = meta.playerId;
        if (!playerId) {
          return { isValid: false, reason: 'Card must specify playerId' };
        }
        const teamState = team === 'A' ? state.teamAState : state.teamBState;
        if (teamState.sentOffPlayers.includes(playerId)) {
          return { isValid: false, reason: `Player ${playerId} has already been sent off` };
        }
        return { isValid: true };
      }

      case 'SUBSTITUTION': {
        const team = (meta.team || meta.side || '').toUpperCase() as MatchSide;
        if (team !== 'A' && team !== 'B') {
          return { isValid: false, reason: 'Substitution must specify team A or B' };
        }
        const playerOffId = meta.playerOffId;
        const playerOnId = meta.playerOnId;

        if (!playerOffId || !playerOnId) {
          return { isValid: false, reason: 'Substitution must specify playerOffId and playerOnId' };
        }
        if (playerOffId === playerOnId) {
          return { isValid: false, reason: 'playerOffId and playerOnId cannot be the same player' };
        }

        const teamState = team === 'A' ? state.teamAState : state.teamBState;
        const maxSubs = state.config.maxSubstitutions;

        if (teamState.substitutionsCount >= maxSubs) {
          return { isValid: false, reason: `Maximum substitutions reached (${maxSubs})` };
        }

        if (teamState.lineup) {
          if (!teamState.activePlayersOnPitch.includes(playerOffId)) {
            return { isValid: false, reason: `Player coming off (${playerOffId}) is not on the pitch` };
          }
          if (!teamState.benchPlayers.includes(playerOnId)) {
            return { isValid: false, reason: `Player coming on (${playerOnId}) is not on the bench` };
          }
        }
        if (teamState.sentOffPlayers.includes(playerOnId)) {
          return { isValid: false, reason: `Player ${playerOnId} has been sent off and cannot play` };
        }

        return { isValid: true };
      }

      case 'PAUSE_MATCH': {
        if (state.isPaused) {
          return { isValid: false, reason: 'Match is already paused' };
        }
        return { isValid: true };
      }

      case 'RESUME_MATCH': {
        if (!state.isPaused) {
          return { isValid: false, reason: 'Match is not paused' };
        }
        return { isValid: true };
      }

      case 'DECLARE_OUTCOME': {
        const outcome = (meta.outcome || '').toUpperCase();
        if (
          outcome !== 'WALKOVER' &&
          outcome !== 'DEFAULT' &&
          outcome !== 'RETIREMENT' &&
          outcome !== 'ABANDONED' &&
          outcome !== 'COMPLETED'
        ) {
          return { isValid: false, reason: `Invalid outcome: ${outcome}` };
        }
        return { isValid: true };
      }

      default:
        return { isValid: false, reason: `Unknown football event type: ${eType}` };
    }
  }

  applyEvent(state: FootballMatchState, event: MatchEvent): FootballMatchState {
    const rawType = event.type || (event as any).event_type || '';
    const normalizedType = normalizeFootballEventType(rawType);

    const normalizedEvent: MatchEvent = {
      ...event,
      type: normalizedType
    };

    // Deep clone state for strict immutability
    const newState = JSON.parse(JSON.stringify(state)) as FootballMatchState;

    if (!newState.processedEventIds.includes(normalizedEvent.id)) {
      newState.processedEventIds.push(normalizedEvent.id);
    }

    // Handle UNDO: pop last non-undo event and replay from initial state
    if (normalizedEvent.type === 'UNDO') {
      if (newState.eventHistory.length > 0) {
        newState.eventHistory.pop();
      }

      const freshState = this.getInitialState(newState.config);
      freshState.processedEventIds = [...newState.processedEventIds];

      let reconstructed = freshState;
      for (const e of newState.eventHistory) {
        reconstructed = this.applySingleEvent(reconstructed, e);
      }
      return reconstructed;
    }

    return this.applySingleEvent(newState, normalizedEvent);
  }

  private applySingleEvent(
    state: FootballMatchState,
    event: MatchEvent
  ): FootballMatchState {
    const rawType = event.type || (event as any).event_type || '';
    const eType = normalizeFootballEventType(rawType);
    const meta = event.metadata || (event as any) || {};

    if (!state.eventHistory.some((e) => e.id === event.id)) {
      state.eventHistory.push(event);
    }

    switch (eType) {
      case 'SET_LINEUP': {
        const teamSide = (meta.team || meta.side || 'A').toUpperCase() as MatchSide;
        const lineup = meta.lineup;
        if (!lineup || !Array.isArray(lineup.startingXI) || !Array.isArray(lineup.substitutes)) {
          throw new Error(
            `Malformed SET_LINEUP event (id: ${event.id || 'unknown'}): metadata.lineup.startingXI and metadata.lineup.substitutes must be arrays. Received: ${JSON.stringify(meta)}`
          );
        }
        const canonicalLineup: FootballLineup = {
          startingXI: [...lineup.startingXI],
          substitutes: [...lineup.substitutes],
          captainId: lineup.captainId,
          positions: lineup.positions || {}
        };
        const teamState = teamSide === 'A' ? state.teamAState : state.teamBState;

        teamState.lineup = canonicalLineup;
        teamState.activePlayersOnPitch = [...canonicalLineup.startingXI];
        teamState.benchPlayers = [...canonicalLineup.substitutes];
        teamState.captainId = canonicalLineup.captainId;
        break;
      }

      case 'START_FIRST_HALF': {
        state.phase = 'FIRST_HALF';
        state.isPaused = false;
        break;
      }

      case 'END_FIRST_HALF': {
        state.phase = 'HALFTIME';
        state.halftimeScore = { scoreA: state.scoreA, scoreB: state.scoreB };
        break;
      }

      case 'START_SECOND_HALF': {
        state.phase = 'SECOND_HALF';
        state.isPaused = false;
        break;
      }

      case 'END_SECOND_HALF': {
        state.phase = 'FULL_TIME';

        if (state.scoreA > state.scoreB) {
          state.winnerId = 'PARTICIPANT_A';
          state.decisionMethod = 'REGULATION';
          state.isCompleted = true;
          state.phase = 'COMPLETED';
        } else if (state.scoreB > state.scoreA) {
          state.winnerId = 'PARTICIPANT_B';
          state.decisionMethod = 'REGULATION';
          state.isCompleted = true;
          state.phase = 'COMPLETED';
        } else {
          // Score is tied
          if (state.config.allowDraw && !state.config.extraTimeEnabled && !state.config.penaltyShootoutEnabled) {
            state.winnerId = 'DRAW';
            state.decisionMethod = 'REGULATION';
            state.isCompleted = true;
            state.phase = 'COMPLETED';
          }
        }
        break;
      }

      case 'START_EXTRA_TIME_FIRST_HALF': {
        state.phase = 'EXTRA_TIME_FIRST_HALF';
        state.isPaused = false;
        break;
      }

      case 'END_EXTRA_TIME_FIRST_HALF': {
        state.phase = 'EXTRA_TIME_HALFTIME';
        break;
      }

      case 'START_EXTRA_TIME_SECOND_HALF': {
        state.phase = 'EXTRA_TIME_SECOND_HALF';
        state.isPaused = false;
        break;
      }

      case 'END_EXTRA_TIME_SECOND_HALF': {
        state.extraTimeScore = { scoreA: state.scoreA, scoreB: state.scoreB };

        if (state.scoreA > state.scoreB) {
          state.winnerId = 'PARTICIPANT_A';
          state.decisionMethod = 'EXTRA_TIME';
          state.isCompleted = true;
          state.phase = 'COMPLETED';
        } else if (state.scoreB > state.scoreA) {
          state.winnerId = 'PARTICIPANT_B';
          state.decisionMethod = 'EXTRA_TIME';
          state.isCompleted = true;
          state.phase = 'COMPLETED';
        } else {
          // Extra time tied
          if (state.config.penaltyShootoutEnabled) {
            state.phase = 'PENALTY_SHOOTOUT';
            state.shootoutState = {
              kicks: [],
              scoreA: 0,
              scoreB: 0,
              isCompleted: false
            };
          } else {
            state.winnerId = 'DRAW';
            state.decisionMethod = 'EXTRA_TIME';
            state.isCompleted = true;
            state.phase = 'COMPLETED';
          }
        }
        break;
      }

      case 'START_PENALTY_SHOOTOUT': {
        state.phase = 'PENALTY_SHOOTOUT';
        if (!state.shootoutState) {
          state.shootoutState = {
            kicks: [],
            scoreA: 0,
            scoreB: 0,
            isCompleted: false
          };
        }
        break;
      }

      case 'PENALTY_KICK': {
        if (!state.shootoutState) {
          state.shootoutState = {
            kicks: [],
            scoreA: 0,
            scoreB: 0,
            isCompleted: false
          };
        }

        const team = (meta.team || meta.side || 'A').toUpperCase() as MatchSide;
        const kickerPlayerId = meta.kickerPlayerId || meta.playerId || 'kicker';
        const scored = meta.scored === true;
        const kickNumber = state.shootoutState.kicks.length + 1;

        state.shootoutState.kicks.push({
          id: event.id,
          team,
          kickerPlayerId,
          kickNumber,
          scored
        });

        if (scored) {
          if (team === 'A') {
            state.shootoutState.scoreA += 1;
          } else {
            state.shootoutState.scoreB += 1;
          }
        }

        // Shootout resolution logic
        const kicksA = state.shootoutState.kicks.filter((k) => k.team === 'A').length;
        const kicksB = state.shootoutState.kicks.filter((k) => k.team === 'B').length;
        const scoreA = state.shootoutState.scoreA;
        const scoreB = state.shootoutState.scoreB;

        // Best of 5 initial phase
        if (kicksA <= 5 && kicksB <= 5) {
          const remA = 5 - kicksA;
          const remB = 5 - kicksB;

          // Team A has insurmountable lead (Team B cannot catch Team A)
          if (scoreA > scoreB + remB) {
            state.shootoutState.isCompleted = true;
            state.shootoutState.winnerId = 'PARTICIPANT_A';
            state.winnerId = 'PARTICIPANT_A';
            state.decisionMethod = 'PENALTY_SHOOTOUT';
            state.isCompleted = true;
            state.phase = 'COMPLETED';
          }
          // Team B has insurmountable lead (Team A cannot catch Team B)
          else if (scoreB > scoreA + remA) {
            state.shootoutState.isCompleted = true;
            state.shootoutState.winnerId = 'PARTICIPANT_B';
            state.winnerId = 'PARTICIPANT_B';
            state.decisionMethod = 'PENALTY_SHOOTOUT';
            state.isCompleted = true;
            state.phase = 'COMPLETED';
          }
          // Both teams have taken all 5 kicks and score differs
          else if (kicksA === 5 && kicksB === 5 && scoreA !== scoreB) {
            state.shootoutState.isCompleted = true;
            state.shootoutState.winnerId = scoreA > scoreB ? 'PARTICIPANT_A' : 'PARTICIPANT_B';
            state.winnerId = state.shootoutState.winnerId;
            state.decisionMethod = 'PENALTY_SHOOTOUT';
            state.isCompleted = true;
            state.phase = 'COMPLETED';
          }
        } else if (kicksA === kicksB && kicksA > 5) {
          // Sudden death: both teams have taken equal kicks (> 5) and scores differ
          if (scoreA !== scoreB) {
            state.shootoutState.isCompleted = true;
            state.shootoutState.winnerId = scoreA > scoreB ? 'PARTICIPANT_A' : 'PARTICIPANT_B';
            state.winnerId = state.shootoutState.winnerId;
            state.decisionMethod = 'PENALTY_SHOOTOUT';
            state.isCompleted = true;
            state.phase = 'COMPLETED';
          }
        }
        break;
      }

      case 'GOAL': {
        const team = (meta.team || meta.side || 'A').toUpperCase() as MatchSide;
        const scorerPlayerId = meta.scorerPlayerId || meta.playerId;
        const assistPlayerId = meta.assistPlayerId;
        const minute = meta.minute ?? 0;
        const addedMinute = meta.addedMinute;

        if (team === 'A') {
          state.scoreA += 1;
        } else {
          state.scoreB += 1;
        }

        state.goals.push({
          id: event.id,
          team,
          scorerPlayerId,
          assistPlayerId,
          isOwnGoal: false,
          minute,
          addedMinute,
          phase: state.phase
        });
        break;
      }

      case 'OWN_GOAL': {
        const concedingTeam = (meta.concedingTeam || meta.team || meta.side || 'A').toUpperCase() as MatchSide;
        const playerPlayerId = meta.playerPlayerId || meta.playerId;
        const minute = meta.minute ?? 0;
        const addedMinute = meta.addedMinute;

        // Opposing team receives the goal point
        const scoringTeam: MatchSide = concedingTeam === 'A' ? 'B' : 'A';

        if (scoringTeam === 'A') {
          state.scoreA += 1;
        } else {
          state.scoreB += 1;
        }

        state.goals.push({
          id: event.id,
          team: scoringTeam,
          concedingTeam,
          concedingPlayerId: playerPlayerId,
          isOwnGoal: true,
          minute,
          addedMinute,
          phase: state.phase
        });
        break;
      }

      case 'YELLOW_CARD': {
        const team = (meta.team || meta.side || 'A').toUpperCase() as MatchSide;
        const playerId = meta.playerId;
        const minute = meta.minute ?? 0;
        const addedMinute = meta.addedMinute;
        const reason = meta.reason;

        const teamState = team === 'A' ? state.teamAState : state.teamBState;
        const currentCount = (teamState.yellowCards[playerId] || 0) + 1;
        teamState.yellowCards[playerId] = currentCount;

        const isSecondYellow = currentCount >= 2;

        if (isSecondYellow) {
          // Second yellow dismisses the player
          if (!teamState.sentOffPlayers.includes(playerId)) {
            teamState.sentOffPlayers.push(playerId);
          }
          const activeIdx = teamState.activePlayersOnPitch.indexOf(playerId);
          if (activeIdx !== -1) {
            teamState.activePlayersOnPitch.splice(activeIdx, 1);
          }
          if (!teamState.redCards.includes(playerId)) {
            teamState.redCards.push(playerId);
          }
        }

        // Pure single record mapped 1:1 to this event
        state.cards.push({
          id: event.id,
          team,
          playerId,
          minute,
          addedMinute,
          type: 'YELLOW',
          isSecondYellow,
          reason
        });
        break;
      }

      case 'RED_CARD': {
        const team = (meta.team || meta.side || 'A').toUpperCase() as MatchSide;
        const playerId = meta.playerId;
        const minute = meta.minute ?? 0;
        const addedMinute = meta.addedMinute;
        const reason = meta.reason;

        const teamState = team === 'A' ? state.teamAState : state.teamBState;
        if (!teamState.redCards.includes(playerId)) {
          teamState.redCards.push(playerId);
        }
        if (!teamState.sentOffPlayers.includes(playerId)) {
          teamState.sentOffPlayers.push(playerId);
        }

        const activeIdx = teamState.activePlayersOnPitch.indexOf(playerId);
        if (activeIdx !== -1) {
          teamState.activePlayersOnPitch.splice(activeIdx, 1);
        }

        state.cards.push({
          id: event.id,
          team,
          playerId,
          minute,
          addedMinute,
          type: 'RED',
          isSecondYellow: false,
          reason
        });
        break;
      }

      case 'SUBSTITUTION': {
        const team = (meta.team || meta.side || 'A').toUpperCase() as MatchSide;
        const playerOffId = meta.playerOffId;
        const playerOnId = meta.playerOnId;
        const minute = meta.minute ?? 0;
        const addedMinute = meta.addedMinute;

        const teamState = team === 'A' ? state.teamAState : state.teamBState;

        const offIdx = teamState.activePlayersOnPitch.indexOf(playerOffId);
        if (offIdx !== -1) {
          teamState.activePlayersOnPitch.splice(offIdx, 1);
        }
        if (!teamState.substitutedOutPlayers.includes(playerOffId)) {
          teamState.substitutedOutPlayers.push(playerOffId);
        }

        const onIdx = teamState.benchPlayers.indexOf(playerOnId);
        if (onIdx !== -1) {
          teamState.benchPlayers.splice(onIdx, 1);
        }
        if (!teamState.activePlayersOnPitch.includes(playerOnId)) {
          teamState.activePlayersOnPitch.push(playerOnId);
        }

        teamState.substitutionsCount += 1;

        state.substitutions.push({
          id: event.id,
          team,
          playerOffId,
          playerOnId,
          minute,
          addedMinute
        });
        break;
      }

      case 'PAUSE_MATCH': {
        state.isPaused = true;
        break;
      }

      case 'RESUME_MATCH': {
        state.isPaused = false;
        break;
      }

      case 'DECLARE_OUTCOME': {
        const outcome = (meta.outcome || 'COMPLETED').toUpperCase() as FootballDecisionMethod;
        const winner = meta.winnerId as 'PARTICIPANT_A' | 'PARTICIPANT_B' | 'DRAW';

        if (outcome === 'ABANDONED') {
          state.phase = 'ABANDONED';
          state.decisionMethod = 'ABANDONED';
          state.isCompleted = false;
          state.isAbandoned = true;
          state.winnerId = undefined;
        } else {
          state.winnerId = winner;
          state.decisionMethod = outcome;
          state.isCompleted = true;
          state.isAbandoned = false;
          state.phase = 'COMPLETED';
        }
        break;
      }
    }

    return state;
  }

  isGameOver(state: FootballMatchState): boolean {
    return state.isCompleted;
  }

  getWinner(state: FootballMatchState): string | undefined {
    return state.winnerId;
  }
}
