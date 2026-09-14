-- ArenaFlow DB Schema Migration

-- Enable pgcrypto extension for gen_random_uuid()
create extension if not exists pgcrypto;

-- 1. Sports
create table if not exists public.sports (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 2. Profiles (Linked to auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  display_name text,
  avatar_url text,
  role text not null default 'PLAYER' check (role in ('PLATFORM_ADMIN', 'ORGANIZER', 'TOURNAMENT_ADMIN', 'SCORER', 'PLAYER', 'SPECTATOR')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. Venues
create table if not exists public.venues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  city text,
  country text,
  created_at timestamptz not null default now()
);

-- 4. Tournaments
create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  sport_id uuid not null references public.sports(id),
  organizer_id uuid not null references auth.users(id),
  venue_id uuid references public.venues(id) on delete set null,
  name text not null,
  slug text not null unique,
  description text,
  logo_url text,
  banner_url text,
  start_date date,
  end_date date,
  registration_open timestamptz,
  registration_close timestamptz,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'PUBLISHED', 'COMPLETED', 'CANCELLED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 5. Categories
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  name text not null,
  category_type text not null check (category_type in ('SINGLES', 'DOUBLES')),
  match_type text not null check (match_type in ('MENS', 'WOMENS', 'MIXED')),
  format text not null check (format in ('KNOCKOUT', 'ROUND_ROBIN', 'GROUP_KNOCKOUT')),
  max_participants integer check (max_participants > 0),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'PUBLISHED')),
  created_at timestamptz not null default now()
);

-- 6. Players
create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  full_name text not null,
  display_name text,
  profile_image_url text,
  gender text check (gender in ('MALE', 'FEMALE')),
  date_of_birth date,
  city text,
  college text,
  club text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 7. Participants
create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete cascade,
  participant_type text not null check (participant_type in ('INDIVIDUAL', 'TEAM')),
  seed integer check (seed > 0),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'WITHDRAWN')),
  created_at timestamptz not null default now()
);

-- 8. Participant Members (singular or pair)
create table if not exists public.participant_members (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  member_order integer not null check (member_order in (1, 2)),
  unique(participant_id, player_id),
  unique(participant_id, member_order)
);

-- 9. Registrations
create table if not exists public.registrations (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  created_at timestamptz not null default now(),
  unique(category_id, participant_id)
);

-- 10. Courts
create table if not exists public.courts (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  name text not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE'))
);

-- 11. Draws
create table if not exists public.draws (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete cascade,
  format text not null check (format in ('KNOCKOUT', 'ROUND_ROBIN', 'GROUP_KNOCKOUT')),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'PUBLISHED')),
  created_at timestamptz not null default now()
);

-- 12. Rounds
create table if not exists public.rounds (
  id uuid primary key default gen_random_uuid(),
  draw_id uuid not null references public.draws(id) on delete cascade,
  round_number integer not null check (round_number > 0),
  name text not null
);

-- 13. Matches
create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete cascade,
  round_id uuid references public.rounds(id) on delete set null,
  participant_a_id uuid references public.participants(id) on delete set null,
  participant_b_id uuid references public.participants(id) on delete set null,
  court_id uuid references public.courts(id) on delete set null,
  scheduled_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  status text not null default 'SCHEDULED' check (status in ('SCHEDULED', 'READY', 'LIVE', 'PAUSED', 'COMPLETED', 'FINAL', 'CANCELLED', 'POSTPONED', 'UNDER_REVIEW')),
  winner_id uuid references public.participants(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 14. Games (Singular matches have up to 3 games in badminton)
create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  game_number integer not null check (game_number in (1, 2, 3)),
  participant_a_score integer not null default 0 check (participant_a_score >= 0),
  participant_b_score integer not null default 0 check (participant_b_score >= 0),
  winner_id uuid references public.participants(id) on delete set null,
  status text not null default 'NOT_STARTED' check (status in ('NOT_STARTED', 'LIVE', 'COMPLETED')),
  started_at timestamptz,
  ended_at timestamptz,
  unique(match_id, game_number)
);

-- 15. Match Events (Point-by-point tracking)
create table if not exists public.match_events (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  game_id uuid references public.games(id) on delete cascade,
  sequence_number integer not null check (sequence_number >= 0),
  participant_id uuid references public.participants(id) on delete set null,
  event_type text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(match_id, sequence_number),
  unique(id, match_id)
);

-- 16. Draw Nodes (Visualizing brackets)
create table if not exists public.draw_nodes (
  id uuid primary key default gen_random_uuid(),
  draw_id uuid not null references public.draws(id) on delete cascade,
  round_number integer not null check (round_number > 0),
  match_id uuid references public.matches(id) on delete set null,
  position integer not null check (position >= 0),
  next_node_id uuid references public.draw_nodes(id) on delete set null
);

-- 17. Standings (For Group Stages/Round Robin)
create table if not exists public.standings (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- 18. Standings Entries
create table if not exists public.standings_entries (
  id uuid primary key default gen_random_uuid(),
  standings_id uuid not null references public.standings(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  played integer not null default 0 check (played >= 0),
  won integer not null default 0 check (won >= 0),
  lost integer not null default 0 check (lost >= 0),
  points_for integer not null default 0 check (points_for >= 0),
  points_against integer not null default 0 check (points_against >= 0),
  rank integer check (rank > 0),
  created_at timestamptz not null default now(),
  unique(standings_id, participant_id)
);

-- 19. Player Statistics
create table if not exists public.player_statistics (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  singles_wins integer not null default 0 check (singles_wins >= 0),
  singles_losses integer not null default 0 check (singles_losses >= 0),
  doubles_wins integer not null default 0 check (doubles_wins >= 0),
  doubles_losses integer not null default 0 check (doubles_losses >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 20. Tournament Statistics
create table if not exists public.tournament_statistics (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  total_matches integer not null default 0 check (total_matches >= 0),
  total_points integer not null default 0 check (total_points >= 0),
  created_at timestamptz not null default now()
);

-- 21. Notifications
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  message text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

-- 22. Audit Logs (System Action Tracking)
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_type text not null,
  target_id uuid not null,
  old_data jsonb,
  new_data jsonb
);

-- 23. Tournament Admins
create table if not exists public.tournament_admins (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (tournament_id, user_id)
);

-- 24. Tournament Scorers
create table if not exists public.tournament_scorers (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (tournament_id, user_id)
);

-- 25. Match Scorers
create table if not exists public.match_scorers (
  match_id uuid not null references public.matches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (match_id, user_id)
);

-- Add database lookup indexes
create index if not exists idx_tournaments_slug on public.tournaments(slug);
create index if not exists idx_categories_tournament on public.categories(tournament_id);
create index if not exists idx_participants_category on public.participants(category_id);
create index if not exists idx_matches_category on public.matches(category_id);
create index if not exists idx_matches_status on public.matches(status);
create index if not exists idx_match_events_match on public.match_events(match_id);
