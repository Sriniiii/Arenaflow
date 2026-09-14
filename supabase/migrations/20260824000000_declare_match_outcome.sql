-- Migration: 20260824000000_declare_match_outcome.sql
-- Dedicated transactional RPC for declaring match outcomes (WALKOVER, RETIREMENT, DEFAULT)
-- with strict semantic safety, scoring event protection, RBAC authorization, atomic bracket advancement, and audit logging.

create or replace function public.declare_match_outcome(
  p_match_id uuid,
  p_outcome text,
  p_winner_id uuid,
  p_retiring_participant_id uuid default null,
  p_notes text default null
)
returns void as $$
declare
  v_match record;
  v_loser_id uuid;
  v_scoring_points_count integer;
begin
  -- 1. Authorization Validation
  if not public.can_score_match(p_match_id, auth.uid()) then
    raise exception 'Unauthorized to declare match outcome';
  end if;

  -- 2. Validate Outcome Format
  if p_outcome not in ('WALKOVER', 'RETIREMENT', 'DEFAULT') then
    raise exception 'Invalid match outcome: %. Must be WALKOVER, RETIREMENT, or DEFAULT.', p_outcome;
  end if;

  -- 3. Fetch Match Record
  select * into v_match
  from public.matches
  where id = p_match_id;

  if v_match.id is null then
    raise exception 'Match not found';
  end if;

  -- 4. Validate Participants
  if v_match.participant_a_id is null or v_match.participant_b_id is null then
    raise exception 'Cannot declare outcome for a match with unassigned participants';
  end if;

  -- 5. Validate Winner and Loser
  if p_winner_id is null or (p_winner_id <> v_match.participant_a_id and p_winner_id <> v_match.participant_b_id) then
    raise exception 'Winner ID % is not a participant in this match', p_winner_id;
  end if;

  if p_winner_id = v_match.participant_a_id then
    v_loser_id := v_match.participant_b_id;
  else
    v_loser_id := v_match.participant_a_id;
  end if;

  if p_retiring_participant_id is not null and p_retiring_participant_id <> v_loser_id then
    raise exception 'Retiring participant must be the conceding player (the opponent of the declared winner)';
  end if;

  -- 6. Validate Scoring Events & Match Lifecycle State
  select count(*) into v_scoring_points_count
  from public.match_events
  where match_id = p_match_id
  and event_type in ('POINT_A', 'POINT_B');

  if p_outcome in ('WALKOVER', 'DEFAULT') then
    -- Cannot declare WALKOVER / DEFAULT if points have already been logged
    if v_scoring_points_count > 0 then
      raise exception 'Cannot declare % because scoring points have already been recorded. Use RETIREMENT instead to preserve legitimate match history.', p_outcome;
    end if;

    if v_match.status not in ('SCHEDULED', 'READY', 'LIVE', 'PAUSED') then
      raise exception 'Cannot declare % on a match with status %', p_outcome, v_match.status;
    end if;
  elsif p_outcome = 'RETIREMENT' then
    -- RETIREMENT is only allowed for active matches in progress
    if v_match.status not in ('LIVE', 'PAUSED') then
      raise exception 'RETIREMENT can only be declared for active matches in progress (LIVE or PAUSED). Use WALKOVER or DEFAULT for unstarted matches.';
    end if;
  end if;

  -- 7. Execute Atomic Match Completion and Bracket Advancement
  perform public.complete_match_and_advance(
    p_match_id,
    p_winner_id,
    'COMPLETED',
    p_outcome
  );

  -- 8. Record Audit Log
  perform public.log_action(
    auth.uid(),
    'OUTCOME_DECLARED',
    'matches',
    p_match_id,
    jsonb_build_object(
      'status', v_match.status,
      'outcome', v_match.outcome
    ),
    jsonb_build_object(
      'status', 'COMPLETED',
      'outcome', p_outcome,
      'winner_id', p_winner_id,
      'retiring_participant_id', v_loser_id,
      'notes', p_notes
    )
  );
end;
$$ language plpgsql security definer;
