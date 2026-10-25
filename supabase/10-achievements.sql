-- GoBoard step 10: achievements, the daily streak, and bans (with an admin who reviews proof).
-- Paste this whole file into Supabase: SQL Editor -> New query -> Run.
-- Safe to run more than once.
--
-- Three kinds of achievements:
--  * checked here by the database (rating, rated wins, daily games, friends, streaks): can't be faked;
--  * "proof" ones (bot games, a big capture): the browser sends the whole game, and the admin
--    reviews it on admin.html. Faked ones get the player banned for 7 days and all achievements removed;
--  * "trusted" ones (puzzles, trying board styles): nothing to gain by faking.

-- ---- Who is the admin ----
create table if not exists public.admins (user_id uuid primary key references public.profiles (id) on delete cascade);
alter table public.admins enable row level security; -- nobody reads it directly
insert into public.admins (user_id) select id from public.profiles where lower(username) = 'reinj'
  on conflict do nothing;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.admins where user_id = auth.uid()) $$;
grant execute on function public.is_admin() to authenticated;

-- ---- Streak and bans live on the profile ----
alter table public.profiles add column if not exists streak integer not null default 0;
alter table public.profiles add column if not exists streak_best integer not null default 0;
alter table public.profiles add column if not exists streak_day date;
alter table public.profiles add column if not exists banned_until timestamptz;

-- ---- Achievements ----
create table if not exists public.player_achievements (
  player uuid not null references public.profiles (id) on delete cascade,
  achievement text not null,
  unlocked_at timestamptz not null default now(),
  proof jsonb,               -- the game, for achievements the admin can check
  reviewed boolean not null default false,
  primary key (player, achievement)
);
alter table public.player_achievements enable row level security;
drop policy if exists "Achievements are public" on public.player_achievements;
create policy "Achievements are public" on public.player_achievements for select using (true);

-- Days solved of "today's puzzle", for the 7-in-a-row achievement.
create table if not exists public.daily_puzzle_days (
  player uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  primary key (player, day)
);
alter table public.daily_puzzle_days enable row level security;

-- The player's own calendar day, checked to be within a day of the server's (time zones).
create or replace function public.checked_day(p_day date)
returns date
language plpgsql stable set search_path = ''
as $$
begin
  if p_day is null or abs(p_day - (now() at time zone 'utc')::date) > 1 then
    raise exception 'Your device''s date looks wrong';
  end if;
  return p_day;
end;
$$;

-- Played today (puzzle, bot game, online game or a daily move): the streak goes up once per day.
create or replace function public.record_activity(p_day date)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  today date := public.checked_day(p_day);
  p public.profiles;
  new_streak integer;
begin
  if me is null then return 0; end if;
  select * into p from public.profiles where id = me for update;
  if p.streak_day is not null and p.streak_day >= today then return p.streak; end if;
  new_streak := case when p.streak_day = today - 1 then p.streak + 1 else 1 end;
  update public.profiles
    set streak = new_streak, streak_best = greatest(streak_best, new_streak), streak_day = today
    where id = me;
  return new_streak;
end;
$$;
grant execute on function public.record_activity(date) to authenticated;

create or replace function public.record_daily_puzzle(p_day date)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then return; end if;
  insert into public.daily_puzzle_days (player, day) values (auth.uid(), public.checked_day(p_day))
    on conflict do nothing;
end;
$$;
grant execute on function public.record_daily_puzzle(date) to authenticated;

-- Checks every database-checked achievement and adds the ones you now have. Returns the new ones.
create or replace function public.check_my_achievements()
returns text[]
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  p public.profiles;
  earned text[] := '{}';
  added text[];
  recent boolean[];
