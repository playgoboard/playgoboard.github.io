-- GoBoard step 13: watching live online games.
-- Paste this whole file into Supabase: SQL Editor -> New query -> Run.
-- Safe to run more than once.
--
-- Online games run between the two browsers, so a logged-in player's browser copies each
-- move here. Who may watch is decided here, not on the website: the players' friends,
-- or the admin with the admin code (step 12). Players see how many friends are watching
-- (the admin isn't counted).

create table if not exists public.live_games (
  game_key text primary key,
  black uuid references public.profiles (id) on delete set null,
  white uuid references public.profiles (id) on delete set null,
  black_name text not null,
  white_name text not null,
  board_size integer not null check (board_size in (9, 13, 19)),
  moves jsonb not null default '[]'::jsonb,
  result text,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists live_games_black on public.live_games (black, updated_at desc);
create index if not exists live_games_white on public.live_games (white, updated_at desc);
alter table public.live_games enable row level security; -- read only through the functions below

create table if not exists public.live_watchers (
  game_key text not null references public.live_games (game_key) on delete cascade,
  watcher uuid not null references public.profiles (id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (game_key, watcher)
);
alter table public.live_watchers enable row level security;

create or replace function public.are_friends(a uuid, b uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select a is not null and b is not null and exists (
    select 1 from public.friendships where status = 'accepted'
      and ((requester = a and addressee = b) or (requester = b and addressee = a)))
$$;
revoke all on function public.are_friends(uuid, uuid) from public, anon, authenticated;

-- A game counts as live while its moves keep coming (the players' browsers check in often).
create or replace function public.live_is_on(g public.live_games)
returns boolean
language sql stable set search_path = ''
as $$ select g.result is null and g.updated_at > now() - interval '3 minutes' $$;

-- A player's browser sends the game. Returns how many friends are watching.
create or replace function public.live_update(p_key text, p_size integer, p_my_color text,
  p_black_name text, p_white_name text, p_moves jsonb, p_result text)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  g public.live_games;
begin
  if me is null then return 0; end if;
  if char_length(coalesce(p_key, '')) not between 6 and 100 or p_size not in (9, 13, 19)
     or p_my_color not in ('black', 'white') or jsonb_typeof(p_moves) <> 'array'
     or jsonb_array_length(p_moves) > 1500 or char_length(p_black_name) > 40 or char_length(p_white_name) > 40
     or char_length(coalesce(p_result, '')) > 20 then
    raise exception 'That game can''t be shown live';
  end if;
  select * into g from public.live_games where game_key = p_key for update;
  if g.game_key is null then
    insert into public.live_games (game_key, black, white, black_name, white_name, board_size, moves, result)
      values (p_key, case when p_my_color = 'black' then me end, case when p_my_color = 'white' then me end,
              p_black_name, p_white_name, p_size, p_moves, p_result);
  elsif g.black = me or g.white = me
     or (p_my_color = 'black' and g.black is null) or (p_my_color = 'white' and g.white is null) then
    update public.live_games
      set black = coalesce(black, case when p_my_color = 'black' then me end),
          white = coalesce(white, case when p_my_color = 'white' then me end),
          black_name = p_black_name, white_name = p_white_name, moves = p_moves,
          result = coalesce(p_result, result), updated_at = now()
      where game_key = p_key;
  else
    return 0; -- someone else's game
  end if;
  if random() < 0.05 then
    delete from public.live_games where updated_at < now() - interval '1 day';
    delete from public.live_watchers where seen_at < now() - interval '10 minutes';
  end if;
  return (select count(*) from public.live_watchers where game_key = p_key and seen_at > now() - interval '15 seconds');
end;
$$;
grant execute on function public.live_update(text, integer, text, text, text, jsonb, text) to authenticated;

-- Your friends' games going on right now (for the Friends window).
create or replace function public.live_friend_games()
returns table (game_key text, black uuid, white uuid, black_name text, white_name text, board_size integer, move_count integer)
language sql stable security definer set search_path = ''
as $$
  select g.game_key, g.black, g.white, g.black_name, g.white_name, g.board_size, jsonb_array_length(g.moves)
    from public.live_games g
    where public.live_is_on(g)
      and (public.are_friends(auth.uid(), g.black) or public.are_friends(auth.uid(), g.white))
    order by g.updated_at desc limit 50
$$;
grant execute on function public.live_friend_games() to authenticated;

-- Is this player in a game right now? Answered for their friends ("friend") and the admin ("admin").
create or replace function public.live_player_game(p_player uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  key text;
  how text;
begin
  if auth.uid() is null or auth.uid() = p_player then return null; end if;
  if public.are_friends(auth.uid(), p_player) then how := 'friend';
  elsif public.is_admin() then how := 'admin';
  else return null;
  end if;
  select g.game_key into key from public.live_games g
    where (g.black = p_player or g.white = p_player) and public.live_is_on(g)
    order by g.updated_at desc limit 1;
  if key is null then return null; end if;
  return jsonb_build_object('key', key, 'as', how);
end;
$$;
grant execute on function public.live_player_game(uuid) to authenticated;

-- Watching: friends of a player, or the admin with the admin code. Called every few seconds.
create or replace function public.watch_game(p_key text, p_code text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  g public.live_games;
  problem text;
  as_friend boolean;
begin
  if me is null then return jsonb_build_object('error', 'Please log in first'); end if;
  select * into g from public.live_games where game_key = p_key;
  if g.game_key is null then return jsonb_build_object('error', 'That game wasn''t found. It may have ended a while ago.'); end if;
  as_friend := me = g.black or me = g.white or public.are_friends(me, g.black) or public.are_friends(me, g.white);
  if not as_friend then
    if p_code is null then return jsonb_build_object('error', 'Only friends of the players can watch this game.'); end if;
    problem := public.admin_code_problem(p_code);
    if problem is not null then return jsonb_build_object('error', problem); end if;
  elsif me <> coalesce(g.black, '00000000-0000-0000-0000-000000000000') and me <> coalesce(g.white, '00000000-0000-0000-0000-000000000000') then
    insert into public.live_watchers (game_key, watcher) values (p_key, me)
      on conflict (game_key, watcher) do update set seen_at = now();
  end if;
  return jsonb_build_object(
    'black_name', g.black_name, 'white_name', g.white_name, 'size', g.board_size,
    'moves', g.moves, 'result', g.result, 'live', public.live_is_on(g),
    'watching', (select count(*) from public.live_watchers w where w.game_key = p_key and w.seen_at > now() - interval '15 seconds'));
end;
$$;
grant execute on function public.watch_game(text, text) to authenticated;

notify pgrst, 'reload schema';
select 'live games ready' as status;
