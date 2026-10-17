-- GoBoard step 7: invite someone you know to a daily game (link or friend challenge).
-- Paste this whole file into Supabase: SQL Editor -> New query -> Run.
-- Safe to run more than once. Needs step 6 (daily games) first.
--
-- A private challenge isn't listed for everyone:
--   invited = null    -> invite link: whoever opens daily.html?join=<game id> can join
--   invited = someone -> only that friend can accept (or decline)

alter table public.daily_games add column if not exists private boolean not null default false;
alter table public.daily_games add column if not exists invited uuid references public.profiles (id) on delete cascade;

-- Private challenges are hidden until the game starts, except from the two players.
drop policy if exists "Daily games are public" on public.daily_games;
create policy "Daily games are public" on public.daily_games for select
  using (status <> 'open' or not private or created_by = auth.uid() or invited = auth.uid());

-- Create a private challenge. p_friend: a friend's id, or null for an invite link.
create or replace function public.create_daily_invite(p_size integer, p_days integer, p_rated boolean, p_color text, p_friend uuid)
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
  if p_friend is not null and not exists (
    select 1 from public.friendships
    where status = 'accepted' and ((requester = me and addressee = p_friend) or (requester = p_friend and addressee = me))
  ) then raise exception 'You can only challenge your friends'; end if;
  if (select count(*) from public.daily_games where created_by = me and status = 'open') >= 5 then
    raise exception 'You already have 5 open challenges. Wait for someone to join, or cancel one';
  end if;
  if (select count(*) from public.daily_games where (black = me or white = me) and status = 'playing') >= 50 then
    raise exception 'You already have 50 daily games going. Finish some first';
  end if;
  insert into public.daily_games (created_by, creator_color, board_size, days, rated, private, invited)
    values (me, p_color, p_size, p_days, coalesce(p_rated, false), true, p_friend)
    returning id into new_id;
  return new_id;
end;
$$;

-- What an invite link shows before joining (the challenge itself is hidden from strangers).
create or replace function public.daily_invite_info(p_game uuid)
returns jsonb
language sql security definer set search_path = ''
as $$
  select jsonb_build_object(
    'status', g.status, 'board_size', g.board_size, 'days', g.days, 'rated', g.rated,
    'creator_color', g.creator_color, 'creator', p.username, 'creator_rating', p.rating,
    'for_someone_else', g.invited is not null and g.invited is distinct from auth.uid())
  from public.daily_games g join public.profiles p on p.id = g.created_by
  where g.id = p_game;
$$;

-- Joining: like before, but a friend challenge can only be accepted by that friend.
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
  if g.invited is not null and g.invited <> me then raise exception 'This challenge is for someone else'; end if;
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

-- The invited friend says no.
create or replace function public.decline_daily_challenge(p_game uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.daily_games set status = 'cancelled'
    where id = p_game and invited = auth.uid() and status = 'open';
end;
$$;

revoke all on function public.create_daily_invite(integer, integer, boolean, text, uuid) from public, anon;
revoke all on function public.daily_invite_info(uuid) from public;
revoke all on function public.decline_daily_challenge(uuid) from public, anon;
grant execute on function public.create_daily_invite(integer, integer, boolean, text, uuid) to authenticated;
grant execute on function public.daily_invite_info(uuid) to anon, authenticated;
grant execute on function public.decline_daily_challenge(uuid) to authenticated;

notify pgrst, 'reload schema';
select 'daily invites ready' as result;
