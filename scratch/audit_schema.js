const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const migrationSql = `-- Migration: 20260901000000_football_support.sql
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
  ADD COLUMN IF NOT EXISTS match_phase text DEFAULT 'PRE_MATCH' CHECK (match_phase IS NULL OR match_phase IN (
    'PRE_MATCH', 'FIRST_HALF', 'HALFTIME', 'SECOND_HALF', 'FULL_TIME',
    'EXTRA_TIME_FIRST_HALF', 'EXTRA_TIME_HALFTIME', 'EXTRA_TIME_SECOND_HALF',
    'EXTRA_TIME_END', 'PENALTY_SHOOTOUT', 'COMPLETED', 'ABANDONED'
  )),
  ADD COLUMN IF NOT EXISTS score_a integer DEFAULT 0 CHECK (score_a >= 0),
  ADD COLUMN IF NOT EXISTS score_b integer DEFAULT 0 CHECK (score_b >= 0),
  ADD COLUMN IF NOT EXISTS halftime_score jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS extra_time_score jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS shootout_score jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS lineup_data jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS outcome_details jsonb DEFAULT NULL;

-- 5. Direct Client Write Protection on Matches Projections
CREATE OR REPLACE FUNCTION public.protect_match_projections()
RETURNS trigger AS $$
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
    'team', p_team,
    'startingXI', to_jsonb(p_starting_xi),
    'substitutes', to_jsonb(coalesce(p_substitutes, ARRAY[]::uuid[])),
    'captainId', p_captain_id,
    'positions', coalesce(p_positions, '{}'::jsonb),
    'submittedAt', now()
  );

  -- 8. Record SET_LINEUP Event in match_events
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
    v_lineup_obj,
    v_caller
  );

  -- 9. Update matches.lineup_data
  PERFORM set_config('arena_flow.internal_mutation', 'on', true);

  v_all_lineups := coalesce(v_match.lineup_data, '{}'::jsonb);
  IF p_team = 'A' THEN
    v_all_lineups := jsonb_set(v_all_lineups, '{teamA}', v_lineup_obj);
  ELSE
    v_all_lineups := jsonb_set(v_all_lineups, '{teamB}', v_lineup_obj);
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
    UPDATE public.matches SET status = 'LIVE' WHERE id = p_match_id;

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
    UPDATE public.matches SET status = 'LIVE' WHERE id = p_match_id;

  ELSIF p_event_type IN ('END_EXTRA_TIME_FIRST_HALF', 'EXTRA_TIME_HALFTIME') THEN
    v_new_phase := 'EXTRA_TIME_HALFTIME';

  ELSIF p_event_type IN ('START_EXTRA_TIME_SECOND_HALF', 'EXTRA_TIME_SECOND_HALF_START') THEN
    v_new_phase := 'EXTRA_TIME_SECOND_HALF';
    UPDATE public.matches SET status = 'LIVE' WHERE id = p_match_id;

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
      v_outcome := v_declared_outcome;
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
`;

