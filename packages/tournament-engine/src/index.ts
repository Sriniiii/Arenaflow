export interface DrawNode {
  id: string;
  round_number: number;
  position: number;
  match_index: number;
  next_node_index: number | null;
}

export interface KnockoutMatch {
  id: string;
  round_number: number;
  position: number;
  participant_a_id: string | null;
  participant_b_id: string | null;
  status: 'SCHEDULED' | 'READY' | 'COMPLETED';
  winner_id: string | null;
  outcome?: 'COMPLETED' | 'WALKOVER' | 'RETIREMENT' | 'DEFAULT' | null;
}

export interface DrawStructure {
  matches: KnockoutMatch[];
  nodes: DrawNode[];
}

export interface RoundRobinFixture {
  round: number;
  participant_a_id: string | null;
  participant_b_id: string | null;
}

export function generateKnockoutStructure(
  participantIds: string[],
  options: { seeds?: Record<string, number> } = {}
): DrawStructure {
  const N = participantIds.length;
  if (N === 0) return { matches: [], nodes: [] };

  // 1. Calculate P (next power of 2)
  let P = 2;
  while (P < N) {
    P *= 2;
  }

  // 2. Generate standard bracket seed ordering
  const seedOrder = getBracketOrder(P);

  // 3. Separate seeded and unseeded players
  const seeds = options.seeds || {};
  const seededPlayers: { id: string; seed: number }[] = [];
  const unseededPlayers: string[] = [];

  for (const id of participantIds) {
    if (seeds[id] !== undefined) {
      seededPlayers.push({ id, seed: seeds[id] });
    } else {
      unseededPlayers.push(id);
    }
  }

  // Sort seeded players by seed rank ascending
  seededPlayers.sort((a, b) => a.seed - b.seed);

  // 4. Line up players in the P slots
  const lineup: (string | null)[] = new Array(P).fill(null);
  
  // Place seeded players
  for (const sp of seededPlayers) {
    const idx = seedOrder.indexOf(sp.seed);
    if (idx !== -1 && idx < P) {
      lineup[idx] = sp.id;
    } else {
      unseededPlayers.unshift(sp.id);
    }
  }

  // Place unseeded players in remaining empty slots
  let unseededIdx = 0;
  for (let i = 0; i < P; i++) {
    if (lineup[i] === null && unseededIdx < unseededPlayers.length) {
      lineup[i] = unseededPlayers[unseededIdx++];
    }
  }

  // 5. Build nodes and matches round-by-round
  const nodesList: DrawNode[] = [];
  const matchesList: KnockoutMatch[] = [];
  const roundNodes: Record<number, number[]> = {};

  let roundNum = 1;
  let currentRoundSize = P / 2;

  while (currentRoundSize >= 1) {
    roundNodes[roundNum] = [];
    for (let pos = 0; pos < currentRoundSize; pos++) {
      const matchIdx = matchesList.length;
      matchesList.push({
        id: `temp-match-${roundNum}-${pos}`,
        round_number: roundNum,
        position: pos,
        participant_a_id: null,
        participant_b_id: null,
        status: 'SCHEDULED',
        winner_id: null
      });

      const nodeIdx = nodesList.length;
      nodesList.push({
        id: `temp-node-${roundNum}-${pos}`,
        round_number: roundNum,
        position: pos,
        match_index: matchIdx,
        next_node_index: null
      });
      roundNodes[roundNum].push(nodeIdx);
    }
    roundNum++;
    currentRoundSize /= 2;
  }

  // Wire up next_node_index
  const totalRounds = roundNum - 1;
  for (let r = 1; r < totalRounds; r++) {
    const currentRoundIdxs = roundNodes[r];
    const nextRoundIdxs = roundNodes[r + 1];
    for (let i = 0; i < currentRoundIdxs.length; i++) {
      const parentPos = Math.floor(i / 2);
      nodesList[currentRoundIdxs[i]].next_node_index = nextRoundIdxs[parentPos];
    }
  }

  // Populate Round 1 participants from the lineup
  const r1Nodes = roundNodes[1];
  for (let i = 0; i < r1Nodes.length; i++) {
    const matchIdx = nodesList[r1Nodes[i]].match_index;
    const match = matchesList[matchIdx];
    match.participant_a_id = lineup[2 * i];
    match.participant_b_id = lineup[2 * i + 1];

    if (match.participant_a_id === null && match.participant_b_id === null) {
      match.status = 'COMPLETED';
      match.winner_id = null;
      match.outcome = 'COMPLETED';
    } else if (match.participant_b_id === null) {
      match.status = 'COMPLETED';
      match.winner_id = match.participant_a_id;
      match.outcome = 'COMPLETED';
    } else if (match.participant_a_id === null) {
      match.status = 'COMPLETED';
      match.winner_id = match.participant_b_id;
      match.outcome = 'COMPLETED';
    } else {
      match.status = 'READY';
    }
  }

  // Propagate winners to subsequent rounds
  for (let r = 1; r < totalRounds; r++) {
    const currentRoundIdxs = roundNodes[r];
    for (let i = 0; i < currentRoundIdxs.length; i++) {
      const node = nodesList[currentRoundIdxs[i]];
      const match = matchesList[node.match_index];
      
      if (match.status === 'COMPLETED' && match.winner_id !== null) {
        const nextNodeIdx = node.next_node_index;
        if (nextNodeIdx !== null) {
          const nextNode = nodesList[nextNodeIdx];
          const nextMatch = matchesList[nextNode.match_index];
          
          if (node.position % 2 === 0) {
            nextMatch.participant_a_id = match.winner_id;
          } else {
            nextMatch.participant_b_id = match.winner_id;
          }
        }
      }
    }

    const nextRoundIdxs = roundNodes[r + 1];
    for (const nodeIdx of nextRoundIdxs) {
      const node = nodesList[nodeIdx];
      const match = matchesList[node.match_index];
      if (match.participant_a_id !== null && match.participant_b_id !== null) {
        match.status = 'READY';
      }
    }
  }

  return { matches: matchesList, nodes: nodesList };
}

