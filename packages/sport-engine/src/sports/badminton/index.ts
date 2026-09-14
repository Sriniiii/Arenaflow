import {
  ISportRules,
  MatchEvent,
  BadmintonServiceState,
  BadmintonMatchConfig,
  BadmintonParticipantInfo,
  DoublesCourtPositions,
  MatchSide,
  ServiceCourt
} from '../../core/types';

export {
  BadmintonServiceState,
  BadmintonMatchConfig,
  BadmintonParticipantInfo,
  DoublesCourtPositions,
  MatchSide,
  ServiceCourt
};

export interface BadmintonGameScore {
  scoreA: number;
  scoreB: number;
  winnerId?: 'PARTICIPANT_A' | 'PARTICIPANT_B';
  isCompleted: boolean;
  serviceState?: BadmintonServiceState;
}

export interface BadmintonMatchState {
  games: BadmintonGameScore[];
  currentGameIndex: number;
  winnerId?: 'PARTICIPANT_A' | 'PARTICIPANT_B';
  isCompleted: boolean;
  eventHistory: MatchEvent[];
  processedEventIds: string[];
  config?: BadmintonMatchConfig;
  currentServiceState: BadmintonServiceState | null;
}

export function createDefaultServiceState(
  config?: BadmintonMatchConfig,
  servingSide?: MatchSide
): BadmintonServiceState {
  const matchType = config?.matchType || 'SINGLES';
  const playerA1 = config?.participantA?.playerIds?.[0] || 'A1';
  const playerA2 = config?.participantA?.playerIds?.[1] || 'A2';
  const playerB1 = config?.participantB?.playerIds?.[0] || 'B1';
  const playerB2 = config?.participantB?.playerIds?.[1] || 'B2';

  const initialSide: MatchSide = servingSide || config?.initialServingSide || 'A';
  const receivingSide: MatchSide = initialSide === 'A' ? 'B' : 'A';

  if (matchType === 'DOUBLES') {
    const sideAPositions: DoublesCourtPositions = config?.initialSideAPositions || {
      rightPlayerId: playerA1,
      leftPlayerId: playerA2
    };
    const sideBPositions: DoublesCourtPositions = config?.initialSideBPositions || {
      rightPlayerId: playerB1,
      leftPlayerId: playerB2
    };

    const serverPlayerId =
      config?.initialServerPlayerId ||
      (initialSide === 'A' ? sideAPositions.rightPlayerId : sideBPositions.rightPlayerId);
    const receiverPlayerId =
      config?.initialReceiverPlayerId ||
      (initialSide === 'A' ? sideBPositions.rightPlayerId : sideAPositions.rightPlayerId);

    const serverCourt: ServiceCourt = 'RIGHT';
    const receiverCourt: ServiceCourt = 'RIGHT';

    return {
      matchType: 'DOUBLES',
      servingSide: initialSide,
      receivingSide,
      serverPlayerId,
      receiverPlayerId,
      serverCourt,
      receiverCourt,
      sideAPositions,
      sideBPositions
    };
  }

  // SINGLES
  const serverPlayerId = initialSide === 'A' ? playerA1 : playerB1;
  const receiverPlayerId = initialSide === 'A' ? playerB1 : playerA1;

  return {
    matchType: 'SINGLES',
    servingSide: initialSide,
    receivingSide,
    serverPlayerId,
    receiverPlayerId,
    serverCourt: 'RIGHT',
    receiverCourt: 'RIGHT'
  };
}

