-- GoBoard step 2: rated online games.
-- Paste this whole file into Supabase: SQL Editor -> New query -> Run.
-- Safe to run more than once.
--
-- How a rated game works:
--   1. The creator's browser calls start_rated_game (it becomes "created_by").
--   2. The joiner's browser checks the game and calls join_rated_game.
--   3. When the game ends, both browsers call report_result with the winner.
--      Ratings change only when both reports agree. If only one player ever reports,
--      finalize_my_stale_games accepts that report after 10 minutes.

create table if not exists public.rated_games (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles (id) on delete cascade,
  black uuid not null references public.profiles (id) on delete cascade,
  white uuid not null references public.profiles (id) on delete cascade,
  board_size integer not null check (board_size in (9, 13, 19)),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  black_report text check (black_report in ('black', 'white')),
  white_report text check (white_report in ('black', 'white')),
  first_report_at timestamptz,
  winner text check (winner in ('black', 'white', 'disputed')),
  finished_at timestamptz,
  black_rating_before integer,
  white_rating_before integer,
  black_change integer,
  white_change integer,
  check (black <> white)
);

create index if not exists rated_games_black on public.rated_games (black);
create index if not exists rated_games_white on public.rated_games (white);

-- Anyone may read games (for game history later). Nobody may write them directly.
alter table public.rated_games enable row level security;
drop policy if exists "Rated games are public" on public.rated_games;
create policy "Rated games are public" on public.rated_games
  for select using (true);

-- Step 1: the creator starts a rated game against the player who joined.
create or replace function public.start_rated_game(opponent uuid, my_color text, size integer)
returns uuid
language plpgsql
security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  new_id uuid;
begin
  if me is null then raise exception 'Please log in first'; end if;
  if opponent is null or opponent = me then raise exception 'You need a different opponent'; end if;
  if my_color not in ('black', 'white') then raise exception 'Invalid color'; end if;
  if not exists (select 1 from public.profiles where id = opponent) then raise exception 'Opponent not found'; end if;
  insert into public.rated_games (created_by, black, white, board_size)
  values (
    me,
    case when my_color = 'black' then me else opponent end,
    case when my_color = 'black' then opponent else me end,
    size
  )
  returning id into new_id;
  return new_id;
end;
$$;

-- Step 2: the other player confirms they are really playing this game.
create or replace function public.join_rated_game(game uuid)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  g public.rated_games;
begin
  select * into g from public.rated_games where id = game for update;
  if not found then raise exception 'Game not found'; end if;
  if me is null or me = g.created_by or (me <> g.black and me <> g.white) then
    raise exception 'Not your game';
  end if;
  update public.rated_games set accepted_at = coalesce(accepted_at, now()) where id = game;
end;
$$;

-- Moves the ratings (Elo, K = 32) and records the result. Only called by the functions below.
create or replace function public.apply_rating(game uuid, winner_color text)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  g public.rated_games;
  black_rating integer;
  white_rating integer;
  expected_black double precision;
  change integer;
  black_won integer := case when winner_color = 'black' then 1 else 0 end;
begin
  select * into g from public.rated_games where id = game for update;
  if g.finished_at is not null then return; end if;
  select rating into black_rating from public.profiles where id = g.black for update;
  select rating into white_rating from public.profiles where id = g.white for update;
  expected_black := 1.0 / (1.0 + power(10.0, (white_rating - black_rating) / 400.0));
  change := round(32 * (black_won - expected_black));

  update public.profiles
    set rating = rating + change, games = games + 1, wins = wins + black_won, losses = losses + 1 - black_won
    where id = g.black;
  update public.profiles
    set rating = rating - change, games = games + 1, wins = wins + 1 - black_won, losses = losses + black_won
    where id = g.white;
  update public.rated_games
    set winner = winner_color, finished_at = now(),
        black_rating_before = black_rating, white_rating_before = white_rating,
        black_change = change, white_change = -change
    where id = game;
end;
$$;

-- Step 3: each player's browser reports who won. Returns the game row.
create or replace function public.report_result(game uuid, winner_color text)
returns public.rated_games
language plpgsql
security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  g public.rated_games;
begin
  if winner_color not in ('black', 'white') then raise exception 'Invalid result'; end if;
  select * into g from public.rated_games where id = game for update;
  if not found then raise exception 'Game not found'; end if;
  if me is null or (me <> g.black and me <> g.white) then raise exception 'Not your game'; end if;
  if g.accepted_at is null then raise exception 'This game was never confirmed by both players'; end if;
  if g.finished_at is not null then return g; end if;

  -- A report can't be changed once made.
  if me = g.black and g.black_report is null then
    update public.rated_games set black_report = winner_color, first_report_at = coalesce(first_report_at, now()) where id = game;
  elsif me = g.white and g.white_report is null then
    update public.rated_games set white_report = winner_color, first_report_at = coalesce(first_report_at, now()) where id = game;
  end if;

  select * into g from public.rated_games where id = game;
  if g.black_report is not null and g.white_report is not null then
    if g.black_report = g.white_report then
      perform public.apply_rating(game, g.black_report);
    else
      update public.rated_games set winner = 'disputed', finished_at = now() where id = game;
    end if;
  end if;

  select * into g from public.rated_games where id = game;
  return g;
end;
$$;

-- If only one player reported and 10 minutes have passed, accept that report.
-- Called when a logged-in player opens the site; only touches games they played.
create or replace function public.finalize_my_stale_games()
returns integer
language plpgsql
security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  g public.rated_games;
  done integer := 0;
begin
  if me is null then return 0; end if;
  for g in
    select * from public.rated_games
    where (black = me or white = me)
      and finished_at is null and accepted_at is not null
      and first_report_at < now() - interval '10 minutes'
      and (black_report is null) <> (white_report is null)
  loop
    perform public.apply_rating(g.id, coalesce(g.black_report, g.white_report));
    done := done + 1;
  end loop;
  return done;
end;
$$;

revoke all on function public.apply_rating(uuid, text) from public, anon, authenticated;
revoke all on function public.start_rated_game(uuid, text, integer) from public, anon;
revoke all on function public.join_rated_game(uuid) from public, anon;
revoke all on function public.report_result(uuid, text) from public, anon;
revoke all on function public.finalize_my_stale_games() from public, anon;
grant execute on function public.start_rated_game(uuid, text, integer) to authenticated;
grant execute on function public.join_rated_game(uuid) to authenticated;
grant execute on function public.report_result(uuid, text) to authenticated;
grant execute on function public.finalize_my_stale_games() to authenticated;
