-- GoBoard step 5: game history with replays.
-- Paste this whole file into Supabase: SQL Editor -> New query -> Run.
-- Safe to run more than once.
--
-- Each logged-in player saves finished online games to THEIR OWN history (one row per
-- player per game). Nobody can write to someone else's history. Rated results and rating
-- changes are not taken from here: the history page reads them from rated_games.

create table if not exists public.game_records (
  id uuid primary key default gen_random_uuid(),
  player uuid not null references public.profiles (id) on delete cascade,
  game_key text not null,
  my_color text not null check (my_color in ('black', 'white')),
  opponent uuid references public.profiles (id) on delete set null,
  opponent_name text not null,
  board_size integer not null check (board_size in (9, 13, 19)),
  moves jsonb not null,
  winner text check (winner in ('black', 'white')),
  result text not null,
  rated_game_id uuid references public.rated_games (id) on delete set null,
  quick boolean not null default false,
  created_at timestamptz not null default now(),
  unique (player, game_key)
);
create index if not exists game_records_player on public.game_records (player, created_at desc);

-- Anyone can look at game histories and replays. Writing only through save_game_record.
alter table public.game_records enable row level security;
drop policy if exists "Game records are public" on public.game_records;
create policy "Game records are public" on public.game_records
  for select using (true);

-- moves: a list like [[2,3], [4,4], "pass", ...] (x, y from the top-left corner).
-- result: a short text like "B+R" (resign), "W+T" (time) or "B+3.5" (points).
create or replace function public.save_game_record(
  p_game_key text, p_my_color text, p_opponent uuid, p_opponent_name text, p_size integer,
  p_moves jsonb, p_winner text, p_result text, p_rated_game_id uuid, p_quick boolean)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  name text := left(coalesce(nullif(trim(p_opponent_name), ''), 'Guest'), 20);
begin
  if me is null then raise exception 'Please log in first'; end if;
  if p_game_key !~ '^[A-Za-z0-9]{8,40}$' then raise exception 'Invalid game'; end if;
  if p_my_color not in ('black', 'white') or p_size not in (9, 13, 19) then raise exception 'Invalid game'; end if;
  if p_winner is not null and p_winner not in ('black', 'white') then raise exception 'Invalid game'; end if;
  if p_result !~ '^[BW]\+(R|T|[0-9]{1,3}(\.5)?)$' then raise exception 'Invalid result'; end if;
  if jsonb_typeof(p_moves) <> 'array' or jsonb_array_length(p_moves) > 1000 then raise exception 'Invalid moves'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_moves) m
    where not (
      m = '"pass"'::jsonb
      or (jsonb_typeof(m) = 'array' and jsonb_array_length(m) = 2
          and jsonb_typeof(m -> 0) = 'number' and jsonb_typeof(m -> 1) = 'number'
          and (m ->> 0) ~ '^[0-9]{1,2}$' and (m ->> 1) ~ '^[0-9]{1,2}$'
          and (m ->> 0)::int < p_size and (m ->> 1)::int < p_size))
  ) then raise exception 'Invalid moves'; end if;

  -- The opponent must be a real account (not yourself); their current username is used.
  if p_opponent is not null then
    if p_opponent = me then raise exception 'Invalid opponent'; end if;
    select username into name from public.profiles where id = p_opponent;
    if name is null then
      p_opponent := null;
      name := 'Guest';
    end if;
  end if;
  -- A rated game can only be linked if you actually played in it.
  if p_rated_game_id is not null and not exists (
    select 1 from public.rated_games where id = p_rated_game_id and (black = me or white = me)
  ) then p_rated_game_id := null; end if;

  -- Keep it reasonable: at most 100 saved games per hour.
  if (select count(*) from public.game_records
      where player = me and created_at > now() - interval '1 hour') >= 100 then
    raise exception 'Too many games saved. Try again later';
  end if;

  insert into public.game_records
    (player, game_key, my_color, opponent, opponent_name, board_size, moves, winner, result, rated_game_id, quick)
  values
    (me, p_game_key, p_my_color, p_opponent, name, p_size, p_moves, p_winner, p_result, p_rated_game_id, coalesce(p_quick, false))
  on conflict (player, game_key) do nothing;
end;
$$;

revoke all on function public.save_game_record(text, text, uuid, text, integer, jsonb, text, text, uuid, boolean) from public, anon;
grant execute on function public.save_game_record(text, text, uuid, text, integer, jsonb, text, text, uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
select 'game history ready' as result;
