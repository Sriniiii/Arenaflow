-- Migration: 20260901000000_football_support.sql
-- Phase B: Supabase Database Schema & Football Squad Model Foundations
-- Authoritative Canonical Football Event Vocabulary & Strict 11-Player Starting XI Policy

-- 1. Register Football in sports table
INSERT INTO public.sports (name, slug, is_active)
VALUES ('Football', 'football', true)
ON CONFLICT (slug) DO UPDATE SET is_active = true;

-- 2. Extend categories to support TEAM category_type and rules_config
ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS categories_category_type_check;
ALTER TABLE public.categories ADD CONSTRAINT categories_category_type_check
  CHECK (category_type IN ('SINGLES', 'DOUBLES', 'TEAM'));

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS rules_config jsonb DEFAULT '{}'::jsonb;

-- 3. Extend participant_members for Football squad model
ALTER TABLE public.participant_members DROP CONSTRAINT IF EXISTS participant_members_member_order_check;
ALTER TABLE public.participant_members ADD CONSTRAINT participant_members_member_order_check
  CHECK (member_order >= 1 AND member_order <= 50);

ALTER TABLE public.participant_members
  ADD COLUMN IF NOT EXISTS jersey_number integer CHECK (jersey_number IS NULL OR (jersey_number >= 1 AND jersey_number <= 99)),
  ADD COLUMN IF NOT EXISTS position text CHECK (position IS NULL OR position IN ('GK', 'DEF', 'MID', 'FWD', 'SUB')),
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INJURED', 'SUSPENDED', 'INACTIVE'));

CREATE UNIQUE INDEX IF NOT EXISTS participant_members_team_jersey_uniq
  ON public.participant_members (participant_id, jersey_number)
  WHERE jersey_number IS NOT NULL;

-- 4. Extend matches table with Football projections & outcomes
ALTER TABLE public.matches DROP CONSTRAINT IF EXISTS matches_outcome_check;
ALTER TABLE public.matches ADD CONSTRAINT matches_outcome_check
  CHECK (outcome IS NULL OR outcome IN ('COMPLETED', 'WALKOVER', 'RETIREMENT', 'DEFAULT', 'ABANDONED'));

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS match_phase text DEFAULT 'PRE_MATCH',
  ADD COLUMN IF NOT EXISTS score_a integer DEFAULT 0 CHECK (score_a >= 0),
  ADD COLUMN IF NOT EXISTS score_b integer DEFAULT 0 CHECK (score_b >= 0),
  ADD COLUMN IF NOT EXISTS halftime_score jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS extra_time_score jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS shootout_score jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS lineup_data jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS outcome_details jsonb DEFAULT NULL;

ALTER TABLE public.matches DROP CONSTRAINT IF EXISTS matches_match_phase_check;
ALTER TABLE public.matches ADD CONSTRAINT matches_match_phase_check
  CHECK (match_phase IS NULL OR match_phase IN (
    'PRE_MATCH', 'FIRST_HALF', 'HALFTIME', 'SECOND_HALF', 'FULL_TIME',
    'EXTRA_TIME_FIRST_HALF', 'EXTRA_TIME_HALFTIME', 'EXTRA_TIME_SECOND_HALF',
    'EXTRA_TIME_END', 'PENALTY_SHOOTOUT', 'COMPLETED', 'ABANDONED'
  ));

-- 5. Direct Client Write Protection on Matches Projections
CREATE OR REPLACE FUNCTION public.protect_match_projections()
RETURNS trigger AS $$
DECLARE
  v_tournament_id uuid;
BEGIN
  -- Allow mutations when explicitly enabled in session (e.g. from security definer RPCs) or platform admin
  IF current_setting('arena_flow.internal_mutation', true) = 'on' OR public.is_platform_admin() THEN
    RETURN NEW;
  END IF;

  -- Block direct mutation of protected score and projection columns
  IF (OLD.score_a IS DISTINCT FROM NEW.score_a) OR
     (OLD.score_b IS DISTINCT FROM NEW.score_b) OR
     (OLD.halftime_score IS DISTINCT FROM NEW.halftime_score) OR
     (OLD.extra_time_score IS DISTINCT FROM NEW.extra_time_score) OR
     (OLD.shootout_score IS DISTINCT FROM NEW.shootout_score) OR
     (OLD.lineup_data IS DISTINCT FROM NEW.lineup_data) OR
     (OLD.outcome_details IS DISTINCT FROM NEW.outcome_details) OR
     (OLD.match_phase IS DISTINCT FROM NEW.match_phase) THEN
    RAISE EXCEPTION 'Direct modification of match projections is prohibited. Use authoritative match event RPCs.'
      USING ERRCODE = '42501';
  END IF;

  -- Block unauthorized participant mutation by non-organizers (e.g. scorers, players, non-authorized users)
  IF (OLD.participant_a_id IS DISTINCT FROM NEW.participant_a_id) OR
     (OLD.participant_b_id IS DISTINCT FROM NEW.participant_b_id) THEN
    SELECT tournament_id INTO v_tournament_id FROM public.categories WHERE id = NEW.category_id;
    IF NOT (public.is_tournament_organizer(v_tournament_id) OR public.is_tournament_admin(v_tournament_id)) THEN
      RAISE EXCEPTION 'Only tournament organizers can modify match participants.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS protect_match_projections_trigger ON public.matches;
