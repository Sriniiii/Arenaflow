import { test } from 'node:test';
import assert from 'node:assert';
import { BadmintonRules } from '../src/sports/badminton';
import { MatchEvent } from '../src/core/types';

function createPointEvent(id: string, type: 'POINT_A' | 'POINT_B' | 'UNDO'): MatchEvent {
  return {
    id,
    type,
    timestamp: new Date().toISOString(),
  };
}

test('1. Initial state (0-0)', () => {
  const rules = new BadmintonRules();
  const state = rules.getInitialState();

  assert.strictEqual(state.isCompleted, false);
  assert.strictEqual(state.currentGameIndex, 0);
  assert.strictEqual(state.games.length, 1);
  assert.strictEqual(state.games[0].scoreA, 0);
  assert.strictEqual(state.games[0].scoreB, 0);
  assert.strictEqual(state.games[0].isCompleted, false);
});

test('2. Regular game win (20-18 -> 21-18)', () => {
  const rules = new BadmintonRules();
  let state = rules.getInitialState();

  // Score to 20-18
  for (let i = 0; i < 20; i++) {
    state = rules.applyEvent(state, createPointEvent(`a-${i}`, 'POINT_A'));
  }
  for (let i = 0; i < 18; i++) {
    state = rules.applyEvent(state, createPointEvent(`b-${i}`, 'POINT_B'));
  }

  assert.strictEqual(state.games[0].scoreA, 20);
  assert.strictEqual(state.games[0].scoreB, 18);
  assert.strictEqual(state.games[0].isCompleted, false);

  // A scores the winning point
  state = rules.applyEvent(state, createPointEvent('a-win', 'POINT_A'));

  assert.strictEqual(state.games[0].scoreA, 21);
  assert.strictEqual(state.games[0].scoreB, 18);
  assert.strictEqual(state.games[0].isCompleted, true);
  assert.strictEqual(state.games[0].winnerId, 'PARTICIPANT_A');
});

test('3. Deuce behavior (20-20 -> 21-20 -> 22-20)', () => {
  const rules = new BadmintonRules();
  let state = rules.getInitialState();

  // Score to 20-20
  for (let i = 0; i < 20; i++) {
    state = rules.applyEvent(state, createPointEvent(`a-${i}`, 'POINT_A'));
    state = rules.applyEvent(state, createPointEvent(`b-${i}`, 'POINT_B'));
  }

  assert.strictEqual(state.games[0].scoreA, 20);
  assert.strictEqual(state.games[0].scoreB, 20);
  assert.strictEqual(state.games[0].isCompleted, false);

  // A scores 1 point (leads 21-20, game continues)
  state = rules.applyEvent(state, createPointEvent('a-21', 'POINT_A'));
  assert.strictEqual(state.games[0].scoreA, 21);
  assert.strictEqual(state.games[0].scoreB, 20);
  assert.strictEqual(state.games[0].isCompleted, false);

  // A scores again (leads 22-20, game ends)
  state = rules.applyEvent(state, createPointEvent('a-22', 'POINT_A'));
  assert.strictEqual(state.games[0].scoreA, 22);
  assert.strictEqual(state.games[0].scoreB, 20);
  assert.strictEqual(state.games[0].isCompleted, true);
  assert.strictEqual(state.games[0].winnerId, 'PARTICIPANT_A');
});

test('4. Cap at 30 points (29-29 -> 30-29)', () => {
  const rules = new BadmintonRules();
  let state = rules.getInitialState();

  // Score to 29-29
  for (let i = 0; i < 29; i++) {
    state = rules.applyEvent(state, createPointEvent(`a-${i}`, 'POINT_A'));
    state = rules.applyEvent(state, createPointEvent(`b-${i}`, 'POINT_B'));
  }

  assert.strictEqual(state.games[0].scoreA, 29);
  assert.strictEqual(state.games[0].scoreB, 29);
  assert.strictEqual(state.games[0].isCompleted, false);

  // A scores point 30 (cap reached, game ends 30-29)
  state = rules.applyEvent(state, createPointEvent('a-30', 'POINT_A'));
  assert.strictEqual(state.games[0].scoreA, 30);
  assert.strictEqual(state.games[0].scoreB, 29);
  assert.strictEqual(state.games[0].isCompleted, true);
  assert.strictEqual(state.games[0].winnerId, 'PARTICIPANT_A');
});

