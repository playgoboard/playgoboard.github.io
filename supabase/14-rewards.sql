-- GoBoard step 14: rewards for finishing a whole group of achievements.
-- Paste this whole file into Supabase: SQL Editor -> New query -> Run.
-- Safe to run more than once.
--
-- Each group (Bots, Puzzles, Online, Fun, Streak) unlocks a picture, a title and a frame color
-- (and a board or stone style, which only changes your own screen). The database checks the
-- whole group is done before it saves any of them. The lists must match js/achievements.js
-- and js/avatars.js.

alter table public.profiles add column if not exists title text;
alter table public.profiles add column if not exists frame text;

create or replace function public.reward_groups()
returns table (grp text, achievements text[], picture text, title text, frame text)
language sql immutable set search_path = ''
as $$
  values
    ('Bots', array['beat-pebble', 'beat-sprout', 'beat-fox', 'beat-tiger', 'beat-dragon', 'dragon-19', 'flawless'], 'robot', 'Dragon Slayer', 'red'),
    ('Puzzles', array['first-puzzle', 'puzzles-beginner', 'puzzles-intermediate', 'puzzles-advanced', 'daily-puzzle-7'], 'puzzle-piece', 'Puzzle Master', 'gold'),
    ('Online', array['first-win', 'wins-10', 'wins-50', 'wins-100', 'rating-1400', 'rating-1600', 'rating-1800', 'win-streak-3', 'daily-win'], 'crown', 'Champion', 'purple'),
    ('Fun', array['first-friend', 'big-capture', 'half-point', 'all-sizes', 'stylist'], 'rainbow', 'Trickster', 'cyan'),
    ('Streak', array['streak-3', 'streak-7', 'streak-30', 'streak-100'], 'flame', 'Unstoppable', 'orange')
$$;

-- The groups a player has finished.
create or replace function public.finished_groups(p_player uuid)
returns text[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(r.grp), '{}') from public.reward_groups() r
    where (select count(*) from public.player_achievements a
           where a.player = p_player and a.achievement = any (r.achievements)) = cardinality(r.achievements)
$$;
grant execute on function public.finished_groups(uuid) to anon, authenticated;

-- Your picture and About me (from step 8), now also allowing reward pictures you've earned.
create or replace function public.set_my_profile(p_avatar text, p_about text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  clean text := btrim(coalesce(p_about, ''));
begin
  if me is null then raise exception 'Please log in first'; end if;
  if p_avatar is not null and p_avatar not in ('black', 'white', 'dragon', 'tiger', 'fox', 'panda', 'owl', 'turtle',
      'cat', 'rabbit', 'frog', 'octopus', 'bamboo', 'blossom', 'moon', 'star')
     and not exists (select 1 from public.reward_groups() r
                     where r.picture = p_avatar and r.grp = any (public.finished_groups(me))) then
    raise exception 'That picture isn''t allowed';
  end if;
  if char_length(clean) > 160 then raise exception 'About me can be at most 160 characters'; end if;
  if clean !~ '^[ -~㐀-䶿一-鿿　-〿！-～‘’“”—…·×←-↓■□▲△◆◇○●★☆]*$' then
    raise exception 'About me can only use English and Chinese';
  end if;
  update public.profiles set avatar = p_avatar, about = clean where id = me;
end;
$$;

-- Your title and frame (null = none). Only from groups you've finished.
create or replace function public.set_my_rewards(p_title text, p_frame text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  done text[];
begin
  if me is null then raise exception 'Please log in first'; end if;
  done := public.finished_groups(me);
  if p_title is not null and not exists (select 1 from public.reward_groups() r where r.title = p_title and r.grp = any (done)) then
    raise exception 'You haven''t earned that title yet';
  end if;
  if p_frame is not null and not exists (select 1 from public.reward_groups() r where r.frame = p_frame and r.grp = any (done)) then
    raise exception 'You haven''t earned that frame yet';
  end if;
  update public.profiles set title = p_title, frame = p_frame where id = me;
end;
$$;
grant execute on function public.set_my_rewards(text, text) to authenticated;

-- A ban (step 12) now also takes away titles, frames and reward pictures.
create or replace function public.admin_ban(p_player uuid, p_code text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  problem text := public.admin_code_problem(p_code);
begin
  if problem is not null then return problem; end if;
  if exists (select 1 from public.admins where user_id = p_player) then return 'You can''t ban an admin'; end if;
  update public.profiles
    set banned_until = now() + interval '7 days', title = null, frame = null,
        avatar = case when avatar in (select picture from public.reward_groups()) then null else avatar end
    where id = p_player;
  delete from public.player_achievements where player = p_player;
  delete from public.daily_puzzle_days where player = p_player;
  return null;
end;
$$;

notify pgrst, 'reload schema';
select 'rewards ready' as status;