function getBracketOrder(size: number): number[] {
  let order = [1, 2];
  while (order.length < size) {
    const nextOrder: number[] = [];
    const nextSize = order.length * 2;
    for (const seed of order) {
      nextOrder.push(seed);
      nextOrder.push(nextSize - seed + 1);
    }
    order = nextOrder;
  }
  return order;
}

export function generateRoundRobinFixtures(participantIds: string[]): RoundRobinFixture[] {
  const players = [...participantIds];
  if (players.length === 0) return [];
  
  if (players.length % 2 !== 0) {
    players.push(null as any); // Add BYE
  }

  const P = players.length;
  const numRounds = P - 1;
  const matchesPerRound = P / 2;
  const fixtures: RoundRobinFixture[] = [];

  for (let round = 1; round <= numRounds; round++) {
    for (let i = 0; i < matchesPerRound; i++) {
      const a = players[i];
      const b = players[P - 1 - i];
      
      if (a === null || b === null) continue; // Skip BYEs
      
      fixtures.push({
        round,
        participant_a_id: a,
        participant_b_id: b
      });
    }
    
    const last = players.pop()!;
    players.splice(1, 0, last);
  }

  return fixtures;
}

export function checkScheduleConflict(
  existingMatches: {
    id?: string;
    participant_a_id: string | null;
    participant_b_id: string | null;
    court_id: string | null;
    scheduled_at: string | null;
    duration_minutes?: number | null;
    buffer_minutes?: number | null;
    status: string;
  }[],
  candidate: {
    id?: string;
    participant_a_id: string | null;
    participant_b_id: string | null;
    court_id: string | null;
    scheduled_at: string;
    duration_minutes: number;
    buffer_minutes: number;
  }
): { conflict: boolean; reason?: string } {
  if (!candidate.scheduled_at || !candidate.court_id) {
    return { conflict: false };
  }

  const candStart = new Date(candidate.scheduled_at).getTime();
  const candEnd = candStart + (candidate.duration_minutes + candidate.buffer_minutes) * 60 * 1000;

  for (const m of existingMatches) {
    if (candidate.id && m.id === candidate.id) continue;
    if (m.status === 'CANCELLED') continue;
    if (!m.scheduled_at) continue;

    const mStart = new Date(m.scheduled_at).getTime();
    const mDuration = m.duration_minutes ?? 45;
    const mBuffer = m.buffer_minutes ?? 10;
    const mEnd = mStart + (mDuration + mBuffer) * 60 * 1000;

    const isOverlapping = candStart < mEnd && mStart < candEnd;

    if (isOverlapping) {
      if (m.court_id === candidate.court_id) {
        return {
          conflict: true,
          reason: `Court is already booked for an overlapping match.`
        };
      }

      const candidates = new Set([candidate.participant_a_id, candidate.participant_b_id].filter(Boolean));
      if (
        (m.participant_a_id && candidates.has(m.participant_a_id)) ||
        (m.participant_b_id && candidates.has(m.participant_b_id))
      ) {
        return {
          conflict: true,
          reason: `One of the players/teams is already scheduled to play in an overlapping match.`
        };
      }
    }
  }

  return { conflict: false };
}

