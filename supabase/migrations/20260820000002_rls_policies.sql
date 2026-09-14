-- Row Level Security Policies

-- Helper check functions to bypass recursion issues

create or replace function public.is_tournament_organizer(t_id uuid)
returns boolean as $$
begin
  return exists (
    select 1 from public.tournaments
    where id = t_id and organizer_id = auth.uid()
  );
end;
$$ language plpgsql security definer;

create or replace function public.is_tournament_admin(t_id uuid)
returns boolean as $$
begin
  return exists (
    select 1 from public.tournament_admins
    where tournament_id = t_id and user_id = auth.uid()
  );
end;
$$ language plpgsql security definer;

create or replace function public.is_tournament_scorer(t_id uuid)
returns boolean as $$
begin
  return exists (
    select 1 from public.tournament_scorers
    where tournament_id = t_id and user_id = auth.uid()
  );
end;
$$ language plpgsql security definer;

create or replace function public.is_match_scorer(m_id uuid)
returns boolean as $$
begin
  return exists (
    select 1 from public.match_scorers
    where match_id = m_id and user_id = auth.uid()
  ) or exists (
    select 1 from public.matches m
    join public.categories c on m.category_id = c.id
    join public.tournament_scorers ts on c.tournament_id = ts.tournament_id
    where m.id = m_id and ts.user_id = auth.uid()
  );
end;
$$ language plpgsql security definer;


-- Enable RLS on all tables
alter table public.sports enable row level security;
alter table public.profiles enable row level security;
alter table public.venues enable row level security;
alter table public.tournaments enable row level security;
alter table public.categories enable row level security;
alter table public.players enable row level security;
alter table public.participants enable row level security;
alter table public.participant_members enable row level security;
alter table public.registrations enable row level security;
alter table public.courts enable row level security;
alter table public.draws enable row level security;
alter table public.rounds enable row level security;
alter table public.matches enable row level security;
alter table public.games enable row level security;
alter table public.match_events enable row level security;
alter table public.draw_nodes enable row level security;
alter table public.standings enable row level security;
alter table public.standings_entries enable row level security;
alter table public.player_statistics enable row level security;
alter table public.tournament_statistics enable row level security;
alter table public.notifications enable row level security;
alter table public.tournament_admins enable row level security;
alter table public.tournament_scorers enable row level security;
alter table public.match_scorers enable row level security;


-- 1. Sports policies
create policy "Sports viewable by everyone" on public.sports
  for select using (true);

create policy "Sports modifiable only by Platform Admin" on public.sports
  for all using (public.is_platform_admin());

-- 2. Profiles policies
create policy "Profiles viewable by everyone" on public.profiles
  for select using (true);

create policy "Profiles manageable by owner or Platform Admin" on public.profiles
  for update using (auth.uid() = id or public.is_platform_admin());

-- 3. Venues policies
create policy "Venues viewable by everyone" on public.venues
  for select using (true);

create policy "Venues modifiable by Organizers and Platform Admins" on public.venues
  for all using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('ORGANIZER', 'PLATFORM_ADMIN')
    )
  );

-- 4. Tournaments policies
create policy "Tournaments select policy" on public.tournaments
  for select using (
    status = 'PUBLISHED'
    or organizer_id = auth.uid()
    or public.is_tournament_admin(id)
    or public.is_tournament_scorer(id)
    or public.is_platform_admin()
  );

create policy "Tournaments insert policy" on public.tournaments
  for insert with check (
    organizer_id = auth.uid()
    and exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('ORGANIZER', 'PLATFORM_ADMIN')
    )
  );

create policy "Tournaments update/delete policy" on public.tournaments
  for all using (
    organizer_id = auth.uid()
    or public.is_platform_admin()
  );

-- 5. Categories policies
create policy "Categories select policy" on public.categories
  for select using (
    exists (
      select 1 from public.tournaments t
      where t.id = tournament_id
      and (
        t.status = 'PUBLISHED'
        or t.organizer_id = auth.uid()
        or public.is_tournament_admin(t.id)
        or public.is_tournament_scorer(t.id)
        or public.is_platform_admin()
      )
    )
  );

