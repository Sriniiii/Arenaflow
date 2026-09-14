export type ServiceCourt = 'RIGHT' | 'LEFT';
export type MatchSide = 'A' | 'B';

export interface DoublesCourtPositions {
  rightPlayerId: string;
  leftPlayerId: string;
}

export interface BadmintonServiceState {
  matchType: 'SINGLES' | 'DOUBLES';
  servingSide: MatchSide;
  receivingSide: MatchSide;
  serverPlayerId: string;
  receiverPlayerId: string;
  serverCourt: ServiceCourt;
  receiverCourt: ServiceCourt;
  sideAPositions?: DoublesCourtPositions;
  sideBPositions?: DoublesCourtPositions;
}

export interface BadmintonParticipantInfo {
  id: string;
  name?: string;
  playerIds: string[];
  playerNames?: Record<string, string>;
}

export interface BadmintonMatchConfig {
  matchType?: 'SINGLES' | 'DOUBLES';
  participantA?: BadmintonParticipantInfo;
  participantB?: BadmintonParticipantInfo;
  initialServingSide?: MatchSide;
  initialServerPlayerId?: string;
  initialReceiverPlayerId?: string;
  initialSideAPositions?: DoublesCourtPositions;
  initialSideBPositions?: DoublesCourtPositions;
}

export interface MatchEvent {
  id: string;
  type: string;
  playerId?: string;
  timestamp: string;
  metadata?: Record<string, any>;
}

export interface ISportRules<TState = any, TEvent = MatchEvent> {
  sportId: string;
  getInitialState(config?: any): TState;
  validateEvent(state: TState, event: TEvent): { isValid: boolean; reason?: string };
  applyEvent(state: TState, event: TEvent): TState;
  isGameOver(state: TState): boolean;
  getWinner(state: TState): string | undefined;
}