test('5. Best of 3 ending 2-0', () => {
  const rules = new BadmintonRules();
  let state = rules.getInitialState();

  // Game 1: A wins 21-0
  for (let i = 0; i < 21; i++) {
    state = rules.applyEvent(state, createPointEvent(`g1-a-${i}`, 'POINT_A'));
  }
  assert.strictEqual(state.games[0].isCompleted, true);
  assert.strictEqual(state.games[0].winnerId, 'PARTICIPANT_A');
  assert.strictEqual(state.currentGameIndex, 1);
  assert.strictEqual(state.games.length, 2);

  // Game 2: A wins 21-0
  for (let i = 0; i < 21; i++) {
    state = rules.applyEvent(state, createPointEvent(`g2-a-${i}`, 'POINT_A'));
  }
  assert.strictEqual(state.games[1].isCompleted, true);
  assert.strictEqual(state.games[1].winnerId, 'PARTICIPANT_A');
  assert.strictEqual(state.isCompleted, true);
  assert.strictEqual(state.winnerId, 'PARTICIPANT_A');
});

test('6. Best of 3 ending 2-1', () => {
  const rules = new BadmintonRules();
  let state = rules.getInitialState();

  // Game 1: A wins 21-0
  for (let i = 0; i < 21; i++) {
    state = rules.applyEvent(state, createPointEvent(`g1-a-${i}`, 'POINT_A'));
  }

  // Game 2: B wins 21-0
  for (let i = 0; i < 21; i++) {
    state = rules.applyEvent(state, createPointEvent(`g2-b-${i}`, 'POINT_B'));
  }
  assert.strictEqual(state.games[1].winnerId, 'PARTICIPANT_B');
  assert.strictEqual(state.isCompleted, false);
  assert.strictEqual(state.currentGameIndex, 2);
  assert.strictEqual(state.games.length, 3);

  // Game 3: A wins 21-0
  for (let i = 0; i < 21; i++) {
    state = rules.applyEvent(state, createPointEvent(`g3-a-${i}`, 'POINT_A'));
  }
  assert.strictEqual(state.games[2].winnerId, 'PARTICIPANT_A');
  assert.strictEqual(state.isCompleted, true);
  assert.strictEqual(state.winnerId, 'PARTICIPANT_A');
});

test('7. Undo operations and history reconstruction', () => {
  const rules = new BadmintonRules();
  let state = rules.getInitialState();

  // Score progression
  state = rules.applyEvent(state, createPointEvent('p-1', 'POINT_A'));
  state = rules.applyEvent(state, createPointEvent('p-2', 'POINT_A'));
  state = rules.applyEvent(state, createPointEvent('p-3', 'POINT_B'));

  assert.strictEqual(state.games[0].scoreA, 2);
  assert.strictEqual(state.games[0].scoreB, 1);

  // Undo point B
  state = rules.applyEvent(state, createPointEvent('u-1', 'UNDO'));
  assert.strictEqual(state.games[0].scoreA, 2);
  assert.strictEqual(state.games[0].scoreB, 0);

  // Undo point A
  state = rules.applyEvent(state, createPointEvent('u-2', 'UNDO'));
  assert.strictEqual(state.games[0].scoreA, 1);
  assert.strictEqual(state.games[0].scoreB, 0);
});

test('8. Rejections and constraints verification', () => {
  const rules = new BadmintonRules();
  let state = rules.getInitialState();

  // Win the match (Game 1 and 2 to A)
  for (let i = 0; i < 21; i++) {
    state = rules.applyEvent(state, createPointEvent(`g1-a-${i}`, 'POINT_A'));
  }
  for (let i = 0; i < 21; i++) {
    state = rules.applyEvent(state, createPointEvent(`g2-a-${i}`, 'POINT_A'));
  }

  assert.strictEqual(state.isCompleted, true);

  // Try adding a point after match completed (should be rejected)
  const validation = rules.validateEvent(state, createPointEvent('late-p', 'POINT_A'));
  assert.strictEqual(validation.isValid, false);
  assert.strictEqual(validation.reason, 'Match is already completed');

  // Try submitting duplicate event id (should be rejected)
  const testState = rules.getInitialState();
  const ev1 = createPointEvent('dup-id', 'POINT_A');
  const s1 = rules.applyEvent(testState, ev1);

  const dupValidation = rules.validateEvent(s1, ev1);
  assert.strictEqual(dupValidation.isValid, false);
  assert.strictEqual(dupValidation.reason, 'Event has already been processed');
});
