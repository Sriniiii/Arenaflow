-- Migration: 20260828000000_group_knockout_format.sql
-- Group + Knockout Tournament Format (GROUP_KNOCKOUT)
-- Comprehensive Group Stage generation, Standings, Terminal Match Completion Validation, and Knockout Stage Generation

-- 1. Update generate_tournament_draw to fully support GROUP_KNOCKOUT format
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
  
  -- Group Knockout variables
  v_num_groups integer;
  v_alloc_method text;
  v_groups uuid[][];
  v_group_counts integer[];
  v_g_idx integer;
  v_forward boolean;
  v_child_draw_id uuid;
  v_group_name text;
  v_group_players uuid[];
  v_groups_created integer := 0;
  
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
  IF v_format NOT IN ('KNOCKOUT', 'ROUND_ROBIN', 'GROUP_KNOCKOUT') THEN
    RAISE EXCEPTION 'Invalid draw format: %. Must be KNOCKOUT, ROUND_ROBIN, or GROUP_KNOCKOUT.', p_format;
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
      SELECT count(*) INTO v_rounds_count FROM public.rounds r JOIN public.draws d ON r.draw_id = d.id WHERE d.category_id = p_category_id;
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
        UPDATE public.matches
        SET participant_a_id = NULL, participant_b_id = NULL, status = 'COMPLETED', winner_id = NULL, outcome = 'COMPLETED'
        WHERE id = v_r1_nodes.match_id;
      ELSIF v_p_a IS NOT NULL AND v_p_b IS NULL THEN
        UPDATE public.matches
        SET participant_a_id = v_p_a, participant_b_id = NULL, status = 'COMPLETED', winner_id = v_p_a, outcome = 'COMPLETED'
        WHERE id = v_r1_nodes.match_id;

        IF v_r1_nodes.next_node_id IS NOT NULL THEN
          SELECT match_id INTO v_next_m_id FROM public.draw_nodes WHERE id = v_r1_nodes.next_node_id;
          IF v_r1_nodes.position % 2 = 0 THEN
            UPDATE public.matches SET participant_a_id = v_p_a WHERE id = v_next_m_id;
          ELSE
            UPDATE public.matches SET participant_b_id = v_p_a WHERE id = v_next_m_id;
          END IF;
        END IF;
      ELSIF v_p_b IS NOT NULL AND v_p_a IS NULL THEN
        UPDATE public.matches
        SET participant_a_id = NULL, participant_b_id = v_p_b, status = 'COMPLETED', winner_id = v_p_b, outcome = 'COMPLETED'
        WHERE id = v_r1_nodes.match_id;

        IF v_r1_nodes.next_node_id IS NOT NULL THEN
          SELECT match_id INTO v_next_m_id FROM public.draw_nodes WHERE id = v_r1_nodes.next_node_id;
          IF v_r1_nodes.position % 2 = 0 THEN
            UPDATE public.matches SET participant_a_id = v_p_b WHERE id = v_next_m_id;
          ELSE
            UPDATE public.matches SET participant_b_id = v_p_b WHERE id = v_next_m_id;
          END IF;
        END IF;
      ELSE
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
      v_rr_players := array_append(v_rr_players, NULL::uuid);
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

      -- Rotate array
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

  -- ===========================================================================
  -- 7. GROUP + KNOCKOUT (GROUP STAGE GENERATION)
  -- ===========================================================================
  ELSIF v_format = 'GROUP_KNOCKOUT' THEN
    v_num_groups := coalesce((p_options->>'num_groups')::integer, 2);
    v_alloc_method := upper(coalesce(p_options->>'allocation_method', 'SNAKE'));

    IF v_num_groups < 2 THEN
      RAISE EXCEPTION 'Number of groups must be at least 2. Provided: %', v_num_groups;
    END IF;

    IF v_participant_count < v_num_groups * 2 THEN
      RAISE EXCEPTION 'At least % participants required for % groups (minimum 2 per group). Found: %', v_num_groups * 2, v_num_groups, v_participant_count;
    END IF;

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

    -- Create Root Draw Record
    INSERT INTO public.draws (category_id, format, status)
    VALUES (p_category_id, 'GROUP_KNOCKOUT', 'DRAFT')
    RETURNING id INTO v_draw_id;

    -- Allocate players into groups using temporary table for flexibility
    CREATE TEMPORARY TABLE temp_group_allocations (
      group_idx integer,
      participant_id uuid
    ) ON COMMIT DROP;

    v_g_idx := 0;
    v_forward := true;

    IF v_alloc_method = 'SNAKE' THEN
      -- Distribute seeded players in snake order
      IF array_length(v_seeded_player_ids, 1) > 0 THEN
        FOR i IN 1 .. array_length(v_seeded_player_ids, 1) LOOP
          INSERT INTO temp_group_allocations (group_idx, participant_id)
          VALUES (v_g_idx, v_seeded_player_ids[i]);

          IF v_forward THEN
            IF v_g_idx = v_num_groups - 1 THEN
              v_forward := false;
            ELSE
              v_g_idx := v_g_idx + 1;
            END IF;
          ELSE
            IF v_g_idx = 0 THEN
              v_forward := true;
            ELSE
              v_g_idx := v_g_idx - 1;
            END IF;
          END IF;
        END LOOP;
      END IF;

      -- Distribute unseeded players continuing snake order
      IF array_length(v_unseeded_player_ids, 1) > 0 THEN
        FOR i IN 1 .. array_length(v_unseeded_player_ids, 1) LOOP
          INSERT INTO temp_group_allocations (group_idx, participant_id)
          VALUES (v_g_idx, v_unseeded_player_ids[i]);

          IF v_forward THEN
            IF v_g_idx = v_num_groups - 1 THEN
              v_forward := false;
            ELSE
              v_g_idx := v_g_idx + 1;
            END IF;
          ELSE
            IF v_g_idx = 0 THEN
              v_forward := true;
            ELSE
              v_g_idx := v_g_idx - 1;
            END IF;
          END IF;
        END LOOP;
      END IF;
    ELSE
      -- SEQUENTIAL distribution
      v_g_idx := 0;
      IF array_length(v_seeded_player_ids, 1) > 0 THEN
        FOR i IN 1 .. array_length(v_seeded_player_ids, 1) LOOP
          INSERT INTO temp_group_allocations (group_idx, participant_id)
          VALUES (v_g_idx, v_seeded_player_ids[i]);
          v_g_idx := (v_g_idx + 1) % v_num_groups;
        END LOOP;
      END IF;
      IF array_length(v_unseeded_player_ids, 1) > 0 THEN
        FOR i IN 1 .. array_length(v_unseeded_player_ids, 1) LOOP
          INSERT INTO temp_group_allocations (group_idx, participant_id)
          VALUES (v_g_idx, v_unseeded_player_ids[i]);
          v_g_idx := (v_g_idx + 1) % v_num_groups;
        END LOOP;
      END IF;
    END IF;

    -- For each group, create child draw, standings, rounds, and round-robin matches
    FOR g IN 0 .. (v_num_groups - 1) LOOP
      v_group_name := 'Group ' || chr(65 + g);
      
      SELECT array_agg(participant_id) INTO v_group_players
      FROM temp_group_allocations
      WHERE group_idx = g;

      -- Insert Child Draw for Group
      INSERT INTO public.draws (category_id, format, status, parent_draw_id, group_name)
      VALUES (p_category_id, 'ROUND_ROBIN', 'DRAFT', v_draw_id, v_group_name)
      RETURNING id INTO v_child_draw_id;

      v_groups_created := v_groups_created + 1;

      -- Create Standings for Group
      INSERT INTO public.standings (category_id, draw_id)
      VALUES (p_category_id, v_child_draw_id)
      RETURNING id INTO v_standings_id;

      -- Insert Standings Entries for players in this group
      FOREACH v_pid IN ARRAY v_group_players LOOP
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

      -- Generate Round-Robin Fixtures for this group
      v_rr_players := v_group_players;
      IF array_length(v_rr_players, 1) % 2 <> 0 THEN
        v_rr_players := array_append(v_rr_players, NULL::uuid);
      END IF;

      v_rr_count := array_length(v_rr_players, 1);
      v_rr_rounds := v_rr_count - 1;
      v_rr_matches_per_round := v_rr_count / 2;

      FOR v_r IN 1 .. v_rr_rounds LOOP
        INSERT INTO public.rounds (draw_id, round_number, name)
        VALUES (v_child_draw_id, v_r, v_group_name || ' Round ' || v_r)
        RETURNING id INTO v_round_id;
        v_rounds_count := v_rounds_count + 1;

        FOR i IN 0 .. (v_rr_matches_per_round - 1) LOOP
          v_p1 := v_rr_players[i + 1];
          v_p2 := v_rr_players[v_rr_count - i];

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

        -- Rotate array
        v_rotated := ARRAY[v_rr_players[1]];
        v_last := v_rr_players[v_rr_count];
        v_rotated := array_append(v_rotated, v_last);
        FOR k IN 2 .. (v_rr_count - 1) LOOP
          v_rotated := array_append(v_rotated, v_rr_players[k]);
        END LOOP;
        v_rr_players := v_rotated;
      END LOOP;
    END LOOP;
  END IF;

  -- 8. Failure Simulation for Automated Rollback Testing
  IF (p_options->>'simulate_failure')::boolean IS TRUE THEN
    RAISE EXCEPTION 'Simulated transaction failure for atomic rollback testing.';
  END IF;

  -- 9. Return Summary
  RETURN jsonb_build_object(
    'success', true,
    'idempotent', false,
    'draw_id', v_draw_id,
    'format', v_format,
    'rounds_count', v_rounds_count,
    'matches_count', v_matches_count,
    'nodes_count', v_nodes_count,
    'participants_count', v_participant_count,
    'groups_count', v_groups_created
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 2. Create RPC for Knockout Generation from Group Stage (generate_knockout_from_groups)
CREATE OR REPLACE FUNCTION public.generate_knockout_from_groups(
  p_category_id uuid,
  p_options jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb AS $$
DECLARE
  v_caller uuid;
  v_cat record;
  v_root_draw record;
  v_existing_ko_draw record;
  v_started_ko_matches_count integer;
  v_uncompleted_group_matches_count integer;
  v_qualifiers_per_group integer;
  v_child_group_draws record;
  v_group_qualifier_ids uuid[];
  v_qualifier_records record;
  v_ko_draw_id uuid;
  
  -- Sizing & Lineup variables
  v_total_qualifiers integer;
  v_p integer;
  v_total_rounds integer;
  v_tmp integer;
  v_lineup uuid[];
  v_groups_count integer := 0;
  
  -- Round / Match / Node variables
  v_r integer;
  v_pos integer;
  v_round_size integer;
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
  
  v_rounds_count integer := 0;
  v_matches_count integer := 0;
  v_nodes_count integer := 0;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Authentication required.';
  END IF;

  -- 1. Validate Category and Authorization
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
    RAISE EXCEPTION 'Unauthorized: Only the tournament organizer or admin can generate knockout stage.';
  END IF;

  -- 2. Verify Root Draw is GROUP_KNOCKOUT
  SELECT * INTO v_root_draw
  FROM public.draws
  WHERE category_id = p_category_id AND parent_draw_id IS NULL AND format = 'GROUP_KNOCKOUT'
  LIMIT 1;

  IF v_root_draw.id IS NULL THEN
    RAISE EXCEPTION 'No active Group + Knockout root draw found for category %', p_category_id;
  END IF;

  -- 3. Check for existing Knockout Stage child draw & idempotency / regeneration safety
  SELECT * INTO v_existing_ko_draw
  FROM public.draws
  WHERE parent_draw_id = v_root_draw.id AND format = 'KNOCKOUT'
  LIMIT 1;

  IF v_existing_ko_draw.id IS NOT NULL THEN
    -- Check if any knockout matches have started/completed
    SELECT count(*) INTO v_started_ko_matches_count
    FROM public.matches m
    JOIN public.rounds r ON m.round_id = r.id
    WHERE r.draw_id = v_existing_ko_draw.id
      AND (
        m.status IN ('LIVE', 'PAUSED', 'COMPLETED', 'FINAL', 'UNDER_REVIEW')
        OR m.started_at IS NOT NULL
        OR EXISTS (SELECT 1 FROM public.match_events me WHERE me.match_id = m.id)
      );

    IF v_started_ko_matches_count > 0 THEN
      RAISE EXCEPTION 'Cannot regenerate knockout stage: knockout matches have already started or completed.';
    END IF;

    IF (p_options->>'force_regenerate')::boolean IS NOT TRUE THEN
      SELECT count(*) INTO v_rounds_count FROM public.rounds WHERE draw_id = v_existing_ko_draw.id;
      SELECT count(*) INTO v_matches_count FROM public.matches m JOIN public.rounds r ON m.round_id = r.id WHERE r.draw_id = v_existing_ko_draw.id;
      SELECT count(*) INTO v_nodes_count FROM public.draw_nodes WHERE draw_id = v_existing_ko_draw.id;

      RETURN jsonb_build_object(
        'success', true,
        'idempotent', true,
        'draw_id', v_existing_ko_draw.id,
        'format', 'KNOCKOUT',
        'rounds_count', v_rounds_count,
        'matches_count', v_matches_count,
        'nodes_count', v_nodes_count,
        'message', 'Knockout stage already exists for this category.'
      );
    END IF;

    -- Delete old knockout child draw and its matches/nodes
    DELETE FROM public.draws WHERE id = v_existing_ko_draw.id;
  END IF;

  -- 4. Terminal Match Completion Validation: All group stage matches must be completed
  SELECT count(*) INTO v_uncompleted_group_matches_count
  FROM public.matches m
  JOIN public.rounds r ON m.round_id = r.id
  JOIN public.draws d ON r.draw_id = d.id
  WHERE d.parent_draw_id = v_root_draw.id
    AND d.format = 'ROUND_ROBIN'
    AND m.status NOT IN ('COMPLETED', 'FINAL');

  IF v_uncompleted_group_matches_count > 0 THEN
    RAISE EXCEPTION 'Cannot generate knockout stage: group stage matches are still in progress (% uncompleted matches remain).', v_uncompleted_group_matches_count;
  END IF;

  -- 5. Extract Group Qualifiers
  v_qualifiers_per_group := coalesce((p_options->>'qualifiers_per_group')::integer, 2);
  IF v_qualifiers_per_group < 1 THEN
    v_qualifiers_per_group := 1;
  END IF;

  CREATE TEMPORARY TABLE temp_qualifiers (
    group_name text,
    group_order integer,
    group_rank integer,
    participant_id uuid
  ) ON COMMIT DROP;

  v_groups_count := 0;
  FOR v_child_group_draws IN (
    SELECT id, group_name, row_number() over (order by group_name asc) as g_order
    FROM public.draws
    WHERE parent_draw_id = v_root_draw.id AND format = 'ROUND_ROBIN'
    ORDER BY group_name ASC
  ) LOOP
    v_groups_count := v_groups_count + 1;

    -- Fetch top N qualifiers from standings entries ordered by rank
    INSERT INTO temp_qualifiers (group_name, group_order, group_rank, participant_id)
    SELECT 
      v_child_group_draws.group_name,
      v_child_group_draws.g_order::integer,
      row_number() over (order by se.rank asc, (se.points_for - se.points_against) desc, se.won desc)::integer as group_rank,
      se.participant_id
    FROM public.standings s
    JOIN public.standings_entries se ON s.id = se.standings_id
    WHERE s.draw_id = v_child_group_draws.id
    ORDER BY se.rank ASC, (se.points_for - se.points_against) DESC, se.won DESC
    LIMIT v_qualifiers_per_group;
  END LOOP;

  SELECT count(*) INTO v_total_qualifiers FROM temp_qualifiers;
  IF v_total_qualifiers < 2 THEN
    RAISE EXCEPTION 'Not enough qualifiers extracted from groups: found %', v_total_qualifiers;
  END IF;

  -- 6. Deterministic Cross-Group Seeding
  v_lineup := ARRAY[]::uuid[];

  IF v_groups_count = 2 AND v_qualifiers_per_group = 2 THEN
    -- 2 Groups, Top 2:
    -- Match 1: A1 vs B2
    -- Match 2: B1 vs A2
    -- Lineup: [A1, B2, B1, A2]
    v_lineup := ARRAY[
      (SELECT participant_id FROM temp_qualifiers WHERE group_order = 1 AND group_rank = 1),
      (SELECT participant_id FROM temp_qualifiers WHERE group_order = 2 AND group_rank = 2),
      (SELECT participant_id FROM temp_qualifiers WHERE group_order = 2 AND group_rank = 1),
      (SELECT participant_id FROM temp_qualifiers WHERE group_order = 1 AND group_rank = 2)
    ];
  ELSIF v_groups_count = 4 AND v_qualifiers_per_group = 2 THEN
    -- 4 Groups, Top 2:
    -- Top Half: QF1 (A1 vs B2), QF2 (C1 vs D2)
    -- Bottom Half: QF3 (B1 vs A2), QF4 (D1 vs C2)
    -- Lineup: [A1, B2, C1, D2, B1, A2, D1, C2]
    v_lineup := ARRAY[
      (SELECT participant_id FROM temp_qualifiers WHERE group_order = 1 AND group_rank = 1),
      (SELECT participant_id FROM temp_qualifiers WHERE group_order = 2 AND group_rank = 2),
      (SELECT participant_id FROM temp_qualifiers WHERE group_order = 3 AND group_rank = 1),
      (SELECT participant_id FROM temp_qualifiers WHERE group_order = 4 AND group_rank = 2),
      (SELECT participant_id FROM temp_qualifiers WHERE group_order = 2 AND group_rank = 1),
      (SELECT participant_id FROM temp_qualifiers WHERE group_order = 1 AND group_rank = 2),
      (SELECT participant_id FROM temp_qualifiers WHERE group_order = 4 AND group_rank = 1),
      (SELECT participant_id FROM temp_qualifiers WHERE group_order = 3 AND group_rank = 2)
    ];
  ELSIF v_qualifiers_per_group = 1 THEN
    -- 1 Qualifier per group: sequential cross group pairing
    FOR i IN 1 .. v_groups_count LOOP
      v_lineup := array_append(v_lineup, (SELECT participant_id FROM temp_qualifiers WHERE group_order = i AND group_rank = 1));
    END LOOP;
  ELSE
    -- General fallback: Firsts in top slots, seconds in bottom slots
    FOR v_qualifier_records IN (SELECT participant_id FROM temp_qualifiers ORDER BY group_rank ASC, group_order ASC) LOOP
      v_lineup := array_append(v_lineup, v_qualifier_records.participant_id);
    END LOOP;
  END IF;

  -- Pad lineup to power of 2 bracket size
  v_p := 2;
  WHILE v_p < array_length(v_lineup, 1) LOOP
    v_p := v_p * 2;
  END LOOP;

  WHILE array_length(v_lineup, 1) < v_p LOOP
    v_lineup := array_append(v_lineup, NULL::uuid);
  END LOOP;

  -- 7. Insert Knockout Child Draw Record
  INSERT INTO public.draws (category_id, format, status, parent_draw_id, group_name)
  VALUES (p_category_id, 'KNOCKOUT', 'DRAFT', v_root_draw.id, 'Knockout Stage')
  RETURNING id INTO v_ko_draw_id;

  -- Calculate total rounds R = log2(P)
  v_total_rounds := 0;
  v_tmp := v_p;
  WHILE v_tmp > 1 LOOP
    v_total_rounds := v_total_rounds + 1;
    v_tmp := v_tmp / 2;
  END LOOP;

  -- Create Rounds for Knockout Stage
  FOR v_r IN 1 .. v_total_rounds LOOP
    IF v_r = v_total_rounds THEN
      v_rname := 'Knockout Final';
    ELSIF v_r = v_total_rounds - 1 THEN
      v_rname := 'Knockout Semi-Final';
    ELSIF v_r = v_total_rounds - 2 THEN
      v_rname := 'Knockout Quarter-Final';
    ELSE
      v_rname := 'Knockout Round ' || v_r;
    END IF;

    INSERT INTO public.rounds (draw_id, round_number, name)
    VALUES (v_ko_draw_id, v_r, v_rname)
    RETURNING id INTO v_rid;

    v_rounds_count := v_rounds_count + 1;
  END LOOP;

  -- Create Matches and Draw Nodes for all rounds
  v_round_size := v_p / 2;
  FOR v_r IN 1 .. v_total_rounds LOOP
    SELECT id INTO v_curr_round_id FROM public.rounds WHERE draw_id = v_ko_draw_id AND round_number = v_r;

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
        v_ko_draw_id,
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
    FOR v_node IN (SELECT id, position FROM public.draw_nodes WHERE draw_id = v_ko_draw_id AND round_number = v_r) LOOP
      v_parent_pos := v_node.position / 2;
      SELECT id INTO v_target_node_id
      FROM public.draw_nodes
      WHERE draw_id = v_ko_draw_id AND round_number = v_r + 1 AND position = v_parent_pos;

      UPDATE public.draw_nodes
      SET next_node_id = v_target_node_id
      WHERE id = v_node.id;
    END LOOP;
  END LOOP;

  -- Assign Round 1 Participants and Process BYEs
  FOR v_r1_nodes IN (SELECT id, position, match_id, next_node_id FROM public.draw_nodes WHERE draw_id = v_ko_draw_id AND round_number = 1 ORDER BY position ASC) LOOP
    v_p_a := v_lineup[2 * v_r1_nodes.position + 1];
    v_p_b := v_lineup[2 * v_r1_nodes.position + 2];

    IF v_p_a IS NULL AND v_p_b IS NULL THEN
      UPDATE public.matches
      SET participant_a_id = NULL, participant_b_id = NULL, status = 'COMPLETED', winner_id = NULL, outcome = 'COMPLETED'
      WHERE id = v_r1_nodes.match_id;
    ELSIF v_p_a IS NOT NULL AND v_p_b IS NULL THEN
      UPDATE public.matches
      SET participant_a_id = v_p_a, participant_b_id = NULL, status = 'COMPLETED', winner_id = v_p_a, outcome = 'COMPLETED'
      WHERE id = v_r1_nodes.match_id;

      IF v_r1_nodes.next_node_id IS NOT NULL THEN
        SELECT match_id INTO v_next_m_id FROM public.draw_nodes WHERE id = v_r1_nodes.next_node_id;
        IF v_r1_nodes.position % 2 = 0 THEN
          UPDATE public.matches SET participant_a_id = v_p_a WHERE id = v_next_m_id;
        ELSE
          UPDATE public.matches SET participant_b_id = v_p_a WHERE id = v_next_m_id;
        END IF;
      END IF;
    ELSIF v_p_b IS NOT NULL AND v_p_a IS NULL THEN
      UPDATE public.matches
      SET participant_a_id = NULL, participant_b_id = v_p_b, status = 'COMPLETED', winner_id = v_p_b, outcome = 'COMPLETED'
      WHERE id = v_r1_nodes.match_id;

      IF v_r1_nodes.next_node_id IS NOT NULL THEN
        SELECT match_id INTO v_next_m_id FROM public.draw_nodes WHERE id = v_r1_nodes.next_node_id;
        IF v_r1_nodes.position % 2 = 0 THEN
          UPDATE public.matches SET participant_a_id = v_p_b WHERE id = v_next_m_id;
        ELSE
          UPDATE public.matches SET participant_b_id = v_p_b WHERE id = v_next_m_id;
        END IF;
      END IF;
    ELSE
      UPDATE public.matches
      SET participant_a_id = v_p_a, participant_b_id = v_p_b, status = 'READY'
      WHERE id = v_r1_nodes.match_id;
    END IF;
  END LOOP;

  -- Update Ready status for subsequent rounds if both players are present
  UPDATE public.matches m
  SET status = 'READY'
  FROM public.rounds r
  WHERE m.round_id = r.id
    AND r.draw_id = v_ko_draw_id
    AND m.participant_a_id IS NOT NULL
    AND m.participant_b_id IS NOT NULL
    AND m.status = 'SCHEDULED';

  -- 8. Failure Simulation for Automated Rollback Testing
  IF (p_options->>'simulate_failure')::boolean IS TRUE THEN
    RAISE EXCEPTION 'Simulated transaction failure for atomic rollback testing.';
  END IF;

  -- 9. Return Summary
  RETURN jsonb_build_object(
    'success', true,
    'idempotent', false,
    'draw_id', v_ko_draw_id,
    'root_draw_id', v_root_draw.id,
    'format', 'KNOCKOUT',
    'rounds_count', v_rounds_count,
    'matches_count', v_matches_count,
    'nodes_count', v_nodes_count,
    'qualifiers_count', v_total_qualifiers
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