export interface GroupAllocation {
  groupIndex: number;
  groupName: string;
  participantIds: string[];
}

export function allocateParticipantsToGroups(
  participantIds: string[],
  numGroups: number,
  options: {
    method?: 'SNAKE' | 'SEED' | 'SEQUENTIAL';
    seeds?: Record<string, number>;
  } = {}
): GroupAllocation[] {
  if (numGroups < 2) {
    throw new Error('Number of groups must be at least 2');
  }

  const groups: GroupAllocation[] = Array.from({ length: numGroups }, (_, i) => ({
    groupIndex: i,
    groupName: `Group ${String.fromCharCode(65 + i)}`,
    participantIds: []
  }));

  if (participantIds.length === 0) return groups;

  const method = options.method || 'SNAKE';
  const seeds = options.seeds || {};

  // Separate seeded and unseeded players
  const seededPlayers: { id: string; seed: number }[] = [];
  const unseededPlayers: string[] = [];

  for (const id of participantIds) {
    if (seeds[id] !== undefined) {
      seededPlayers.push({ id, seed: seeds[id] });
    } else {
      unseededPlayers.push(id);
    }
  }

  // Sort seeded players ascending
  seededPlayers.sort((a, b) => a.seed - b.seed);

  if (method === 'SNAKE') {
    // Distribute seeded players in snake order
    let groupIdx = 0;
    let forward = true;

    for (const sp of seededPlayers) {
      groups[groupIdx].participantIds.push(sp.id);
      if (forward) {
        if (groupIdx === numGroups - 1) {
          forward = false;
        } else {
          groupIdx++;
        }
      } else {
        if (groupIdx === 0) {
          forward = true;
        } else {
          groupIdx--;
        }
      }
    }

    // Continue distributing unseeded players in snake order
    for (const up of unseededPlayers) {
      groups[groupIdx].participantIds.push(up);
      if (forward) {
        if (groupIdx === numGroups - 1) {
          forward = false;
        } else {
          groupIdx++;
        }
      } else {
        if (groupIdx === 0) {
          forward = true;
        } else {
          groupIdx--;
        }
      }
    }
  } else {
    // SEQUENTIAL or SEED
    const allPlayers = [...seededPlayers.map(p => p.id), ...unseededPlayers];
    for (let i = 0; i < allPlayers.length; i++) {
      const gIdx = i % numGroups;
      groups[gIdx].participantIds.push(allPlayers[i]);
    }
  }

  return groups;
}

export interface GroupQualifier {
  groupName: string;
  rank: number;
  participantId: string;
}

export interface CrossGroupPairing {
  participantA: GroupQualifier;
  participantB: GroupQualifier;
}

