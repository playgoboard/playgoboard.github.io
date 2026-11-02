-- GoBoard step 23: weekly leaderboards (wins and puzzles), starting fresh every Monday 00:00 UTC.
-- Paste this whole file into Supabase: SQL Editor -> New query -> Run.
-- Safe to run more than once. Needs steps 16, 19 and 21 first.
--
-- Wins are counted from rated live and daily games, which the database itself confirmed.
-- Puzzles are reported by the browser, so they're limited: a first-time solve counts 1 per call (so
-- syncing an old device doesn't add hundreds), the daily puzzle counts 1, a Rush run at most 100.

create table if not exists public.weekly_puzzles (
  player uuid not null references public.profiles (id) on delete cascade,
  week date not null,
  solved integer not null default 0,
  primary key (player, week)
);
create index if not exists weekly_puzzles_top on public.weekly_puzzles (week, solved desc);
alter table public.weekly_puzzles enable row level security; -- read through weekly_top() only

create or replace function public.weekly_puzzles_add(p_player uuid, p_count integer)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_player is null or coalesce(p_count, 0) <= 0 then return; end if;
  insert into public.weekly_puzzles (player, week, solved)
    values (p_player, date_trunc('week', now() at time zone 'utc')::date, p_count)
    on conflict (player, week) do update set solved = public.weekly_puzzles.solved + excluded.solved;
  -- Now and then, throw away old weeks.
  if random() < 0.01 then
    delete from public.weekly_puzzles where week < (now() - interval '8 weeks')::date;
  end if;
end;
$$;
revoke all on function public.weekly_puzzles_add(uuid, integer) from public, anon, authenticated;

-- Everyone can see the boards. Banned players are left out.
create or replace function public.weekly_top()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  with this_week as (
    select (date_trunc('week', now() at time zone 'utc') at time zone 'utc') as starts
  ), wins as (
    select case when g.winner = 'black' then g.black else g.white end as player
      from public.rated_games g, this_week w
      where g.finished_at >= w.starts and g.winner in ('black', 'white')
        and g.black_change is not null and not g.rating_undone
    union all
    select case when d.winner = 'black' then d.black else d.white end
      from public.daily_games d, this_week w
      where d.finished_at >= w.starts and d.winner in ('black', 'white')
        and d.black_change is not null and not d.rating_undone
  )
  select jsonb_build_object(
    'resets', (select starts + interval '7 days' from this_week),
    'wins', coalesce((select jsonb_agg(r) from (
        select p.username, p.avatar, p.frame, count(*) as n
          from wins x join public.profiles p on p.id = x.player
          where p.banned_until is null or p.banned_until <= now()
          group by p.id, p.username, p.avatar, p.frame
          order by n desc, p.username limit 50) r), '[]'::jsonb),
    'puzzles', coalesce((select jsonb_agg(r) from (
        select p.username, p.avatar, p.frame, wp.solved as n
          from public.weekly_puzzles wp join public.profiles p on p.id = wp.player
          where wp.week = date_trunc('week', now() at time zone 'utc')::date
            and (p.banned_until is null or p.banned_until <= now())
          order by wp.solved desc, p.username limit 50) r), '[]'::jsonb));
$$;
grant execute on function public.weekly_top() to anon, authenticated;

-- The daily puzzle: step 10's table gets one new row per player per day.
create or replace function public.daily_puzzle_counts_weekly()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.weekly_puzzles_add(new.player, 1);
  return new;
end;
$$;
drop trigger if exists daily_puzzle_counts_weekly on public.daily_puzzle_days;
create trigger daily_puzzle_counts_weekly after insert on public.daily_puzzle_days
  for each row execute function public.daily_puzzle_counts_weekly();

-- Same as step 19, and a first-time solve now counts for the week.
create or replace function public.add_solved_puzzles(p_puzzles integer[])
returns integer[]
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  merged integer[];
  before_count integer;
begin
  if me is null then raise exception 'Please log in first'; end if;
  if cardinality(coalesce(p_puzzles, '{}')) > 2000 then raise exception 'Too many puzzles at once'; end if;
  select cardinality(solved_puzzles) into before_count from public.profiles where id = me;
  select coalesce(array_agg(distinct n order by n), '{}') into merged from (
    select unnest(solved_puzzles) as n from public.profiles where id = me
    union
    select unnest(coalesce(p_puzzles, '{}'))) all_solved
  where n between 0 and 9999;
  update public.profiles set solved_puzzles = merged where id = me;
  if cardinality(merged) > before_count then perform public.weekly_puzzles_add(me, 1); end if;
  return merged;
end;
$$;

-- Same as step 16, and a finished run's score now counts for the week (at most 100 per run).
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
  perform public.weekly_puzzles_add(me, least(p_score, 100));
  with inserted as (
    insert into public.player_achievements (player, achievement)
      select me, a from unnest(array['rush-10', 'rush-20', 'rush-30']) a
      where p_score >= (substring(a from 6))::integer
      on conflict do nothing returning achievement)
  select coalesce(array_agg(achievement), '{}') into earned from inserted;
  return jsonb_build_object('best', old_best is null or p_score > old_best, 'new', to_jsonb(earned));
end;
$$;

notify pgrst, 'reload schema';
select 'weekly boards ready' as status;
