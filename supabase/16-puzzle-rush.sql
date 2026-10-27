-- GoBoard step 16: Puzzle Rush best scores and the Rush achievements.
-- Paste this whole file into Supabase: SQL Editor -> New query -> Run.
-- Safe to run more than once.

create table if not exists public.rush_scores (
  player uuid not null references public.profiles (id) on delete cascade,
  mode text not null check (mode in ('3min', '5min', 'survival')),
  best integer not null,
  achieved_at timestamptz not null default now(),
  primary key (player, mode)
);
create index if not exists rush_scores_top on public.rush_scores (mode, best desc);
alter table public.rush_scores enable row level security;
drop policy if exists "Rush scores are public" on public.rush_scores;
create policy "Rush scores are public" on public.rush_scores for select using (true);

-- A finished run: keeps your best per mode and gives the Rush achievements (10, 20, 30).
-- Returns { "best": true/false (a new best), "new": [achievements just earned] }.
-- Old versions of the website are refused (step 15).
drop function if exists public.submit_rush_score(text, integer, integer);
create or replace function public.submit_rush_score(p_mode text, p_score integer, p_version integer)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  old_best integer;
  earned text[];
begin
  if me is null then raise exception 'Please log in first'; end if;
  if coalesce(p_version, 0) < (select min_client_version from public.app_settings) then
    raise exception 'Please refresh the page to get the newest version of GoBoard';
  end if;
  if p_mode not in ('3min', '5min', 'survival') or p_score is null or p_score < 0 or p_score > 500 then
    raise exception 'That score can''t be saved';
  end if;
  select best into old_best from public.rush_scores where player = me and mode = p_mode;
  if old_best is null or p_score > old_best then
    insert into public.rush_scores (player, mode, best) values (me, p_mode, p_score)
      on conflict (player, mode) do update set best = excluded.best, achieved_at = now();
  end if;
  with inserted as (
    insert into public.player_achievements (player, achievement)
      select me, a from unnest(array['rush-10', 'rush-20', 'rush-30']) a
      where p_score >= (substring(a from 6))::integer
      on conflict do nothing returning achievement)
  select coalesce(array_agg(achievement), '{}') into earned from inserted;
  return jsonb_build_object('best', old_best is null or p_score > old_best, 'new', to_jsonb(earned));
end;
$$;
grant execute on function public.submit_rush_score(text, integer, integer) to authenticated;

-- The Puzzles group (step 14) now also needs the three Rush achievements for its reward.
create or replace function public.reward_groups()
returns table (grp text, achievements text[], picture text, title text, frame text)
language sql immutable set search_path = ''
as $$
  values
    ('Bots', array['beat-pebble', 'beat-sprout', 'beat-fox', 'beat-tiger', 'beat-dragon', 'dragon-19', 'flawless'], 'robot', 'Dragon Slayer', 'red'),
    ('Puzzles', array['first-puzzle', 'puzzles-beginner', 'puzzles-intermediate', 'puzzles-advanced', 'daily-puzzle-7', 'rush-10', 'rush-20', 'rush-30'], 'puzzle-piece', 'Puzzle Master', 'gold'),
    ('Online', array['first-win', 'wins-10', 'wins-50', 'wins-100', 'rating-1400', 'rating-1600', 'rating-1800', 'win-streak-3', 'daily-win'], 'crown', 'Champion', 'purple'),
    ('Fun', array['first-friend', 'big-capture', 'half-point', 'all-sizes', 'stylist'], 'rainbow', 'Trickster', 'cyan'),
    ('Streak', array['streak-3', 'streak-7', 'streak-30', 'streak-100'], 'flame', 'Unstoppable', 'orange')
$$;

notify pgrst, 'reload schema';
select 'puzzle rush ready' as status;
