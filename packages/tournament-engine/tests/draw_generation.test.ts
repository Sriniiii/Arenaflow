import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  generateKnockoutStructure,
  generateRoundRobinFixtures
} from '../src/index';

describe('Tournament Engine — Draw Generation Unit Tests', () => {

  // ---------------------------------------------------------------------------
  // 1. KNOCKOUT STRUCTURE & SEEDING TESTS
  // ---------------------------------------------------------------------------
  describe('1. Knockout Structure & Seeding', () => {
    test('1.1. 4-Player Knockout: 2 rounds, 3 matches, 3 nodes, correct linkage', () => {
      const participants = ['p1', 'p2', 'p3', 'p4'];
      const seeds = { p1: 1, p2: 2, p3: 3, p4: 4 };
      const { matches, nodes } = generateKnockoutStructure(participants, { seeds });

      assert.strictEqual(matches.length, 3, '4-player bracket must have 3 matches');
      assert.strictEqual(nodes.length, 3, '4-player bracket must have 3 draw nodes');

      // Round 1
      const r1Matches = matches.filter(m => m.round_number === 1);
      assert.strictEqual(r1Matches.length, 2);
      // Canonical BWF: Seed 1 plays Seed 4 in match 0; Seed 2 plays Seed 3 in match 1
      assert.strictEqual(r1Matches[0].participant_a_id, 'p1'); // Seed 1
      assert.strictEqual(r1Matches[0].participant_b_id, 'p4'); // Seed 4
      assert.strictEqual(r1Matches[0].status, 'READY');

      assert.strictEqual(r1Matches[1].participant_a_id, 'p2'); // Seed 2
      assert.strictEqual(r1Matches[1].participant_b_id, 'p3'); // Seed 3
      assert.strictEqual(r1Matches[1].status, 'READY');

      // Round 2 (Final)
      const r2Matches = matches.filter(m => m.round_number === 2);
      assert.strictEqual(r2Matches.length, 1);
      assert.strictEqual(r2Matches[0].status, 'SCHEDULED');
      assert.strictEqual(r2Matches[0].participant_a_id, null);
      assert.strictEqual(r2Matches[0].participant_b_id, null);

      // Node linkages
      assert.strictEqual(nodes[0].next_node_index, 2);
      assert.strictEqual(nodes[1].next_node_index, 2);
      assert.strictEqual(nodes[2].next_node_index, null);
    });

    test('1.2. 8-Player Knockout: 3 rounds, 7 matches, 7 nodes, canonical BWF seed placement', () => {
      const participants = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
      const seeds = { p1: 1, p2: 2, p3: 3, p4: 4, p5: 5, p6: 6, p7: 7, p8: 8 };
      const { matches, nodes } = generateKnockoutStructure(participants, { seeds });

      assert.strictEqual(matches.length, 7, '8-player bracket must have 7 matches');
      assert.strictEqual(nodes.length, 7, '8-player bracket must have 7 draw nodes');

      // Round 1: 4 matches
      const r1 = matches.filter(m => m.round_number === 1);
      assert.strictEqual(r1.length, 4);
      // BWF Seed Order for 8: [1, 8, 4, 5, 2, 7, 3, 6]
      // Match 0: 1 vs 8
      assert.strictEqual(r1[0].participant_a_id, 'p1');
      assert.strictEqual(r1[0].participant_b_id, 'p8');
      // Match 1: 4 vs 5
      assert.strictEqual(r1[1].participant_a_id, 'p4');
      assert.strictEqual(r1[1].participant_b_id, 'p5');
      // Match 2: 2 vs 7
      assert.strictEqual(r1[2].participant_a_id, 'p2');
      assert.strictEqual(r1[2].participant_b_id, 'p7');
      // Match 3: 3 vs 6
      assert.strictEqual(r1[3].participant_a_id, 'p3');
      assert.strictEqual(r1[3].participant_b_id, 'p6');

      // Check all Round 1 are READY
      r1.forEach(m => assert.strictEqual(m.status, 'READY'));

      // Semi-Final linkages
      assert.strictEqual(nodes[0].next_node_index, 4);
      assert.strictEqual(nodes[1].next_node_index, 4);
      assert.strictEqual(nodes[2].next_node_index, 5);
      assert.strictEqual(nodes[3].next_node_index, 5);
      // Final linkages
      assert.strictEqual(nodes[4].next_node_index, 6);
      assert.strictEqual(nodes[5].next_node_index, 6);
      assert.strictEqual(nodes[6].next_node_index, null);
    });

    test('1.3. 3-Player Knockout (Non-Power-of-Two): 1 BYE automatically advances Seed 1', () => {
      const participants = ['p1', 'p2', 'p3'];
      const seeds = { p1: 1, p2: 2, p3: 3 };
      const { matches } = generateKnockoutStructure(participants, { seeds });

      assert.strictEqual(matches.length, 3);
      const r1 = matches.filter(m => m.round_number === 1);

      // Match 0: Seed 1 (p1) vs null (BYE) -> COMPLETED, winner = p1
      assert.strictEqual(r1[0].participant_a_id, 'p1');
      assert.strictEqual(r1[0].participant_b_id, null);
      assert.strictEqual(r1[0].status, 'COMPLETED');
      assert.strictEqual(r1[0].winner_id, 'p1');

      // Match 1: Seed 2 (p2) vs Seed 3 (p3) -> READY
      assert.strictEqual(r1[1].participant_a_id, 'p2');
      assert.strictEqual(r1[1].participant_b_id, 'p3');
      assert.strictEqual(r1[1].status, 'READY');

      // Final Match (r2[0]): p1 automatically advanced to participant_a_id, waiting for winner of Match 1
      const r2 = matches.filter(m => m.round_number === 2);
      assert.strictEqual(r2[0].participant_a_id, 'p1');
      assert.strictEqual(r2[0].participant_b_id, null);
      assert.strictEqual(r2[0].status, 'SCHEDULED');
    });

    test('1.4. 5-Player Knockout (Non-Power-of-Two): 3 BYEs advance Seeds 2, 3 and unseeded p5', () => {
      const participants = ['p1', 'p2', 'p3', 'p4', 'p5'];
      const seeds = { p1: 1, p2: 2, p3: 3 };
      const { matches } = generateKnockoutStructure(participants, { seeds });

      assert.strictEqual(matches.length, 7);
      const r1 = matches.filter(m => m.round_number === 1);

      // In 8-slot bracket for 5 players:
      // Lineup: [p1, p4, p5, null, p2, null, p3, null]
      // Match 0 (p1 vs p4): READY
      // Match 1 (p5 vs null): COMPLETED, winner = p5
      // Match 2 (p2 vs null): COMPLETED, winner = p2
      // Match 3 (p3 vs null): COMPLETED, winner = p3
      const completedByes = r1.filter(m => m.status === 'COMPLETED');
      const readyMatches = r1.filter(m => m.status === 'READY');

      assert.strictEqual(completedByes.length, 3, 'Must have 3 BYE matches');
      assert.strictEqual(readyMatches.length, 1, 'Must have 1 active Round 1 match');

      assert.ok(completedByes.some(m => m.winner_id === 'p2'), 'Seed 2 advanced via BYE');
      assert.ok(completedByes.some(m => m.winner_id === 'p3'), 'Seed 3 advanced via BYE');
      assert.ok(completedByes.some(m => m.winner_id === 'p5'), 'Player 5 advanced via BYE');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. ROUND ROBIN FIXTURE GENERATION TESTS
  // ---------------------------------------------------------------------------
  describe('2. Round Robin Fixtures', () => {
    test('2.1. 4-Player Round Robin: 3 rounds, 6 unique matches, no self-pairing', () => {
      const participants = ['p1', 'p2', 'p3', 'p4'];
      const fixtures = generateRoundRobinFixtures(participants);

      assert.strictEqual(fixtures.length, 6, '4 players -> 4*3/2 = 6 matches');

      const rounds = new Set(fixtures.map(f => f.round));
      assert.strictEqual(rounds.size, 3, 'Must have 3 rounds');

      const pairSet = new Set<string>();
      for (const f of fixtures) {
        assert.notStrictEqual(f.participant_a_id, f.participant_b_id, 'Cannot play self');
        const key = [f.participant_a_id, f.participant_b_id].sort().join('-');
        assert.ok(!pairSet.has(key), `Pair ${key} must be unique across tournament`);
        pairSet.add(key);
      }
      assert.strictEqual(pairSet.size, 6, 'All 6 pairings must be unique');
    });

    test('2.2. 5-Player Round Robin (Odd N): 5 rounds, 10 unique matches, 1 BYE per round', () => {
      const participants = ['p1', 'p2', 'p3', 'p4', 'p5'];
      const fixtures = generateRoundRobinFixtures(participants);

      assert.strictEqual(fixtures.length, 10, '5 players -> 5*4/2 = 10 matches');

      const rounds = new Set(fixtures.map(f => f.round));
      assert.strictEqual(rounds.size, 5, 'Must have 5 rounds');

      // Every round must have exactly 2 matches (4 players active, 1 on BYE)
      for (let r = 1; r <= 5; r++) {
        const roundFixtures = fixtures.filter(f => f.round === r);
        assert.strictEqual(roundFixtures.length, 2, `Round ${r} must have 2 matches`);
      }

      const pairSet = new Set<string>();
      for (const f of fixtures) {
        assert.notStrictEqual(f.participant_a_id, f.participant_b_id, 'Cannot play self');
        const key = [f.participant_a_id, f.participant_b_id].sort().join('-');
        assert.ok(!pairSet.has(key), `Pair ${key} must be unique`);
        pairSet.add(key);
      }
      assert.strictEqual(pairSet.size, 10, 'All 10 pairings must be unique');
    });

    test('2.3. 6-Player Round Robin: 5 rounds, 15 unique matches', () => {
      const participants = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
      const fixtures = generateRoundRobinFixtures(participants);

      assert.strictEqual(fixtures.length, 15, '6 players -> 6*5/2 = 15 matches');
      const rounds = new Set(fixtures.map(f => f.round));
      assert.strictEqual(rounds.size, 5, 'Must have 5 rounds');

      const pairSet = new Set<string>();
      for (const f of fixtures) {
        const key = [f.participant_a_id, f.participant_b_id].sort().join('-');
        pairSet.add(key);
      }
      assert.strictEqual(pairSet.size, 15);
    });
  });
});