CREATE TRIGGER protect_match_projections_trigger
  BEFORE UPDATE ON public.matches
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_match_projections();

-- 6. Update validate_match_events_lock for Canonical Football and Badminton Events
CREATE OR REPLACE FUNCTION public.validate_match_events_lock()
RETURNS trigger AS $$
DECLARE
  v_match_status text;
BEGIN
  IF current_setting('arena_flow.internal_mutation', true) = 'on' THEN
    RETURN NEW;
  END IF;

  SELECT status INTO v_match_status
  FROM public.matches
  WHERE id = NEW.match_id;

  IF NEW.event_type IN ('SET_SERVICE', 'SET_LINEUP') THEN
    IF v_match_status NOT IN ('SCHEDULED', 'READY', 'LIVE', 'UNDER_REVIEW') THEN
      RAISE EXCEPTION 'Event % is only allowed when match is SCHEDULED, READY, LIVE, or UNDER_REVIEW. Current status: %', NEW.event_type, v_match_status;
    END IF;
  ELSIF NEW.event_type IN ('START_FIRST_HALF', 'START_MATCH') THEN
    IF v_match_status NOT IN ('SCHEDULED', 'READY', 'LIVE', 'UNDER_REVIEW') THEN
      RAISE EXCEPTION 'Starting match is only allowed when match is SCHEDULED, READY, LIVE, or UNDER_REVIEW. Current status: %', v_match_status;
    END IF;
  ELSIF NEW.event_type IN ('DECLARE_OUTCOME') THEN
    -- DECLARE_OUTCOME is allowed across non-final statuses
    IF v_match_status NOT IN ('SCHEDULED', 'READY', 'LIVE', 'PAUSED', 'UNDER_REVIEW') THEN
      RAISE EXCEPTION 'Declaring outcome is not allowed on match with status: %', v_match_status;
    END IF;
  ELSE
    IF v_match_status NOT IN ('LIVE', 'PAUSED', 'UNDER_REVIEW') THEN
      RAISE EXCEPTION 'In-game event % is only allowed when match is LIVE, PAUSED, or UNDER_REVIEW. Current status: %', NEW.event_type, v_match_status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Authoritative set_football_lineup RPC (Strict 11-player Standard Policy)
