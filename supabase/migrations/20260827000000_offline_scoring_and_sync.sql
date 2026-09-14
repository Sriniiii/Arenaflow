-- Migration: 20260827000000_offline_scoring_and_sync.sql
-- Implement Offline Scoring, Client Event Idempotency, and Reliable Synchronization for ArenaFlow

-- 1. Add client_event_id to public.match_events if not present
ALTER TABLE public.match_events
  ADD COLUMN IF NOT EXISTS client_event_id uuid DEFAULT NULL;

-- 2. Create partial unique index on (match_id, client_event_id) to enforce server-side idempotency
CREATE UNIQUE INDEX IF NOT EXISTS idx_match_events_client_event_id
  ON public.match_events (match_id, client_event_id)
  WHERE client_event_id IS NOT NULL;

-- 3. Dedicated Server-Side Batch Synchronization RPC
CREATE OR REPLACE FUNCTION public.sync_match_events(
  p_match_id uuid,
  p_events jsonb,
  p_options jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb AS $$
DECLARE
  v_caller uuid;
  v_match record;
  v_category record;
  v_max_seq integer;
  v_current_game_num integer;
  v_game record;
  v_event jsonb;
  v_client_event_id uuid;
  v_event_type text;
  v_expected_base_seq integer;
  v_local_order integer;
  v_server_player_id uuid;
  v_receiver_player_id uuid;
  v_metadata jsonb;
  v_existing_event record;
  v_has_conflict boolean := false;
  v_conflict_reason text := null;
  v_processed_results jsonb := '[]'::jsonb;
  v_new_events_count integer := 0;
  v_idempotent_count integer := 0;
  v_accepted_seq integer;
  v_part_a_id uuid;
  v_part_b_id uuid;
  v_all_events record;
  v_score_a integer := 0;
  v_score_b integer := 0;
  v_games_won_a integer := 0;
  v_games_won_b integer := 0;
  v_game_scores jsonb := '[]'::jsonb;
  v_latest_service jsonb := null;
  v_is_game_completed boolean := false;
  v_game_winner_id uuid := null;
  v_match_winner_id uuid := null;
  v_is_match_over boolean := false;
  v_batch_len integer;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Authentication required.';
  END IF;

  -- 1. Verify caller authorization to score this match
  IF NOT public.can_score_match(p_match_id, v_caller) THEN
    RAISE EXCEPTION 'Unauthorized: Caller does not have permissions to score match %', p_match_id;
  END IF;

  -- 2. Lock target match row to serialize synchronization
  SELECT * INTO v_match
  FROM public.matches
  WHERE id = p_match_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Match not found: %', p_match_id;
  END IF;

  -- Fetch Category
  SELECT * INTO v_category
  FROM public.categories
  WHERE id = v_match.category_id;

  v_part_a_id := v_match.participant_a_id;
  v_part_b_id := v_match.participant_b_id;

  -- 3. Validate Batch Size
  v_batch_len := jsonb_array_length(p_events);
  IF v_batch_len = 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'synced_count', 0,
      'idempotent_count', 0,
      'results', '[]'::jsonb,
      'message', 'Empty batch.'
    );
  END IF;

  IF v_batch_len > 100 THEN
    RAISE EXCEPTION 'Batch size exceeds maximum limit of 100 events.';
  END IF;

  -- 4. Get Current Server Max Sequence Number
  SELECT COALESCE(MAX(sequence_number), 0)
  INTO v_max_seq
  FROM public.match_events
  WHERE match_id = p_match_id;

  -- 5. Process each event in the batch
  FOR i IN 0 .. (v_batch_len - 1) LOOP
    v_event := p_events->i;
    v_client_event_id := (v_event->>'client_event_id')::uuid;
    v_event_type := upper(trim(v_event->>'event_type'));
    v_local_order := coalesce((v_event->>'local_order')::integer, i + 1);
    v_expected_base_seq := (v_event->>'expected_server_sequence')::integer;
    v_server_player_id := (v_event->>'server_player_id')::uuid;
    v_receiver_player_id := (v_event->>'receiver_player_id')::uuid;
    v_metadata := coalesce(v_event->'metadata', '{}'::jsonb);

    -- Validate client_event_id
    IF v_client_event_id IS NULL THEN
      RAISE EXCEPTION 'Event at index % is missing required client_event_id.', i;
    END IF;

    -- Validate Event Type
    IF v_event_type NOT IN ('POINT_A', 'POINT_B', 'UNDO', 'SET_SERVICE') THEN
      RAISE EXCEPTION 'Invalid event type: % at index %', v_event_type, i;
    END IF;

    -- Check Match Lifecycle for event
    IF v_event_type = 'SET_SERVICE' THEN
      IF v_match.status NOT IN ('READY', 'LIVE', 'UNDER_REVIEW') THEN
        RAISE EXCEPTION 'Cannot set service on match with status %', v_match.status;
      END IF;
    ELSE
      IF v_match.status NOT IN ('LIVE', 'UNDER_REVIEW') THEN
        RAISE EXCEPTION 'Scoring events are only allowed when match is LIVE or UNDER_REVIEW. Current status: %', v_match.status;
      END IF;
    END IF;

    -- A. Idempotency Check: Already present in match_events?
    SELECT * INTO v_existing_event
    FROM public.match_events
    WHERE match_id = p_match_id AND client_event_id = v_client_event_id
    LIMIT 1;

    IF v_existing_event.id IS NOT NULL THEN
      -- Already acknowledged idempotently
      v_idempotent_count := v_idempotent_count + 1;
      v_processed_results := v_processed_results || jsonb_build_object(
        'client_event_id', v_client_event_id,
        'status', 'ACKNOWLEDGED',
        'is_idempotent', true,
        'sequence_number', v_existing_event.sequence_number,
        'event_type', v_existing_event.event_type
      );
      CONTINUE;
    END IF;

    -- B. Conflict Detection Check
    -- If conflict has already occurred in earlier event of this batch, block subsequent events
    IF v_has_conflict THEN
      v_processed_results := v_processed_results || jsonb_build_object(
        'client_event_id', v_client_event_id,
        'status', 'BLOCKED_BY_CONFLICT',
        'reason', v_conflict_reason
      );
      CONTINUE;
    END IF;

    -- If this is the first new event and client expected a base sequence lower than current server sequence:
    -- CONFLICT: Server has advanced concurrently while client was disconnected.
    IF v_new_events_count = 0 AND v_expected_base_seq IS NOT NULL AND v_expected_base_seq < v_max_seq THEN
      v_has_conflict := true;
      v_conflict_reason := format('Stale predecessor: client expected base sequence %s, but server authoritative sequence is %s.', v_expected_base_seq, v_max_seq);

      v_processed_results := v_processed_results || jsonb_build_object(
        'client_event_id', v_client_event_id,
        'status', 'CONFLICT',
        'expected_server_sequence', v_expected_base_seq,
        'current_server_sequence', v_max_seq,
        'reason', v_conflict_reason
      );
      CONTINUE;
    END IF;

    -- C. Insert Accepted Event
    -- Let trigger assign_match_event_sequence_number_trigger safely generate next sequence_number
    INSERT INTO public.match_events (
      match_id,
      client_event_id,
      event_type,
      server_player_id,
      receiver_player_id,
      metadata,
      created_by
    ) VALUES (
      p_match_id,
      v_client_event_id,
      v_event_type,
      v_server_player_id,
      v_receiver_player_id,
      v_metadata,
      v_caller
    ) RETURNING sequence_number INTO v_accepted_seq;

    v_new_events_count := v_new_events_count + 1;
    v_max_seq := v_accepted_seq;

    v_processed_results := v_processed_results || jsonb_build_object(
      'client_event_id', v_client_event_id,
      'status', 'ACKNOWLEDGED',
      'is_idempotent', false,
      'sequence_number', v_accepted_seq,
      'event_type', v_event_type
    );
  END LOOP;

  -- 6. State Materialization (if any new events were inserted)
  IF v_new_events_count > 0 THEN
    -- Find latest service state and game scores by iterating over active events
    -- Extract latest metadata
    SELECT metadata INTO v_latest_service
    FROM public.match_events
    WHERE match_id = p_match_id AND metadata IS NOT NULL AND metadata <> '{}'::jsonb
    ORDER BY sequence_number DESC
    LIMIT 1;

    IF v_latest_service IS NOT NULL THEN
      UPDATE public.matches
      SET service_state = v_latest_service,
          updated_at = now()
      WHERE id = p_match_id;

      SELECT coalesce(max(game_number), 1) INTO v_current_game_num
      FROM public.games
      WHERE match_id = p_match_id;

      UPDATE public.games
      SET service_state = v_latest_service
      WHERE match_id = p_match_id AND game_number = v_current_game_num;
    END IF;
  END IF;

  -- 7. Return Synchronization Summary
  RETURN jsonb_build_object(
    'success', NOT v_has_conflict,
    'has_conflict', v_has_conflict,
    'conflict_reason', v_conflict_reason,
    'synced_count', v_new_events_count,
    'idempotent_count', v_idempotent_count,
    'current_server_sequence', v_max_seq,
    'match_status', v_match.status,
    'results', v_processed_results
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