create policy "Categories write policy" on public.categories
  for all using (
    public.is_tournament_organizer(tournament_id)
    or public.is_platform_admin()
  );

-- 6. Players policies
create policy "Players viewable by everyone" on public.players
  for select using (true);

create policy "Players manageable by owner or Platform Admin" on public.players
  for all using (
    user_id = auth.uid()
    or public.is_platform_admin()
  );

-- 7. Participants policies
create policy "Participants select policy" on public.participants
  for select using (
    exists (
      select 1 from public.categories c
      join public.tournaments t on c.tournament_id = t.id
      where c.id = category_id
      and (
        t.status = 'PUBLISHED'
        or t.organizer_id = auth.uid()
        or public.is_tournament_admin(t.id)
        or public.is_tournament_scorer(t.id)
        or public.is_platform_admin()
      )
    )
  );

create policy "Participants write policy" on public.participants
  for all using (
    exists (
      select 1 from public.categories c
      where c.id = category_id
      and (
        public.is_tournament_organizer(c.tournament_id)
        or public.is_platform_admin()
      )
    )
  );

-- 8. Participant Members policies
create policy "Participant Members select policy" on public.participant_members
  for select using (
    exists (
      select 1 from public.participants p
      join public.categories c on p.category_id = c.id
      join public.tournaments t on c.tournament_id = t.id
      where p.id = participant_id
      and (
        t.status = 'PUBLISHED'
        or t.organizer_id = auth.uid()
        or public.is_tournament_admin(t.id)
        or public.is_tournament_scorer(t.id)
        or public.is_platform_admin()
      )
    )
  );

create policy "Participant Members write policy" on public.participant_members
  for all using (
    exists (
      select 1 from public.participants p
      join public.categories c on p.category_id = c.id
      where p.id = participant_id
      and (
        public.is_tournament_organizer(c.tournament_id)
        or public.is_platform_admin()
      )
    )
  );

-- 9. Registrations policies
create policy "Registrations select policy" on public.registrations
  for select using (
    exists (
      select 1 from public.categories c
      where c.id = category_id
      and (
        public.is_tournament_organizer(c.tournament_id)
        or public.is_platform_admin()
      )
    )
    or exists (
      select 1 from public.participant_members pm
      join public.players pl on pm.player_id = pl.id
      where pm.participant_id = participant_id
      and pl.user_id = auth.uid()
    )
  );

create policy "Registrations write policy" on public.registrations
  for all using (
    exists (
      select 1 from public.categories c
      where c.id = category_id
      and (
        public.is_tournament_organizer(c.tournament_id)
        or public.is_platform_admin()
      )
    )
    or exists (
      select 1 from public.participant_members pm
      join public.players pl on pm.player_id = pl.id
      where pm.participant_id = participant_id
      and pl.user_id = auth.uid()
    )
  );

-- 10. Courts policies
create policy "Courts viewable by everyone" on public.courts
  for select using (true);

create policy "Courts manageable by venue Organizer or Platform Admin" on public.courts
  for all using (
    exists (
      select 1 from public.venues v
      join public.tournaments t on t.venue_id = v.id
      where v.id = venue_id
      and t.organizer_id = auth.uid()
    )
    or public.is_platform_admin()
  );

-- 11. Draws policies
create policy "Draws select policy" on public.draws
  for select using (
    exists (
      select 1 from public.categories c
      join public.tournaments t on c.tournament_id = t.id
      where c.id = category_id
      and (
        t.status = 'PUBLISHED'
        or t.organizer_id = auth.uid()
        or public.is_tournament_admin(t.id)
        or public.is_tournament_scorer(t.id)
        or public.is_platform_admin()
      )
    )
  );

create policy "Draws write policy" on public.draws
  for all using (
    exists (
      select 1 from public.categories c
      where c.id = category_id
      and (
        public.is_tournament_organizer(c.tournament_id)
        or public.is_tournament_admin(c.tournament_id)
        or public.is_platform_admin()
      )
    )
  );

