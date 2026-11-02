-- GoBoard step 24: rated puzzles. A puzzle rating that goes up and down, and puzzles picked near it.
-- Paste this whole file into Supabase: SQL Editor -> New query -> Run.
-- Safe to run more than once: puzzles already there keep the rating they've earned.
--
-- Puzzles are numbered by their place in js/rush-puzzles.js (0 = the first), so new ones must go at
-- the end. A puzzle's starting rating comes from how many moves it takes; play then corrects it.
-- The browser reports whether a puzzle was solved, so a determined cheater could fake it.

alter table public.profiles add column if not exists puzzle_rating integer not null default 1000;
alter table public.profiles add column if not exists puzzle_games integer not null default 0;

create table if not exists public.puzzle_ratings (
  puzzle integer primary key,
  rating integer not null,
  plays integer not null default 0,
  solves integer not null default 0
);
alter table public.puzzle_ratings enable row level security; -- nobody reads it directly

create table if not exists public.puzzle_attempts (
  player uuid not null references public.profiles (id) on delete cascade,
  puzzle integer not null references public.puzzle_ratings (puzzle) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  solved boolean,
  change integer,
  primary key (player, puzzle)
);
create unique index if not exists puzzle_attempts_one_open on public.puzzle_attempts (player) where finished_at is null;
alter table public.puzzle_attempts enable row level security; -- nobody reads it directly

-- One digit per puzzle: how many moves it takes.
insert into public.puzzle_ratings (puzzle, rating)
  select pos - 1, 650 + 250 * (least(digit::integer, 5) - 1)
  from unnest(string_to_array('135344213211232145144351411131114453111114423412155131414111241142213341335411314511122151311113533315311432512241111131111111321514411151511111122311151133351523423233125411213113154311111345514513114531111131432512541334511334313521131413231253311131315521412352112133424451134441311111311311135111111114332231111411211131111131131143215142211151431114313131131253313335423223113311511111333434111333131213341515551211132411215123214151434533313112311111313324141131133213323311514333145223133111311311355411414311514513143435312214131135141112111134511211431151121351323121131333311344221211112333533234253113113211131111411111121115141541333', NULL)) with ordinality as t(digit, pos)
  on conflict (puzzle) do nothing;

-- The puzzle you're on, or a new one near your rating (a random one of the 10 closest you haven't played).
-- Returns { puzzle, my_rating, games } or { done: true, my_rating, games }.
create or replace function public.puzzle_next()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  mine integer;
  played integer;
  chosen integer;
begin
  if me is null then raise exception 'Please log in first'; end if;
  select puzzle_rating, puzzle_games into mine, played from public.profiles where id = me for update;
  select puzzle into chosen from public.puzzle_attempts where player = me and finished_at is null;
  if chosen is null then
    select c.puzzle into chosen from (
      select r.puzzle from public.puzzle_ratings r
        where not exists (select 1 from public.puzzle_attempts a where a.player = me and a.puzzle = r.puzzle)
        order by abs(r.rating - mine) limit 10) c
      order by random() limit 1;
    if chosen is null then
      return jsonb_build_object('done', true, 'my_rating', mine, 'games', played);
    end if;
    insert into public.puzzle_attempts (player, puzzle) values (me, chosen);
  end if;
  return jsonb_build_object('puzzle', chosen, 'my_rating', mine, 'games', played);
end;
$$;
revoke all on function public.puzzle_next() from public, anon;
grant execute on function public.puzzle_next() to authenticated;

-- Ends the try. Your rating moves more in your first 20 puzzles, so it finds your level quickly.
-- Returns { change, my_rating, games, puzzle_rating }.
create or replace function public.puzzle_finish(p_puzzle integer, p_solved boolean)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  mine integer;
  played integer;
  theirs integer;
  expected double precision;
  score integer := case when p_solved then 1 else 0 end;
  my_change integer;
  new_mine integer;
  new_theirs integer;
begin
  if me is null then raise exception 'Please log in first'; end if;
  if p_solved is null then raise exception 'That result can''t be saved'; end if;
  select puzzle_rating, puzzle_games into mine, played from public.profiles where id = me for update;
  if not exists (select 1 from public.puzzle_attempts where player = me and puzzle = p_puzzle and finished_at is null) then
    raise exception 'That puzzle isn''t open any more';
  end if;
  select rating into theirs from public.puzzle_ratings where puzzle = p_puzzle for update;
  expected := 1.0 / (1.0 + power(10.0, (theirs - mine) / 400.0));
  new_mine := greatest(100, least(3000, mine + round((case when played < 20 then 48 else 24 end) * (score - expected))::integer));
  my_change := new_mine - mine;
  new_theirs := greatest(100, least(3000, theirs + round(16 * (expected - score))::integer));
  update public.profiles set puzzle_rating = new_mine, puzzle_games = played + 1 where id = me;
  update public.puzzle_ratings set rating = new_theirs, plays = plays + 1, solves = solves + score where puzzle = p_puzzle;
  update public.puzzle_attempts set finished_at = now(), solved = p_solved, change = my_change
    where player = me and puzzle = p_puzzle;
  if p_solved then perform public.weekly_puzzles_add(me, 1); end if;
  return jsonb_build_object('change', my_change, 'my_rating', new_mine, 'games', played + 1, 'puzzle_rating', new_theirs);
end;
$$;
revoke all on function public.puzzle_finish(integer, boolean) from public, anon;
grant execute on function public.puzzle_finish(integer, boolean) to authenticated;

notify pgrst, 'reload schema';
select 'puzzle rating ready' as status;
