import {
  BadmintonRules,
  BadmintonMatchState,
  BadmintonMatchConfig,
  FootballRules,
  FootballMatchState,
  FootballMatchConfig,
  MatchEvent
} from '@arena-flow/sport-engine';

export type SyncStatus = 'PENDING' | 'SYNCING' | 'SYNCED' | 'CONFLICT' | 'BLOCKED';

export type OfflineMatchEventType =
  | 'POINT_A'
  | 'POINT_B'
  | 'UNDO'
  | 'SET_SERVICE'
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
  | string;

export interface OfflineMatchEvent {
  client_event_id: string;
  match_id: string;
  game_id?: string;
  event_type: OfflineMatchEventType;
  local_order: number;
  created_at: string;
  expected_server_sequence: number;
  server_player_id?: string | null;
  receiver_player_id?: string | null;
  metadata?: any;
  sync_status: SyncStatus;
  retry_count: number;
  error_message?: string;
}

export interface SyncResult {
  success: boolean;
  synced_count: number;
  idempotent_count: number;
  has_conflict: boolean;
  conflict_reason?: string;
  current_server_sequence?: number;
  results?: Array<{
    client_event_id: string;
    status: string;
    is_idempotent?: boolean;
    sequence_number?: number;
    reason?: string;
  }>;
  error?: string;
}

const DB_NAME = 'ArenaFlow_OfflineScoring_v1';
const DB_VERSION = 1;
const STORE_NAME = 'pending_events';

// In-memory fallback for Node / SSR / non-indexedDB environments
const inMemoryStore = new Map<string, OfflineMatchEvent>();

function isIndexedDBAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
}

export function openOfflineDB(): Promise<IDBDatabase | null> {
  if (!isIndexedDBAvailable()) {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'client_event_id' });
        store.createIndex('by_match', 'match_id', { unique: false });
        store.createIndex('by_status', 'sync_status', { unique: false });
        store.createIndex('by_order', ['match_id', 'local_order'], { unique: false });
      }
    };

    request.onsuccess = (event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };

    request.onerror = (event) => {
      console.warn('IndexedDB open error, using in-memory store:', (event.target as IDBOpenDBRequest).error);
      resolve(null);
    };
  });
}

export async function enqueueOfflineEvent(event: OfflineMatchEvent): Promise<void> {
  const db = await openOfflineDB();
  if (!db) {
    inMemoryStore.set(event.client_event_id, { ...event });
    return;
  }

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(event);

      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    } catch (err) {
      inMemoryStore.set(event.client_event_id, { ...event });
      resolve();
    }
  });
}

export async function getPendingEventsForMatch(matchId: string): Promise<OfflineMatchEvent[]> {
  const db = await openOfflineDB();
  if (!db) {
    return Array.from(inMemoryStore.values())
      .filter((e) => e.match_id === matchId && (e.sync_status === 'PENDING' || e.sync_status === 'SYNCING'))
      .sort((a, b) => a.local_order - b.local_order);
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('by_match');
      const req = index.getAll(matchId);

      req.onsuccess = () => {
        const results = (req.result as OfflineMatchEvent[]) || [];
        const pending = results
          .filter((e) => e.sync_status === 'PENDING' || e.sync_status === 'SYNCING')
          .sort((a, b) => a.local_order - b.local_order);
        resolve(pending);
      };

      req.onerror = () => {
        resolve([]);
      };
    } catch (err) {
      resolve([]);
    }
  });
}

export async function getAllEventsForMatch(matchId: string): Promise<OfflineMatchEvent[]> {
  const db = await openOfflineDB();
  if (!db) {
    return Array.from(inMemoryStore.values())
      .filter((e) => e.match_id === matchId)
      .sort((a, b) => a.local_order - b.local_order);
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('by_match');
      const req = index.getAll(matchId);

      req.onsuccess = () => {
        const results = (req.result as OfflineMatchEvent[]) || [];
        resolve(results.sort((a, b) => a.local_order - b.local_order));
      };

      req.onerror = () => resolve([]);
    } catch (err) {
      resolve([]);
    }
  });
}

