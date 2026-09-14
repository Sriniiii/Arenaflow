import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  FootballRules,
  FootballMatchConfig,
  FootballLineup,
  validateLineup,
  FootballMatchState
} from '../src/sports/football';
import { MatchEvent } from '../src/core/types';

describe('FootballRules Engine', () => {
  const rules = new FootballRules();

  // Helper to create mock teams with 15-player squads
  const createMockSquad = (prefix: string, count: number = 15) => {
    return Array.from({ length: count }, (_, i) => ({
      id: `${prefix}_p${i + 1}`,
      name: `${prefix} Player ${i + 1}`,
      jerseyNumber: i + 1,
      position: i === 0 ? 'GK' : i < 5 ? 'DEF' : i < 9 ? 'MID' : 'FWD',
      isSuspended: i === 14 // 15th player suspended for test
    }));
  };

  const squadA = createMockSquad('teamA');
  const squadB = createMockSquad('teamB');

  const lineupA: FootballLineup = {
    startingXI: squadA.slice(0, 11).map(p => p.id),
    substitutes: squadA.slice(11, 14).map(p => p.id),
    captainId: squadA[0].id
  };

  const lineupB: FootballLineup = {
    startingXI: squadB.slice(0, 11).map(p => p.id),
    substitutes: squadB.slice(11, 14).map(p => p.id),
    captainId: squadB[0].id
  };

  const mockConfig: FootballMatchConfig = {
    participantA: { id: 'PART_A', name: 'Real Madrid', squad: squadA },
    participantB: { id: 'PART_B', name: 'Barcelona', squad: squadB },
    initialLineupA: lineupA,
    initialLineupB: lineupB,
    regulationDurationMinutes: 90,
    halfDurationMinutes: 45,
    extraTimeEnabled: true,
    penaltyShootoutEnabled: true,
    maxSubstitutions: 5,
    allowDraw: true,
    playersPerTeam: 11
  };

  describe('1. Initial State & Configuration', () => {
    it('initializes default state without config cleanly', () => {
      const state = rules.getInitialState();
      assert.equal(state.phase, 'PRE_MATCH');
      assert.equal(state.scoreA, 0);
      assert.equal(state.scoreB, 0);
      assert.equal(state.halftimeScore, null);
      assert.equal(state.extraTimeScore, null);
      assert.equal(state.shootoutState, null);
      assert.equal(state.isCompleted, false);
      assert.equal(state.isPaused, false);
      assert.equal(state.goals.length, 0);
      assert.equal(state.cards.length, 0);
      assert.equal(state.substitutions.length, 0);
      assert.equal(rules.isGameOver(state), false);
      assert.equal(rules.getWinner(state), undefined);
    });

    it('initializes with team lineups and active squad states', () => {
      const state = rules.getInitialState(mockConfig);
      assert.equal(state.teamAState.activePlayersOnPitch.length, 11);
      assert.equal(state.teamAState.benchPlayers.length, 3);
      assert.equal(state.teamAState.captainId, 'teamA_p1');
      assert.equal(state.teamBState.activePlayersOnPitch.length, 11);
      assert.equal(state.teamBState.benchPlayers.length, 3);
      assert.equal(state.teamBState.captainId, 'teamB_p1');
    });
  });

  describe('2. Lineup Validation', () => {
    it('validates a correct 11-player Starting XI and bench', () => {
      const res = validateLineup(lineupA, mockConfig.participantA, 11);
      assert.equal(res.isValid, true);
    });

    it('rejects lineup with incorrect Starting XI player count', () => {
      const invalidLineup: FootballLineup = {
        startingXI: squadA.slice(0, 10).map(p => p.id), // only 10 players
        substitutes: squadA.slice(10, 14).map(p => p.id),
        captainId: squadA[0].id
      };
      const res = validateLineup(invalidLineup, mockConfig.participantA, 11);
      assert.equal(res.isValid, false);
      assert.match(res.reason!, /Starting XI must contain exactly 11 players/);
    });

    it('rejects lineup containing duplicate player IDs', () => {
      const invalidLineup: FootballLineup = {
        startingXI: [...squadA.slice(0, 10).map(p => p.id), squadA[0].id], // p1 duplicated
        substitutes: squadA.slice(11, 14).map(p => p.id),
        captainId: squadA[0].id
      };
      const res = validateLineup(invalidLineup, mockConfig.participantA, 11);
      assert.equal(res.isValid, false);
      assert.match(res.reason!, /Lineup contains duplicate players/);
    });

    it('rejects lineup with player not in squad', () => {
      const invalidLineup: FootballLineup = {
        startingXI: [...squadA.slice(0, 10).map(p => p.id), 'foreign_player_99'],
        substitutes: squadA.slice(11, 14).map(p => p.id),
        captainId: squadA[0].id
      };
      const res = validateLineup(invalidLineup, mockConfig.participantA, 11);
      assert.equal(res.isValid, false);
      assert.match(res.reason!, /is not in team squad/);
    });

    it('rejects lineup with a suspended player', () => {
      const invalidLineup: FootballLineup = {
        startingXI: squadA.slice(0, 11).map(p => p.id),
        substitutes: [squadA[14].id], // p15 is suspended
        captainId: squadA[0].id
      };
      const res = validateLineup(invalidLineup, mockConfig.participantA, 11);
      assert.equal(res.isValid, false);
      assert.match(res.reason!, /is suspended/);
    });

    it('rejects captain who is not in the Starting XI', () => {
      const invalidLineup: FootballLineup = {
        startingXI: squadA.slice(0, 11).map(p => p.id),
        substitutes: squadA.slice(11, 14).map(p => p.id),
        captainId: squadA[11].id // p12 is on the bench!
      };
      const res = validateLineup(invalidLineup, mockConfig.participantA, 11);
      assert.equal(res.isValid, false);
      assert.match(res.reason!, /Captain .* must be in the Starting XI/);
    });
  });

  describe('3. Match Phase Flow & Regulation Scoring', () => {
    it('handles kickoff, first half, and goals for Team A and Team B', () => {
      let state = rules.getInitialState(mockConfig);

      // Start Match
      state = rules.applyEvent(state, {
        id: 'ev-1',
        type: 'START_MATCH',
        timestamp: '2026-09-01T10:00:00Z'
      });
      assert.equal(state.phase, 'FIRST_HALF');
      assert.equal(state.isPaused, false);

      // Goal Team A (scored by player 9, assisted by player 10 at 14')
      state = rules.applyEvent(state, {
        id: 'ev-2',
        type: 'GOAL',
        metadata: { team: 'A', scorerPlayerId: 'teamA_p9', assistPlayerId: 'teamA_p10', minute: 14 },
        timestamp: '2026-09-01T10:14:00Z'
      });
      assert.equal(state.scoreA, 1);
      assert.equal(state.scoreB, 0);
      assert.equal(state.goals.length, 1);
      assert.equal(state.goals[0].team, 'A');
      assert.equal(state.goals[0].scorerPlayerId, 'teamA_p9');
      assert.equal(state.goals[0].isOwnGoal, false);

      // Goal Team B (scored by player 11 at 35')
      state = rules.applyEvent(state, {
        id: 'ev-3',
        type: 'GOAL',
        metadata: { team: 'B', scorerPlayerId: 'teamB_p11', minute: 35 },
        timestamp: '2026-09-01T10:35:00Z'
      });
      assert.equal(state.scoreA, 1);
      assert.equal(state.scoreB, 1);

      // Halftime
      state = rules.applyEvent(state, {
        id: 'ev-4',
        type: 'HALFTIME',
        timestamp: '2026-09-01T10:45:00Z'
      });
      assert.equal(state.phase, 'HALFTIME');
      assert.deepEqual(state.halftimeScore, { scoreA: 1, scoreB: 1 });

      // Second Half Start
      state = rules.applyEvent(state, {
        id: 'ev-5',
        type: 'SECOND_HALF_START',
        timestamp: '2026-09-01T11:00:00Z'
      });
      assert.equal(state.phase, 'SECOND_HALF');
    });

    it('handles Own Goals correctly crediting the opposing team', () => {
      let state = rules.getInitialState(mockConfig);
      state = rules.applyEvent(state, { id: 'ev-1', type: 'START_MATCH', timestamp: '2026-09-01T10:00:00Z' });

      // Team A defender (teamA_p3) accidentally scores an own goal
      state = rules.applyEvent(state, {
        id: 'ev-og-1',
        type: 'OWN_GOAL',
        metadata: { concedingTeam: 'A', playerPlayerId: 'teamA_p3', minute: 22 },
        timestamp: '2026-09-01T10:22:00Z'
      });

      // Invariant: Team B is awarded +1 goal!
      assert.equal(state.scoreA, 0);
      assert.equal(state.scoreB, 1);
      assert.equal(state.goals.length, 1);
      assert.equal(state.goals[0].team, 'B'); // Credited team
      assert.equal(state.goals[0].isOwnGoal, true);
      assert.equal(state.goals[0].concedingPlayerId, 'teamA_p3');
      assert.equal(state.goals[0].concedingTeam, 'A');

      // Team B defender (teamB_p4) scores an own goal
      state = rules.applyEvent(state, {
        id: 'ev-og-2',
        type: 'OWN_GOAL',
        metadata: { concedingTeam: 'B', playerPlayerId: 'teamB_p4', minute: 58 },
        timestamp: '2026-09-01T10:58:00Z'
      });

      // Invariant: Team A is awarded +1 goal!
      assert.equal(state.scoreA, 1);
      assert.equal(state.scoreB, 1);
      assert.equal(state.goals[1].team, 'A');
      assert.equal(state.goals[1].isOwnGoal, true);
      assert.equal(state.goals[1].concedingPlayerId, 'teamB_p4');
    });
  });

  describe('4. Disciplinary Card Tracking', () => {
    it('records yellow cards and automatically triggers red card on second yellow', () => {
      let state = rules.getInitialState(mockConfig);
      state = rules.applyEvent(state, { id: 'ev-1', type: 'START_MATCH', timestamp: '2026-09-01T10:00:00Z' });

      const targetPlayer = 'teamA_p4';
      assert.ok(state.teamAState.activePlayersOnPitch.includes(targetPlayer));

      // 1st Yellow Card
      state = rules.applyEvent(state, {
        id: 'ev-c-1',
        type: 'YELLOW_CARD',
        metadata: { team: 'A', playerId: targetPlayer, minute: 30, reason: 'Tactical foul' },
        timestamp: '2026-09-01T10:30:00Z'
      });
      assert.equal(state.cards.length, 1);
      assert.equal(state.cards[0].type, 'YELLOW');
      assert.equal(state.cards[0].isSecondYellow, false);
      assert.equal(state.teamAState.yellowCards[targetPlayer], 1);
      assert.equal(state.teamAState.redCards.length, 0);
      assert.ok(state.teamAState.activePlayersOnPitch.includes(targetPlayer));

      // 2nd Yellow Card to same player
      state = rules.applyEvent(state, {
        id: 'ev-c-2',
        type: 'YELLOW_CARD',
        metadata: { team: 'A', playerId: targetPlayer, minute: 65, reason: 'Late tackle' },
        timestamp: '2026-09-01T10:65:00Z'
      });

      // Invariant: second yellow card records with isSecondYellow: true, sentOffPlayers updated, active pitch reduced
      assert.equal(state.cards.length, 2);
      assert.equal(state.cards[1].type, 'YELLOW');
      assert.equal(state.cards[1].isSecondYellow, true);
      assert.equal(state.teamAState.yellowCards[targetPlayer], 2);
      assert.deepEqual(state.teamAState.redCards, [targetPlayer]);
      assert.ok(!state.teamAState.activePlayersOnPitch.includes(targetPlayer));
      assert.ok(state.teamAState.sentOffPlayers.includes(targetPlayer));
      assert.equal(state.teamAState.activePlayersOnPitch.length, 10);
    });

    it('handles direct red card and removes player from active pitch', () => {
      let state = rules.getInitialState(mockConfig);
      state = rules.applyEvent(state, { id: 'ev-1', type: 'START_MATCH', timestamp: '2026-09-01T10:00:00Z' });

      const targetPlayer = 'teamB_p5';

      state = rules.applyEvent(state, {
        id: 'ev-rc-1',
        type: 'RED_CARD',
        metadata: { team: 'B', playerId: targetPlayer, minute: 40, reason: 'Violent conduct' },
        timestamp: '2026-09-01T10:40:00Z'
      });

      assert.equal(state.cards.length, 1);
      assert.equal(state.cards[0].type, 'RED');
      assert.equal(state.cards[0].isSecondYellow, false);
      assert.deepEqual(state.teamBState.redCards, [targetPlayer]);
      assert.ok(!state.teamBState.activePlayersOnPitch.includes(targetPlayer));
      assert.ok(state.teamBState.sentOffPlayers.includes(targetPlayer));
      assert.equal(state.teamBState.activePlayersOnPitch.length, 10);
    });
  });

  describe('5. Substitutions', () => {
    it('correctly swaps active player and bench player', () => {
      let state = rules.getInitialState(mockConfig);
      state = rules.applyEvent(state, { id: 'ev-1', type: 'START_MATCH', timestamp: '2026-09-01T10:00:00Z' });

      const playerOff = 'teamA_p9'; // currently starting
      const playerOn = 'teamA_p12'; // on the bench

      assert.ok(state.teamAState.activePlayersOnPitch.includes(playerOff));
      assert.ok(state.teamAState.benchPlayers.includes(playerOn));

      state = rules.applyEvent(state, {
        id: 'ev-sub-1',
        type: 'SUBSTITUTION',
        metadata: { team: 'A', playerOffId: playerOff, playerOnId: playerOn, minute: 60 },
        timestamp: '2026-09-01T10:60:00Z'
      });

      assert.equal(state.substitutions.length, 1);
      assert.equal(state.teamAState.substitutionsCount, 1);
      assert.ok(!state.teamAState.activePlayersOnPitch.includes(playerOff));
      assert.ok(state.teamAState.substitutedOutPlayers.includes(playerOff));
      assert.ok(!state.teamAState.benchPlayers.includes(playerOn));
      assert.ok(state.teamAState.activePlayersOnPitch.includes(playerOn));
      assert.equal(state.teamAState.activePlayersOnPitch.length, 11);
    });

    it('rejects invalid substitutions (e.g. player not on pitch or already subbed)', () => {
      let state = rules.getInitialState(mockConfig);
      state = rules.applyEvent(state, { id: 'ev-1', type: 'START_MATCH', timestamp: '2026-09-01T10:00:00Z' });

      // Try to sub off a bench player
      const val1 = rules.validateEvent(state, {
        id: 'ev-bad-1',
        type: 'SUBSTITUTION',
        metadata: { team: 'A', playerOffId: 'teamA_p12', playerOnId: 'teamA_p13', minute: 60 },
        timestamp: '2026-09-01T10:60:00Z'
      });
      assert.equal(val1.isValid, false);
      assert.match(val1.reason!, /is not on the pitch/);

      // Try to sub on an already active player
      const val2 = rules.validateEvent(state, {
        id: 'ev-bad-2',
        type: 'SUBSTITUTION',
        metadata: { team: 'A', playerOffId: 'teamA_p9', playerOnId: 'teamA_p10', minute: 60 },
        timestamp: '2026-09-01T10:60:00Z'
      });
      assert.equal(val2.isValid, false);
      assert.match(val2.reason!, /is not on the bench/);
    });
  });

  describe('6. Regulation Outcome & League Draw', () => {
    it('supports regulation win when scores are distinct', () => {
      let state = rules.getInitialState(mockConfig);
      state = rules.applyEvent(state, { id: 'ev-1', type: 'START_MATCH', timestamp: '2026-09-01T10:00:00Z' });
      state = rules.applyEvent(state, { id: 'ev-2', type: 'GOAL', metadata: { team: 'A', minute: 30 }, timestamp: '2026-09-01T10:30:00Z' });
      state = rules.applyEvent(state, { id: 'ev-3', type: 'HALFTIME', timestamp: '2026-09-01T10:45:00Z' });
      state = rules.applyEvent(state, { id: 'ev-4', type: 'SECOND_HALF_START', timestamp: '2026-09-01T11:00:00Z' });
      state = rules.applyEvent(state, { id: 'ev-5', type: 'END_REGULATION', timestamp: '2026-09-01T11:45:00Z' });

      assert.equal(state.phase, 'COMPLETED');
      assert.equal(state.isCompleted, true);
      assert.equal(state.scoreA, 1);
      assert.equal(state.scoreB, 0);
      assert.equal(state.winnerId, 'PARTICIPANT_A');
      assert.equal(state.decisionMethod, 'REGULATION');
    });

    it('supports valid DRAW in regulation when allowDraw: true and no extra time is forced', () => {
      const leagueConfig: FootballMatchConfig = {
        ...mockConfig,
        allowDraw: true,
        extraTimeEnabled: false,
        penaltyShootoutEnabled: false
      };

      let state = rules.getInitialState(leagueConfig);
      state = rules.applyEvent(state, { id: 'ev-1', type: 'START_MATCH', timestamp: '2026-09-01T10:00:00Z' });
      state = rules.applyEvent(state, { id: 'ev-2', type: 'GOAL', metadata: { team: 'A', minute: 20 }, timestamp: '2026-09-01T10:20:00Z' });
      state = rules.applyEvent(state, { id: 'ev-3', type: 'GOAL', metadata: { team: 'B', minute: 40 }, timestamp: '2026-09-01T10:40:00Z' });
      state = rules.applyEvent(state, { id: 'ev-4', type: 'HALFTIME', timestamp: '2026-09-01T10:45:00Z' });
      state = rules.applyEvent(state, { id: 'ev-5', type: 'SECOND_HALF_START', timestamp: '2026-09-01T11:00:00Z' });
      state = rules.applyEvent(state, { id: 'ev-6', type: 'END_REGULATION', timestamp: '2026-09-01T11:45:00Z' });

      // Invariant: In league/group stages, a 1-1 match is a valid DRAW
      assert.equal(state.phase, 'COMPLETED');
      assert.equal(state.isCompleted, true);
      assert.equal(state.scoreA, 1);
      assert.equal(state.scoreB, 1);
      assert.equal(state.winnerId, 'DRAW');
      assert.equal(state.decisionMethod, 'REGULATION');
    });
  });

  describe('7. Extra Time and Penalty Shootout Semantics', () => {
    it('handles 1-1 regulation + extra time + 4-3 shootout preserving official score and setting decisionMethod', () => {
      let state = rules.getInitialState(mockConfig);
      state = rules.applyEvent(state, { id: 'ev-1', type: 'START_FIRST_HALF', timestamp: '2026-09-01T10:00:00Z' });
      state = rules.applyEvent(state, { id: 'ev-2', type: 'GOAL', metadata: { team: 'A', minute: 10 }, timestamp: '2026-09-01T10:10:00Z' });
      state = rules.applyEvent(state, { id: 'ev-3', type: 'GOAL', metadata: { team: 'B', minute: 20 }, timestamp: '2026-09-01T10:20:00Z' });
      state = rules.applyEvent(state, { id: 'ev-4', type: 'END_FIRST_HALF', timestamp: '2026-09-01T10:45:00Z' });
      state = rules.applyEvent(state, { id: 'ev-5', type: 'START_SECOND_HALF', timestamp: '2026-09-01T11:00:00Z' });
      state = rules.applyEvent(state, { id: 'ev-6', type: 'END_SECOND_HALF', timestamp: '2026-09-01T11:45:00Z' });

      assert.equal(state.phase, 'FULL_TIME');
      assert.equal(state.isCompleted, false);

      // Extra Time
      state = rules.applyEvent(state, { id: 'ev-7', type: 'START_EXTRA_TIME_FIRST_HALF', timestamp: '2026-09-01T11:50:00Z' });
      assert.equal(state.phase, 'EXTRA_TIME_FIRST_HALF');
      state = rules.applyEvent(state, { id: 'ev-8', type: 'END_EXTRA_TIME_FIRST_HALF', timestamp: '2026-09-01T12:05:00Z' });
      assert.equal(state.phase, 'EXTRA_TIME_HALFTIME');
      state = rules.applyEvent(state, { id: 'ev-9', type: 'START_EXTRA_TIME_SECOND_HALF', timestamp: '2026-09-01T12:07:00Z' });
      assert.equal(state.phase, 'EXTRA_TIME_SECOND_HALF');
      state = rules.applyEvent(state, { id: 'ev-10', type: 'END_EXTRA_TIME_SECOND_HALF', timestamp: '2026-09-01T12:22:00Z' });
      assert.equal(state.phase, 'PENALTY_SHOOTOUT');

      // Shootout Kicks: 4-3 in 5 kicks
      // Kick 1: A scores (1-0), B scores (1-1)
      state = rules.applyEvent(state, { id: 'ev-pk-1', type: 'PENALTY_KICK', metadata: { team: 'A', kickerPlayerId: 'teamA_p9', scored: true }, timestamp: '2026-09-01T12:25:00Z' });
      state = rules.applyEvent(state, { id: 'ev-pk-2', type: 'PENALTY_KICK', metadata: { team: 'B', kickerPlayerId: 'teamB_p9', scored: true }, timestamp: '2026-09-01T12:26:00Z' });
      // Kick 2: A scores (2-1), B scores (2-2)
      state = rules.applyEvent(state, { id: 'ev-pk-3', type: 'PENALTY_KICK', metadata: { team: 'A', kickerPlayerId: 'teamA_p10', scored: true }, timestamp: '2026-09-01T12:27:00Z' });
      state = rules.applyEvent(state, { id: 'ev-pk-4', type: 'PENALTY_KICK', metadata: { team: 'B', kickerPlayerId: 'teamB_p10', scored: true }, timestamp: '2026-09-01T12:28:00Z' });
      // Kick 3: A scores (3-2), B scores (3-3)
      state = rules.applyEvent(state, { id: 'ev-pk-5', type: 'PENALTY_KICK', metadata: { team: 'A', kickerPlayerId: 'teamA_p8', scored: true }, timestamp: '2026-09-01T12:29:00Z' });
      state = rules.applyEvent(state, { id: 'ev-pk-6', type: 'PENALTY_KICK', metadata: { team: 'B', kickerPlayerId: 'teamB_p8', scored: true }, timestamp: '2026-09-01T12:30:00Z' });
      // Kick 4: A scores (4-3), B misses (4-3)
      state = rules.applyEvent(state, { id: 'ev-pk-7', type: 'PENALTY_KICK', metadata: { team: 'A', kickerPlayerId: 'teamA_p7', scored: true }, timestamp: '2026-09-01T12:31:00Z' });
      state = rules.applyEvent(state, { id: 'ev-pk-8', type: 'PENALTY_KICK', metadata: { team: 'B', kickerPlayerId: 'teamB_p7', scored: false }, timestamp: '2026-09-01T12:32:00Z' });
      // Kick 5: A misses (4-3), B misses (4-3) -> Shootout ends 4-3!
      state = rules.applyEvent(state, { id: 'ev-pk-9', type: 'PENALTY_KICK', metadata: { team: 'A', kickerPlayerId: 'teamA_p6', scored: false }, timestamp: '2026-09-01T12:33:00Z' });
      state = rules.applyEvent(state, { id: 'ev-pk-10', type: 'PENALTY_KICK', metadata: { team: 'B', kickerPlayerId: 'teamB_p6', scored: false }, timestamp: '2026-09-01T12:34:00Z' });

      // Invariants:
      // 1. Official score remains 1 - 1
      assert.equal(state.scoreA, 1);
      assert.equal(state.scoreB, 1);
      // 2. Shootout score is 4 - 3
      assert.equal(state.shootoutState!.scoreA, 4);
      assert.equal(state.shootoutState!.scoreB, 3);
      assert.equal(state.shootoutState!.isCompleted, true);
      assert.equal(state.shootoutState!.winnerId, 'PARTICIPANT_A');
      // 3. Match completed with winner A
      assert.equal(state.winnerId, 'PARTICIPANT_A');
      assert.equal(state.decisionMethod, 'PENALTY_SHOOTOUT');
      assert.equal(state.isCompleted, true);
      assert.equal(state.phase, 'COMPLETED');
    });

    it('handles early shootout win (3-0 insurmountable lead after 3 kicks)', () => {
      let state = rules.getInitialState(mockConfig);
      state = rules.applyEvent(state, { id: 'ev-1', type: 'START_FIRST_HALF', timestamp: '2026-09-01T10:00:00Z' });
      state = rules.applyEvent(state, { id: 'ev-2', type: 'END_FIRST_HALF', timestamp: '2026-09-01T10:45:00Z' });
      state = rules.applyEvent(state, { id: 'ev-3', type: 'START_SECOND_HALF', timestamp: '2026-09-01T11:00:00Z' });
      state = rules.applyEvent(state, { id: 'ev-4', type: 'END_SECOND_HALF', timestamp: '2026-09-01T11:45:00Z' });
      state = rules.applyEvent(state, { id: 'ev-5', type: 'START_PENALTY_SHOOTOUT', timestamp: '2026-09-01T11:50:00Z' });

      // A scores, B misses (1-0)
      state = rules.applyEvent(state, { id: 'k1', type: 'PENALTY_KICK', metadata: { team: 'A', scored: true } });
      state = rules.applyEvent(state, { id: 'k2', type: 'PENALTY_KICK', metadata: { team: 'B', scored: false } });
      // A scores, B misses (2-0)
      state = rules.applyEvent(state, { id: 'k3', type: 'PENALTY_KICK', metadata: { team: 'A', scored: true } });
      state = rules.applyEvent(state, { id: 'k4', type: 'PENALTY_KICK', metadata: { team: 'B', scored: false } });
      // A scores, B misses (3-0) -> B has only 2 kicks left and cannot catch 3!
      state = rules.applyEvent(state, { id: 'k5', type: 'PENALTY_KICK', metadata: { team: 'A', scored: true } });
      state = rules.applyEvent(state, { id: 'k6', type: 'PENALTY_KICK', metadata: { team: 'B', scored: false } });

      assert.equal(state.shootoutState!.isCompleted, true);
      assert.equal(state.shootoutState!.scoreA, 3);
      assert.equal(state.shootoutState!.scoreB, 0);
      assert.equal(state.winnerId, 'PARTICIPANT_A');
      assert.equal(state.decisionMethod, 'PENALTY_SHOOTOUT');
      assert.equal(state.isCompleted, true);

      // Shootout cannot continue after winner is determined
      const extraKick = rules.validateEvent(state, { id: 'k7', type: 'PENALTY_KICK', metadata: { team: 'A', scored: true } });
      assert.equal(extraKick.isValid, false);
      assert.match(extraKick.reason!, /already completed/);
    });

    it('handles 5-5 after first five each and progresses to sudden death', () => {
      let state = rules.getInitialState(mockConfig);
      state = rules.applyEvent(state, { id: 'ev-1', type: 'START_FIRST_HALF', timestamp: '2026-09-01T10:00:00Z' });
      state = rules.applyEvent(state, { id: 'ev-2', type: 'END_FIRST_HALF', timestamp: '2026-09-01T10:45:00Z' });
      state = rules.applyEvent(state, { id: 'ev-3', type: 'START_SECOND_HALF', timestamp: '2026-09-01T11:00:00Z' });
      state = rules.applyEvent(state, { id: 'ev-4', type: 'END_SECOND_HALF', timestamp: '2026-09-01T11:45:00Z' });
      state = rules.applyEvent(state, { id: 'ev-5', type: 'START_PENALTY_SHOOTOUT', timestamp: '2026-09-01T11:50:00Z' });

      // First 5 kicks: both score all 5 kicks (5-5)
      for (let i = 1; i <= 5; i++) {
        state = rules.applyEvent(state, { id: `k-a-${i}`, type: 'PENALTY_KICK', metadata: { team: 'A', scored: true } });
        state = rules.applyEvent(state, { id: `k-b-${i}`, type: 'PENALTY_KICK', metadata: { team: 'B', scored: true } });
      }

      assert.equal(state.shootoutState!.scoreA, 5);
      assert.equal(state.shootoutState!.scoreB, 5);
      assert.equal(state.shootoutState!.isCompleted, false);
      assert.equal(state.isCompleted, false);

      // Sudden Death Round 6: A scores (6), B scores (6) -> Sudden death continues
      state = rules.applyEvent(state, { id: 'k-a-6', type: 'PENALTY_KICK', metadata: { team: 'A', scored: true } });
      assert.equal(state.shootoutState!.isCompleted, false, 'Waiting for Team B sudden death attempt');
      state = rules.applyEvent(state, { id: 'k-b-6', type: 'PENALTY_KICK', metadata: { team: 'B', scored: true } });
      assert.equal(state.shootoutState!.scoreA, 6);
      assert.equal(state.shootoutState!.scoreB, 6);
      assert.equal(state.shootoutState!.isCompleted, false);

      // Sudden Death Round 7: A scores (7), B misses (6) -> Team A wins in sudden death!
      state = rules.applyEvent(state, { id: 'k-a-7', type: 'PENALTY_KICK', metadata: { team: 'A', scored: true } });
      state = rules.applyEvent(state, { id: 'k-b-7', type: 'PENALTY_KICK', metadata: { team: 'B', scored: false } });

      assert.equal(state.shootoutState!.scoreA, 7);
      assert.equal(state.shootoutState!.scoreB, 6);
      assert.equal(state.shootoutState!.isCompleted, true);
      assert.equal(state.shootoutState!.winnerId, 'PARTICIPANT_A');
      assert.equal(state.winnerId, 'PARTICIPANT_A');
      assert.equal(state.decisionMethod, 'PENALTY_SHOOTOUT');
      assert.equal(state.isCompleted, true);
      assert.equal(state.phase, 'COMPLETED');
    });
  });

  describe('8. UNDO & Replay Determinism', () => {
    it('accurately rolls back state with UNDO', () => {
      let state = rules.getInitialState(mockConfig);
      state = rules.applyEvent(state, { id: 'ev-1', type: 'START_FIRST_HALF', timestamp: '2026-09-01T10:00:00Z' });
      state = rules.applyEvent(state, { id: 'ev-2', type: 'GOAL', metadata: { team: 'A', minute: 15 }, timestamp: '2026-09-01T10:15:00Z' });
      state = rules.applyEvent(state, { id: 'ev-3', type: 'YELLOW_CARD', metadata: { team: 'B', playerId: 'teamB_p2', minute: 20 }, timestamp: '2026-09-01T10:20:00Z' });

      assert.equal(state.scoreA, 1);
      assert.equal(state.cards.length, 1);

      // Undo yellow card
      state = rules.applyEvent(state, { id: 'ev-undo-1', type: 'UNDO', timestamp: '2026-09-01T10:21:00Z' });
      assert.equal(state.cards.length, 0);
      assert.equal(state.scoreA, 1);

      // Undo goal
      state = rules.applyEvent(state, { id: 'ev-undo-2', type: 'UNDO', timestamp: '2026-09-01T10:22:00Z' });
      assert.equal(state.scoreA, 0);
      assert.equal(state.goals.length, 0);
      assert.equal(state.phase, 'FIRST_HALF');
    });

    it('full lifecycle event-stream replay produces identical deep-equal state', () => {
      const fullLifecycleEvents: MatchEvent[] = [
        { id: 'e1', type: 'SET_LINEUP', metadata: { team: 'A', lineup: lineupA }, timestamp: '2026-09-01T09:30:00Z' },
        { id: 'e2', type: 'SET_LINEUP', metadata: { team: 'B', lineup: lineupB }, timestamp: '2026-09-01T09:35:00Z' },
        { id: 'e3', type: 'START_FIRST_HALF', timestamp: '2026-09-01T10:00:00Z' },
        { id: 'e4', type: 'GOAL', metadata: { team: 'A', scorerPlayerId: 'teamA_p9', minute: 12 }, timestamp: '2026-09-01T10:12:00Z' },
        { id: 'e5', type: 'YELLOW_CARD', metadata: { team: 'B', playerId: 'teamB_p3', minute: 28 }, timestamp: '2026-09-01T10:28:00Z' },
        { id: 'e6', type: 'END_FIRST_HALF', timestamp: '2026-09-01T10:45:00Z' },
        { id: 'e7', type: 'START_SECOND_HALF', timestamp: '2026-09-01T11:00:00Z' },
        { id: 'e8', type: 'SUBSTITUTION', metadata: { team: 'A', playerOffId: 'teamA_p9', playerOnId: 'teamA_p12', minute: 55 }, timestamp: '2026-09-01T11:10:00Z' },
        { id: 'e9', type: 'OWN_GOAL', metadata: { concedingTeam: 'A', playerPlayerId: 'teamA_p4', minute: 70 }, timestamp: '2026-09-01T11:25:00Z' },
        { id: 'e10', type: 'END_SECOND_HALF', timestamp: '2026-09-01T11:45:00Z' },
        { id: 'e11', type: 'START_EXTRA_TIME_FIRST_HALF', timestamp: '2026-09-01T11:50:00Z' },
        { id: 'e12', type: 'END_EXTRA_TIME_FIRST_HALF', timestamp: '2026-09-01T12:05:00Z' },
        { id: 'e13', type: 'START_EXTRA_TIME_SECOND_HALF', timestamp: '2026-09-01T12:07:00Z' },
        { id: 'e14', type: 'END_EXTRA_TIME_SECOND_HALF', timestamp: '2026-09-01T12:22:00Z' },
        { id: 'e15', type: 'START_PENALTY_SHOOTOUT', timestamp: '2026-09-01T12:25:00Z' },
        { id: 'e16', type: 'PENALTY_KICK', metadata: { team: 'A', kickerPlayerId: 'teamA_p1', scored: true }, timestamp: '2026-09-01T12:26:00Z' },
        { id: 'e17', type: 'PENALTY_KICK', metadata: { team: 'B', kickerPlayerId: 'teamB_p1', scored: false }, timestamp: '2026-09-01T12:27:00Z' },
        { id: 'e18', type: 'PENALTY_KICK', metadata: { team: 'A', kickerPlayerId: 'teamA_p2', scored: true }, timestamp: '2026-09-01T12:28:00Z' },
        { id: 'e19', type: 'PENALTY_KICK', metadata: { team: 'B', kickerPlayerId: 'teamB_p2', scored: false }, timestamp: '2026-09-01T12:29:00Z' },
        { id: 'e20', type: 'PENALTY_KICK', metadata: { team: 'A', kickerPlayerId: 'teamA_p3', scored: true }, timestamp: '2026-09-01T12:30:00Z' },
        { id: 'e21', type: 'PENALTY_KICK', metadata: { team: 'B', kickerPlayerId: 'teamB_p3', scored: false }, timestamp: '2026-09-01T12:31:00Z' }
      ];

      // Run 1: live step-by-step
      let run1 = rules.getInitialState(mockConfig);
      for (const ev of fullLifecycleEvents) {
        run1 = rules.applyEvent(run1, ev);
      }

      // Run 2: deterministic replay from initial state
      let run2 = rules.getInitialState(mockConfig);
      for (const ev of fullLifecycleEvents) {
        run2 = rules.applyEvent(run2, ev);
      }

      assert.deepEqual(run1, run2, 'Deterministic replay must produce 100% identical state');
      assert.equal(run1.isCompleted, true);
      assert.equal(run1.decisionMethod, 'PENALTY_SHOOTOUT');
      assert.equal(run1.scoreA, 1);
      assert.equal(run1.scoreB, 1);
      assert.equal(run1.shootoutState!.scoreA, 3);
      assert.equal(run1.shootoutState!.scoreB, 0);
      assert.equal(run1.winnerId, 'PARTICIPANT_A');
    });
  });

  describe('9. Declarative Outcomes & Invariants', () => {
    it('handles WALKOVER, DEFAULT, and RETIREMENT with clean completed state', () => {
      let state = rules.getInitialState(mockConfig);
      state = rules.applyEvent(state, {
        id: 'ev-wo',
        type: 'DECLARE_OUTCOME',
        metadata: { outcome: 'WALKOVER', winnerId: 'PARTICIPANT_A', notes: 'Opponent forfeited' },
        timestamp: '2026-09-01T10:00:00Z'
      });

      assert.equal(state.isCompleted, true);
      assert.equal(state.isAbandoned, false);
      assert.equal(state.phase, 'COMPLETED');
      assert.equal(state.winnerId, 'PARTICIPANT_A');
      assert.equal(state.decisionMethod, 'WALKOVER');
    });

    it('handles ABANDONED outcome without completing or awarding a winner', () => {
      let state = rules.getInitialState(mockConfig);
      state = rules.applyEvent(state, { id: 'ev-1', type: 'START_FIRST_HALF', timestamp: '2026-09-01T10:00:00Z' });
      state = rules.applyEvent(state, { id: 'ev-2', type: 'GOAL', metadata: { team: 'A', minute: 15 }, timestamp: '2026-09-01T10:15:00Z' });

      // Match is abandoned at 35' due to floodlight failure
      state = rules.applyEvent(state, {
        id: 'ev-aban',
        type: 'DECLARE_OUTCOME',
        metadata: { outcome: 'ABANDONED', notes: 'Floodlight failure' },
        timestamp: '2026-09-01T10:35:00Z'
      });

      assert.equal(state.phase, 'ABANDONED');
      assert.equal(state.decisionMethod, 'ABANDONED');
      assert.equal(state.isCompleted, false, 'ABANDONED match must NOT be marked isCompleted: true');
      assert.equal(state.isAbandoned, true);
      assert.equal(state.winnerId, undefined, 'ABANDONED match must NOT declare a winner');

      // Subsequent scoring events are rejected
      const nextGoal = rules.validateEvent(state, { id: 'ev-bad-goal', type: 'GOAL', metadata: { team: 'A', minute: 36 } });
      assert.equal(nextGoal.isValid, false);
      assert.match(nextGoal.reason!, /abandoned/);
    });

    it('verifies pure event-sourcing integrity for second-yellow dismissal', () => {
      let state = rules.getInitialState(mockConfig);
      state = rules.applyEvent(state, { id: 'ev-1', type: 'START_FIRST_HALF', timestamp: '2026-09-01T10:00:00Z' });

      const targetPlayer = 'teamA_p4';

      // 1st Yellow Card
      state = rules.applyEvent(state, {
        id: 'ev-y1',
        type: 'YELLOW_CARD',
        metadata: { team: 'A', playerId: targetPlayer, minute: 20 },
        timestamp: '2026-09-01T10:20:00Z'
      });

      // 2nd Yellow Card
      state = rules.applyEvent(state, {
        id: 'ev-y2',
        type: 'YELLOW_CARD',
        metadata: { team: 'A', playerId: targetPlayer, minute: 70 },
        timestamp: '2026-09-01T10:70:00Z'
      });

      // Assert eventHistory contains ONLY the two user events (no hidden synthetic RED_CARD event)
      assert.equal(state.eventHistory.length, 3);
      assert.deepEqual(state.eventHistory.map(e => e.type), ['START_FIRST_HALF', 'YELLOW_CARD', 'YELLOW_CARD']);

      // Assert reducer derived sent-off state purely from the yellow card accumulation
      assert.equal(state.teamAState.yellowCards[targetPlayer], 2);
      assert.ok(state.teamAState.sentOffPlayers.includes(targetPlayer));
      assert.ok(!state.teamAState.activePlayersOnPitch.includes(targetPlayer));
      assert.equal(state.cards.length, 2);
      assert.equal(state.cards[0].isSecondYellow, false);
      assert.equal(state.cards[1].isSecondYellow, true);
    });

    it('rejects duplicate event IDs idempotently', () => {
      let state = rules.getInitialState(mockConfig);
      state = rules.applyEvent(state, { id: 'ev-dup', type: 'START_FIRST_HALF', timestamp: '2026-09-01T10:00:00Z' });

      const duplicateVal = rules.validateEvent(state, {
        id: 'ev-dup',
        type: 'START_FIRST_HALF',
        timestamp: '2026-09-01T10:00:00Z'
      });
      assert.equal(duplicateVal.isValid, false);
      assert.match(duplicateVal.reason!, /already been processed/);
    });
  });
});
