-- GoBoard step 6: daily games (slow games: a move whenever you like, within 1, 3 or 7 days).
-- Paste this whole file into Supabase: SQL Editor -> New query -> Run.
-- Safe to run more than once.
--
-- Every move is checked here with the real rules (captures, no suicide, simple ko), so a
-- changed page can't cheat. When both players pass, the board is counted exactly as it is
-- (area scoring, komi 7.5): stones plus empty areas that touch only one color.
-- Board points are numbered 0..size*size-1 (y * size + x); the arrays here start at 1.

create table if not exists public.daily_games (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles (id) on delete cascade,
  creator_color text not null check (creator_color in ('black', 'white', 'random')),
  black uuid references public.profiles (id) on delete set null,
  white uuid references public.profiles (id) on delete set null,
  board_size integer not null check (board_size in (9, 13, 19)),
  days integer not null check (days in (1, 3, 7)),
  rated boolean not null default false,
  status text not null default 'open' check (status in ('open', 'playing', 'finished', 'cancelled')),
  board smallint[],
  prev_board smallint[],
  moves jsonb not null default '[]'::jsonb,
  turn text not null default 'black' check (turn in ('black', 'white')),
  passes integer not null default 0,
  captures_black integer not null default 0,
  captures_white integer not null default 0,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  last_move_at timestamptz,
  finished_at timestamptz,
  winner text check (winner in ('black', 'white')),
  result text,
  black_rating_before integer,
  white_rating_before integer,
  black_change integer,
  white_change integer
);
create index if not exists daily_games_status on public.daily_games (status, created_at desc);
create index if not exists daily_games_black on public.daily_games (black);
create index if not exists daily_games_white on public.daily_games (white);

-- Anyone can look at daily games (open challenges must be visible). Changes only through the functions.
alter table public.daily_games enable row level security;
drop policy if exists "Daily games are public" on public.daily_games;
create policy "Daily games are public" on public.daily_games for select using (true);

-- Game history (05) learns about daily games: which ones they are, and the rating change.
alter table public.game_records add column if not exists daily boolean not null default false;
alter table public.game_records add column if not exists rating_change integer;

-- ---- The rules ----

-- One group: its stones and how many liberties it has.
create or replace function public.daily_group(b smallint[], size integer, start integer, out stones integer[], out libs integer)
language plpgsql immutable set search_path = ''
as $$
declare
  color smallint := b[start + 1];
  seen boolean[] := array_fill(false, array[size * size]);
  libseen boolean[] := array_fill(false, array[size * size]);
  stack integer[] := array[start];
  cur integer;
  n integer;
  nbrs integer[];
begin
  stones := array[]::integer[];
  libs := 0;
  seen[start + 1] := true;
  while cardinality(stack) > 0 loop
    cur := stack[cardinality(stack)];
    stack := stack[1:cardinality(stack) - 1];
    stones := stones || cur;
    nbrs := array[]::integer[];
    if cur % size > 0 then nbrs := nbrs || (cur - 1); end if;
    if cur % size < size - 1 then nbrs := nbrs || (cur + 1); end if;
    if cur / size > 0 then nbrs := nbrs || (cur - size); end if;
    if cur / size < size - 1 then nbrs := nbrs || (cur + size); end if;
    foreach n in array nbrs loop
      if b[n + 1] = 0 then
        if not libseen[n + 1] then libseen[n + 1] := true; libs := libs + 1; end if;
      elsif b[n + 1] = color and not seen[n + 1] then
        seen[n + 1] := true;
        stack := stack || n;
      end if;
    end loop;
  end loop;
end;
$$;

-- Plays a stone and returns the new board, or stops with the reason the move isn't allowed.
create or replace function public.daily_play(b smallint[], size integer, idx integer, color smallint, ko_board smallint[])
returns smallint[]
language plpgsql immutable set search_path = ''
as $$
declare
  nb smallint[] := b;
  opp smallint := 3 - color;
  n integer;
  s integer;
  nbrs integer[] := array[]::integer[];
  grp record;