export async function updateEventStatus(
  clientEventId: string,
  status: SyncStatus,
  error?: string
): Promise<void> {
  const db = await openOfflineDB();
  if (!db) {
    const existing = inMemoryStore.get(clientEventId);
    if (existing) {
      existing.sync_status = status;
      if (error) existing.error_message = error;
      inMemoryStore.set(clientEventId, existing);
    }
    return;
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const getReq = store.get(clientEventId);

      getReq.onsuccess = () => {
        const item = getReq.result as OfflineMatchEvent | undefined;
        if (item) {
          item.sync_status = status;
          if (error) item.error_message = error;
          store.put(item);
        }
        resolve();
      };
      getReq.onerror = () => resolve();
    } catch (err) {
      resolve();
    }
  });
}

export async function removeEventsForMatch(matchId: string, clientEventIds: string[]): Promise<void> {
  const db = await openOfflineDB();
  if (!db) {
    for (const id of clientEventIds) {
      inMemoryStore.delete(id);
    }
    return;
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      for (const id of clientEventIds) {
        store.delete(id);
      }

      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch (err) {
      resolve();
    }
  });
}

export async function clearAllOfflineEvents(): Promise<void> {
  inMemoryStore.clear();
  const db = await openOfflineDB();
  if (!db) return;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch (err) {
      resolve();
    }
  });
}

/**
 * Deterministically reconstruct Badminton match state by applying:
 * 1. Server authoritative events (ordered by sequence_number)
 * 2. Pending local events (ordered by local_order)
 * Deduplicating any client_event_id that exists in both.
 */
export function reconstructOfflineMatchState(
  serverEvents: any[],
  pendingEvents: OfflineMatchEvent[],
  config?: BadmintonMatchConfig
): BadmintonMatchState {
  const rules = new BadmintonRules();
  let state = rules.getInitialState(config);

  const seenClientEventIds = new Set<string>();

  // 1. Apply Server Authoritative Events
  const sortedServer = [...serverEvents].sort(
    (a, b) => (a.sequence_number || 0) - (b.sequence_number || 0)
  );

  for (const sEv of sortedServer) {
    if (sEv.client_event_id) {
      seenClientEventIds.add(sEv.client_event_id);
    }
    state = rules.applyEvent(state, {
      id: sEv.id || sEv.client_event_id || `srv-${sEv.sequence_number}`,
      type: sEv.event_type || sEv.type,
      metadata: sEv.metadata,
      server_player_id: sEv.server_player_id,
      receiver_player_id: sEv.receiver_player_id,
      timestamp: sEv.created_at || new Date().toISOString()
    } as any);
  }

  // 2. Apply Pending Local Events (skipping already acknowledged or conflicted)
  const validPending = pendingEvents
    .filter(
      (p) =>
        !seenClientEventIds.has(p.client_event_id) &&
        p.sync_status !== 'CONFLICT' &&
        p.sync_status !== 'BLOCKED'
    )
    .sort((a, b) => a.local_order - b.local_order);

  for (const pEv of validPending) {
    seenClientEventIds.add(pEv.client_event_id);
    state = rules.applyEvent(state, {
      id: pEv.client_event_id,
      type: pEv.event_type,
      metadata: pEv.metadata,
      server_player_id: pEv.server_player_id,
      receiver_player_id: pEv.receiver_player_id,
      timestamp: pEv.created_at
    } as any);
  }

  return state;
}

/**
 * Deterministically reconstruct Football match state by applying:
 * 1. Server authoritative events (ordered by sequence_number)
 * 2. Pending local events (ordered by local_order)
 * Deduplicating any client_event_id that exists in both.
 */
