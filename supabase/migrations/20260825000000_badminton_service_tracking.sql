-- Migration: 20260825000000_badminton_service_tracking.sql
-- Implement authoritative badminton server & receiver tracking, court positions, and RPC validation

-- 1. Add service columns to match_events, games, and matches
ALTER TABLE public.match_events
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS server_player_id uuid REFERENCES public.players(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS receiver_player_id uuid REFERENCES public.players(id) ON DELETE SET NULL;

ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS service_state jsonb DEFAULT NULL;

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS service_state jsonb DEFAULT NULL;

-- 2. Update validate_match_events_lock to allow SET_SERVICE in READY, LIVE, UNDER_REVIEW
CREATE OR REPLACE FUNCTION public.validate_match_events_lock()
RETURNS trigger AS $$
DECLARE
  v_match_status text;
BEGIN
  SELECT status INTO v_match_status
  FROM public.matches
  WHERE id = NEW.match_id;

  IF NEW.event_type = 'SET_SERVICE' THEN
    IF v_match_status NOT IN ('READY', 'LIVE', 'UNDER_REVIEW') THEN
      RAISE EXCEPTION 'Setting service is only allowed when match is READY, LIVE, or UNDER_REVIEW. Current status: %', v_match_status;
    END IF;
  ELSE
    IF v_match_status NOT IN ('LIVE', 'UNDER_REVIEW') THEN
      RAISE EXCEPTION 'Scoring is only allowed when match is LIVE or UNDER_REVIEW. Current status: %', v_match_status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Create set_match_service RPC
CREATE OR REPLACE FUNCTION public.set_match_service(
  p_match_id uuid,
  p_serving_side text,
  p_server_player_id uuid,
  p_receiver_player_id uuid,
  p_side_a_positions jsonb DEFAULT NULL,
  p_side_b_positions jsonb DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
  v_match record;
  v_category record;
  v_serving_part_id uuid;
  v_receiving_part_id uuid;
  v_caller uuid;
  v_can_score boolean;
  v_is_server_valid boolean;
  v_is_receiver_valid boolean;
  v_count_a integer;
  v_count_b integer;
  v_side_a_right uuid;
  v_side_a_left uuid;
  v_side_b_right uuid;
  v_side_b_left uuid;
  v_service_state jsonb;
  v_current_game_num integer;
BEGIN
  v_caller := auth.uid();

  -- 1. Verify caller authorization
  IF v_caller IS NULL OR NOT public.can_score_match(p_match_id, v_caller) THEN
    RAISE EXCEPTION 'Unauthorized: You do not have permission to configure service for this match.';
  END IF;

  -- 2. Fetch match and category details
  SELECT * INTO v_match
  FROM public.matches
  WHERE id = p_match_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Match not found: %', p_match_id;
  END IF;

  IF v_match.status NOT IN ('READY', 'LIVE', 'UNDER_REVIEW') THEN
    RAISE EXCEPTION 'Cannot set service on a match in status %', v_match.status;
  END IF;

  IF v_match.participant_a_id IS NULL OR v_match.participant_b_id IS NULL THEN
    RAISE EXCEPTION 'Both participants must be assigned before configuring service.';
  END IF;

  IF p_serving_side NOT IN ('A', 'B') THEN
    RAISE EXCEPTION 'Invalid serving side: % (must be A or B)', p_serving_side;
  END IF;

  IF p_server_player_id IS NULL OR p_receiver_player_id IS NULL THEN
    RAISE EXCEPTION 'Server and receiver player IDs must not be null.';
  END IF;

  IF p_server_player_id = p_receiver_player_id THEN
    RAISE EXCEPTION 'Server and receiver cannot be the same player.';
  END IF;

  SELECT * INTO v_category
  FROM public.categories
  WHERE id = v_match.category_id;

  -- 3. Verify server belongs to serving side & receiver belongs to receiving side
  IF p_serving_side = 'A' THEN
    v_serving_part_id := v_match.participant_a_id;
    v_receiving_part_id := v_match.participant_b_id;
  ELSE
    v_serving_part_id := v_match.participant_b_id;
    v_receiving_part_id := v_match.participant_a_id;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.participant_members
    WHERE participant_id = v_serving_part_id AND player_id = p_server_player_id
  ) INTO v_is_server_valid;

  IF NOT v_is_server_valid THEN
    RAISE EXCEPTION 'Server player does not belong to the declared serving side.';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.participant_members
    WHERE participant_id = v_receiving_part_id AND player_id = p_receiver_player_id
  ) INTO v_is_receiver_valid;

  IF NOT v_is_receiver_valid THEN
    RAISE EXCEPTION 'Receiver player does not belong to the declared receiving side.';
  END IF;

  -- 4. Category-specific validations (Singles vs Doubles)
  IF v_category.category_type = 'SINGLES' THEN
    SELECT count(*) INTO v_count_a FROM public.participant_members WHERE participant_id = v_match.participant_a_id;
    SELECT count(*) INTO v_count_b FROM public.participant_members WHERE participant_id = v_match.participant_b_id;

    IF v_count_a <> 1 OR v_count_b <> 1 THEN
      RAISE EXCEPTION 'Singles match must have exactly one player per participant.';
    END IF;

    v_service_state := jsonb_build_object(
      'matchType', 'SINGLES',
      'servingSide', p_serving_side,
      'receivingSide', CASE WHEN p_serving_side = 'A' THEN 'B' ELSE 'A' END,
      'serverPlayerId', p_server_player_id,
      'receiverPlayerId', p_receiver_player_id,
      'serverCourt', 'RIGHT',
      'receiverCourt', 'RIGHT'
    );
  ELSE
    -- DOUBLES VALIDATION
    SELECT count(*) INTO v_count_a FROM public.participant_members WHERE participant_id = v_match.participant_a_id;
    SELECT count(*) INTO v_count_b FROM public.participant_members WHERE participant_id = v_match.participant_b_id;

    IF v_count_a <> 2 OR v_count_b <> 2 THEN
      RAISE EXCEPTION 'Doubles match must have exactly two players per participant.';
    END IF;

    -- Extract / Validate positions
    IF p_side_a_positions IS NOT NULL THEN
      v_side_a_right := (p_side_a_positions->>'rightPlayerId')::uuid;
      v_side_a_left := (p_side_a_positions->>'leftPlayerId')::uuid;

      IF v_side_a_right = v_side_a_left THEN
        RAISE EXCEPTION 'Side A court positions cannot contain duplicate player.';
      END IF;

      IF NOT EXISTS (SELECT 1 FROM public.participant_members WHERE participant_id = v_match.participant_a_id AND player_id = v_side_a_right)
         OR NOT EXISTS (SELECT 1 FROM public.participant_members WHERE participant_id = v_match.participant_a_id AND player_id = v_side_a_left) THEN
        RAISE EXCEPTION 'Side A court positions must contain valid participant A players.';
      END IF;
    ELSE
      SELECT player_id INTO v_side_a_right FROM public.participant_members WHERE participant_id = v_match.participant_a_id ORDER BY member_order LIMIT 1;
      SELECT player_id INTO v_side_a_left FROM public.participant_members WHERE participant_id = v_match.participant_a_id ORDER BY member_order OFFSET 1 LIMIT 1;
    END IF;

    IF p_side_b_positions IS NOT NULL THEN
      v_side_b_right := (p_side_b_positions->>'rightPlayerId')::uuid;
      v_side_b_left := (p_side_b_positions->>'leftPlayerId')::uuid;

      IF v_side_b_right = v_side_b_left THEN
        RAISE EXCEPTION 'Side B court positions cannot contain duplicate player.';
      END IF;

      IF NOT EXISTS (SELECT 1 FROM public.participant_members WHERE participant_id = v_match.participant_b_id AND player_id = v_side_b_right)
         OR NOT EXISTS (SELECT 1 FROM public.participant_members WHERE participant_id = v_match.participant_b_id AND player_id = v_side_b_left) THEN
        RAISE EXCEPTION 'Side B court positions must contain valid participant B players.';
      END IF;
    ELSE
      SELECT player_id INTO v_side_b_right FROM public.participant_members WHERE participant_id = v_match.participant_b_id ORDER BY member_order LIMIT 1;
      SELECT player_id INTO v_side_b_left FROM public.participant_members WHERE participant_id = v_match.participant_b_id ORDER BY member_order OFFSET 1 LIMIT 1;
    END IF;

    v_service_state := jsonb_build_object(
      'matchType', 'DOUBLES',
      'servingSide', p_serving_side,
      'receivingSide', CASE WHEN p_serving_side = 'A' THEN 'B' ELSE 'A' END,
      'serverPlayerId', p_server_player_id,
      'receiverPlayerId', p_receiver_player_id,
      'serverCourt', 'RIGHT',
      'receiverCourt', 'RIGHT',
      'sideAPositions', jsonb_build_object('rightPlayerId', v_side_a_right, 'leftPlayerId', v_side_a_left),
      'sideBPositions', jsonb_build_object('rightPlayerId', v_side_b_right, 'leftPlayerId', v_side_b_left)
    );
  END IF;

  -- 5. Insert SET_SERVICE event into match_events
  INSERT INTO public.match_events (
    match_id,
    event_type,
    server_player_id,
    receiver_player_id,
    metadata,
    created_by
  ) VALUES (
    p_match_id,
    'SET_SERVICE',
    p_server_player_id,
    p_receiver_player_id,
    v_service_state,
    v_caller
  );

  -- 6. Update matches and games tables with materialized service_state
  UPDATE public.matches
  SET service_state = v_service_state,
      updated_at = now()
  WHERE id = p_match_id;

  -- Determine current game number (or default to 1)
  SELECT coalesce(max(game_number), 1) INTO v_current_game_num
  FROM public.games
  WHERE match_id = p_match_id;

  UPDATE public.games
  SET service_state = v_service_state
  WHERE match_id = p_match_id AND game_number = v_current_game_num;

  RETURN v_service_state;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