CREATE OR REPLACE FUNCTION public.set_football_lineup(
  p_match_id uuid,
  p_team text,
  p_starting_xi uuid[],
  p_substitutes uuid[],
  p_captain_id uuid,
  p_positions jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb AS $$
DECLARE
  v_caller uuid;
  v_match record;
  v_category record;
  v_team_part_id uuid;
  v_starter_id uuid;
  v_sub_id uuid;
  v_starter_count integer;
  v_expected_starters integer;
  v_sub_count integer;
  v_member record;
  v_lineup_obj jsonb;
  v_all_lineups jsonb;
BEGIN
  v_caller := auth.uid();

  -- 1. Authorization check
  IF v_caller IS NOT NULL AND NOT (
    public.can_score_match(p_match_id, v_caller) OR
    public.is_tournament_organizer((SELECT tournament_id FROM public.categories WHERE id = (SELECT category_id FROM public.matches WHERE id = p_match_id))) OR
    public.is_platform_admin()
  ) THEN
    RAISE EXCEPTION 'Unauthorized: You do not have permission to configure lineups for this match.'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Fetch match and validate status
  SELECT * INTO v_match FROM public.matches WHERE id = p_match_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Match not found: %', p_match_id;
  END IF;

  IF v_match.status NOT IN ('SCHEDULED', 'READY', 'LIVE', 'UNDER_REVIEW') THEN
    RAISE EXCEPTION 'Cannot set lineup on a match with status %', v_match.status;
  END IF;

  IF p_team NOT IN ('A', 'B') THEN
    RAISE EXCEPTION 'Invalid team: %. Must be A or B.', p_team;
  END IF;

  IF p_team = 'A' THEN
    v_team_part_id := v_match.participant_a_id;
  ELSE
    v_team_part_id := v_match.participant_b_id;
  END IF;

  IF v_team_part_id IS NULL THEN
    RAISE EXCEPTION 'Participant for Team % is not assigned.', p_team;
  END IF;

  SELECT * INTO v_category FROM public.categories WHERE id = v_match.category_id;

  -- 3. Validate Starting XI Count (Enforce standard 11 or explicit rules_config.playersPerTeam)
  v_expected_starters := coalesce((v_category.rules_config->>'playersPerTeam')::integer, 11);
  v_starter_count := coalesce(array_length(p_starting_xi, 1), 0);

  IF v_starter_count <> v_expected_starters THEN
    RAISE EXCEPTION 'Starting XI must contain exactly % players. Provided: %', v_expected_starters, v_starter_count;
  END IF;

  IF (SELECT count(DISTINCT pid) FROM unnest(p_starting_xi) AS pid) <> v_starter_count THEN
    RAISE EXCEPTION 'Starting XI contains duplicate players.';
  END IF;

  -- 4. Validate Substitutes uniqueness and disjointness
  v_sub_count := coalesce(array_length(p_substitutes, 1), 0);
  IF v_sub_count > 0 THEN
    IF (SELECT count(DISTINCT pid) FROM unnest(p_substitutes) AS pid) <> v_sub_count THEN
      RAISE EXCEPTION 'Substitutes list contains duplicate players.';
    END IF;

    IF EXISTS (
      SELECT 1 FROM unnest(p_starting_xi) AS s
      WHERE s = ANY(p_substitutes)
    ) THEN
      RAISE EXCEPTION 'A player cannot be both in the starting XI and on the substitutes bench.';
    END IF;
  END IF;

  -- 5. Validate Captain (Must be in Starting XI)
  IF p_captain_id IS NULL THEN
    RAISE EXCEPTION 'Captain ID must be provided.';
  END IF;

  IF NOT (p_captain_id = ANY(p_starting_xi)) THEN
    RAISE EXCEPTION 'Captain (%) must be in the Starting XI.', p_captain_id;
  END IF;

  -- 6. Validate Squad Membership and Status
  FOREACH v_starter_id IN ARRAY p_starting_xi LOOP
    SELECT * INTO v_member
    FROM public.participant_members
    WHERE participant_id = v_team_part_id AND player_id = v_starter_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Player % is not a member of the squad for Team %', v_starter_id, p_team;
    END IF;

    IF v_member.status = 'SUSPENDED' THEN
      RAISE EXCEPTION 'Player % is suspended and cannot participate in the match.', v_starter_id;
    END IF;
  END LOOP;

  IF v_sub_count > 0 THEN
    FOREACH v_sub_id IN ARRAY p_substitutes LOOP
      SELECT * INTO v_member
      FROM public.participant_members
      WHERE participant_id = v_team_part_id AND player_id = v_sub_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Player % is not a member of the squad for Team %', v_sub_id, p_team;
      END IF;

      IF v_member.status = 'SUSPENDED' THEN
        RAISE EXCEPTION 'Player % is suspended and cannot participate in the match.', v_sub_id;
      END IF;
    END LOOP;
  END IF;

  -- 7. Build Lineup JSON Payload
  v_lineup_obj := jsonb_build_object(
    'startingXI', to_jsonb(p_starting_xi),
    'substitutes', to_jsonb(coalesce(p_substitutes, ARRAY[]::uuid[])),
    'captainId', p_captain_id,
    'positions', coalesce(p_positions, '{}'::jsonb)
  );

  -- 8. Record Canonical SET_LINEUP Event in match_events
  INSERT INTO public.match_events (
    match_id,
    event_type,
    participant_id,
    metadata,
    created_by
  ) VALUES (
    p_match_id,
    'SET_LINEUP',
    v_team_part_id,
    jsonb_build_object(
      'team', p_team,
      'teamId', v_team_part_id,
      'lineup', v_lineup_obj,
      'submittedAt', now()
    ),
    v_caller
  );

  -- 9. Update matches.lineup_data
  PERFORM set_config('arena_flow.internal_mutation', 'on', true);

  v_all_lineups := coalesce(v_match.lineup_data, '{}'::jsonb);
  IF p_team = 'A' THEN
    v_all_lineups := jsonb_set(v_all_lineups, '{teamA}', jsonb_build_object(
      'team', 'A',
      'startingXI', to_jsonb(p_starting_xi),
      'substitutes', to_jsonb(coalesce(p_substitutes, ARRAY[]::uuid[])),
      'captainId', p_captain_id,
      'positions', coalesce(p_positions, '{}'::jsonb),
      'submittedAt', now()
    ));
  ELSE
    v_all_lineups := jsonb_set(v_all_lineups, '{teamB}', jsonb_build_object(
      'team', 'B',
      'startingXI', to_jsonb(p_starting_xi),
      'substitutes', to_jsonb(coalesce(p_substitutes, ARRAY[]::uuid[])),
      'captainId', p_captain_id,
      'positions', coalesce(p_positions, '{}'::jsonb),
      'submittedAt', now()
    ));
  END IF;

  UPDATE public.matches
  SET lineup_data = v_all_lineups,
      updated_at = now()
  WHERE id = p_match_id;

  RETURN v_all_lineups;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. Authoritative apply_football_match_event RPC (Canonical Event Vocabulary)
CREATE OR REPLACE FUNCTION public.apply_football_match_event(
  p_match_id uuid,
  p_event_type text,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_client_event_id uuid DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
  v_caller uuid;
  v_match record;
  v_category record;
  v_part_id uuid;
  v_new_score_a integer;
  v_new_score_b integer;
  v_new_phase text;
  v_new_ht_score jsonb;
  v_new_et_score jsonb;
  v_new_so_score jsonb;
  v_winner_id uuid;
  v_outcome text;
  v_outcome_details jsonb;
  v_team text;
  v_so_score_a integer;
  v_so_score_b integer;
  v_event_id uuid;
  v_et_enabled boolean;
  v_so_enabled boolean;
  v_allow_draw boolean;
  v_declared_outcome text;
BEGIN
  v_caller := auth.uid();

  -- 1. Authorization
  IF v_caller IS NOT NULL AND NOT (
    public.can_score_match(p_match_id, v_caller) OR
    public.is_tournament_organizer((SELECT tournament_id FROM public.categories WHERE id = (SELECT category_id FROM public.matches WHERE id = p_match_id))) OR
    public.is_platform_admin()
  ) THEN
    RAISE EXCEPTION 'Unauthorized to record match events for this match.'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Fetch Match & Category
  SELECT * INTO v_match FROM public.matches WHERE id = p_match_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Match not found: %', p_match_id;
  END IF;

  SELECT * INTO v_category FROM public.categories WHERE id = v_match.category_id;

  v_et_enabled := coalesce((v_category.rules_config->>'extraTimeEnabled')::boolean, false);
  v_so_enabled := coalesce((v_category.rules_config->>'penaltyShootoutEnabled')::boolean, false);
  v_allow_draw := coalesce((v_category.rules_config->>'allowDraw')::boolean, true);

  v_team := p_metadata->>'team';
  IF v_team = 'A' THEN
    v_part_id := v_match.participant_a_id;
  ELSIF v_team = 'B' THEN
    v_part_id := v_match.participant_b_id;
  ELSE
    v_part_id := NULL;
  END IF;

  -- 3. Idempotency Check on client_event_id
  IF p_client_event_id IS NOT NULL THEN
    SELECT id INTO v_event_id
    FROM public.match_events
    WHERE match_id = p_match_id AND client_event_id = p_client_event_id;

    IF v_event_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'score_a', v_match.score_a,
        'score_b', v_match.score_b,
        'match_phase', v_match.match_phase,
        'halftime_score', v_match.halftime_score,
        'extra_time_score', v_match.extra_time_score,
        'shootout_score', v_match.shootout_score,
        'status', v_match.status,
        'winner_id', v_match.winner_id,
        'outcome', v_match.outcome,
        'outcome_details', v_match.outcome_details
      );
    END IF;
  END IF;

  -- 4. Insert canonical event into match_events
  INSERT INTO public.match_events (
    match_id,
    event_type,
    participant_id,
    metadata,
    client_event_id,
    created_by
  ) VALUES (
    p_match_id,
    p_event_type,
    v_part_id,
    p_metadata,
    p_client_event_id,
    v_caller
  ) RETURNING id INTO v_event_id;

  -- 5. Canonical Event Reductions
  v_new_score_a := coalesce(v_match.score_a, 0);
  v_new_score_b := coalesce(v_match.score_b, 0);
  v_new_phase := coalesce(v_match.match_phase, 'PRE_MATCH');
  v_new_ht_score := v_match.halftime_score;
  v_new_et_score := v_match.extra_time_score;
  v_new_so_score := v_match.shootout_score;
  v_winner_id := v_match.winner_id;
  v_outcome := v_match.outcome;
  v_outcome_details := v_match.outcome_details;

  -- Canonical Event Mapping
  IF p_event_type IN ('START_FIRST_HALF', 'START_MATCH') THEN
    v_new_phase := 'FIRST_HALF';
    IF v_match.status IN ('SCHEDULED', 'READY') THEN
      UPDATE public.matches SET status = 'LIVE', started_at = coalesce(started_at, now()) WHERE id = p_match_id;
    END IF;

  ELSIF p_event_type IN ('END_FIRST_HALF', 'HALFTIME') THEN
    v_new_phase := 'HALFTIME';
    v_new_ht_score := jsonb_build_object('score_a', v_new_score_a, 'score_b', v_new_score_b);

  ELSIF p_event_type IN ('START_SECOND_HALF', 'SECOND_HALF_START') THEN
    v_new_phase := 'SECOND_HALF';
    IF v_match.status IN ('SCHEDULED', 'READY', 'PAUSED') THEN
      UPDATE public.matches SET status = 'LIVE' WHERE id = p_match_id;
    END IF;

  ELSIF p_event_type IN ('END_SECOND_HALF', 'END_REGULATION') THEN
    v_new_phase := 'FULL_TIME';

    IF v_new_score_a > v_new_score_b THEN
      v_new_phase := 'COMPLETED';
      v_outcome := 'COMPLETED';
      v_winner_id := v_match.participant_a_id;
      v_outcome_details := jsonb_build_object('decisionMethod', 'REGULATION', 'isCompleted', true);
      PERFORM public.complete_match_and_advance(p_match_id, v_winner_id, 'COMPLETED', 'COMPLETED');
    ELSIF v_new_score_b > v_new_score_a THEN
      v_new_phase := 'COMPLETED';
      v_outcome := 'COMPLETED';
      v_winner_id := v_match.participant_b_id;
      v_outcome_details := jsonb_build_object('decisionMethod', 'REGULATION', 'isCompleted', true);
      PERFORM public.complete_match_and_advance(p_match_id, v_winner_id, 'COMPLETED', 'COMPLETED');
    ELSE
      -- Score is tied at full time
      IF v_allow_draw AND NOT v_et_enabled AND NOT v_so_enabled THEN
        v_new_phase := 'COMPLETED';
        v_outcome := 'COMPLETED';
        v_winner_id := NULL;
        v_outcome_details := jsonb_build_object('decisionMethod', 'REGULATION', 'isCompleted', true, 'isDraw', true);
        UPDATE public.matches SET status = 'COMPLETED', winner_id = NULL, outcome = 'COMPLETED', ended_at = now() WHERE id = p_match_id;
      END IF;
    END IF;

  ELSIF p_event_type IN ('START_EXTRA_TIME_FIRST_HALF', 'EXTRA_TIME_START') THEN
    v_new_phase := 'EXTRA_TIME_FIRST_HALF';
    IF v_match.status IN ('SCHEDULED', 'READY', 'PAUSED') THEN
      UPDATE public.matches SET status = 'LIVE' WHERE id = p_match_id;
    END IF;

  ELSIF p_event_type IN ('END_EXTRA_TIME_FIRST_HALF', 'EXTRA_TIME_HALFTIME') THEN
    v_new_phase := 'EXTRA_TIME_HALFTIME';

  ELSIF p_event_type IN ('START_EXTRA_TIME_SECOND_HALF', 'EXTRA_TIME_SECOND_HALF_START') THEN
    v_new_phase := 'EXTRA_TIME_SECOND_HALF';
    IF v_match.status IN ('SCHEDULED', 'READY', 'PAUSED') THEN
      UPDATE public.matches SET status = 'LIVE' WHERE id = p_match_id;
    END IF;

  ELSIF p_event_type IN ('END_EXTRA_TIME_SECOND_HALF', 'EXTRA_TIME_END') THEN
    v_new_et_score := jsonb_build_object('score_a', v_new_score_a, 'score_b', v_new_score_b);

    IF v_new_score_a > v_new_score_b THEN
      v_new_phase := 'COMPLETED';
      v_outcome := 'COMPLETED';
      v_winner_id := v_match.participant_a_id;
      v_outcome_details := jsonb_build_object('decisionMethod', 'EXTRA_TIME', 'isCompleted', true);
      PERFORM public.complete_match_and_advance(p_match_id, v_winner_id, 'COMPLETED', 'COMPLETED');
    ELSIF v_new_score_b > v_new_score_a THEN
      v_new_phase := 'COMPLETED';
      v_outcome := 'COMPLETED';
      v_winner_id := v_match.participant_b_id;
      v_outcome_details := jsonb_build_object('decisionMethod', 'EXTRA_TIME', 'isCompleted', true);
      PERFORM public.complete_match_and_advance(p_match_id, v_winner_id, 'COMPLETED', 'COMPLETED');
    ELSE
      IF NOT v_so_enabled THEN
        v_new_phase := 'COMPLETED';
        v_outcome := 'COMPLETED';
        v_winner_id := NULL;
        v_outcome_details := jsonb_build_object('decisionMethod', 'EXTRA_TIME', 'isCompleted', true, 'isDraw', true);
        UPDATE public.matches SET status = 'COMPLETED', winner_id = NULL, outcome = 'COMPLETED', ended_at = now() WHERE id = p_match_id;
      ELSE
        v_new_phase := 'EXTRA_TIME_END';
      END IF;
    END IF;

  ELSIF p_event_type = 'START_PENALTY_SHOOTOUT' THEN
    v_new_phase := 'PENALTY_SHOOTOUT';
    IF v_new_so_score IS NULL THEN
      v_new_so_score := jsonb_build_object('score_a', 0, 'score_b', 0, 'kicks', '[]'::jsonb);
    END IF;

  ELSIF p_event_type = 'PENALTY_KICK' THEN
    v_so_score_a := coalesce((v_new_so_score->>'score_a')::integer, 0);
    v_so_score_b := coalesce((v_new_so_score->>'score_b')::integer, 0);

    IF (p_metadata->>'scored')::boolean = true THEN
      IF v_team = 'A' THEN
        v_so_score_a := v_so_score_a + 1;
      ELSIF v_team = 'B' THEN
        v_so_score_b := v_so_score_b + 1;
      END IF;
    END IF;

    v_new_so_score := jsonb_build_object(
      'score_a', v_so_score_a,
      'score_b', v_so_score_b,
      'kicks', coalesce(v_new_so_score->'kicks', '[]'::jsonb) || jsonb_build_array(p_metadata)
    );

  ELSIF p_event_type = 'GOAL' THEN
    IF v_team = 'A' THEN
      v_new_score_a := v_new_score_a + 1;
    ELSIF v_team = 'B' THEN
      v_new_score_b := v_new_score_b + 1;
    END IF;

  ELSIF p_event_type = 'OWN_GOAL' THEN
    -- Conceded by Team X -> credits Team Y
    IF v_team = 'A' THEN
      v_new_score_b := v_new_score_b + 1;
    ELSIF v_team = 'B' THEN
      v_new_score_a := v_new_score_a + 1;
    END IF;

  ELSIF p_event_type = 'PAUSE_MATCH' THEN
    UPDATE public.matches SET status = 'PAUSED' WHERE id = p_match_id;

  ELSIF p_event_type = 'RESUME_MATCH' THEN
    UPDATE public.matches SET status = 'LIVE' WHERE id = p_match_id;

  ELSIF p_event_type = 'DECLARE_OUTCOME' THEN
    v_declared_outcome := (p_metadata->>'outcome');

    IF v_declared_outcome = 'ABANDONED' THEN
      -- CRITICAL INVARIANT: ABANDONED outcome MUST NOT equal DEFAULT
      v_new_phase := 'ABANDONED';
      v_outcome := 'ABANDONED';
      v_winner_id := NULL;
      v_outcome_details := jsonb_build_object(
        'reason', p_metadata->>'reason',
        'isCompleted', false,
        'isAbandoned', true,
        'abandonedAt', now()
      );

      PERFORM set_config('arena_flow.internal_mutation', 'on', true);
      UPDATE public.matches
      SET match_phase = v_new_phase,
          status = 'POSTPONED',
          outcome = v_outcome,
          winner_id = v_winner_id,
          outcome_details = v_outcome_details,
          updated_at = now()
      WHERE id = p_match_id;

      RETURN jsonb_build_object(
        'score_a', v_new_score_a,
        'score_b', v_new_score_b,
        'match_phase', v_new_phase,
        'status', 'POSTPONED',
        'outcome', v_outcome,
        'winner_id', v_winner_id,
        'outcome_details', v_outcome_details
      );
    ELSE
      -- WALKOVER, DEFAULT, RETIREMENT, PENALTY_SHOOTOUT, COMPLETED
      v_new_phase := 'COMPLETED';
      IF v_declared_outcome IN ('PENALTY_SHOOTOUT', 'EXTRA_TIME', 'REGULATION', 'COMPLETED') THEN
        v_outcome := 'COMPLETED';
      ELSE
        v_outcome := v_declared_outcome;
      END IF;
      v_winner_id := (p_metadata->>'winnerId')::uuid;

      IF v_winner_id IS NULL THEN
        IF (p_metadata->>'winnerSide') = 'A' THEN
          v_winner_id := v_match.participant_a_id;
        ELSIF (p_metadata->>'winnerSide') = 'B' THEN
          v_winner_id := v_match.participant_b_id;
        END IF;
      END IF;

      v_outcome_details := jsonb_build_object(
        'decisionMethod', v_declared_outcome,
        'isCompleted', true,
        'notes', p_metadata->>'notes'
      );

      IF v_winner_id IS NOT NULL THEN
        PERFORM public.complete_match_and_advance(
          p_match_id,
          v_winner_id,
          'COMPLETED',
          v_outcome
        );
      ELSE
        UPDATE public.matches
        SET status = 'COMPLETED',
            winner_id = NULL,
            outcome = v_outcome,
            ended_at = now()
        WHERE id = p_match_id;
      END IF;
    END IF;
  END IF;

  -- 6. Materialize Projections onto Matches
  PERFORM set_config('arena_flow.internal_mutation', 'on', true);

  UPDATE public.matches
  SET score_a = v_new_score_a,
      score_b = v_new_score_b,
      match_phase = v_new_phase,
      halftime_score = v_new_ht_score,
      extra_time_score = v_new_et_score,
      shootout_score = v_new_so_score,
      outcome = v_outcome,
      outcome_details = v_outcome_details,
      updated_at = now()
  WHERE id = p_match_id;

  RETURN jsonb_build_object(
    'score_a', v_new_score_a,
    'score_b', v_new_score_b,
    'match_phase', v_new_phase,
    'halftime_score', v_new_ht_score,
    'extra_time_score', v_new_et_score,
    'shootout_score', v_new_so_score,
    'status', (SELECT status FROM public.matches WHERE id = p_match_id),
    'winner_id', (SELECT winner_id FROM public.matches WHERE id = p_match_id),
    'outcome', (SELECT outcome FROM public.matches WHERE id = p_match_id),
    'outcome_details', v_outcome_details
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 9. Update check_registration_eligibility for TEAM category compatibility
CREATE OR REPLACE FUNCTION public.check_registration_eligibility()
RETURNS trigger AS $$
DECLARE
  v_category_id uuid;
  v_category_type text;
  v_match_type text;
  v_age_group text;
  v_tournament_start date;
  v_p1_gender text;
  v_p1_dob date;
  v_p1_age integer;
  v_p2_gender text;
  v_p2_dob date;
  v_p2_age integer;
  v_member_count integer;
  v_invalid_gender_count integer;
BEGIN
  v_category_id := NEW.category_id;
  
  SELECT category_type, match_type, age_group, tournament_id
  INTO v_category_type, v_match_type, v_age_group
  FROM public.categories
  WHERE id = v_category_id;

  -- Get tournament start date
  SELECT start_date INTO v_tournament_start
  FROM public.tournaments
  WHERE id = (SELECT tournament_id FROM public.categories WHERE id = v_category_id);

  -- Count participant members
  SELECT count(*) INTO v_member_count
  FROM public.participant_members
  WHERE participant_id = NEW.participant_id;

  -- If it is a TEAM category, perform team-level validation
  IF v_category_type = 'TEAM' THEN
    IF v_match_type = 'MENS' THEN
      SELECT count(*) INTO v_invalid_gender_count
      FROM public.participant_members pm
      JOIN public.players p ON pm.player_id = p.id
      WHERE pm.participant_id = NEW.participant_id
      AND (p.gender IS NULL OR p.gender <> 'MALE');

      IF v_invalid_gender_count > 0 THEN
        RAISE EXCEPTION 'Only male players are eligible for Men''s division.' USING ERRCODE = '45000';
      END IF;
    ELSIF v_match_type = 'WOMENS' THEN
      SELECT count(*) INTO v_invalid_gender_count
      FROM public.participant_members pm
      JOIN public.players p ON pm.player_id = p.id
      WHERE pm.participant_id = NEW.participant_id
      AND (p.gender IS NULL OR p.gender <> 'FEMALE');

      IF v_invalid_gender_count > 0 THEN
        RAISE EXCEPTION 'Only female players are eligible for Women''s division.' USING ERRCODE = '45000';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- For SINGLES and DOUBLES (Badminton and racket sports):
  -- Load player 1 details (member_order = 1)
  SELECT p.gender, p.date_of_birth
  INTO v_p1_gender, v_p1_dob
  FROM public.participant_members pm
  JOIN public.players p ON pm.player_id = p.id
  WHERE pm.participant_id = NEW.participant_id AND pm.member_order = 1;

  -- Load player 2 details (member_order = 2) if exists
  SELECT p.gender, p.date_of_birth
  INTO v_p2_gender, v_p2_dob
  FROM public.participant_members pm
  JOIN public.players p ON pm.player_id = p.id
  WHERE pm.participant_id = NEW.participant_id AND pm.member_order = 2;

  -- Calculate ages relative to tournament start date
  IF v_p1_dob IS NOT NULL THEN
    v_p1_age := date_part('year', age(v_tournament_start, v_p1_dob));
  END IF;
  IF v_p2_dob IS NOT NULL THEN
    v_p2_age := date_part('year', age(v_tournament_start, v_p2_dob));
  END IF;

  -- 1. Gender check
  IF v_match_type = 'MENS' THEN
    IF v_p1_gender IS NULL OR v_p1_gender <> 'MALE' THEN
      RAISE EXCEPTION 'Only male players are eligible for Men''s division.' USING ERRCODE = '45000';
    END IF;
    IF v_member_count = 2 AND (v_p2_gender IS NULL OR v_p2_gender <> 'MALE') THEN
      RAISE EXCEPTION 'Partner must be male for Men''s division.' USING ERRCODE = '45000';
    END IF;
  ELSIF v_match_type = 'WOMENS' THEN
    IF v_p1_gender IS NULL OR v_p1_gender <> 'FEMALE' THEN
      RAISE EXCEPTION 'Only female players are eligible for Women''s division.' USING ERRCODE = '45000';
    END IF;
    IF v_member_count = 2 AND (v_p2_gender IS NULL OR v_p2_gender <> 'FEMALE') THEN
      RAISE EXCEPTION 'Partner must be female for Women''s division.' USING ERRCODE = '45000';
    END IF;
  ELSIF v_match_type = 'MIXED' THEN
    IF v_member_count <> 2 THEN
      RAISE EXCEPTION 'Mixed division requires exactly two team members.' USING ERRCODE = '45000';
    END IF;
    IF (v_p1_gender = 'MALE' AND v_p2_gender = 'FEMALE') OR (v_p1_gender = 'FEMALE' AND v_p2_gender = 'MALE') THEN
      -- Valid mixed team
    ELSE
      RAISE EXCEPTION 'Mixed Doubles requires one male and one female player.' USING ERRCODE = '45000';
    END IF;
  END IF;

  -- 2. Age group check
  IF v_age_group = 'U19' THEN
    IF v_p1_age IS NULL OR v_p1_age >= 19 OR (v_member_count = 2 AND (v_p2_age IS NULL OR v_p2_age >= 19)) THEN
      RAISE EXCEPTION 'Players must be under 19 years old.' USING ERRCODE = '45000';
    END IF;
  ELSIF v_age_group = 'ADULT' THEN
    IF v_p1_age IS NULL OR v_p1_age < 18 OR (v_member_count = 2 AND (v_p2_age IS NULL OR v_p2_age < 18)) THEN
      RAISE EXCEPTION 'Players must be at least 18 years old.' USING ERRCODE = '45000';
    END IF;
  ELSIF v_age_group = 'O40' THEN
    IF v_p1_age IS NULL OR v_p1_age < 40 OR (v_member_count = 2 AND (v_p2_age IS NULL OR v_p2_age < 40)) THEN
      RAISE EXCEPTION 'Players must be 40 years of age or older.' USING ERRCODE = '45000';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