export function reconstructOfflineFootballMatchState(
  serverEvents: any[],
  pendingEvents: OfflineMatchEvent[],
  config?: Partial<FootballMatchConfig>
): FootballMatchState {
  const rules = new FootballRules();
  let state = rules.getInitialState(config);

  const seenClientEventIds = new Set<string>();

  // 1. Apply Server Authoritative Events
  const sortedServer = [...serverEvents].sort(
    (a, b) => (a.sequence_number || 0) - (b.sequence_number || 0)
  );

  for (const sEv of sortedServer) {
    if (sEv.client_event_id) {
      seenClientEventIds.add(sEv.client_event_id);
    }
    const eType = sEv.event_type || sEv.type;
    const rawMeta = sEv.metadata || sEv.event_data || {};
    let normalizedMeta = rawMeta;

    if (eType === 'SET_LINEUP') {
      const lineup = rawMeta.lineup;
      if (!lineup || !Array.isArray(lineup.startingXI) || !Array.isArray(lineup.substitutes)) {
        throw new Error(
          `Malformed SET_LINEUP event (id: ${sEv.id || sEv.client_event_id || 'unknown'}): metadata.lineup.startingXI and metadata.lineup.substitutes must be arrays. Payload: ${JSON.stringify(rawMeta)}`
        );
      }
      normalizedMeta = {
        team: (rawMeta.team || rawMeta.side || 'A').toUpperCase(),
        teamId: rawMeta.teamId || rawMeta.participant_id,
        lineup: {
          startingXI: [...lineup.startingXI],
          substitutes: [...lineup.substitutes],
          captainId: lineup.captainId,
          positions: lineup.positions || {}
        }
      };
    }

    state = rules.applyEvent(state, {
      id: sEv.id || sEv.client_event_id || `srv-${sEv.sequence_number}`,
      type: eType,
      metadata: normalizedMeta,
      timestamp: sEv.created_at || new Date().toISOString()
    } as any);
  }

  // 2. Apply Pending Local Events (skipping already acknowledged or conflicted)
  const validPending = pendingEvents
    .filter(
      (p) =>
        !seenClientEventIds.has(p.client_event_id) &&
        p.sync_status !== 'CONFLICT' &&
        p.sync_status !== 'BLOCKED'
    )
    .sort((a, b) => a.local_order - b.local_order);

  for (const pEv of validPending) {
    seenClientEventIds.add(pEv.client_event_id);
    const eType = pEv.event_type;
    const rawMeta = pEv.metadata || {};
    let normalizedMeta = rawMeta;

    if (eType === 'SET_LINEUP') {
      const lineup = rawMeta.lineup;
      if (!lineup || !Array.isArray(lineup.startingXI) || !Array.isArray(lineup.substitutes)) {
        throw new Error(
          `Malformed SET_LINEUP event (id: ${pEv.client_event_id}): metadata.lineup.startingXI and metadata.lineup.substitutes must be arrays. Payload: ${JSON.stringify(rawMeta)}`
        );
      }
      normalizedMeta = {
        team: (rawMeta.team || rawMeta.side || 'A').toUpperCase(),
        teamId: rawMeta.teamId || rawMeta.participant_id,
        lineup: {
          startingXI: [...lineup.startingXI],
          substitutes: [...lineup.substitutes],
          captainId: lineup.captainId,
          positions: lineup.positions || {}
        }
      };
    }

    state = rules.applyEvent(state, {
      id: pEv.client_event_id,
      type: eType,
      metadata: normalizedMeta,
      timestamp: pEv.created_at
    } as any);
  }

  return state;
}

const FOOTBALL_EVENT_TYPES = new Set([
  'SET_LINEUP',
  'START_FIRST_HALF',
  'END_FIRST_HALF',
  'START_SECOND_HALF',
  'END_SECOND_HALF',
  'START_EXTRA_TIME_FIRST_HALF',
  'END_EXTRA_TIME_FIRST_HALF',
  'START_EXTRA_TIME_SECOND_HALF',
  'END_EXTRA_TIME_SECOND_HALF',
  'START_PENALTY_SHOOTOUT',
  'PENALTY_KICK',
  'GOAL',
  'OWN_GOAL',
  'YELLOW_CARD',
  'RED_CARD',
  'SUBSTITUTION',
  'PAUSE_MATCH',
  'RESUME_MATCH',
  'DECLARE_OUTCOME'
]);

/**
 * Synchronize all pending events for a match to the server.
 * Uses client_event_id idempotency and conflict detection.
 */