begin
  if idx < 0 or idx >= size * size then raise exception 'That point is not on the board'; end if;
  if b[idx + 1] <> 0 then raise exception 'There''s already a stone there.'; end if;
  nb[idx + 1] := color;
  if idx % size > 0 then nbrs := nbrs || (idx - 1); end if;
  if idx % size < size - 1 then nbrs := nbrs || (idx + 1); end if;
  if idx / size > 0 then nbrs := nbrs || (idx - size); end if;
  if idx / size < size - 1 then nbrs := nbrs || (idx + size); end if;
  foreach n in array nbrs loop
    if nb[n + 1] = opp then
      select * into grp from public.daily_group(nb, size, n);
      if grp.libs = 0 then
        foreach s in array grp.stones loop nb[s + 1] := 0; end loop;
      end if;
    end if;
  end loop;
  select * into grp from public.daily_group(nb, size, idx);
  if grp.libs = 0 then raise exception 'You can''t play where your stones would have no liberties.'; end if;
  if ko_board is not null and nb = ko_board then
    raise exception 'Ko rule: you can''t retake right away. Play somewhere else first.';
  end if;
  return nb;
end;
$$;

-- Black's area minus White's area: stones, plus empty regions that touch only one color.
create or replace function public.daily_score(b smallint[], size integer)
returns integer
language plpgsql immutable set search_path = ''
as $$
declare
  total integer := 0;
  seen boolean[] := array_fill(false, array[size * size]);
  stack integer[];
  cur integer;
  n integer;
  nbrs integer[];
  region integer;
  touches_black boolean;
  touches_white boolean;
begin
  for i in 0 .. size * size - 1 loop
    if b[i + 1] = 1 then total := total + 1;
    elsif b[i + 1] = 2 then total := total - 1;
    elsif not seen[i + 1] then
      region := 0; touches_black := false; touches_white := false;
      stack := array[i];
      seen[i + 1] := true;
      while cardinality(stack) > 0 loop
        cur := stack[cardinality(stack)];
        stack := stack[1:cardinality(stack) - 1];
        region := region + 1;
        nbrs := array[]::integer[];
        if cur % size > 0 then nbrs := nbrs || (cur - 1); end if;
        if cur % size < size - 1 then nbrs := nbrs || (cur + 1); end if;
        if cur / size > 0 then nbrs := nbrs || (cur - size); end if;
        if cur / size < size - 1 then nbrs := nbrs || (cur + size); end if;
        foreach n in array nbrs loop
          if b[n + 1] = 1 then touches_black := true;
          elsif b[n + 1] = 2 then touches_white := true;
          elsif not seen[n + 1] then seen[n + 1] := true; stack := stack || n;
          end if;
        end loop;
      end loop;
      if touches_black and not touches_white then total := total + region;
      elsif touches_white and not touches_black then total := total - region;
      end if;
    end if;
  end loop;
  return total;
end;
$$;