export function computeNextServiceState(
  currentServiceState: BadmintonServiceState | null,
  config: BadmintonMatchConfig | undefined,
  scoringSide: MatchSide,
  newScoreA: number,
  newScoreB: number
): BadmintonServiceState {
  if (!currentServiceState) {
    currentServiceState = createDefaultServiceState(config, scoringSide);
  }

  const matchType = currentServiceState.matchType;
  const serverScore = scoringSide === 'A' ? newScoreA : newScoreB;
  const isEven = serverScore % 2 === 0;
  const court: ServiceCourt = isEven ? 'RIGHT' : 'LEFT';

  if (matchType === 'SINGLES') {
    const playerA = config?.participantA?.playerIds?.[0] || 'A1';
    const playerB = config?.participantB?.playerIds?.[0] || 'B1';

    const serverPlayerId = scoringSide === 'A' ? playerA : playerB;
    const receiverPlayerId = scoringSide === 'A' ? playerB : playerA;

    return {
      matchType: 'SINGLES',
      servingSide: scoringSide,
      receivingSide: scoringSide === 'A' ? 'B' : 'A',
      serverPlayerId,
      receiverPlayerId,
      serverCourt: court,
      receiverCourt: court
    };
  }

  // DOUBLES
  const currentServingSide = currentServiceState.servingSide;
  const sideAPositions = {
    ...(currentServiceState.sideAPositions || {
      rightPlayerId: config?.participantA?.playerIds?.[0] || 'A1',
      leftPlayerId: config?.participantA?.playerIds?.[1] || 'A2'
    })
  };
  const sideBPositions = {
    ...(currentServiceState.sideBPositions || {
      rightPlayerId: config?.participantB?.playerIds?.[0] || 'B1',
      leftPlayerId: config?.participantB?.playerIds?.[1] || 'B2'
    })
  };

  if (scoringSide === currentServingSide) {
    // CASE A: SERVING SIDE WINS RALLY
    // 1. Same individual server remains server
    const serverPlayerId = currentServiceState.serverPlayerId;

    // 2. Serving side swaps its two court positions
    if (scoringSide === 'A') {
      const temp = sideAPositions.rightPlayerId;
      sideAPositions.rightPlayerId = sideAPositions.leftPlayerId;
      sideAPositions.leftPlayerId = temp;
    } else {
      const temp = sideBPositions.rightPlayerId;
      sideBPositions.rightPlayerId = sideBPositions.leftPlayerId;
      sideBPositions.leftPlayerId = temp;
    }
    // Receiving side does NOT swap court positions

    // 3. Service court corresponds to server's new position (matching new score parity)
    const serverCourt = court;
    const receiverCourt = court;

    // 4. Receiver becomes player diagonally opposite the server (occupies same court name on their side)
    const receivingPositions = scoringSide === 'A' ? sideBPositions : sideAPositions;
    const receiverPlayerId =
      serverCourt === 'RIGHT' ? receivingPositions.rightPlayerId : receivingPositions.leftPlayerId;

    return {
      matchType: 'DOUBLES',
      servingSide: scoringSide,
      receivingSide: scoringSide === 'A' ? 'B' : 'A',
      serverPlayerId,
      receiverPlayerId,
      serverCourt,
      receiverCourt,
      sideAPositions,
      sideBPositions
    };
  } else {
    // CASE B: RECEIVING SIDE WINS RALLY (SIDE-OUT)
    // 1. Scoring side becomes new serving side
    const newServingSide = scoringSide;
    const newReceivingSide: MatchSide = scoringSide === 'A' ? 'B' : 'A';

    // 2. Neither side swaps court positions (sideAPositions and sideBPositions remain untouched)

    // 3. Server court corresponds to new score parity
    const serverCourt = court;
    const receiverCourt = court;

    // 4. New server is the player on the new serving side who is currently standing in serverCourt
    const servingPositions = newServingSide === 'A' ? sideAPositions : sideBPositions;
    const serverPlayerId =
      serverCourt === 'RIGHT' ? servingPositions.rightPlayerId : servingPositions.leftPlayerId;

    // 5. Receiver is the player on opposing side currently standing in diagonally opposite court (same court name)
    const receivingPositions = newReceivingSide === 'A' ? sideAPositions : sideBPositions;
    const receiverPlayerId =
      receiverCourt === 'RIGHT' ? receivingPositions.rightPlayerId : receivingPositions.leftPlayerId;

    return {
      matchType: 'DOUBLES',
      servingSide: newServingSide,
      receivingSide: newReceivingSide,
      serverPlayerId,
      receiverPlayerId,
      serverCourt,
      receiverCourt,
      sideAPositions,
      sideBPositions
    };
  }
}

export class BadmintonRules implements ISportRules<BadmintonMatchState, MatchEvent> {
  sportId = 'BADMINTON';

  getInitialState(config?: BadmintonMatchConfig): BadmintonMatchState {
    const initialService = createDefaultServiceState(config, config?.initialServingSide || 'A');
    return {
      games: [{ scoreA: 0, scoreB: 0, isCompleted: false, serviceState: initialService }],
      currentGameIndex: 0,
      isCompleted: false,
      eventHistory: [],
      processedEventIds: [],
      config,
      currentServiceState: initialService
    };
  }

  validateEvent(state: BadmintonMatchState, event: MatchEvent): { isValid: boolean; reason?: string } {
    if (state.isCompleted) {
      return { isValid: false, reason: 'Match is already completed' };
    }
    if (state.processedEventIds.includes(event.id)) {
      return { isValid: false, reason: 'Event has already been processed' };
    }
    const eType = event.type || (event as any).event_type;
    if (eType !== 'POINT_A' && eType !== 'POINT_B' && eType !== 'UNDO' && eType !== 'SET_SERVICE') {
      return { isValid: false, reason: `Invalid event type: ${eType}` };
    }
    return { isValid: true };
  }