-- 12. Rounds policies
create policy "Rounds select policy" on public.rounds
  for select using (
    exists (
      select 1 from public.draws d
      join public.categories c on d.category_id = c.id
      join public.tournaments t on c.tournament_id = t.id
      where d.id = draw_id
      and (
        t.status = 'PUBLISHED'
        or t.organizer_id = auth.uid()
        or public.is_tournament_admin(t.id)
        or public.is_tournament_scorer(t.id)
        or public.is_platform_admin()
      )
    )
  );

create policy "Rounds write policy" on public.rounds
  for all using (
    exists (
      select 1 from public.draws d
      join public.categories c on d.category_id = c.id
      where d.id = draw_id
      and (
        public.is_tournament_organizer(c.tournament_id)
        or public.is_tournament_admin(c.tournament_id)
        or public.is_platform_admin()
      )
    )
  );

-- 13. Matches policies
create policy "Matches select policy" on public.matches
  for select using (
    exists (
      select 1 from public.categories c
      join public.tournaments t on c.tournament_id = t.id
      where c.id = category_id
      and (
        t.status = 'PUBLISHED'
        or t.organizer_id = auth.uid()
        or public.is_tournament_admin(t.id)
        or public.is_tournament_scorer(t.id)
        or public.is_platform_admin()
      )
    )
  );

create policy "Matches management policy" on public.matches
  for all using (
    exists (
      select 1 from public.categories c
      where c.id = category_id
      and (
        public.is_tournament_organizer(c.tournament_id)
        or public.is_tournament_admin(c.tournament_id)
        or public.is_platform_admin()
      )
    )
  );

create policy "Matches scorer update policy" on public.matches
  for update using (
    public.is_match_scorer(id)
  );

-- 14. Games policies
create policy "Games select policy" on public.games
  for select using (
    exists (
      select 1 from public.matches m
      join public.categories c on m.category_id = c.id
      join public.tournaments t on c.tournament_id = t.id
      where m.id = match_id
      and (
        t.status = 'PUBLISHED'
        or t.organizer_id = auth.uid()
        or public.is_tournament_admin(t.id)
        or public.is_tournament_scorer(t.id)
        or public.is_platform_admin()
      )
    )
  );

create policy "Games write policy" on public.games
  for all using (
    exists (
      select 1 from public.matches m
      join public.categories c on m.category_id = c.id
      where m.id = match_id
      and (
        public.is_tournament_organizer(c.tournament_id)
        or public.is_tournament_admin(c.tournament_id)
        or public.is_match_scorer(m.id)
        or public.is_platform_admin()
      )
    )
  );

-- 15. Match Events policies
create policy "Match Events select policy" on public.match_events
  for select using (
    exists (
      select 1 from public.matches m
      join public.categories c on m.category_id = c.id
      join public.tournaments t on c.tournament_id = t.id
      where m.id = match_id
      and (
        t.status = 'PUBLISHED'
        or t.organizer_id = auth.uid()
        or public.is_tournament_admin(t.id)
        or public.is_tournament_scorer(t.id)
        or public.is_platform_admin()
      )
    )
  );

create policy "Match Events insert policy" on public.match_events
  for insert with check (
    exists (
      select 1 from public.matches m
      join public.categories c on m.category_id = c.id
      where m.id = match_id
      and (
        public.is_tournament_organizer(c.tournament_id)
        or public.is_tournament_admin(c.tournament_id)
        or public.is_match_scorer(m.id)
        or public.is_platform_admin()
      )
    )
  );

create policy "Match Events admin modify policy" on public.match_events
  for all using (
    public.is_platform_admin()
  );

-- 16. Draw Nodes policies
create policy "Draw Nodes select policy" on public.draw_nodes
  for select using (
    exists (
      select 1 from public.draws d
      join public.categories c on d.category_id = c.id
      join public.tournaments t on c.tournament_id = t.id
      where d.id = draw_id
      and (
        t.status = 'PUBLISHED'
        or t.organizer_id = auth.uid()
        or public.is_tournament_admin(t.id)
        or public.is_tournament_scorer(t.id)
        or public.is_platform_admin()
      )
    )
  );