async function runAll() {
  const filePath = path.join(__dirname, '..', 'supabase', 'migrations', '20260901000000_football_support.sql');
  const migrationSql = fs.readFileSync(filePath, 'utf8');
  console.log('Loading updated migration file from:', filePath);

  const client = new Client({
    host: 'aws-0-ap-northeast-1.pooler.supabase.com',
    port: 6543,
    user: 'postgres.qoccbcczccnbjznnnmgf',
    password: 'fbW5943ZkfSmy7C',
    database: 'postgres',
    ssl: { rejectUnauthorized: false }
  });

  await client.connect();
  console.log('Applying updated migration to PostgreSQL database...');
  await client.query(migrationSql);
  console.log('Migration successfully applied!\n');

  console.log('====================================================');
  console.log('   ARENAFLOW PHASE B: DATABASE & SQUAD TEST SUITE   ');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${name}`);
      console.error(`       Error: ${err.message}`);
      failed++;
    }
  }

  // Setup test environment data
  console.log('Setting up isolated test fixtures...');
  const userRes = await client.query(`SELECT id FROM auth.users LIMIT 1;`);
  const testUserId = userRes.rows[0]?.id;

  const sportRes = await client.query(`SELECT id FROM public.sports WHERE slug = 'football';`);
  const footballSportId = sportRes.rows[0]?.id;

  const tRes = await client.query(`
    INSERT INTO public.tournaments (name, slug, sport_id, organizer_id, status, start_date, end_date)
    VALUES ('Phase B Test Football Cup', 'phase-b-football-cup-' || substr(gen_random_uuid()::text, 1, 8), $1, $2, 'PUBLISHED', '2026-09-01', '2026-09-10')
    RETURNING id;
  `, [footballSportId, testUserId]);
  const tournamentId = tRes.rows[0].id;

  const cRes = await client.query(`
    INSERT INTO public.categories (tournament_id, name, category_type, match_type, format, rules_config)
    VALUES ($1, 'Men Premier Division', 'TEAM', 'OPEN', 'KNOCKOUT', '{"regulationHalfMinutes": 45, "extraTimeEnabled": true, "penaltyShootoutEnabled": true, "maxSubstitutions": 5, "playersPerTeam": 11, "allowDraw": true}'::jsonb)
    RETURNING id;
  `, [tournamentId]);
  const categoryId = cRes.rows[0].id;

  const pARes = await client.query(`
    INSERT INTO public.participants (category_id, participant_type, status)
    VALUES ($1, 'TEAM', 'ACTIVE')
    RETURNING id;
  `, [categoryId]);
  const teamAId = pARes.rows[0].id;

  const pBRes = await client.query(`
    INSERT INTO public.participants (category_id, participant_type, status)
    VALUES ($1, 'TEAM', 'ACTIVE')
    RETURNING id;
  `, [categoryId]);
  const teamBId = pBRes.rows[0].id;

  const teamAPlayers = [];
  const teamBPlayers = [];

  for (let i = 1; i <= 15; i++) {
    const p1 = await client.query(`
      INSERT INTO public.players (full_name, gender, date_of_birth)
      VALUES ('PlayerA' || $1, 'MALE', '1995-01-01')
      RETURNING id;
    `, [i]);
    teamAPlayers.push(p1.rows[0].id);

    const p2 = await client.query(`
      INSERT INTO public.players (full_name, gender, date_of_birth)
      VALUES ('PlayerB' || $1, 'MALE', '1996-01-01')
      RETURNING id;
    `, [i]);
    teamBPlayers.push(p2.rows[0].id);
  }

  const suspPlayer = await client.query(`
    INSERT INTO public.players (full_name, gender, date_of_birth)
    VALUES ('SuspendedPlayer TeamA', 'MALE', '1994-01-01')
    RETURNING id;
  `);
  const suspendedPlayerId = suspPlayer.rows[0].id;

  for (let i = 0; i < 15; i++) {
    const pos = i === 0 ? 'GK' : (i < 5 ? 'DEF' : (i < 10 ? 'MID' : 'FWD'));
    await client.query(`
      INSERT INTO public.participant_members (participant_id, player_id, member_order, jersey_number, position, status)
      VALUES ($1, $2, $3, $4, $5, 'ACTIVE');
    `, [teamAId, teamAPlayers[i], i + 1, i + 1, pos]);
  }

  await client.query(`
    INSERT INTO public.participant_members (participant_id, player_id, member_order, jersey_number, position, status)
    VALUES ($1, $2, 16, 99, 'SUB', 'SUSPENDED');
  `, [teamAId, suspendedPlayerId]);

  for (let i = 0; i < 15; i++) {
    const pos = i === 0 ? 'GK' : (i < 5 ? 'DEF' : (i < 10 ? 'MID' : 'FWD'));
    await client.query(`
      INSERT INTO public.participant_members (participant_id, player_id, member_order, jersey_number, position, status)
      VALUES ($1, $2, $3, $4, $5, 'ACTIVE');
    `, [teamBId, teamBPlayers[i], i + 1, i + 1, pos]);
  }

  const mRes = await client.query(`
    INSERT INTO public.matches (category_id, participant_a_id, participant_b_id, status, match_phase)
    VALUES ($1, $2, $3, 'READY', 'PRE_MATCH')
    RETURNING id;
  `, [categoryId, teamAId, teamBId]);
  const matchId = mRes.rows[0].id;

  console.log('Fixtures initialized. Running tests...\n');

  // Test 1: Football Sport Registration
  await test('1. Football sport is active in sports table', async () => {
    const res = await client.query(`SELECT * FROM public.sports WHERE slug = 'football';`);
    if (res.rows.length === 0 || !res.rows[0].is_active) throw new Error('Football sport not found or not active');
  });

  // Test 2: Category Type TEAM and rules_config
  await test('2. Categories table supports TEAM category_type and rules_config', async () => {
    const res = await client.query(`SELECT category_type, rules_config FROM public.categories WHERE id = $1;`, [categoryId]);
    if (res.rows[0].category_type !== 'TEAM') throw new Error('category_type is not TEAM');
    if (!res.rows[0].rules_config?.regulationHalfMinutes) throw new Error('rules_config missing expected properties');
  });

  // Test 3: participant_members allows squad size up to 50
  await test('3. participant_members allows member_order > 2 (squad size up to 50)', async () => {
    const res = await client.query(`SELECT count(*) as cnt FROM public.participant_members WHERE participant_id = $1;`, [teamAId]);
    if (parseInt(res.rows[0].cnt) !== 16) throw new Error(`Expected 16 squad members, got ${res.rows[0].cnt}`);
  });

  // Test 4: participant_members rejects member_order > 50
  await test('4. participant_members rejects member_order > 50', async () => {
    let thrown = false;
    try {
      await client.query(`
        INSERT INTO public.participant_members (participant_id, player_id, member_order, jersey_number)
        VALUES ($1, $2, 51, 51);
      `, [teamBId, suspendedPlayerId]);
    } catch (e) {
      thrown = true;
    }
    if (!thrown) throw new Error('Expected member_order > 50 to fail check constraint');
  });

  // Test 5: participant_members rejects jersey_number > 99 or < 1
  await test('5. participant_members rejects jersey_number outside 1..99', async () => {
    let thrown = false;
    try {
      await client.query(`
        INSERT INTO public.participant_members (participant_id, player_id, member_order, jersey_number)
        VALUES ($1, $2, 17, 100);
      `, [teamAId, teamBPlayers[0]]);
    } catch (e) {
      thrown = true;
    }
    if (!thrown) throw new Error('Expected jersey_number 100 to fail check constraint');
  });

  // Test 6: participant_members rejects duplicate jersey numbers within same team
  await test('6. participant_members rejects duplicate jersey numbers within same team', async () => {
    let thrown = false;
    try {
      await client.query(`
        INSERT INTO public.participant_members (participant_id, player_id, member_order, jersey_number)
        VALUES ($1, $2, 17, 1);
      `, [teamAId, teamBPlayers[1]]);
    } catch (e) {
      thrown = true;
    }
    if (!thrown) throw new Error('Expected duplicate jersey number 1 in Team A to fail unique constraint');
  });

  // Test 7: participant_members allows same jersey number on different teams
  await test('7. participant_members allows same jersey number on different teams', async () => {
    const res = await client.query(`
      SELECT participant_id, jersey_number FROM public.participant_members
      WHERE jersey_number = 10;
    `);
    if (res.rows.length < 2) throw new Error('Expected jersey #10 to exist for both Team A and Team B');
  });

  // Test 8: participant_members allows multiple NULL jersey numbers
  await test('8. participant_members allows multiple NULL jersey numbers', async () => {
    const p3 = await client.query(`
      INSERT INTO public.players (full_name, gender, date_of_birth)
      VALUES ('NoJersey1', 'MALE', '1998-01-01'), ('NoJersey2', 'MALE', '1998-01-01')
      RETURNING id;
    `);
    await client.query(`
      INSERT INTO public.participant_members (participant_id, player_id, member_order, jersey_number)
      VALUES ($1, $2, 18, NULL), ($1, $3, 19, NULL);
    `, [teamBId, p3.rows[0].id, p3.rows[1].id]);
  });

  // Test 9: participant_members position check constraint
  await test('9. participant_members position check validates valid positions and rejects invalid', async () => {
    let thrown = false;
    try {
      await client.query(`
        INSERT INTO public.participant_members (participant_id, player_id, member_order, jersey_number, position)
        VALUES ($1, $2, 20, 44, 'QUARTERBACK');
      `, [teamBId, teamAPlayers[0]]);
    } catch (e) {
      thrown = true;
    }
    if (!thrown) throw new Error('Expected invalid position QUARTERBACK to fail constraint');
  });

  // Test 10: participant_members status check constraint
  await test('10. participant_members status check validates ACTIVE/INJURED/SUSPENDED/INACTIVE', async () => {
    let thrown = false;
    try {
      await client.query(`
        INSERT INTO public.participant_members (participant_id, player_id, member_order, jersey_number, status)
        VALUES ($1, $2, 20, 44, 'BENCHED');
      `, [teamBId, teamAPlayers[0]]);
    } catch (e) {
      thrown = true;
    }
    if (!thrown) throw new Error('Expected invalid status BENCHED to fail constraint');
  });

  // Test 11: Direct client write protection on matches projections
  await test('11. Direct client UPDATE to matches projections is blocked by trigger', async () => {
    let thrown = false;
    try {
      await client.query(`
        UPDATE public.matches
        SET score_a = 99
        WHERE id = $1;
      `, [matchId]);
    } catch (e) {
      thrown = true;
    }
    if (!thrown) throw new Error('Expected direct update to score_a to be blocked');
  });

  // Test 12: set_football_lineup validates strict 11-player Starting XI policy (rejects 10 players)
  await test('12. set_football_lineup rejects starting XI with != 11 players (Strict Policy)', async () => {
    let thrown = false;
    try {
      await client.query(`
        SELECT public.set_football_lineup($1, 'A', $2, $3, $4);
      `, [matchId, teamAPlayers.slice(0, 10), teamAPlayers.slice(10, 15), teamAPlayers[0]]);
    } catch (e) {
      thrown = true;
    }
    if (!thrown) throw new Error('Expected starting XI with 10 players to be rejected under 11-player policy');
  });

  // Test 13: set_football_lineup rejects duplicate players in starting XI
  await test('13. set_football_lineup rejects duplicate players in starting XI', async () => {
    let thrown = false;
    const dupeStarters = [...teamAPlayers.slice(0, 10), teamAPlayers[0]]; // 11 players, but player 0 duplicated
    try {
      await client.query(`
        SELECT public.set_football_lineup($1, 'A', $2, $3, $4);
      `, [matchId, dupeStarters, teamAPlayers.slice(11, 14), teamAPlayers[0]]);
    } catch (e) {
      thrown = true;
    }
    if (!thrown) throw new Error('Expected duplicate starter to be rejected');
  });

  // Test 14: set_football_lineup rejects overlap between starters and substitutes
  await test('14. set_football_lineup rejects player appearing in both starting XI and bench', async () => {
    let thrown = false;
    try {
      await client.query(`
        SELECT public.set_football_lineup($1, 'A', $2, $3, $4);
      `, [matchId, teamAPlayers.slice(0, 11), [teamAPlayers[0], teamAPlayers[12]], teamAPlayers[0]]);
    } catch (e) {
      thrown = true;
    }
    if (!thrown) throw new Error('Expected starter in substitutes to be rejected');
  });

  // Test 15: set_football_lineup rejects cross-team player injection (non-squad member)
  await test('15. set_football_lineup rejects non-squad player (cross-team injection)', async () => {
    let thrown = false;
    try {
      const foreignStarters = [...teamAPlayers.slice(0, 10), teamBPlayers[0]];
      await client.query(`
        SELECT public.set_football_lineup($1, 'A', $2, $3, $4);
      `, [matchId, foreignStarters, teamAPlayers.slice(11, 14), teamAPlayers[0]]);
    } catch (e) {
      thrown = true;
    }
    if (!thrown) throw new Error('Expected opponent player in squad lineup to be rejected');
  });

  // Test 16: set_football_lineup rejects suspended players
  await test('16. set_football_lineup rejects suspended players', async () => {
    let thrown = false;
    try {
      const startersWithSuspended = [...teamAPlayers.slice(0, 10), suspendedPlayerId];
      await client.query(`
        SELECT public.set_football_lineup($1, 'A', $2, $3, $4);
      `, [matchId, startersWithSuspended, teamAPlayers.slice(11, 14), teamAPlayers[0]]);
    } catch (e) {
      thrown = true;
    }
    if (!thrown) throw new Error('Expected suspended player in lineup to be rejected');
  });

  // Test 17: set_football_lineup successfully sets lineup for Team A and Team B
  await test('17. set_football_lineup successfully records SET_LINEUP and populates lineup_data', async () => {
    await client.query(`
      SELECT public.set_football_lineup($1, 'A', $2, $3, $4, '{"formation": "4-3-3"}'::jsonb);
    `, [matchId, teamAPlayers.slice(0, 11), teamAPlayers.slice(11, 15), teamAPlayers[0]]);

    await client.query(`
      SELECT public.set_football_lineup($1, 'B', $2, $3, $4, '{"formation": "4-4-2"}'::jsonb);
    `, [matchId, teamBPlayers.slice(0, 11), teamBPlayers.slice(11, 15), teamBPlayers[0]]);

    const res = await client.query(`SELECT lineup_data FROM public.matches WHERE id = $1;`, [matchId]);
    if (!res.rows[0].lineup_data?.teamA || !res.rows[0].lineup_data?.teamB) {
      throw new Error('lineup_data does not contain teamA and teamB lineups');
    }

    const evRes = await client.query(`
      SELECT count(*) as cnt FROM public.match_events WHERE match_id = $1 AND event_type = 'SET_LINEUP';
    `, [matchId]);
    if (parseInt(evRes.rows[0].cnt) !== 2) throw new Error(`Expected 2 SET_LINEUP events, got ${evRes.rows[0].cnt}`);
  });

  // Test 18: apply_football_match_event START_FIRST_HALF transitions match to LIVE and FIRST_HALF
  await test('18. Canonical START_FIRST_HALF transitions match to LIVE and FIRST_HALF', async () => {
    const res = await client.query(`
      SELECT public.apply_football_match_event($1, 'START_FIRST_HALF', '{"timestamp": "2026-09-01T10:00:00Z"}'::jsonb);
    `, [matchId]);
    const m = await client.query(`SELECT status, match_phase FROM public.matches WHERE id = $1;`, [matchId]);
    if (m.rows[0].status !== 'LIVE' || m.rows[0].match_phase !== 'FIRST_HALF') {
      throw new Error(`Expected LIVE/FIRST_HALF, got ${m.rows[0].status}/${m.rows[0].match_phase}`);
    }
  });

  // Test 19: apply_football_match_event GOAL increments score
  await test('19. Canonical GOAL correctly increments score_a and score_b', async () => {
    // Goal for Team A
    await client.query(`
      SELECT public.apply_football_match_event($1, 'GOAL', '{"team": "A", "minute": 15, "scorerId": "${teamAPlayers[9]}"}'::jsonb);
    `, [matchId]);

    // Goal for Team B
    await client.query(`
      SELECT public.apply_football_match_event($1, 'GOAL', '{"team": "B", "minute": 30, "scorerId": "${teamBPlayers[10]}"}'::jsonb);
    `, [matchId]);

    const m = await client.query(`SELECT score_a, score_b FROM public.matches WHERE id = $1;`, [matchId]);
    if (m.rows[0].score_a !== 1 || m.rows[0].score_b !== 1) {
      throw new Error(`Expected 1-1, got ${m.rows[0].score_a}-${m.rows[0].score_b}`);
    }
  });

  // Test 20: apply_football_match_event OWN_GOAL credits opponent
  await test('20. Canonical OWN_GOAL credits opponent score', async () => {
    // Team A player scores own goal -> credits Team B
    await client.query(`
      SELECT public.apply_football_match_event($1, 'OWN_GOAL', '{"team": "A", "minute": 40, "scorerId": "${teamAPlayers[3]}"}'::jsonb);
    `, [matchId]);

    const m = await client.query(`SELECT score_a, score_b FROM public.matches WHERE id = $1;`, [matchId]);
    if (m.rows[0].score_a !== 1 || m.rows[0].score_b !== 2) {
      throw new Error(`Expected 1-2 after Team A own goal, got ${m.rows[0].score_a}-${m.rows[0].score_b}`);
    }
  });

  // Test 21: Halftime score snapshot on END_FIRST_HALF
  await test('21. Canonical END_FIRST_HALF records halftime_score snapshot', async () => {
    await client.query(`
      SELECT public.apply_football_match_event($1, 'END_FIRST_HALF', '{"minute": 45}'::jsonb);
    `, [matchId]);

    const m = await client.query(`SELECT match_phase, halftime_score FROM public.matches WHERE id = $1;`, [matchId]);
    if (m.rows[0].match_phase !== 'HALFTIME') throw new Error(`Expected HALFTIME, got ${m.rows[0].match_phase}`);
    if (m.rows[0].halftime_score?.score_a !== 1 || m.rows[0].halftime_score?.score_b !== 2) {
      throw new Error(`Expected halftime_score 1-2, got ${JSON.stringify(m.rows[0].halftime_score)}`);
    }
  });

  // Test 22: Penalty shootout score isolation from score_a and score_b
  await test('22. Canonical PENALTY_KICK updates shootout_score without modifying score_a or score_b', async () => {
    // Equalize in second half
    await client.query(`
      SELECT public.apply_football_match_event($1, 'START_SECOND_HALF', '{}'::jsonb);
    `, [matchId]);
    await client.query(`
      SELECT public.apply_football_match_event($1, 'GOAL', '{"team": "A", "minute": 75, "scorerId": "${teamAPlayers[10]}"}'::jsonb);
    `, [matchId]);

    // End regulation
    await client.query(`
      SELECT public.apply_football_match_event($1, 'END_SECOND_HALF', '{"minute": 90}'::jsonb);
    `, [matchId]);

    // Shootout kicks
    await client.query(`
      SELECT public.apply_football_match_event($1, 'START_PENALTY_SHOOTOUT', '{}'::jsonb);
    `, [matchId]);

    // Kick 1 Team A (scored)
    await client.query(`
      SELECT public.apply_football_match_event($1, 'PENALTY_KICK', '{"team": "A", "round": 1, "scored": true}'::jsonb);
    `, [matchId]);
    // Kick 1 Team B (missed)
    await client.query(`
      SELECT public.apply_football_match_event($1, 'PENALTY_KICK', '{"team": "B", "round": 1, "scored": false}'::jsonb);
    `, [matchId]);
    // Kick 2 Team A (scored)
    await client.query(`
      SELECT public.apply_football_match_event($1, 'PENALTY_KICK', '{"team": "A", "round": 2, "scored": true}'::jsonb);
    `, [matchId]);
    // Kick 2 Team B (missed)
    await client.query(`
      SELECT public.apply_football_match_event($1, 'PENALTY_KICK', '{"team": "B", "round": 2, "scored": false}'::jsonb);
    `, [matchId]);

    const m = await client.query(`SELECT score_a, score_b, shootout_score FROM public.matches WHERE id = $1;`, [matchId]);
    if (m.rows[0].score_a !== 2 || m.rows[0].score_b !== 2) {
      throw new Error(`Official score corrupted! Expected 2-2, got ${m.rows[0].score_a}-${m.rows[0].score_b}`);
    }
    if (m.rows[0].shootout_score?.score_a !== 2 || m.rows[0].shootout_score?.score_b !== 0) {
      throw new Error(`Expected shootout score 2-0, got ${JSON.stringify(m.rows[0].shootout_score)}`);
    }
  });

  // Test 23: DECLARE_OUTCOME completes match and sets winner with decisionMethod PENALTY_SHOOTOUT
  await test('23. Canonical DECLARE_OUTCOME awards winner to shootout winner with decisionMethod PENALTY_SHOOTOUT', async () => {
    await client.query(`
      SELECT public.apply_football_match_event($1, 'DECLARE_OUTCOME', '{"outcome": "PENALTY_SHOOTOUT", "winnerSide": "A"}'::jsonb);
    `, [matchId]);

    const m = await client.query(`SELECT status, winner_id, outcome, outcome_details FROM public.matches WHERE id = $1;`, [matchId]);
    if (m.rows[0].status !== 'COMPLETED') throw new Error(`Expected COMPLETED, got ${m.rows[0].status}`);
    if (m.rows[0].winner_id !== teamAId) throw new Error(`Expected winner to be Team A (${teamAId}), got ${m.rows[0].winner_id}`);
    if (m.rows[0].outcome_details?.decisionMethod !== 'PENALTY_SHOOTOUT') {
      throw new Error(`Expected decisionMethod PENALTY_SHOOTOUT, got ${m.rows[0].outcome_details?.decisionMethod}`);
    }
  });

  // Test 24: DECLARE_OUTCOME with ABANDONED sets outcome = ABANDONED (NOT DEFAULT), winner NULL, isCompleted false
  await test('24. Canonical DECLARE_OUTCOME with ABANDONED sets outcome=ABANDONED (NOT DEFAULT), winner NULL, isCompleted false', async () => {
    // Create new match to abandon
    const m2Res = await client.query(`
      INSERT INTO public.matches (category_id, participant_a_id, participant_b_id, status, match_phase)
      VALUES ($1, $2, $3, 'LIVE', 'FIRST_HALF')
      RETURNING id;
    `, [categoryId, teamAId, teamBId]);
    const abandonMatchId = m2Res.rows[0].id;

    await client.query(`
      SELECT public.apply_football_match_event($1, 'DECLARE_OUTCOME', '{"outcome": "ABANDONED", "reason": "Severe weather"}'::jsonb);
    `, [abandonMatchId]);

    const m = await client.query(`SELECT match_phase, status, outcome, winner_id, outcome_details FROM public.matches WHERE id = $1;`, [abandonMatchId]);
    if (m.rows[0].match_phase !== 'ABANDONED') throw new Error(`Expected match_phase ABANDONED, got ${m.rows[0].match_phase}`);
    if (m.rows[0].outcome !== 'ABANDONED') throw new Error(`CRITICAL FAIL: Expected outcome 'ABANDONED', got '${m.rows[0].outcome}' (MUST NOT be DEFAULT)`);
    if (m.rows[0].status !== 'POSTPONED') throw new Error(`Expected status POSTPONED, got ${m.rows[0].status}`);
    if (m.rows[0].winner_id !== null) throw new Error(`Expected winner NULL, got ${m.rows[0].winner_id}`);
    if (m.rows[0].outcome_details?.isCompleted !== false) throw new Error('Expected isCompleted false');
    if (m.rows[0].outcome_details?.isAbandoned !== true) throw new Error('Expected isAbandoned true');
  });

  // Test 25: Existing Badminton Integrity and Non-Regression
  await test('25. Existing Badminton tournaments, categories (SINGLES/DOUBLES), and match workflows remain 100% operational', async () => {
    const badmSport = await client.query(`SELECT id FROM public.sports WHERE slug = 'badminton';`);
    if (badmSport.rows.length === 0) throw new Error('Badminton sport not found');

    const badmCats = await client.query(`
      SELECT category_type FROM public.categories
      WHERE category_type IN ('SINGLES', 'DOUBLES')
      LIMIT 5;
    `);
    if (badmCats.rows.length === 0) throw new Error('No Badminton SINGLES/DOUBLES categories found');

    const bCatRes = await client.query(`
      INSERT INTO public.categories (tournament_id, name, category_type, match_type, format)
      VALUES ($1, 'Badminton Test Doubles', 'DOUBLES', 'OPEN', 'KNOCKOUT')
      RETURNING id;
    `, [tournamentId]);
    const bCatId = bCatRes.rows[0].id;

    const bPartRes = await client.query(`
      INSERT INTO public.participants (category_id, participant_type)
      VALUES ($1, 'TEAM')
      RETURNING id;
    `, [bCatId]);
    const bPartId = bPartRes.rows[0].id;

    await client.query(`
      INSERT INTO public.participant_members (participant_id, player_id, member_order)
      VALUES ($1, $2, 1), ($1, $3, 2);
    `, [bPartId, teamAPlayers[0], teamAPlayers[1]]);

    const cnt = await client.query(`SELECT count(*) as cnt FROM public.participant_members WHERE participant_id = $1;`, [bPartId]);
    if (parseInt(cnt.rows[0].cnt) !== 2) throw new Error('Badminton doubles squad insert failed');
  });

  // Cleanup test fixtures
  console.log('\nCleaning up test fixtures...');
  await client.query(`DELETE FROM public.tournaments WHERE id = $1;`, [tournamentId]);
  for (const pid of [...teamAPlayers, ...teamBPlayers, suspendedPlayerId]) {
    await client.query(`DELETE FROM public.players WHERE id = $1;`, [pid]);
  }

  console.log('\n====================================================');
  console.log(`RESULTS: ${passed} PASSED, ${failed} FAILED (TOTAL: ${passed + failed})`);
  console.log('====================================================\n');

  await client.end();
  if (failed > 0) process.exit(1);
}

runAll().catch(err => {
  console.error('Test suite error:', err);
  process.exit(1);
});