export function getCrossGroupKnockoutPairings(
  groups: { groupName: string; qualifiers: string[] }[]
): {
  round1Lineup: (string | null)[];
  pairings: CrossGroupPairing[];
} {
  const numGroups = groups.length;
  if (numGroups === 0) return { round1Lineup: [], pairings: [] };

  const qualifiersPerGroup = groups[0]?.qualifiers?.length || 0;
  if (qualifiersPerGroup === 0) return { round1Lineup: [], pairings: [] };

  const pairings: CrossGroupPairing[] = [];
  const lineup: (string | null)[] = [];

  if (numGroups === 2 && qualifiersPerGroup === 2) {
    // Semifinal 1: A1 vs B2
    // Semifinal 2: B1 vs A2
    const a1: GroupQualifier = { groupName: groups[0].groupName, rank: 1, participantId: groups[0].qualifiers[0] };
    const a2: GroupQualifier = { groupName: groups[0].groupName, rank: 2, participantId: groups[0].qualifiers[1] };
    const b1: GroupQualifier = { groupName: groups[1].groupName, rank: 1, participantId: groups[1].qualifiers[0] };
    const b2: GroupQualifier = { groupName: groups[1].groupName, rank: 2, participantId: groups[1].qualifiers[1] };

    pairings.push({ participantA: a1, participantB: b2 });
    pairings.push({ participantA: b1, participantB: a2 });

    lineup.push(a1.participantId, b2.participantId, b1.participantId, a2.participantId);
  } else if (numGroups === 4 && qualifiersPerGroup === 2) {
    // 4 Groups, Top 2
    // Top Half: A1 vs B2, C1 vs D2
    // Bottom Half: B1 vs A2, D1 vs C2
    const g = (idx: number, rank: number): GroupQualifier => ({
      groupName: groups[idx].groupName,
      rank,
      participantId: groups[idx].qualifiers[rank - 1]
    });

    const m1 = { participantA: g(0, 1), participantB: g(1, 2) }; // A1 vs B2
    const m2 = { participantA: g(2, 1), participantB: g(3, 2) }; // C1 vs D2
    const m3 = { participantA: g(1, 1), participantB: g(0, 2) }; // B1 vs A2
    const m4 = { participantA: g(3, 1), participantB: g(2, 2) }; // D1 vs C2

    pairings.push(m1, m2, m3, m4);
    lineup.push(
      m1.participantA.participantId, m1.participantB.participantId,
      m2.participantA.participantId, m2.participantB.participantId,
      m3.participantA.participantId, m3.participantB.participantId,
      m4.participantA.participantId, m4.participantB.participantId
    );
  } else if (qualifiersPerGroup === 1) {
    // 1 Qualifier per group: Pair sequentially across groups
    for (let i = 0; i < numGroups; i += 2) {
      if (i + 1 < numGroups) {
        const pA: GroupQualifier = { groupName: groups[i].groupName, rank: 1, participantId: groups[i].qualifiers[0] };
        const pB: GroupQualifier = { groupName: groups[i + 1].groupName, rank: 1, participantId: groups[i + 1].qualifiers[0] };
        pairings.push({ participantA: pA, participantB: pB });
        lineup.push(pA.participantId, pB.participantId);
      } else {
        const pA: GroupQualifier = { groupName: groups[i].groupName, rank: 1, participantId: groups[i].qualifiers[0] };
        lineup.push(pA.participantId, null);
      }
    }
  } else {
    // General fallback for any other group/qualifier configurations
    // Place rank 1s in upper half cross-paired with opposite group rank 2s
    const firsts: GroupQualifier[] = [];
    const seconds: GroupQualifier[] = [];
    for (let i = 0; i < numGroups; i++) {
      if (groups[i].qualifiers[0]) {
        firsts.push({ groupName: groups[i].groupName, rank: 1, participantId: groups[i].qualifiers[0] });
      }
      if (groups[i].qualifiers[1]) {
        seconds.push({ groupName: groups[i].groupName, rank: 2, participantId: groups[i].qualifiers[1] });
      }
    }

    for (let i = 0; i < firsts.length; i++) {
      const pA = firsts[i];
      const pB = seconds[(i + 1) % seconds.length] || null;
      if (pB) {
        pairings.push({ participantA: pA, participantB: pB });
        lineup.push(pA.participantId, pB.participantId);
      } else {
        lineup.push(pA.participantId, null);
      }
    }
  }

  return { round1Lineup: lineup, pairings };
}

export {
  sortStandings,
  calculateStandings,
  StandingEntry,
  StandingsResult,
  StandingsOptions
} from '@arena-flow/statistics-engine';