create policy "Draw Nodes write policy" on public.draw_nodes
  for all using (
    exists (
      select 1 from public.draws d
      join public.categories c on d.category_id = c.id
      where d.id = draw_id
      and (
        public.is_tournament_organizer(c.tournament_id)
        or public.is_tournament_admin(c.tournament_id)
        or public.is_platform_admin()
      )
    )
  );

-- 17. Standings policies
create policy "Standings select policy" on public.standings
  for select using (
    exists (
      select 1 from public.categories c
      join public.tournaments t on c.tournament_id = t.id
      where c.id = category_id
      and (
        t.status = 'PUBLISHED'
        or t.organizer_id = auth.uid()
        or public.is_tournament_admin(t.id)
        or public.is_tournament_scorer(t.id)
        or public.is_platform_admin()
      )
    )
  );

create policy "Standings write policy" on public.standings
  for all using (
    exists (
      select 1 from public.categories c
      where c.id = category_id
      and (
        public.is_tournament_organizer(c.tournament_id)
        or public.is_tournament_admin(c.tournament_id)
        or public.is_platform_admin()
      )
    )
  );

-- 18. Standings Entries policies
create policy "Standings Entries select policy" on public.standings_entries
  for select using (
    exists (
      select 1 from public.standings s
      join public.categories c on s.category_id = c.id
      join public.tournaments t on c.tournament_id = t.id
      where s.id = standings_id
      and (
        t.status = 'PUBLISHED'
        or t.organizer_id = auth.uid()
        or public.is_tournament_admin(t.id)
        or public.is_tournament_scorer(t.id)
        or public.is_platform_admin()
      )
    )
  );

create policy "Standings Entries write policy" on public.standings_entries
  for all using (
    exists (
      select 1 from public.standings s
      join public.categories c on s.category_id = c.id
      where s.id = standings_id
      and (
        public.is_tournament_organizer(c.tournament_id)
        or public.is_tournament_admin(c.tournament_id)
        or public.is_platform_admin()
      )
    )
  );

-- 19. Player Statistics policies
create policy "Player Statistics select policy" on public.player_statistics
  for select using (true);

create policy "Player Statistics write policy" on public.player_statistics
  for all using (public.is_platform_admin());

-- 20. Tournament Statistics policies
create policy "Tournament Statistics select policy" on public.tournament_statistics
  for select using (true);

create policy "Tournament Statistics write policy" on public.tournament_statistics
  for all using (public.is_platform_admin());

-- 21. Notifications policies
create policy "Notifications owner policy" on public.notifications
  for all using (user_id = auth.uid());

-- 22. Assignment tables policies

create policy "Tournament Admins view policy" on public.tournament_admins
  for select using (
    public.is_tournament_organizer(tournament_id)
    or user_id = auth.uid()
    or public.is_platform_admin()
  );

create policy "Tournament Admins manage policy" on public.tournament_admins
  for all using (
    public.is_tournament_organizer(tournament_id)
    or public.is_platform_admin()
  );

create policy "Tournament Scorers view policy" on public.tournament_scorers
  for select using (
    public.is_tournament_organizer(tournament_id)
    or user_id = auth.uid()
    or public.is_platform_admin()
  );

create policy "Tournament Scorers manage policy" on public.tournament_scorers
  for all using (
    public.is_tournament_organizer(tournament_id)
    or public.is_platform_admin()
  );

create policy "Match Scorers view policy" on public.match_scorers
  for select using (
    exists (
      select 1 from public.matches m
      where m.id = match_id
      and (
        public.is_tournament_organizer(m.category_id)
        or public.is_tournament_admin(m.category_id)
      )
    )
    or user_id = auth.uid()
    or public.is_platform_admin()
  );

create policy "Match Scorers manage policy" on public.match_scorers
  for all using (
    exists (
      select 1 from public.matches m
      where m.id = match_id
      and (
        public.is_tournament_organizer(m.category_id)
        or public.is_tournament_admin(m.category_id)
        or public.is_platform_admin()
      )
    )
  );
