-- GoBoard step 3: friends with friend requests.
-- Paste this whole file into Supabase: SQL Editor -> New query -> Run.
-- Safe to run more than once.

-- One row per pair of players: a pending request, or an accepted friendship.
create table if not exists public.friendships (
  requester uuid not null references public.profiles (id) on delete cascade,
  addressee uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  primary key (requester, addressee),
  check (requester <> addressee)
);

-- Players can only see their own requests and friendships. Changes go through the functions below.
alter table public.friendships enable row level security;
drop policy if exists "See your own friendships" on public.friendships;
create policy "See your own friendships" on public.friendships
  for select using (auth.uid() = requester or auth.uid() = addressee);

-- Send a friend request by username. If they already asked you, this accepts it.
create or replace function public.send_friend_request(friend_name text)
returns text
language plpgsql
security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  friend uuid;
  existing public.friendships;
begin
  if me is null then raise exception 'Please log in first'; end if;
  select id into friend from public.profiles where lower(username) = lower(trim(friend_name));
  if friend is null then raise exception 'No player with that username'; end if;
  if friend = me then raise exception 'You can''t add yourself'; end if;

  select * into existing from public.friendships
    where (requester = me and addressee = friend) or (requester = friend and addressee = me);
  if found then
    if existing.status = 'accepted' then raise exception 'You are already friends'; end if;
    if existing.requester = me then raise exception 'You already sent a request to this player'; end if;
    update public.friendships set status = 'accepted' where requester = friend and addressee = me;
    return 'accepted';
  end if;

  -- Keep it friendly: at most 20 open requests at a time.
  if (select count(*) from public.friendships where requester = me and status = 'pending') >= 20 then
    raise exception 'You have too many requests waiting. Wait for some answers first';
  end if;
  insert into public.friendships (requester, addressee) values (me, friend);
  return 'sent';
end;
$$;

-- Accept or decline a request someone sent you.
create or replace function public.answer_friend_request(friend uuid, accept boolean)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'Please log in first'; end if;
  if accept then
    update public.friendships set status = 'accepted'
      where requester = friend and addressee = me and status = 'pending';
  else
    delete from public.friendships
      where requester = friend and addressee = me and status = 'pending';
  end if;
end;
$$;

-- Remove a friend, or cancel a request you sent.
create or replace function public.remove_friend(friend uuid)
returns void
language plpgsql
security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'Please log in first'; end if;
  delete from public.friendships
    where (requester = me and addressee = friend) or (requester = friend and addressee = me);
end;
$$;

revoke all on function public.send_friend_request(text) from public, anon;
revoke all on function public.answer_friend_request(uuid, boolean) from public, anon;
revoke all on function public.remove_friend(uuid) from public, anon;
grant execute on function public.send_friend_request(text) to authenticated;
grant execute on function public.answer_friend_request(uuid, boolean) to authenticated;
grant execute on function public.remove_friend(uuid) to authenticated;
