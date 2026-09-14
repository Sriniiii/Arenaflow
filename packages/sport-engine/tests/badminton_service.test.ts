import { test } from 'node:test';
import assert from 'node:assert';
import { BadmintonRules, BadmintonMatchConfig } from '../src/sports/badminton';
import { MatchEvent } from '../src/core/types';

function createEvent(id: string, type: string, metadata?: any): MatchEvent {
  return {
    id,
    type,
    timestamp: new Date().toISOString(),
    metadata
  };
}

test('Badminton Service Tracking Unit Suite', async (t) => {
  // ---------------------------------------------------------------------------
  // 1. Singles Service Rules
  // ---------------------------------------------------------------------------
  await t.test('1. Singles Service: Initial setup & even/odd court positions', () => {
    const rules = new BadmintonRules();
    const config: BadmintonMatchConfig = {
      matchType: 'SINGLES',
      participantA: { id: 'part-A', playerIds: ['player-A1'], playerNames: { 'player-A1': 'Alice' } },
      participantB: { id: 'part-B', playerIds: ['player-B1'], playerNames: { 'player-B1': 'Bob' } },
      initialServingSide: 'A'
    };

    let state = rules.getInitialState(config);

    // Initial state: 0-0, A1 serves from RIGHT to B1 in RIGHT
    assert.strictEqual(state.currentServiceState?.servingSide, 'A');
    assert.strictEqual(state.currentServiceState?.receivingSide, 'B');
    assert.strictEqual(state.currentServiceState?.serverPlayerId, 'player-A1');
    assert.strictEqual(state.currentServiceState?.receiverPlayerId, 'player-B1');
    assert.strictEqual(state.currentServiceState?.serverCourt, 'RIGHT');
    assert.strictEqual(state.currentServiceState?.receiverCourt, 'RIGHT');

    // 1-0: A scores (score is 1, odd) -> A1 serves from LEFT to B1 in LEFT
    state = rules.applyEvent(state, createEvent('e-1', 'POINT_A'));
    assert.strictEqual(state.games[0].scoreA, 1);
    assert.strictEqual(state.games[0].scoreB, 0);
    assert.strictEqual(state.currentServiceState?.servingSide, 'A');
    assert.strictEqual(state.currentServiceState?.serverPlayerId, 'player-A1');
    assert.strictEqual(state.currentServiceState?.receiverPlayerId, 'player-B1');
    assert.strictEqual(state.currentServiceState?.serverCourt, 'LEFT');
    assert.strictEqual(state.currentServiceState?.receiverCourt, 'LEFT');

    // 2-0: A scores (score is 2, even) -> A1 serves from RIGHT to B1 in RIGHT
    state = rules.applyEvent(state, createEvent('e-2', 'POINT_A'));
    assert.strictEqual(state.games[0].scoreA, 2);
    assert.strictEqual(state.games[0].scoreB, 0);
    assert.strictEqual(state.currentServiceState?.serverCourt, 'RIGHT');
    assert.strictEqual(state.currentServiceState?.receiverCourt, 'RIGHT');

    // 2-1: Side B scores (Side-out, B's score is 1, odd) -> B1 serves from LEFT to A1 in LEFT
    state = rules.applyEvent(state, createEvent('e-3', 'POINT_B'));
    assert.strictEqual(state.games[0].scoreA, 2);
    assert.strictEqual(state.games[0].scoreB, 1);
    assert.strictEqual(state.currentServiceState?.servingSide, 'B');
    assert.strictEqual(state.currentServiceState?.receivingSide, 'A');
    assert.strictEqual(state.currentServiceState?.serverPlayerId, 'player-B1');
    assert.strictEqual(state.currentServiceState?.receiverPlayerId, 'player-A1');
    assert.strictEqual(state.currentServiceState?.serverCourt, 'LEFT');
    assert.strictEqual(state.currentServiceState?.receiverCourt, 'LEFT');

    // 2-2: Side B scores (B's score is 2, even) -> B1 serves from RIGHT to A1 in RIGHT
    state = rules.applyEvent(state, createEvent('e-4', 'POINT_B'));
    assert.strictEqual(state.games[0].scoreA, 2);
    assert.strictEqual(state.games[0].scoreB, 2);
    assert.strictEqual(state.currentServiceState?.servingSide, 'B');
    assert.strictEqual(state.currentServiceState?.serverPlayerId, 'player-B1');
    assert.strictEqual(state.currentServiceState?.serverCourt, 'RIGHT');
    assert.strictEqual(state.currentServiceState?.receiverCourt, 'RIGHT');

    // 3-2: Side A scores (Side-out, A's score is 3, odd) -> A1 serves from LEFT to B1 in LEFT
    state = rules.applyEvent(state, createEvent('e-5', 'POINT_A'));
    assert.strictEqual(state.games[0].scoreA, 3);
    assert.strictEqual(state.games[0].scoreB, 2);
    assert.strictEqual(state.currentServiceState?.servingSide, 'A');
    assert.strictEqual(state.currentServiceState?.serverPlayerId, 'player-A1');
    assert.strictEqual(state.currentServiceState?.serverCourt, 'LEFT');
    assert.strictEqual(state.currentServiceState?.receiverCourt, 'LEFT');
  });

  // ---------------------------------------------------------------------------
  // 2. Doubles Service Rules & Court Positions
  // ---------------------------------------------------------------------------
  await t.test('2. Doubles Service: Court Swaps, Side-outs, and Player Positions', () => {
    const rules = new BadmintonRules();
    const config: BadmintonMatchConfig = {
      matchType: 'DOUBLES',
      participantA: {
        id: 'part-A',
        playerIds: ['A1', 'A2'],
        playerNames: { A1: 'Alice', A2: 'Amanda' }
      },
      participantB: {
        id: 'part-B',
        playerIds: ['B1', 'B2'],
        playerNames: { B1: 'Bob', B2: 'Brian' }
      },
      initialServingSide: 'A',
      initialServerPlayerId: 'A1',
      initialReceiverPlayerId: 'B1',
      initialSideAPositions: { rightPlayerId: 'A1', leftPlayerId: 'A2' },
      initialSideBPositions: { rightPlayerId: 'B1', leftPlayerId: 'B2' }
    };

    let state = rules.getInitialState(config);

    // Initial 0-0:
    // A positions: Right=A1, Left=A2
    // B positions: Right=B1, Left=B2
    // Server: A1 in RIGHT court, Receiver: B1 in RIGHT court
    assert.strictEqual(state.currentServiceState?.servingSide, 'A');
    assert.strictEqual(state.currentServiceState?.serverPlayerId, 'A1');
    assert.strictEqual(state.currentServiceState?.receiverPlayerId, 'B1');
    assert.strictEqual(state.currentServiceState?.serverCourt, 'RIGHT');
    assert.strictEqual(state.currentServiceState?.receiverCourt, 'RIGHT');
    assert.deepStrictEqual(state.currentServiceState?.sideAPositions, { rightPlayerId: 'A1', leftPlayerId: 'A2' });
    assert.deepStrictEqual(state.currentServiceState?.sideBPositions, { rightPlayerId: 'B1', leftPlayerId: 'B2' });

    // RALLY 1: Side A scores (1-0)
    // - Same server (A1)
    // - Side A SWAPS positions: Right=A2, Left=A1
    // - Side B DOES NOT SWAP: Right=B1, Left=B2
    // - Server A1 is in LEFT court (score 1 is odd)
    // - Receiver is player in Side B's LEFT court (B2)
    state = rules.applyEvent(state, createEvent('d-1', 'POINT_A'));
    assert.strictEqual(state.games[0].scoreA, 1);
    assert.strictEqual(state.games[0].scoreB, 0);
    assert.strictEqual(state.currentServiceState?.servingSide, 'A');
    assert.strictEqual(state.currentServiceState?.serverPlayerId, 'A1');
    assert.strictEqual(state.currentServiceState?.receiverPlayerId, 'B2');
    assert.strictEqual(state.currentServiceState?.serverCourt, 'LEFT');
    assert.strictEqual(state.currentServiceState?.receiverCourt, 'LEFT');
    assert.deepStrictEqual(state.currentServiceState?.sideAPositions, { rightPlayerId: 'A2', leftPlayerId: 'A1' });
    assert.deepStrictEqual(state.currentServiceState?.sideBPositions, { rightPlayerId: 'B1', leftPlayerId: 'B2' });

    // RALLY 2: Side A scores again (2-0)
    // - Same server (A1)
    // - Side A SWAPS positions: Right=A1, Left=A2
    // - Side B DOES NOT SWAP: Right=B1, Left=B2
    // - Server A1 is in RIGHT court (score 2 is even)
    // - Receiver is player in Side B's RIGHT court (B1)
    state = rules.applyEvent(state, createEvent('d-2', 'POINT_A'));
    assert.strictEqual(state.games[0].scoreA, 2);
    assert.strictEqual(state.games[0].scoreB, 0);
    assert.strictEqual(state.currentServiceState?.servingSide, 'A');
    assert.strictEqual(state.currentServiceState?.serverPlayerId, 'A1');
    assert.strictEqual(state.currentServiceState?.receiverPlayerId, 'B1');
    assert.strictEqual(state.currentServiceState?.serverCourt, 'RIGHT');
    assert.strictEqual(state.currentServiceState?.receiverCourt, 'RIGHT');
    assert.deepStrictEqual(state.currentServiceState?.sideAPositions, { rightPlayerId: 'A1', leftPlayerId: 'A2' });
    assert.deepStrictEqual(state.currentServiceState?.sideBPositions, { rightPlayerId: 'B1', leftPlayerId: 'B2' });

    // RALLY 3: Side B scores (Side-Out! 2-1)
    // - Side B becomes new serving side
    // - NEITHER side swaps positions:
    //     A: Right=A1, Left=A2
    //     B: Right=B1, Left=B2
    // - Side B's score is 1 (odd) -> player in Side B's LEFT court serves -> B2!
    // - Receiver is player in Side A's LEFT court -> A2!
    state = rules.applyEvent(state, createEvent('d-3', 'POINT_B'));
    assert.strictEqual(state.games[0].scoreA, 2);
    assert.strictEqual(state.games[0].scoreB, 1);
    assert.strictEqual(state.currentServiceState?.servingSide, 'B');
    assert.strictEqual(state.currentServiceState?.receivingSide, 'A');
    assert.strictEqual(state.currentServiceState?.serverPlayerId, 'B2');
    assert.strictEqual(state.currentServiceState?.receiverPlayerId, 'A2');
    assert.strictEqual(state.currentServiceState?.serverCourt, 'LEFT');
    assert.strictEqual(state.currentServiceState?.receiverCourt, 'LEFT');
    assert.deepStrictEqual(state.currentServiceState?.sideAPositions, { rightPlayerId: 'A1', leftPlayerId: 'A2' });
    assert.deepStrictEqual(state.currentServiceState?.sideBPositions, { rightPlayerId: 'B1', leftPlayerId: 'B2' });

    // RALLY 4: Side B scores again (2-2)
    // - Same server (B2)
    // - Side B SWAPS positions: Right=B2, Left=B1
    // - Side A DOES NOT SWAP: Right=A1, Left=A2
    // - Server B2 is in RIGHT court (score 2 is even)
    // - Receiver is player in Side A's RIGHT court (A1)
    state = rules.applyEvent(state, createEvent('d-4', 'POINT_B'));
    assert.strictEqual(state.games[0].scoreA, 2);
    assert.strictEqual(state.games[0].scoreB, 2);
    assert.strictEqual(state.currentServiceState?.servingSide, 'B');
    assert.strictEqual(state.currentServiceState?.serverPlayerId, 'B2');
    assert.strictEqual(state.currentServiceState?.receiverPlayerId, 'A1');
    assert.strictEqual(state.currentServiceState?.serverCourt, 'RIGHT');
    assert.strictEqual(state.currentServiceState?.receiverCourt, 'RIGHT');
    assert.deepStrictEqual(state.currentServiceState?.sideAPositions, { rightPlayerId: 'A1', leftPlayerId: 'A2' });
    assert.deepStrictEqual(state.currentServiceState?.sideBPositions, { rightPlayerId: 'B2', leftPlayerId: 'B1' });

    // RALLY 5: Side A scores (Side-Out! 3-2)
    // - Side A becomes new serving side
    // - NEITHER side swaps positions:
    //     A: Right=A1, Left=A2
    //     B: Right=B2, Left=B1
    // - Side A's score is 3 (odd) -> player in Side A's LEFT court serves -> A2!
    // - Receiver is player in Side B's LEFT court -> B1!
    state = rules.applyEvent(state, createEvent('d-5', 'POINT_A'));
    assert.strictEqual(state.games[0].scoreA, 3);
    assert.strictEqual(state.games[0].scoreB, 2);
    assert.strictEqual(state.currentServiceState?.servingSide, 'A');
    assert.strictEqual(state.currentServiceState?.serverPlayerId, 'A2');
    assert.strictEqual(state.currentServiceState?.receiverPlayerId, 'B1');
    assert.strictEqual(state.currentServiceState?.serverCourt, 'LEFT');
    assert.strictEqual(state.currentServiceState?.receiverCourt, 'LEFT');
    assert.deepStrictEqual(state.currentServiceState?.sideAPositions, { rightPlayerId: 'A1', leftPlayerId: 'A2' });
    assert.deepStrictEqual(state.currentServiceState?.sideBPositions, { rightPlayerId: 'B2', leftPlayerId: 'B1' });
  });

  // ---------------------------------------------------------------------------
  // 3. UNDO Replay & State Restoration
  // ---------------------------------------------------------------------------
  await t.test('3. Multi-Step UNDO restores exact scores, server, receiver, and court positions', () => {
    const rules = new BadmintonRules();
    const config: BadmintonMatchConfig = {
      matchType: 'DOUBLES',
      participantA: { id: 'part-A', playerIds: ['A1', 'A2'] },
      participantB: { id: 'part-B', playerIds: ['B1', 'B2'] },
      initialServingSide: 'A',
      initialServerPlayerId: 'A1',
      initialReceiverPlayerId: 'B1',
      initialSideAPositions: { rightPlayerId: 'A1', leftPlayerId: 'A2' },
      initialSideBPositions: { rightPlayerId: 'B1', leftPlayerId: 'B2' }
    };

    let state = rules.getInitialState(config);

    // Apply 3 points: A scores (1-0), A scores (2-0), B scores (2-1)
    state = rules.applyEvent(state, createEvent('u-1', 'POINT_A'));
    state = rules.applyEvent(state, createEvent('u-2', 'POINT_A'));
    state = rules.applyEvent(state, createEvent('u-3', 'POINT_B'));

    assert.strictEqual(state.games[0].scoreA, 2);
    assert.strictEqual(state.games[0].scoreB, 1);
    assert.strictEqual(state.currentServiceState?.servingSide, 'B');
    assert.strictEqual(state.currentServiceState?.serverPlayerId, 'B2');
    assert.strictEqual(state.currentServiceState?.receiverPlayerId, 'A2');

    // UNDO 1: Should restore state at 2-0 (A1 serving to B1 in RIGHT)
    state = rules.applyEvent(state, createEvent('undo-1', 'UNDO'));
    assert.strictEqual(state.games[0].scoreA, 2);
    assert.strictEqual(state.games[0].scoreB, 0);
    assert.strictEqual(state.currentServiceState?.servingSide, 'A');
    assert.strictEqual(state.currentServiceState?.serverPlayerId, 'A1');
    assert.strictEqual(state.currentServiceState?.receiverPlayerId, 'B1');
    assert.strictEqual(state.currentServiceState?.serverCourt, 'RIGHT');
    assert.deepStrictEqual(state.currentServiceState?.sideAPositions, { rightPlayerId: 'A1', leftPlayerId: 'A2' });

    // UNDO 2: Should restore state at 1-0 (A1 serving to B2 in LEFT)
    state = rules.applyEvent(state, createEvent('undo-2', 'UNDO'));
    assert.strictEqual(state.games[0].scoreA, 1);
    assert.strictEqual(state.games[0].scoreB, 0);
    assert.strictEqual(state.currentServiceState?.servingSide, 'A');
    assert.strictEqual(state.currentServiceState?.serverPlayerId, 'A1');
    assert.strictEqual(state.currentServiceState?.receiverPlayerId, 'B2');
    assert.strictEqual(state.currentServiceState?.serverCourt, 'LEFT');
    assert.deepStrictEqual(state.currentServiceState?.sideAPositions, { rightPlayerId: 'A2', leftPlayerId: 'A1' });

    // UNDO 3: Should restore initial state at 0-0 (A1 serving to B1 in RIGHT)
    state = rules.applyEvent(state, createEvent('undo-3', 'UNDO'));
    assert.strictEqual(state.games[0].scoreA, 0);
    assert.strictEqual(state.games[0].scoreB, 0);
    assert.strictEqual(state.currentServiceState?.servingSide, 'A');
    assert.strictEqual(state.currentServiceState?.serverPlayerId, 'A1');
    assert.strictEqual(state.currentServiceState?.receiverPlayerId, 'B1');
    assert.strictEqual(state.currentServiceState?.serverCourt, 'RIGHT');
    assert.deepStrictEqual(state.currentServiceState?.sideAPositions, { rightPlayerId: 'A1', leftPlayerId: 'A2' });
  });

  // ---------------------------------------------------------------------------
  // 4. SET_SERVICE Event Handling
  // ---------------------------------------------------------------------------
  await t.test('4. SET_SERVICE allows authorized scorer to configure initial service & positions', () => {
    const rules = new BadmintonRules();
    const config: BadmintonMatchConfig = {
      matchType: 'DOUBLES',
      participantA: { id: 'part-A', playerIds: ['A1', 'A2'] },
      participantB: { id: 'part-B', playerIds: ['B1', 'B2'] }
    };

    let state = rules.getInitialState(config);

    // Custom set service: Side B serves first, B2 serves to A2
    state = rules.applyEvent(
      state,
      createEvent('set-srv-1', 'SET_SERVICE', {
        matchType: 'DOUBLES',
        servingSide: 'B',
        serverPlayerId: 'B2',
        receiverPlayerId: 'A2',
        serverCourt: 'RIGHT',
        receiverCourt: 'RIGHT',
        sideAPositions: { rightPlayerId: 'A2', leftPlayerId: 'A1' },
        sideBPositions: { rightPlayerId: 'B2', leftPlayerId: 'B1' }
      })
    );

    assert.strictEqual(state.currentServiceState?.servingSide, 'B');
    assert.strictEqual(state.currentServiceState?.serverPlayerId, 'B2');
    assert.strictEqual(state.currentServiceState?.receiverPlayerId, 'A2');
    assert.deepStrictEqual(state.currentServiceState?.sideAPositions, { rightPlayerId: 'A2', leftPlayerId: 'A1' });
    assert.deepStrictEqual(state.currentServiceState?.sideBPositions, { rightPlayerId: 'B2', leftPlayerId: 'B1' });

    // Side B scores first point (0-1):
    // Same server (B2), Side B swaps: Right=B1, Left=B2
    // Server B2 is now in LEFT court (score 1 is odd) -> Receiver is player in Side A's LEFT court (A1)
    state = rules.applyEvent(state, createEvent('pt-b-1', 'POINT_B'));
    assert.strictEqual(state.games[0].scoreB, 1);
    assert.strictEqual(state.currentServiceState?.serverPlayerId, 'B2');
    assert.strictEqual(state.currentServiceState?.receiverPlayerId, 'A1');
    assert.strictEqual(state.currentServiceState?.serverCourt, 'LEFT');
    assert.deepStrictEqual(state.currentServiceState?.sideBPositions, { rightPlayerId: 'B1', leftPlayerId: 'B2' });
  });

  // ---------------------------------------------------------------------------
  // 5. Game Transitions
  // ---------------------------------------------------------------------------
  await t.test('5. Game transition initializes winner to serve first in Game 2 from Right court', () => {
    const rules = new BadmintonRules();
    const config: BadmintonMatchConfig = {
      matchType: 'SINGLES',
      participantA: { id: 'part-A', playerIds: ['A1'] },
      participantB: { id: 'part-B', playerIds: ['B1'] },
      initialServingSide: 'A'
    };

    let state = rules.getInitialState(config);

    // Side B wins Game 1 (21-0)
    for (let i = 0; i < 21; i++) {
      state = rules.applyEvent(state, createEvent(`g1-b-${i}`, 'POINT_B'));
    }

    assert.strictEqual(state.games[0].isCompleted, true);
    assert.strictEqual(state.games[0].winnerId, 'PARTICIPANT_B');
    assert.strictEqual(state.currentGameIndex, 1);
    assert.strictEqual(state.games.length, 2);

    // Game 2 must start at 0-0 with Game 1 Winner (Side B) serving from RIGHT court
    assert.strictEqual(state.games[1].scoreA, 0);
    assert.strictEqual(state.games[1].scoreB, 0);
    assert.strictEqual(state.currentServiceState?.servingSide, 'B');
    assert.strictEqual(state.currentServiceState?.serverPlayerId, 'B1');
    assert.strictEqual(state.currentServiceState?.receiverPlayerId, 'A1');
    assert.strictEqual(state.currentServiceState?.serverCourt, 'RIGHT');
  });
});