  applyEvent(state: BadmintonMatchState, event: MatchEvent): BadmintonMatchState {
    const eType = event.type || (event as any).event_type;
    const normalizedEvent = {
      ...event,
      type: eType,
      event_type: eType
    };

    // 1. Deep clone current state
    const newState = JSON.parse(JSON.stringify(state)) as BadmintonMatchState;

    // Add to processed IDs
    if (!newState.processedEventIds.includes(normalizedEvent.id)) {
      newState.processedEventIds.push(normalizedEvent.id);
    }

    if (normalizedEvent.type === 'UNDO') {
      // Find and remove the last point or service event from eventHistory
      let lastEventIdx = -1;
      for (let i = newState.eventHistory.length - 1; i >= 0; i--) {
        const evType = newState.eventHistory[i].type;
        if (evType === 'POINT_A' || evType === 'POINT_B' || evType === 'SET_SERVICE') {
          lastEventIdx = i;
          break;
        }
      }

      if (lastEventIdx !== -1) {
        newState.eventHistory.splice(lastEventIdx, 1);
      }

      // Re-run the active events from scratch to reconstruct state
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

  private applySingleEvent(state: BadmintonMatchState, event: MatchEvent): BadmintonMatchState {
    const eType = event.type || (event as any).event_type;
    const normalized = {
      ...event,
      type: eType,
      event_type: eType
    };

    // Push to eventHistory if not already there
    if (!state.eventHistory.some((e) => e.id === normalized.id)) {
      state.eventHistory.push(normalized);
    }

    // 1. Handle SET_SERVICE
    if (normalized.type === 'SET_SERVICE') {
      const meta = normalized.metadata || {};
      const matchType = meta.matchType || state.config?.matchType || 'SINGLES';
      const servingSide: MatchSide = meta.servingSide || meta.serving_side || 'A';
      const receivingSide: MatchSide = meta.receivingSide || meta.receiving_side || (servingSide === 'A' ? 'B' : 'A');

      const serverPlayerId = meta.serverPlayerId || meta.server_player_id || state.currentServiceState?.serverPlayerId || 'A1';
      const receiverPlayerId = meta.receiverPlayerId || meta.receiver_player_id || state.currentServiceState?.receiverPlayerId || 'B1';
      const serverCourt: ServiceCourt = meta.serverCourt || meta.server_court || 'RIGHT';
      const receiverCourt: ServiceCourt = meta.receiverCourt || meta.receiver_court || 'RIGHT';

      const sideAPositions: DoublesCourtPositions | undefined =
        meta.sideAPositions || meta.side_a_positions || state.currentServiceState?.sideAPositions;
      const sideBPositions: DoublesCourtPositions | undefined =
        meta.sideBPositions || meta.side_b_positions || state.currentServiceState?.sideBPositions;

      const newServiceState: BadmintonServiceState = {
        matchType,
        servingSide,
        receivingSide,
        serverPlayerId,
        receiverPlayerId,
        serverCourt,
        receiverCourt,
        sideAPositions,
        sideBPositions
      };

      state.currentServiceState = newServiceState;
      if (state.games[state.currentGameIndex]) {
        state.games[state.currentGameIndex].serviceState = newServiceState;
      }
      return state;
    }

    // 2. Handle POINT_A or POINT_B
    const currentGame = state.games[state.currentGameIndex];
    const scoringSide: MatchSide = normalized.type === 'POINT_A' ? 'A' : 'B';

    if (scoringSide === 'A') {
      currentGame.scoreA += 1;
    } else {
      currentGame.scoreB += 1;
    }

    // Compute updated service state for this point
    const nextServiceState = computeNextServiceState(
      state.currentServiceState,
      state.config,
      scoringSide,
      currentGame.scoreA,
      currentGame.scoreB
    );

    state.currentServiceState = nextServiceState;
    currentGame.serviceState = nextServiceState;

    // Check game completeness:
    // - Score >= 21 AND lead >= 2
    // - OR Score === 30 (cap)
    const isWinA =
      (currentGame.scoreA >= 21 && currentGame.scoreA - currentGame.scoreB >= 2) ||
      currentGame.scoreA === 30;
    const isWinB =
      (currentGame.scoreB >= 21 && currentGame.scoreB - currentGame.scoreA >= 2) ||
      currentGame.scoreB === 30;

    if (isWinA) {
      currentGame.isCompleted = true;
      currentGame.winnerId = 'PARTICIPANT_A';
    } else if (isWinB) {
      currentGame.isCompleted = true;
      currentGame.winnerId = 'PARTICIPANT_B';
    }

    // Check match completeness: best of 3 games
    const winsA = state.games.filter((g) => g.winnerId === 'PARTICIPANT_A').length;
    const winsB = state.games.filter((g) => g.winnerId === 'PARTICIPANT_B').length;

    if (winsA >= 2) {
      state.isCompleted = true;
      state.winnerId = 'PARTICIPANT_A';
    } else if (winsB >= 2) {
      state.isCompleted = true;
      state.winnerId = 'PARTICIPANT_B';
    } else if (currentGame.isCompleted && state.currentGameIndex < 2) {
      // Game transition to next game
      state.currentGameIndex += 1;

      // Winner of previous game serves first at 0-0
      const gameWinnerSide: MatchSide = isWinA ? 'A' : 'B';
      const newGameServiceState = createDefaultServiceState(state.config, gameWinnerSide);

      state.games.push({
        scoreA: 0,
        scoreB: 0,
        isCompleted: false,
        serviceState: newGameServiceState
      });
      state.currentServiceState = newGameServiceState;
    }

    return state;
  }

  isGameOver(state: BadmintonMatchState): boolean {
    return state.isCompleted;
  }

  getWinner(state: BadmintonMatchState): string | undefined {
    return state.winnerId;
  }
}