-- Ends a game: result, ratings (Elo, K = 32, like online games) and both players' game history.
-- result: 'B+R' resign, 'W+T' time, 'B+3.5' points.
create or replace function public.daily_finish(p_game uuid, p_winner text, p_result text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  g public.daily_games;
  black_rating integer;
  white_rating integer;
  expected_black double precision;
  change integer := null;
  black_won integer := case when p_winner = 'black' then 1 else 0 end;
  black_name text;
  white_name text;
begin
  select * into g from public.daily_games where id = p_game for update;
  if g.status <> 'playing' then return; end if;

  if g.rated and g.black is not null and g.white is not null then
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
  end if;

  update public.daily_games
    set status = 'finished', winner = p_winner, result = p_result, finished_at = now(),
        black_rating_before = black_rating, white_rating_before = white_rating,
        black_change = change, white_change = -change
    where id = p_game;

  -- Both players get the game in their history, with the moves for replays.
  select username into black_name from public.profiles where id = g.black;
  select username into white_name from public.profiles where id = g.white;
  if g.black is not null then
    insert into public.game_records
      (player, game_key, my_color, opponent, opponent_name, board_size, moves, winner, result, daily, rating_change)
    values (g.black, 'daily' || replace(g.id::text, '-', ''), 'black', g.white, coalesce(white_name, 'Deleted player'),
            g.board_size, g.moves, p_winner, p_result, true, change)
    on conflict (player, game_key) do nothing;
  end if;
  if g.white is not null then
    insert into public.game_records
      (player, game_key, my_color, opponent, opponent_name, board_size, moves, winner, result, daily, rating_change)
    values (g.white, 'daily' || replace(g.id::text, '-', ''), 'white', g.black, coalesce(black_name, 'Deleted player'),
            g.board_size, g.moves, p_winner, p_result, true, -change)
    on conflict (player, game_key) do nothing;
  end if;
end;
$$;

-- Ends games whose player to move ran out of days. Anyone may call it; it only applies the rules.
create or replace function public.daily_check_timeouts()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  g public.daily_games;
  done integer := 0;
begin
  for g in
    select * from public.daily_games
    where status = 'playing' and last_move_at + make_interval(days => days) < now()
    limit 100
  loop
    perform public.daily_finish(g.id,
      case when g.turn = 'black' then 'white' else 'black' end,
      case when g.turn = 'black' then 'W+T' else 'B+T' end);
    done := done + 1;
  end loop;
  return done;
end;
$$;

-- ---- Challenges ----

create or replace function public.create_daily_challenge(p_size integer, p_days integer, p_rated boolean, p_color text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  new_id uuid;
begin
  if me is null then raise exception 'Please log in first'; end if;
  if p_size not in (9, 13, 19) or p_days not in (1, 3, 7) or p_color not in ('black', 'white', 'random') then
    raise exception 'Those game settings aren''t allowed';
  end if;
  if (select count(*) from public.daily_games where created_by = me and status = 'open') >= 5 then
    raise exception 'You already have 5 open challenges. Wait for someone to join, or cancel one';
  end if;
  if (select count(*) from public.daily_games where (black = me or white = me) and status = 'playing') >= 50 then
    raise exception 'You already have 50 daily games going. Finish some first';
  end if;
  insert into public.daily_games (created_by, creator_color, board_size, days, rated)
    values (me, p_color, p_size, p_days, coalesce(p_rated, false))
    returning id into new_id;
  return new_id;
end;
$$;

create or replace function public.cancel_daily_challenge(p_game uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.daily_games set status = 'cancelled'
    where id = p_game and created_by = auth.uid() and status = 'open';
end;
$$;

create or replace function public.join_daily_game(p_game uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  g public.daily_games;
  creator_black boolean;
begin
  if me is null then raise exception 'Please log in first'; end if;
  select * into g from public.daily_games where id = p_game for update;
  if not found or g.status <> 'open' then raise exception 'This challenge isn''t open any more'; end if;
  if g.created_by = me then raise exception 'You can''t join your own challenge'; end if;
  creator_black := case g.creator_color when 'black' then true when 'white' then false else random() < 0.5 end;
  update public.daily_games
    set status = 'playing',
        black = case when creator_black then g.created_by else me end,
        white = case when creator_black then me else g.created_by end,
        board = array_fill(0::smallint, array[g.board_size * g.board_size]),
        prev_board = null, turn = 'black', started_at = now(), last_move_at = now()
    where id = p_game;
end;
$$;

-- ---- Playing ----

-- p_count: how many moves the page knew about, so a double click or an old page can't play twice.
-- p_x = -1 means pass.
create or replace function public.daily_move(p_game uuid, p_count integer, p_x integer, p_y integer)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  g public.daily_games;
  color smallint;
  new_board smallint[];
  stones_before integer;
  stones_after integer;
  score integer;
  margin numeric;
begin
  if me is null then raise exception 'Please log in first'; end if;
  perform public.daily_check_timeouts();
  select * into g from public.daily_games where id = p_game for update;
  if not found then raise exception 'Game not found'; end if;
  if g.status <> 'playing' then raise exception 'This game is over'; end if;
  if (g.turn = 'black' and g.black is distinct from me) or (g.turn = 'white' and g.white is distinct from me) then
    raise exception 'It''s not your turn';
  end if;
  if jsonb_array_length(g.moves) <> p_count then raise exception 'The game changed. Reloading'; end if;
  color := case when g.turn = 'black' then 1 else 2 end;

  if p_x = -1 then
    update public.daily_games
      set moves = moves || '["pass"]'::jsonb, passes = passes + 1, prev_board = board,
          turn = case when turn = 'black' then 'white' else 'black' end, last_move_at = now()
      where id = p_game;
    if g.passes + 1 >= 2 then
      score := public.daily_score(g.board, g.board_size);
      margin := abs(score - 7.5);
      perform public.daily_finish(p_game,
        case when score - 7.5 > 0 then 'black' else 'white' end,
        case when score - 7.5 > 0 then 'B+' else 'W+' end || trim(trailing '.' from trim(trailing '0' from margin::text)));
    end if;
    return;
  end if;

  if p_x < 0 or p_y < 0 or p_x >= g.board_size or p_y >= g.board_size then raise exception 'That point is not on the board'; end if;
  new_board := public.daily_play(g.board, g.board_size, p_y * g.board_size + p_x, color, g.prev_board);
  select count(*) into stones_before from unnest(g.board) v where v = 3 - color;
  select count(*) into stones_after from unnest(new_board) v where v = 3 - color;
  update public.daily_games
    set moves = moves || jsonb_build_array(jsonb_build_array(p_x, p_y)),
        prev_board = board, board = new_board, passes = 0,
        captures_black = captures_black + case when color = 1 then stones_before - stones_after else 0 end,
        captures_white = captures_white + case when color = 2 then stones_before - stones_after else 0 end,
        turn = case when turn = 'black' then 'white' else 'black' end, last_move_at = now()
    where id = p_game;
end;
$$;

create or replace function public.daily_resign(p_game uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  g public.daily_games;
begin
  select * into g from public.daily_games where id = p_game;
  if not found or g.status <> 'playing' then raise exception 'This game is over'; end if;
  if me is null or (me is distinct from g.black and me is distinct from g.white) then raise exception 'Not your game'; end if;
  if me = g.black then perform public.daily_finish(p_game, 'white', 'W+R');
  else perform public.daily_finish(p_game, 'black', 'B+R');
  end if;
end;
$$;

-- Helpers only the functions above may use.
revoke all on function public.daily_group(smallint[], integer, integer) from public, anon, authenticated;
revoke all on function public.daily_play(smallint[], integer, integer, smallint, smallint[]) from public, anon, authenticated;
revoke all on function public.daily_score(smallint[], integer) from public, anon, authenticated;
revoke all on function public.daily_finish(uuid, text, text) from public, anon, authenticated;

revoke all on function public.daily_check_timeouts() from public;
revoke all on function public.create_daily_challenge(integer, integer, boolean, text) from public, anon;
revoke all on function public.cancel_daily_challenge(uuid) from public, anon;
revoke all on function public.join_daily_game(uuid) from public, anon;
revoke all on function public.daily_move(uuid, integer, integer, integer) from public, anon;
revoke all on function public.daily_resign(uuid) from public, anon;
grant execute on function public.daily_check_timeouts() to anon, authenticated;
grant execute on function public.create_daily_challenge(integer, integer, boolean, text) to authenticated;
grant execute on function public.cancel_daily_challenge(uuid) to authenticated;
grant execute on function public.join_daily_game(uuid) to authenticated;
grant execute on function public.daily_move(uuid, integer, integer, integer) to authenticated;
grant execute on function public.daily_resign(uuid) to authenticated;

-- Self-test of the rules (points are y * 9 + x on a 9x9 board; arrays start at 1).
do $$
declare
  b smallint[] := array_fill(0::smallint, array[81]);
  before_ko smallint[];
  failed boolean;
begin
  -- Capture: a white stone with its last liberty taken disappears.
  b := public.daily_play(b, 9, 40, 2::smallint, null);
  b := public.daily_play(b, 9, 31, 1::smallint, null);
  b := public.daily_play(b, 9, 39, 1::smallint, null);
  b := public.daily_play(b, 9, 41, 1::smallint, null);
  b := public.daily_play(b, 9, 49, 1::smallint, null);
  if b[41] <> 0 then raise exception 'Self-test failed: capture'; end if;

  -- Suicide: White can't play back into that hole.
  failed := false;
  begin
    perform public.daily_play(b, 9, 40, 2::smallint, null);
  exception when others then failed := true;
  end;
  if not failed then raise exception 'Self-test failed: suicide'; end if;

  -- Ko: Black takes one stone, White may not take straight back.
  b := array_fill(0::smallint, array[81]);
  b[2] := 1; b[10] := 1; b[20] := 1;            -- black (1,0) (0,1) (1,2)
  b[3] := 2; b[11] := 2; b[13] := 2; b[21] := 2; -- white (2,0) (1,1) (3,1) (2,2)
  before_ko := b;
  b := public.daily_play(b, 9, 11, 1::smallint, null); -- black (2,1) takes (1,1)
  if b[11] <> 0 then raise exception 'Self-test failed: ko capture'; end if;
  failed := false;
  begin
    perform public.daily_play(b, 9, 10, 2::smallint, before_ko); -- white retakes at once
  exception when others then failed := true;
  end;
  if not failed then raise exception 'Self-test failed: ko'; end if;

  -- Counting: an empty board is even; one black stone owns the whole board.
  if public.daily_score(array_fill(0::smallint, array[81]), 9) <> 0 then raise exception 'Self-test failed: empty count'; end if;
  b := array_fill(0::smallint, array[81]);
  b[41] := 1;
  if public.daily_score(b, 9) <> 81 then raise exception 'Self-test failed: count'; end if;
end;
$$;

notify pgrst, 'reload schema';
select 'daily games ready' as result;