begin
  if me is null then return '{}'; end if;
  select * into p from public.profiles where id = me;

  if p.wins >= 1 then earned := earned || 'first-win'::text; end if;
  if p.wins >= 10 then earned := earned || 'wins-10'::text; end if;
  if p.wins >= 50 then earned := earned || 'wins-50'::text; end if;
  if p.wins >= 100 then earned := earned || 'wins-100'::text; end if;
  if p.rating >= 1400 then earned := earned || 'rating-1400'::text; end if;
  if p.rating >= 1600 then earned := earned || 'rating-1600'::text; end if;
  if p.rating >= 1800 then earned := earned || 'rating-1800'::text; end if;
  if p.streak_best >= 3 then earned := earned || 'streak-3'::text; end if;
  if p.streak_best >= 7 then earned := earned || 'streak-7'::text; end if;
  if p.streak_best >= 30 then earned := earned || 'streak-30'::text; end if;
  if p.streak_best >= 100 then earned := earned || 'streak-100'::text; end if;

  if exists (select 1 from public.friendships where status = 'accepted' and (requester = me or addressee = me)) then
    earned := earned || 'first-friend'::text;
  end if;
  if exists (select 1 from public.daily_games where status = 'finished'
             and ((black = me and winner = 'black') or (white = me and winner = 'white'))) then
    earned := earned || 'daily-win'::text;
  end if;
  if exists (select 1 from public.daily_games where status = 'finished'
             and ((black = me and result = 'B+0.5') or (white = me and result = 'W+0.5'))) then
    earned := earned || 'half-point'::text;
  end if;

  -- Last three finished rated games (live and daily) all won.
  select array_agg(won order by finished desc) into recent from (
    select g.finished_at as finished, (g.winner = case when g.black = me then 'black' else 'white' end) as won
      from public.rated_games g where (g.black = me or g.white = me) and g.winner in ('black', 'white')
    union all
    select d.finished_at, (d.winner = case when d.black = me then 'black' else 'white' end)
      from public.daily_games d where d.rated and d.status = 'finished' and (d.black = me or d.white = me)
    order by 1 desc limit 3) last_three;
  if coalesce(array_length(recent, 1), 0) = 3 and recent[1] and recent[2] and recent[3] then
    earned := earned || 'win-streak-3'::text;
  end if;

  -- Today's puzzle solved 7 days in a row (any 7 consecutive days).
  if exists (select 1 from public.daily_puzzle_days d where d.player = me
             and (select count(*) from public.daily_puzzle_days e where e.player = me
                  and e.day between d.day and d.day + 6) = 7) then
    earned := earned || 'daily-puzzle-7'::text;
  end if;

  with inserted as (
    insert into public.player_achievements (player, achievement)
      select me, a from unnest(earned) a on conflict do nothing returning achievement)
  select coalesce(array_agg(achievement), '{}') into added from inserted;
  return added;
end;
$$;
grant execute on function public.check_my_achievements() to authenticated;

-- Achievements the browser claims. Proof ones must send the game.
create or replace function public.claim_achievement(p_id text, p_proof jsonb)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  needs_proof boolean;
begin
  if me is null then raise exception 'Please log in first'; end if;
  if p_id in ('beat-pebble', 'beat-sprout', 'beat-fox', 'beat-tiger', 'beat-dragon', 'dragon-19', 'flawless', 'big-capture') then
    needs_proof := true;
  elsif p_id in ('first-puzzle', 'puzzles-beginner', 'puzzles-intermediate', 'puzzles-advanced', 'all-sizes', 'stylist') then
    needs_proof := false;
  else
    raise exception 'That achievement can''t be claimed';
  end if;
  if needs_proof and (p_proof is null or jsonb_typeof(p_proof -> 'moves') <> 'array'
                      or jsonb_array_length(p_proof -> 'moves') > 1500 or octet_length(p_proof::text) > 60000) then
    raise exception 'This achievement needs the game as proof';
  end if;
  insert into public.player_achievements (player, achievement, proof)
    values (me, p_id, case when needs_proof then p_proof else null end)
    on conflict do nothing;
  return found;
end;
$$;
grant execute on function public.claim_achievement(text, jsonb) to authenticated;

-- ---- Admin: review proof, ban cheaters ----
create or replace function public.admin_proofs(p_reviewed boolean)
returns table (player uuid, username text, achievement text, unlocked_at timestamptz, proof jsonb)
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Only the admin can do that'; end if;
  return query
    select a.player, pr.username, a.achievement, a.unlocked_at, a.proof
      from public.player_achievements a join public.profiles pr on pr.id = a.player
      where a.proof is not null and a.reviewed = p_reviewed
      order by a.unlocked_at desc limit 100;
end;
$$;
grant execute on function public.admin_proofs(boolean) to authenticated;

create or replace function public.admin_mark_reviewed(p_player uuid, p_achievement text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Only the admin can do that'; end if;
  update public.player_achievements set reviewed = true where player = p_player and achievement = p_achievement;
end;
$$;
grant execute on function public.admin_mark_reviewed(uuid, text) to authenticated;

-- 7-day ban and every achievement removed.
create or replace function public.admin_ban(p_player uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Only the admin can do that'; end if;
  if exists (select 1 from public.admins where user_id = p_player) then raise exception 'You can''t ban an admin'; end if;
  update public.profiles set banned_until = now() + interval '7 days' where id = p_player;
  delete from public.player_achievements where player = p_player;
  delete from public.daily_puzzle_days where player = p_player;
end;
$$;
grant execute on function public.admin_ban(uuid) to authenticated;

-- ---- Before every request: two-step code (step 9) and bans ----
create or replace function public.check_two_step()
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  ban_end timestamptz;
begin
  if auth.uid() is null then return; end if;
  if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2'
     and exists (select 1 from auth.mfa_factors where user_id = auth.uid() and status = 'verified') then
    raise exception 'Two-step verification code needed';
  end if;
  select banned_until into ban_end from public.profiles where id = auth.uid();
  if ban_end is not null and ban_end > now() then
    raise exception 'BANNED_UNTIL %', to_char(ban_end at time zone 'utc', 'YYYY-MM-DD HH24:MI "UTC"');
  end if;
end;
$$;
notify pgrst, 'reload config';
notify pgrst, 'reload schema';

select 'achievements ready' as status;
