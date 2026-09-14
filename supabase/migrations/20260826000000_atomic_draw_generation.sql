-- Migration: 20260826000000_atomic_draw_generation.sql
-- Implement atomic, idempotent, concurrency-safe draw generation & integrity for ArenaFlow

-- 1. Unique index for active root draws per category
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_root_draw_per_category 
  ON public.draws (category_id) 
  WHERE parent_draw_id IS NULL;

-- 2. Ensure validate_match_status_transition allows single participant for BYE/walkover completions
CREATE OR REPLACE FUNCTION public.validate_match_status_transition()
RETURNS trigger AS $$
DECLARE
  v_tournament_id uuid;
  v_organizer_id uuid;
BEGIN
  -- If status hasn't changed, do nothing
  IF old.status = new.status THEN
    RETURN new;
  END IF;

  -- 1. Check if both participants are present before going to READY or LIVE
  IF new.status IN ('READY', 'LIVE') THEN
    IF new.participant_a_id IS NULL OR new.participant_b_id IS NULL THEN
      RAISE EXCEPTION 'Cannot transition to % when participant is missing', new.status;
    END IF;
  ELSIF new.status = 'COMPLETED' THEN
    -- Allow COMPLETED when both participants are present, OR when it is a BYE / walkover / single participant with winner set
    IF (new.participant_a_id IS NULL OR new.participant_b_id IS NULL) THEN
      IF new.outcome IS NULL OR (new.winner_id IS NULL AND (new.participant_a_id IS NOT NULL OR new.participant_b_id IS NOT NULL)) THEN
        RAISE EXCEPTION 'Cannot transition to COMPLETED when participant is missing';
      END IF;
    END IF;
  END IF;

  -- 2. Validate transitions
  IF old.status = 'SCHEDULED' AND new.status NOT IN ('READY', 'LIVE', 'COMPLETED', 'CANCELLED', 'POSTPONED', 'UNDER_REVIEW') THEN
    RAISE EXCEPTION 'Invalid status transition from SCHEDULED to %', new.status;
  ELSIF old.status = 'READY' AND new.status NOT IN ('LIVE', 'COMPLETED', 'CANCELLED', 'POSTPONED', 'UNDER_REVIEW') THEN
    RAISE EXCEPTION 'Invalid status transition from READY to %', new.status;
  ELSIF old.status = 'LIVE' AND new.status NOT IN ('PAUSED', 'COMPLETED', 'CANCELLED', 'POSTPONED', 'UNDER_REVIEW') THEN
    RAISE EXCEPTION 'Invalid status transition from LIVE to %', new.status;
  ELSIF old.status = 'PAUSED' AND new.status NOT IN ('LIVE', 'COMPLETED', 'CANCELLED', 'POSTPONED', 'UNDER_REVIEW') THEN
    RAISE EXCEPTION 'Invalid status transition from PAUSED to %', new.status;
  ELSIF old.status = 'COMPLETED' AND new.status NOT IN ('FINAL', 'UNDER_REVIEW', 'CANCELLED', 'POSTPONED') THEN
    RAISE EXCEPTION 'Invalid status transition from COMPLETED to %', new.status;
  ELSIF old.status = 'FINAL' AND new.status <> 'UNDER_REVIEW' THEN
    RAISE EXCEPTION 'Invalid status transition from FINAL to %', new.status;
  ELSIF old.status = 'UNDER_REVIEW' AND new.status NOT IN ('FINAL', 'COMPLETED', 'CANCELLED', 'POSTPONED') THEN
    RAISE EXCEPTION 'Invalid status transition from UNDER_REVIEW to %', new.status;
  END IF;

  -- 3. Verify permissions for FINAL -> UNDER_REVIEW transition
  IF old.status = 'FINAL' AND new.status = 'UNDER_REVIEW' THEN
    SELECT t.id, t.organizer_id INTO v_tournament_id, v_organizer_id
    FROM public.categories c
    JOIN public.tournaments t ON c.tournament_id = t.id
    WHERE c.id = new.category_id;

    IF auth.uid() <> v_organizer_id AND NOT public.is_tournament_admin(v_tournament_id) AND NOT public.is_platform_admin() THEN
      RAISE EXCEPTION 'Only the tournament organizer or admin can reopen a finalized match for correction';
    END IF;
  END IF;

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Atomic Draw Deletion RPC (with match-started protection)
CREATE OR REPLACE FUNCTION public.delete_tournament_draw(
  p_category_id uuid
)
RETURNS jsonb AS $$
DECLARE
  v_caller uuid;
  v_cat record;
  v_started_matches_count integer;
  v_existing_draw record;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Authentication required.';
  END IF;

  -- Lock category for update
  SELECT c.*, t.id AS tourney_id, t.organizer_id
  INTO v_cat
  FROM public.categories c
  JOIN public.tournaments t ON c.tournament_id = t.id
  WHERE c.id = p_category_id
  FOR UPDATE OF c;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Category not found: %', p_category_id;
  END IF;

  IF NOT (
    v_cat.organizer_id = v_caller
    OR public.is_tournament_admin(v_cat.tourney_id)
    OR public.is_platform_admin()
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only the tournament organizer or admin can delete draws.';
  END IF;

  SELECT * INTO v_existing_draw
  FROM public.draws
  WHERE category_id = p_category_id AND parent_draw_id IS NULL
  LIMIT 1;

  IF v_existing_draw.id IS NULL THEN
    RETURN jsonb_build_object('success', true, 'message', 'No draw found to delete.');
  END IF;

  -- Match-started protection: reject if any match is LIVE, PAUSED, COMPLETED, FINAL, UNDER_REVIEW or has scoring events
  SELECT count(*) INTO v_started_matches_count
  FROM public.matches m
  WHERE m.category_id = p_category_id
    AND (
      m.status IN ('LIVE', 'PAUSED', 'COMPLETED', 'FINAL', 'UNDER_REVIEW')
      OR m.started_at IS NOT NULL
      OR EXISTS (SELECT 1 FROM public.match_events me WHERE me.match_id = m.id)
    );

  IF v_started_matches_count > 0 THEN
    RAISE EXCEPTION 'Cannot delete draw: matches have already started or completed in this category.';
  END IF;

  -- Delete draw and all associated entities atomically
  DELETE FROM public.draws WHERE category_id = p_category_id;
  DELETE FROM public.matches WHERE category_id = p_category_id;
  DELETE FROM public.standings WHERE category_id = p_category_id;

  RETURN jsonb_build_object('success', true, 'message', 'Draw and associated matches deleted successfully.');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Atomic Draw Generation RPC (with full transactional rollback, seeding, BYE handling, and concurrency safety)
CREATE OR REPLACE FUNCTION public.generate_tournament_draw(
  p_category_id uuid,
  p_format text,
  p_seeds jsonb DEFAULT '{}'::jsonb,
  p_options jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb AS $$
DECLARE
  v_caller uuid;
  v_cat record;
  v_existing_draw record;
  v_started_matches_count integer;
  v_participant_ids uuid[];
  v_participant_count integer;
  v_draw_id uuid;
  v_format text;
  
  -- Seeding & Sizing variables
  v_p integer;
  v_total_rounds integer;
  v_seed_order integer[];
  v_next_order integer[];
  v_curr_len integer;
  v_next_size integer;
  v_s integer;
  v_lineup uuid[];
  v_seeded_player_ids uuid[];
  v_seeded_ranks integer[];
  v_unseeded_player_ids uuid[];
  v_pid uuid;
  v_seed_val integer;
  v_idx integer;
  v_unseeded_idx integer;
  v_tmp_p uuid;
  v_tmp_r integer;
  v_tmp integer;
  
  -- Bracket building structures
  v_round_size integer;
  v_r integer;
  v_pos integer;
  v_rname text;
  v_rid uuid;
  v_curr_round_id uuid;
  v_match_id uuid;
  v_node_id uuid;
  v_node record;
  v_target_node_id uuid;
  v_parent_pos integer;
  v_r1_nodes record;
  v_p_a uuid;
  v_p_b uuid;
  v_next_m_id uuid;
  
  -- Round Robin variables
  v_rr_players uuid[];
  v_rr_count integer;
  v_rr_rounds integer;
  v_rr_matches_per_round integer;
  v_p1 uuid;
  v_p2 uuid;
  v_standings_id uuid;
  v_rotated uuid[];
  v_last uuid;
  v_round_id uuid;
  
  v_rounds_count integer := 0;
  v_matches_count integer := 0;
  v_nodes_count integer := 0;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Authentication required.';
  END IF;

  -- 1. Validate Category and Tournament Authorization with Row-Level Lock
  SELECT c.*, t.id AS tourney_id, t.organizer_id, t.status AS tournament_status
  INTO v_cat
  FROM public.categories c
  JOIN public.tournaments t ON c.tournament_id = t.id
  WHERE c.id = p_category_id
  FOR UPDATE OF c;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Category not found: %', p_category_id;
  END IF;

  IF NOT (
    v_cat.organizer_id = v_caller
    OR public.is_tournament_admin(v_cat.tourney_id)
    OR public.is_platform_admin()
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only the tournament organizer or admin can generate draws.';
  END IF;

  -- 2. Validate Format
  v_format := upper(trim(p_format));
  IF v_format = 'GROUP_KNOCKOUT' THEN
    RAISE EXCEPTION 'GROUP_KNOCKOUT format is not currently supported in atomic draw generation.';
  ELSIF v_format NOT IN ('KNOCKOUT', 'ROUND_ROBIN') THEN
    RAISE EXCEPTION 'Invalid draw format: %. Must be KNOCKOUT or ROUND_ROBIN.', p_format;
  END IF;

  -- 3. Check Existing Active Root Draw & Idempotency / Regeneration Safety
  SELECT * INTO v_existing_draw
  FROM public.draws
  WHERE category_id = p_category_id AND parent_draw_id IS NULL
  LIMIT 1;

  IF v_existing_draw.id IS NOT NULL THEN
    -- Check if any match in this category has already started, completed, or has scoring events
    SELECT count(*) INTO v_started_matches_count
    FROM public.matches m
    WHERE m.category_id = p_category_id
      AND (
        m.status IN ('LIVE', 'PAUSED', 'COMPLETED', 'FINAL', 'UNDER_REVIEW')
        OR m.started_at IS NOT NULL
        OR EXISTS (SELECT 1 FROM public.match_events me WHERE me.match_id = m.id)
      );

    -- If matches have already started or completed, REJECT immediately (regardless of force_regenerate)
    IF v_started_matches_count > 0 THEN
      RAISE EXCEPTION 'Cannot regenerate draw: matches have already started or completed in this category.';
    END IF;

    -- If force_regenerate is NOT true, return existing draw safely (Idempotency)
    IF (p_options->>'force_regenerate')::boolean IS NOT TRUE THEN
      SELECT count(*) INTO v_rounds_count FROM public.rounds WHERE draw_id = v_existing_draw.id;
      SELECT count(*) INTO v_matches_count FROM public.matches WHERE category_id = p_category_id;
      SELECT count(*) INTO v_nodes_count FROM public.draw_nodes WHERE draw_id = v_existing_draw.id;

      RETURN jsonb_build_object(
        'success', true,
        'idempotent', true,
        'draw_id', v_existing_draw.id,
        'format', v_existing_draw.format,
        'rounds_count', v_rounds_count,
        'matches_count', v_matches_count,
        'nodes_count', v_nodes_count,
        'message', 'Draw already exists for this category.'
      );
    END IF;

    -- If force_regenerate is true and no match has started, delete existing draw atomically
    DELETE FROM public.draws WHERE category_id = p_category_id;
    DELETE FROM public.matches WHERE category_id = p_category_id;
    DELETE FROM public.standings WHERE category_id = p_category_id;
  END IF;

  -- 4. Validate Eligible Active Participants
  SELECT array_agg(id ORDER BY created_at ASC) INTO v_participant_ids
  FROM public.participants
  WHERE category_id = p_category_id AND status = 'ACTIVE';

  v_participant_count := coalesce(array_length(v_participant_ids, 1), 0);
  IF v_participant_count < 2 THEN
    RAISE EXCEPTION 'At least 2 active participants are required to generate a draw. Found %', v_participant_count;
  END IF;

  -- ===========================================================================
  -- 5. KNOCKOUT GENERATION
  -- ===========================================================================
  IF v_format = 'KNOCKOUT' THEN
    -- Calculate power of 2 bracket size
    v_p := 2;
    WHILE v_p < v_participant_count LOOP
      v_p := v_p * 2;
    END LOOP;

    -- Generate standard BWF seed order for size v_p
    v_seed_order := ARRAY[1, 2];
    WHILE array_length(v_seed_order, 1) < v_p LOOP
      v_next_order := ARRAY[]::integer[];
      v_curr_len := array_length(v_seed_order, 1);
      v_next_size := v_curr_len * 2;
      FOREACH v_s IN ARRAY v_seed_order LOOP
        v_next_order := array_append(v_next_order, v_s);
        v_next_order := array_append(v_next_order, v_next_size - v_s + 1);
      END LOOP;
      v_seed_order := v_next_order;
    END LOOP;

    -- Separate seeded and unseeded players
    v_seeded_player_ids := ARRAY[]::uuid[];
    v_seeded_ranks := ARRAY[]::integer[];
    v_unseeded_player_ids := ARRAY[]::uuid[];

    FOREACH v_pid IN ARRAY v_participant_ids LOOP
      IF p_seeds ? v_pid::text THEN
        v_seed_val := (p_seeds->>v_pid::text)::integer;
        v_seeded_player_ids := array_append(v_seeded_player_ids, v_pid);
        v_seeded_ranks := array_append(v_seeded_ranks, v_seed_val);
      ELSE
        v_unseeded_player_ids := array_append(v_unseeded_player_ids, v_pid);
      END IF;
    END LOOP;

    -- Sort seeded players by rank ascending
    IF array_length(v_seeded_player_ids, 1) > 1 THEN
      FOR i IN 1 .. (array_length(v_seeded_player_ids, 1) - 1) LOOP
        FOR j IN (i + 1) .. array_length(v_seeded_player_ids, 1) LOOP
          IF v_seeded_ranks[i] > v_seeded_ranks[j] THEN
            v_tmp_p := v_seeded_player_ids[i];
            v_tmp_r := v_seeded_ranks[i];
            v_seeded_player_ids[i] := v_seeded_player_ids[j];
            v_seeded_ranks[i] := v_seeded_ranks[j];
            v_seeded_player_ids[j] := v_tmp_p;
            v_seeded_ranks[j] := v_tmp_r;
          END IF;
        END LOOP;
      END LOOP;
    END IF;

    -- Initialize lineup array of size v_p with NULLs
    v_lineup := ARRAY[]::uuid[];
    FOR i IN 1 .. v_p LOOP
      v_lineup := array_append(v_lineup, NULL::uuid);
    END LOOP;

    -- Place seeded players into canonical bracket slots
    IF array_length(v_seeded_player_ids, 1) > 0 THEN
      FOR i IN 1 .. array_length(v_seeded_player_ids, 1) LOOP
        v_pid := v_seeded_player_ids[i];
        v_seed_val := v_seeded_ranks[i];
        
        v_idx := 0;
        FOR k IN 1 .. v_p LOOP
          IF v_seed_order[k] = v_seed_val THEN
            v_idx := k;
            EXIT;
          END IF;
        END LOOP;

        IF v_idx > 0 AND v_idx <= v_p AND v_lineup[v_idx] IS NULL THEN
          v_lineup[v_idx] := v_pid;
        ELSE
          v_unseeded_player_ids := array_prepend(v_pid, v_unseeded_player_ids);
        END IF;
      END LOOP;
    END IF;

    -- Place unseeded players in remaining empty slots
    v_unseeded_idx := 1;
    FOR i IN 1 .. v_p LOOP
      IF v_lineup[i] IS NULL AND v_unseeded_idx <= coalesce(array_length(v_unseeded_player_ids, 1), 0) THEN
        v_lineup[i] := v_unseeded_player_ids[v_unseeded_idx];
        v_unseeded_idx := v_unseeded_idx + 1;
      END IF;
    END LOOP;

    -- Insert Draw Record
    INSERT INTO public.draws (category_id, format, status)
    VALUES (p_category_id, 'KNOCKOUT', 'DRAFT')
    RETURNING id INTO v_draw_id;

    -- Calculate total rounds R = log2(P)
    v_total_rounds := 0;
    v_tmp := v_p;
    WHILE v_tmp > 1 LOOP
      v_total_rounds := v_total_rounds + 1;
      v_tmp := v_tmp / 2;
    END LOOP;

    -- Create Rounds
    FOR v_r IN 1 .. v_total_rounds LOOP
      IF v_r = v_total_rounds THEN
        v_rname := 'Final';
      ELSIF v_r = v_total_rounds - 1 THEN
        v_rname := 'Semi-Final';
      ELSIF v_r = v_total_rounds - 2 THEN
        v_rname := 'Quarter-Final';
      ELSE
        v_rname := 'Round ' || v_r;
      END IF;

      INSERT INTO public.rounds (draw_id, round_number, name)
      VALUES (v_draw_id, v_r, v_rname)
      RETURNING id INTO v_rid;

      v_rounds_count := v_rounds_count + 1;
    END LOOP;

    -- Create Matches and Draw Nodes for all rounds
    v_round_size := v_p / 2;
    FOR v_r IN 1 .. v_total_rounds LOOP
      SELECT id INTO v_curr_round_id FROM public.rounds WHERE draw_id = v_draw_id AND round_number = v_r;

      FOR v_pos IN 0 .. (v_round_size - 1) LOOP
        INSERT INTO public.matches (
          category_id,
          round_id,
          participant_a_id,
          participant_b_id,
          status,
          duration_minutes,
          buffer_minutes
        ) VALUES (
          p_category_id,
          v_curr_round_id,
          NULL,
          NULL,
          'SCHEDULED',
          45,
          10
        ) RETURNING id INTO v_match_id;
        v_matches_count := v_matches_count + 1;

        INSERT INTO public.draw_nodes (
          draw_id,
          round_number,
          position,
          match_id,
          next_node_id
        ) VALUES (
          v_draw_id,
          v_r,
          v_pos,
          v_match_id,
          NULL
        ) RETURNING id INTO v_node_id;
        v_nodes_count := v_nodes_count + 1;
      END LOOP;

      v_round_size := v_round_size / 2;
    END LOOP;

    -- Wire up next_node_id bracket advancement relationships
    FOR v_r IN 1 .. (v_total_rounds - 1) LOOP
      FOR v_node IN (SELECT id, position FROM public.draw_nodes WHERE draw_id = v_draw_id AND round_number = v_r) LOOP
        v_parent_pos := v_node.position / 2;
        SELECT id INTO v_target_node_id
        FROM public.draw_nodes
        WHERE draw_id = v_draw_id AND round_number = v_r + 1 AND position = v_parent_pos;

        UPDATE public.draw_nodes
        SET next_node_id = v_target_node_id
        WHERE id = v_node.id;
      END LOOP;
    END LOOP;

    -- Assign Round 1 Participants and Process BYEs
    FOR v_r1_nodes IN (SELECT id, position, match_id, next_node_id FROM public.draw_nodes WHERE draw_id = v_draw_id AND round_number = 1 ORDER BY position ASC) LOOP
      v_p_a := v_lineup[2 * v_r1_nodes.position + 1];
      v_p_b := v_lineup[2 * v_r1_nodes.position + 2];

      IF v_p_a IS NULL AND v_p_b IS NULL THEN
        -- Both slots empty
        UPDATE public.matches
        SET participant_a_id = NULL, participant_b_id = NULL, status = 'COMPLETED', winner_id = NULL, outcome = 'COMPLETED'
        WHERE id = v_r1_nodes.match_id;
      ELSIF v_p_a IS NOT NULL AND v_p_b IS NULL THEN
        -- Player A has a BYE
        UPDATE public.matches
        SET participant_a_id = v_p_a, participant_b_id = NULL, status = 'COMPLETED', winner_id = v_p_a, outcome = 'COMPLETED'
        WHERE id = v_r1_nodes.match_id;

        -- Advance Player A to next round
        IF v_r1_nodes.next_node_id IS NOT NULL THEN
          SELECT match_id INTO v_next_m_id FROM public.draw_nodes WHERE id = v_r1_nodes.next_node_id;
          IF v_r1_nodes.position % 2 = 0 THEN
            UPDATE public.matches SET participant_a_id = v_p_a WHERE id = v_next_m_id;
          ELSE
            UPDATE public.matches SET participant_b_id = v_p_a WHERE id = v_next_m_id;
          END IF;
        END IF;
      ELSIF v_p_b IS NOT NULL AND v_p_a IS NULL THEN
        -- Player B has a BYE
        UPDATE public.matches
        SET participant_a_id = NULL, participant_b_id = v_p_b, status = 'COMPLETED', winner_id = v_p_b, outcome = 'COMPLETED'
        WHERE id = v_r1_nodes.match_id;

        -- Advance Player B to next round
        IF v_r1_nodes.next_node_id IS NOT NULL THEN
          SELECT match_id INTO v_next_m_id FROM public.draw_nodes WHERE id = v_r1_nodes.next_node_id;
          IF v_r1_nodes.position % 2 = 0 THEN
            UPDATE public.matches SET participant_a_id = v_p_b WHERE id = v_next_m_id;
          ELSE
            UPDATE public.matches SET participant_b_id = v_p_b WHERE id = v_next_m_id;
          END IF;
        END IF;
      ELSE
        -- Both players present -> Ready to play
        UPDATE public.matches
        SET participant_a_id = v_p_a, participant_b_id = v_p_b, status = 'READY'
        WHERE id = v_r1_nodes.match_id;
      END IF;
    END LOOP;

    -- Update Ready status for subsequent rounds if both players are present
    UPDATE public.matches
    SET status = 'READY'
    WHERE category_id = p_category_id
      AND participant_a_id IS NOT NULL
      AND participant_b_id IS NOT NULL
      AND status = 'SCHEDULED';

  -- ===========================================================================
  -- 6. ROUND ROBIN GENERATION
  -- ===========================================================================
  ELSIF v_format = 'ROUND_ROBIN' THEN
    v_rr_players := v_participant_ids;
    IF array_length(v_rr_players, 1) % 2 <> 0 THEN
      v_rr_players := array_append(v_rr_players, NULL::uuid); -- BYE dummy
    END IF;

    v_rr_count := array_length(v_rr_players, 1);
    v_rr_rounds := v_rr_count - 1;
    v_rr_matches_per_round := v_rr_count / 2;

    -- Insert Draw Record
    INSERT INTO public.draws (category_id, format, status)
    VALUES (p_category_id, 'ROUND_ROBIN', 'DRAFT')
    RETURNING id INTO v_draw_id;

    -- Generate Rounds and Fixtures
    FOR v_r IN 1 .. v_rr_rounds LOOP
      INSERT INTO public.rounds (draw_id, round_number, name)
      VALUES (v_draw_id, v_r, 'Round ' || v_r)
      RETURNING id INTO v_round_id;
      v_rounds_count := v_rounds_count + 1;

      FOR i IN 0 .. (v_rr_matches_per_round - 1) LOOP
        v_p1 := v_rr_players[i + 1];
        v_p2 := v_rr_players[v_rr_count - i];

        -- Skip fixture if either participant is BYE dummy (NULL)
        IF v_p1 IS NOT NULL AND v_p2 IS NOT NULL THEN
          INSERT INTO public.matches (
            category_id,
            round_id,
            participant_a_id,
            participant_b_id,
            status,
            duration_minutes,
            buffer_minutes
          ) VALUES (
            p_category_id,
            v_round_id,
            v_p1,
            v_p2,
            'READY',
            45,
            10
          );
          v_matches_count := v_matches_count + 1;
        END IF;
      END LOOP;

      -- Rotate array (fixed first element, circular shift of remainder)
      v_rotated := ARRAY[v_rr_players[1]];
      v_last := v_rr_players[v_rr_count];
      v_rotated := array_append(v_rotated, v_last);
      FOR k IN 2 .. (v_rr_count - 1) LOOP
        v_rotated := array_append(v_rotated, v_rr_players[k]);
      END LOOP;
      v_rr_players := v_rotated;
    END LOOP;

    -- Create Standings and Standings Entries
    INSERT INTO public.standings (category_id, draw_id)
    VALUES (p_category_id, v_draw_id)
    RETURNING id INTO v_standings_id;

    FOREACH v_pid IN ARRAY v_participant_ids LOOP
      INSERT INTO public.standings_entries (
        standings_id,
        participant_id,
        rank,
        played,
        won,
        lost,
        points_for,
        points_against
      ) VALUES (
        v_standings_id,
        v_pid,
        1,
        0,
        0,
        0,
        0,
        0
      );
    END LOOP;
  END IF;

  -- 7. Failure Simulation for Automated Rollback Testing
  IF (p_options->>'simulate_failure')::boolean IS TRUE THEN
    RAISE EXCEPTION 'Simulated transaction failure for atomic rollback testing.';
  END IF;

  -- 8. Return Summary
  RETURN jsonb_build_object(
    'success', true,
    'idempotent', false,
    'draw_id', v_draw_id,
    'format', v_format,
    'rounds_count', v_rounds_count,
    'matches_count', v_matches_count,
    'nodes_count', v_nodes_count,
    'participants_count', v_participant_count
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
