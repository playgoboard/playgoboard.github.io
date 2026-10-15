-- GoBoard step 4: quick match with strangers.
-- Paste this whole file into Supabase: SQL Editor -> New query -> Run.
-- Safe to run more than once.

-- The waiting line. Each searching browser has one row (a random "ticket") and an
-- online room it is already hosting. Nobody can read or change this table directly;
-- everything goes through quick_match() and quick_match_leave() below.
create table if not exists public.quick_match_queue (
  ticket uuid primary key,
  user_id uuid references public.profiles (id) on delete cascade,
  room_code text not null,
  size int not null,
  minutes int not null,
  bonus int not null,
  rated boolean not null,
  rating int not null,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  matched_with uuid,
  matched_at timestamptz
);
alter table public.quick_match_queue enable row level security;

-- Called every few seconds while searching. Returns one of:
--   {"status": "waiting"}              you're in the line, keep asking
--   {"status": "found", "room": CODE}  join that player's room
--   {"status": "matched"}              someone is joining your room
create or replace function public.quick_match(
  p_ticket uuid, p_room text, p_size int, p_minutes int, p_bonus int, p_rated boolean, p_rating int)
returns jsonb
language plpgsql
security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  my_rating int := greatest(100, least(3000, coalesce(p_rating, 1200)));
  mine public.quick_match_queue;
  partner public.quick_match_queue;
  my_start timestamptz := now();
begin
  if p_size not in (9, 13, 19) or p_minutes not in (0, 1, 3, 5, 10, 30)
     or p_bonus not in (0, 2, 5, 10, 30) or p_room !~ '^[A-Z0-9]{6}$' then
    raise exception 'Those game settings aren''t allowed';
  end if;
  if p_rated and me is null then raise exception 'Log in to play rated games'; end if;
  if me is not null then
    select rating into my_rating from public.profiles where id = me;
  end if;

  -- Forget players who left (no check-in for 15 s) and old finished matches.
  delete from public.quick_match_queue
    where (matched_with is null and last_seen < now() - interval '15 seconds')
       or matched_at < now() - interval '2 minutes';

  -- Lock our own row first, so two players can't both "find" each other at once.
  select * into mine from public.quick_match_queue where ticket = p_ticket for update;
  if found then
    if mine.matched_with is not null then return jsonb_build_object('status', 'matched'); end if;
    my_start := mine.created_at;
    update public.quick_match_queue set last_seen = now() where ticket = p_ticket;
  end if;

  -- Same settings, closest rating. The allowed rating gap starts at 200 and grows by
  -- 100 every 10 seconds the longer of the two has waited (at most 1000).
  select * into partner from public.quick_match_queue q
    where q.ticket <> p_ticket and q.matched_with is null
      and q.size = p_size and q.minutes = p_minutes and q.bonus = p_bonus and q.rated = p_rated
      and (me is null or q.user_id is distinct from me)
      and abs(q.rating - my_rating) <= least(1000,
            200 + 100 * floor(extract(epoch from now() - least(q.created_at, my_start)) / 10))
    order by abs(q.rating - my_rating), q.created_at
    limit 1
    for update skip locked;

  if found then
    update public.quick_match_queue set matched_with = p_ticket, matched_at = now() where ticket = partner.ticket;
    delete from public.quick_match_queue where ticket = p_ticket;
    return jsonb_build_object('status', 'found', 'room', partner.room_code);
  end if;

  if mine.ticket is null then
    if (select count(*) from public.quick_match_queue) >= 300 then
      raise exception 'Quick match is very busy right now. Try again in a minute';
    end if;
    insert into public.quick_match_queue (ticket, user_id, room_code, size, minutes, bonus, rated, rating)
      values (p_ticket, me, p_room, p_size, p_minutes, p_bonus, p_rated, my_rating);
  end if;
  return jsonb_build_object('status', 'waiting');
end;
$$;

-- Stop searching (Cancel, or the game started).
create or replace function public.quick_match_leave(p_ticket uuid)
returns void
language sql
security definer set search_path = ''
as $$
  delete from public.quick_match_queue where ticket = p_ticket;
$$;

revoke all on function public.quick_match(uuid, text, int, int, int, boolean, int) from public;
revoke all on function public.quick_match_leave(uuid) from public;
grant execute on function public.quick_match(uuid, text, int, int, int, boolean, int) to anon, authenticated;
grant execute on function public.quick_match_leave(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
select 'quick match ready' as result;