export async function syncPendingMatchEvents(
  matchId: string,
  supabaseClient: any,
  options?: { isFootball?: boolean }
): Promise<SyncResult> {
  const pending = await getPendingEventsForMatch(matchId);
  if (pending.length === 0) {
    return {
      success: true,
      synced_count: 0,
      idempotent_count: 0,
      has_conflict: false
    };
  }

  // Check if this batch is for a football match
  const isFootballMatch = options?.isFootball || pending.some(p => FOOTBALL_EVENT_TYPES.has(p.event_type));

  // Mark all pending as SYNCING
  for (const p of pending) {
    await updateEventStatus(p.client_event_id, 'SYNCING');
  }

  if (isFootballMatch) {
    let syncedCount = 0;
    let idempotentCount = 0;
    const results: Array<{ client_event_id: string; status: string; is_idempotent?: boolean; reason?: string }> = [];
    const ackIds: string[] = [];

    try {
      for (const p of pending) {
        if (p.event_type === 'SET_LINEUP') {
          const lineup = p.metadata?.lineup;
          const startingXI = Array.isArray(lineup?.startingXI) ? lineup.startingXI : [];
          const substitutes = Array.isArray(lineup?.substitutes) ? lineup.substitutes : [];
          const captainId = lineup?.captainId || null;
          const positions = lineup?.positions || {};
          const team = (p.metadata?.team || 'A').toUpperCase();

          const { error } = await supabaseClient.rpc('set_football_lineup', {
            p_match_id: matchId,
            p_team: team,
            p_starting_xi: startingXI,
            p_substitutes: substitutes,
            p_captain_id: captainId,
            p_positions: positions
          });
          if (error) {
            await updateEventStatus(p.client_event_id, 'CONFLICT', error.message);
            results.push({ client_event_id: p.client_event_id, status: 'CONFLICT', reason: error.message });
            break;
          } else {
            ackIds.push(p.client_event_id);
            syncedCount += 1;
            results.push({ client_event_id: p.client_event_id, status: 'ACKNOWLEDGED' });
          }
        } else {
          const { error } = await supabaseClient.rpc('apply_football_match_event', {
            p_match_id: matchId,
            p_event_type: p.event_type,
            p_metadata: p.metadata || {},
            p_client_event_id: p.client_event_id
          });
          if (error) {
            await updateEventStatus(p.client_event_id, 'CONFLICT', error.message);
            results.push({ client_event_id: p.client_event_id, status: 'CONFLICT', reason: error.message });
            break;
          } else {
            ackIds.push(p.client_event_id);
            syncedCount += 1;
            results.push({ client_event_id: p.client_event_id, status: 'ACKNOWLEDGED' });
          }
        }
      }

      if (ackIds.length > 0) {
        await removeEventsForMatch(matchId, ackIds);
      }

      return {
        success: results.every(r => r.status === 'ACKNOWLEDGED'),
        synced_count: syncedCount,
        idempotent_count: idempotentCount,
        has_conflict: results.some(r => r.status === 'CONFLICT'),
        results
      };
    } catch (err: any) {
      for (const p of pending) {
        await updateEventStatus(p.client_event_id, 'PENDING', err.message);
      }
      return {
        success: false,
        synced_count: 0,
        idempotent_count: 0,
        has_conflict: false,
        error: err.message || 'Unknown sync error'
      };
    }
  }

  // Prepare JSON batch payload for Badminton sync_match_events
  const payload = pending.map((p) => ({
    client_event_id: p.client_event_id,
    event_type: p.event_type,
    local_order: p.local_order,
    expected_server_sequence: p.expected_server_sequence,
    server_player_id: p.server_player_id || null,
    receiver_player_id: p.receiver_player_id || null,
    metadata: p.metadata || {}
  }));

  try {
    const { data, error } = await supabaseClient.rpc('sync_match_events', {
      p_match_id: matchId,
      p_events: payload
    });

    if (error) {
      // Revert status to PENDING on network error
      for (const p of pending) {
        await updateEventStatus(p.client_event_id, 'PENDING', error.message);
      }
      return {
        success: false,
        synced_count: 0,
        idempotent_count: 0,
        has_conflict: false,
        error: error.message
      };
    }

    const results = data?.results || [];
    const ackIds: string[] = [];

    for (const r of results) {
      if (r.status === 'ACKNOWLEDGED') {
        ackIds.push(r.client_event_id);
      } else if (r.status === 'CONFLICT') {
        await updateEventStatus(r.client_event_id, 'CONFLICT', r.reason || 'State conflict');
      } else if (r.status === 'BLOCKED_BY_CONFLICT') {
        await updateEventStatus(r.client_event_id, 'BLOCKED', r.reason || 'Blocked by earlier conflict');
      }
    }

    // Remove acknowledged events from IndexedDB
    if (ackIds.length > 0) {
      await removeEventsForMatch(matchId, ackIds);
    }

    return {
      success: data?.success ?? true,
      synced_count: data?.synced_count || 0,
      idempotent_count: data?.idempotent_count || 0,
      has_conflict: data?.has_conflict || false,
      conflict_reason: data?.conflict_reason,
      current_server_sequence: data?.current_server_sequence,
      results
    };
  } catch (err: any) {
    for (const p of pending) {
      await updateEventStatus(p.client_event_id, 'PENDING', err.message);
    }
    return {
      success: false,
      synced_count: 0,
      idempotent_count: 0,
      has_conflict: false,
      error: err.message || 'Unknown sync error'
    };
  }
}
