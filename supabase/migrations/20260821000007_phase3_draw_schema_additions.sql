-- Migration 20260821000007_phase3_draw_schema_additions

-- Configurable match durations & buffers
alter table public.tournaments 
  add column if not exists default_match_duration integer not null default 45 check (default_match_duration > 0),
  add column if not exists default_buffer_time integer not null default 10 check (default_buffer_time >= 0);

alter table public.categories 
  add column if not exists match_duration integer check (match_duration > 0),
  add column if not exists buffer_time integer check (buffer_time >= 0);

alter table public.matches 
  add column if not exists duration_minutes integer check (duration_minutes > 0),
  add column if not exists buffer_minutes integer check (buffer_minutes >= 0);

-- Match outcomes (walkover, retirement, default)
alter table public.matches
  add column if not exists outcome text check (outcome in ('COMPLETED', 'WALKOVER', 'RETIREMENT', 'DEFAULT'));

-- Hierarchical draws for group stage stages
alter table public.draws 
  add column if not exists parent_draw_id uuid references public.draws(id) on delete cascade,
  add column if not exists group_name text;

alter table public.standings 
  add column if not exists draw_id uuid references public.draws(id) on delete cascade;

-- Manual tie-breaker override flags
alter table public.standings_entries
  add column if not exists is_manually_resolved boolean not null default false,
  add column if not exists manual_rank_override integer check (manual_rank_override > 0);

-- Create performance indexes
create index if not exists idx_draws_parent on public.draws(parent_draw_id);
create index if not exists idx_standings_draw on public.standings(draw_id);

-- Atomic Advancement Function (complete_match_and_advance)
create or replace function public.complete_match_and_advance(
  p_match_id uuid,
  p_winner_id uuid,
  p_status text,
  p_outcome text
)
returns void as $$
declare
  v_draw_node_id uuid;
  v_next_node_id uuid;
  v_next_match_id uuid;
  v_position integer;
begin
  -- 1. Update the current match details
  update public.matches
  set 
    winner_id = p_winner_id,
    status = p_status,
    outcome = p_outcome,
    ended_at = now(),
    updated_at = now()
  where id = p_match_id;

  -- 2. Check if this match is linked to a knockout bracket node
  select id, position, next_node_id
  into v_draw_node_id, v_position, v_next_node_id
  from public.draw_nodes
  where match_id = p_match_id;

  -- 3. If there is a next node in the bracket, advance the winner
  if v_draw_node_id is not null and v_next_node_id is not null then
    -- Find the match id associated with the next node
    select match_id into v_next_match_id
    from public.draw_nodes
    where id = v_next_node_id;

    if v_next_match_id is not null then
      -- If position of current match is even, winner is player A in next match
      -- If position is odd, winner is player B in next match
      if v_position % 2 = 0 then
        update public.matches
        set participant_a_id = p_winner_id, updated_at = now()
        where id = v_next_match_id;
      else
        update public.matches
        set participant_b_id = p_winner_id, updated_at = now()
        where id = v_next_match_id;
      end if;

      -- If the next match now has both participants set, mark it as READY
      update public.matches
      set status = 'READY'
      where id = v_next_match_id
      and participant_a_id is not null
      and participant_b_id is not null
      and status = 'SCHEDULED';
    end if;
  end if;
end;
$$ language plpgsql security definer;
