-- ArenaFlow initial schema blueprint
-- AI agent: convert this blueprint into Supabase migrations with UUIDs,
-- foreign keys, indexes, constraints, timestamps and RLS.
-- Do not blindly execute this file without reviewing project-specific
-- auth/user relationships.

create table if not exists sports (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists venues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  city text,
  country text,
  created_at timestamptz not null default now()
);

create table if not exists tournaments (
  id uuid primary key default gen_random_uuid(),
  sport_id uuid not null references sports(id),
  organizer_id uuid not null references auth.users(id),
  venue_id uuid references venues(id),
  name text not null,
  slug text not null unique,
  description text,
  logo_url text,
  banner_url text,
  start_date date,
  end_date date,
  registration_open timestamptz,
  registration_close timestamptz,
  status text not null default 'DRAFT',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  name text not null,
  category_type text not null,
  match_type text not null,
  format text not null,
  max_participants integer,
  status text not null default 'DRAFT',
  created_at timestamptz not null default now()
);

create table if not exists players (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  full_name text not null,
  display_name text,
  profile_image_url text,
  gender text,
  date_of_birth date,
  city text,
  college text,
  club text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists participants (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references categories(id) on delete cascade,
  participant_type text not null,
  seed integer,
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now()
);

create table if not exists participant_members (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references participants(id) on delete cascade,
  player_id uuid not null references players(id),
  member_order integer not null,
  unique(participant_id, player_id),
  unique(participant_id, member_order)
);

create table if not exists registrations (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references categories(id) on delete cascade,
  participant_id uuid not null references participants(id) on delete cascade,
  status text not null default 'PENDING',
  created_at timestamptz not null default now(),
  unique(category_id, participant_id)
);

create table if not exists courts (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id) on delete cascade,
  name text not null,
  status text not null default 'ACTIVE'
);

create table if not exists draws (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references categories(id) on delete cascade,
  format text not null,
  status text not null default 'DRAFT',
  created_at timestamptz not null default now()
);

create table if not exists rounds (
  id uuid primary key default gen_random_uuid(),
  draw_id uuid not null references draws(id) on delete cascade,
  round_number integer not null,
  name text not null
);

create table if not exists matches (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references categories(id),
  round_id uuid references rounds(id),
  participant_a_id uuid references participants(id),
  participant_b_id uuid references participants(id),
  court_id uuid references courts(id),
  scheduled_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  status text not null default 'SCHEDULED',
  winner_id uuid references participants(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists games (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  game_number integer not null,
  participant_a_score integer not null default 0,
  participant_b_score integer not null default 0,
  winner_id uuid references participants(id),
  status text not null default 'NOT_STARTED',
  started_at timestamptz,
  ended_at timestamptz,
  unique(match_id, game_number)
);

create table if not exists match_events (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  game_id uuid references games(id) on delete cascade,
  sequence_number integer not null,
  participant_id uuid references participants(id),
  event_type text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique(match_id, sequence_number),
  unique(id, match_id)
);

create table if not exists draw_nodes (
  id uuid primary key default gen_random_uuid(),
  draw_id uuid not null references draws(id) on delete cascade,
  round_number integer not null,
  match_id uuid references matches(id),
  position integer not null,
  next_node_id uuid references draw_nodes(id)
);

create index if not exists idx_tournaments_slug on tournaments(slug);
create index if not exists idx_categories_tournament on categories(tournament_id);
create index if not exists idx_participants_category on participants(category_id);
create index if not exists idx_matches_category on matches(category_id);
create index if not exists idx_matches_status on matches(status);
create index if not exists idx_match_events_match on match_events(match_id);
