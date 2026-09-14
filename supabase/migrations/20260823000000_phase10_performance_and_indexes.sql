-- Migration: 20260823000000_phase10_performance_and_indexes.sql
-- Production Performance & Query Indexing Optimization

-- 1. Matches table query acceleration
create index if not exists idx_matches_court_scheduled on public.matches(court_id, scheduled_at) where court_id is not null;
create index if not exists idx_matches_round on public.matches(round_id);
create index if not exists idx_matches_participants on public.matches(participant_a_id, participant_b_id);

-- 2. Games and scoring query acceleration
create index if not exists idx_games_match_number on public.games(match_id, game_number);
create index if not exists idx_match_events_seq on public.match_events(match_id, sequence_number);

-- 3. Registrations and participants query acceleration
create index if not exists idx_registrations_cat_status on public.registrations(category_id, status);
create index if not exists idx_participant_members_player on public.participant_members(player_id);
create index if not exists idx_participants_status on public.participants(category_id, status);

-- 4. Draws and Tournament Scorer indexing
create index if not exists idx_draw_nodes_draw on public.draw_nodes(draw_id, round_number);
create index if not exists idx_tournament_scorers_lookup on public.tournament_scorers(tournament_id, user_id);
