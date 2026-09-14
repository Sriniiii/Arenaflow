-- Create secure database trigger to enforce tournament registration eligibility (gender and age)

create or replace function public.check_registration_eligibility()
returns trigger as $$
declare
  v_category_id uuid;
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
begin
  v_category_id := new.category_id;
  
  select match_type, age_group, tournament_id
  into v_match_type, v_age_group
  from public.categories
  where id = v_category_id;

  -- Get tournament start date
  select start_date into v_tournament_start
  from public.tournaments
  where id = (select tournament_id from public.categories where id = v_category_id);

  -- Count participant members
  select count(*) into v_member_count
  from public.participant_members
  where participant_id = new.participant_id;

  -- Load player 1 details (member_order = 1)
  select p.gender, p.date_of_birth
  into v_p1_gender, v_p1_dob
  from public.participant_members pm
  join public.players p on pm.player_id = p.id
  where pm.participant_id = new.participant_id and pm.member_order = 1;

  -- Load player 2 details (member_order = 2) if exists
  select p.gender, p.date_of_birth
  into v_p2_gender, v_p2_dob
  from public.participant_members pm
  join public.players p on pm.player_id = p.id
  where pm.participant_id = new.participant_id and pm.member_order = 2;

  -- Calculate ages relative to tournament start date
  if v_p1_dob is not null then
    v_p1_age := date_part('year', age(v_tournament_start, v_p1_dob));
  end if;
  if v_p2_dob is not null then
    v_p2_age := date_part('year', age(v_tournament_start, v_p2_dob));
  end if;

  -- 1. Gender check
  if v_match_type = 'MENS' then
    if v_p1_gender is null or v_p1_gender != 'MALE' then
      raise exception 'Only male players are eligible for Men''s division.' using errcode = '45000';
    end if;
    if v_member_count = 2 and (v_p2_gender is null or v_p2_gender != 'MALE') then
      raise exception 'Partner must be male for Men''s division.' using errcode = '45000';
    end if;
  elsif v_match_type = 'WOMENS' then
    if v_p1_gender is null or v_p1_gender != 'FEMALE' then
      raise exception 'Only female players are eligible for Women''s division.' using errcode = '45000';
    end if;
    if v_member_count = 2 and (v_p2_gender is null or v_p2_gender != 'FEMALE') then
      raise exception 'Partner must be female for Women''s division.' using errcode = '45000';
    end if;
  elsif v_match_type = 'MIXED' then
    if v_member_count != 2 then
      raise exception 'Mixed division requires exactly two team members.' using errcode = '45000';
    end if;
    if (v_p1_gender = 'MALE' and v_p2_gender = 'FEMALE') or (v_p1_gender = 'FEMALE' and v_p2_gender = 'MALE') then
      -- Valid mixed team
    else
      raise exception 'Mixed Doubles requires one male and one female player.' using errcode = '45000';
    end if;
  end if;

  -- 2. Age group check
  if v_age_group = 'U19' then
    if v_p1_age is null or v_p1_age >= 19 or (v_member_count = 2 and (v_p2_age is null or v_p2_age >= 19)) then
      raise exception 'Players must be under 19 years old.' using errcode = '45000';
    end if;
  elsif v_age_group = 'ADULT' then
    if v_p1_age is null or v_p1_age < 18 or (v_member_count = 2 and (v_p2_age is null or v_p2_age < 18)) then
      raise exception 'Players must be at least 18 years old.' using errcode = '45000';
    end if;
  elsif v_age_group = 'O40' then
    if v_p1_age is null or v_p1_age < 40 or (v_member_count = 2 and (v_p2_age is null or v_p2_age < 40)) then
      raise exception 'Players must be 40 years of age or older.' using errcode = '45000';
    end if;
  end if;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists tr_check_registration_eligibility on public.registrations;
create trigger tr_check_registration_eligibility
before insert or update on public.registrations
for each row execute function public.check_registration_eligibility();
