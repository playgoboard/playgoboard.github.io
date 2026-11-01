-- GoBoard step 20: block and report players.
-- Paste this whole file into Supabase: SQL Editor -> New query -> Run.
-- Safe to run more than once.
--
-- Blocking someone (either way round) stops friend requests, daily challenges (invites and joining
-- each other's open challenges) and quick match between the two of you, and ends your friendship.
-- Reports go to the admin page, where the admin bans the player for 7 days or dismisses the report.

-- ---- Blocks ----

create table if not exists public.blocks (
  blocker uuid not null references public.profiles (id) on delete cascade,
  blocked uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);
-- You can see who YOU blocked, but never who blocked you.
alter table public.blocks enable row level security;
drop policy if exists "See who you blocked" on public.blocks;
create policy "See who you blocked" on public.blocks for select using (blocker = auth.uid());

-- Why a and b can't play together: null if they can, otherwise the message for a.
create or replace function public.block_problem(a uuid, b uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select case
    when a is null or b is null then null
    when exists (select 1 from public.blocks where blocker = a and blocked = b) then 'You blocked this player. Unblock them first'
    when exists (select 1 from public.blocks where blocker = b and blocked = a) then 'You can''t do that with this player'
  end;
$$;
revoke all on function public.block_problem(uuid, uuid) from public, anon, authenticated;

create or replace function public.block_player(p_player uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'Please log in first'; end if;
  if p_player = me then raise exception 'You can''t block yourself'; end if;
  if not exists (select 1 from public.profiles where id = p_player) then raise exception 'That player wasn''t found'; end if;
  if (select count(*) from public.blocks where blocker = me) >= 500 then raise exception 'You blocked too many players'; end if;
  insert into public.blocks (blocker, blocked) values (me, p_player) on conflict do nothing;
  delete from public.friendships
    where (requester = me and addressee = p_player) or (requester = p_player and addressee = me);
  update public.daily_games set status = 'cancelled'
    where status = 'open' and ((created_by = me and invited = p_player) or (created_by = p_player and invited = me));
end;
$$;

create or replace function public.unblock_player(p_player uuid)
returns void
language sql security definer set search_path = ''
as $$
  delete from public.blocks where blocker = auth.uid() and blocked = p_player;
$$;

revoke all on function public.block_player(uuid) from public, anon;
revoke all on function public.unblock_player(uuid) from public, anon;
grant execute on function public.block_player(uuid) to authenticated;
grant execute on function public.unblock_player(uuid) to authenticated;

-- Friend requests: checked when a request is created.
create or replace function public.friendships_block_check()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  problem text := public.block_problem(new.requester, new.addressee);
begin
  if problem is not null then raise exception '%', problem; end if;
  return new;
end;
$$;
drop trigger if exists friendships_block_check on public.friendships;
create trigger friendships_block_check before insert on public.friendships
  for each row execute function public.friendships_block_check();

-- Daily games: a challenge sent to someone, or joining someone's open challenge.
create or replace function public.daily_games_block_check()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  problem text;
begin
  if tg_op = 'INSERT' then
    problem := public.block_problem(new.created_by, new.invited);
  elsif old.status = 'open' and new.status = 'playing' then
    problem := public.block_problem(auth.uid(), new.created_by);
  end if;
  if problem is not null then raise exception '%', problem; end if;
  return new;
end;
$$;
drop trigger if exists daily_games_block_check on public.daily_games;
create trigger daily_games_block_check before insert or update on public.daily_games
  for each row execute function public.daily_games_block_check();

-- Quick match: the same as step 4, but never pairs two players when one blocked the other.
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

  delete from public.quick_match_queue
    where (matched_with is null and last_seen < now() - interval '15 seconds')
       or matched_at < now() - interval '2 minutes';

  select * into mine from public.quick_match_queue where ticket = p_ticket for update;
  if found then
    if mine.matched_with is not null then return jsonb_build_object('status', 'matched'); end if;
    my_start := mine.created_at;
    update public.quick_match_queue set last_seen = now() where ticket = p_ticket;
  end if;

  select * into partner from public.quick_match_queue q
    where q.ticket <> p_ticket and q.matched_with is null
      and q.size = p_size and q.minutes = p_minutes and q.bonus = p_bonus and q.rated = p_rated
      and (me is null or q.user_id is distinct from me)
      and public.block_problem(me, q.user_id) is null
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

-- ---- Reports ----

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter uuid references public.profiles (id) on delete set null,
  reported uuid not null references public.profiles (id) on delete cascade,
  reason text not null check (reason in ('cheating', 'rude', 'name', 'other')),
  note text not null default '' check (char_length(note) <= 300),
  game uuid references public.game_records (id) on delete set null,
  status text not null default 'open' check (status in ('open', 'banned', 'dismissed')),
  created_at timestamptz not null default now()
);
create index if not exists reports_open on public.reports (status, created_at desc);
alter table public.reports enable row level security; -- nobody reads it directly

-- p_game: a game from YOUR history against this player, or null.
create or replace function public.report_player(p_player uuid, p_reason text, p_note text, p_game uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'Please log in first'; end if;
  if p_player = me then raise exception 'You can''t report yourself'; end if;
  if not exists (select 1 from public.profiles where id = p_player) then raise exception 'That player wasn''t found'; end if;
  if p_reason not in ('cheating', 'rude', 'name', 'other') then raise exception 'Pick a reason first'; end if;
  if p_game is not null and not exists (
    select 1 from public.game_records where id = p_game and player = me and opponent = p_player
  ) then raise exception 'That game wasn''t found'; end if;
  if exists (select 1 from public.reports where reporter = me and reported = p_player and status = 'open') then
    raise exception 'You already reported this player. The admin will look at it soon';
  end if;
  if (select count(*) from public.reports where reporter = me and created_at > now() - interval '1 day') >= 10 then
    raise exception 'You sent a lot of reports today. Try again tomorrow';
  end if;
  insert into public.reports (reporter, reported, reason, note, game)
    values (me, p_player, p_reason, left(trim(coalesce(p_note, '')), 300), p_game);
end;
$$;
revoke all on function public.report_player(uuid, text, text, uuid) from public, anon;
grant execute on function public.report_player(uuid, text, text, uuid) to authenticated;

-- Admin (with the admin code, see step 12): { "error": "..." } or { "rows": [...] } of open reports.
create or replace function public.admin_reports(p_code text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  problem text := public.admin_code_problem(p_code);
begin
  if problem is not null then return jsonb_build_object('error', problem); end if;
  return jsonb_build_object('rows', coalesce((
    select jsonb_agg(r) from (
      select rp.id, rp.reported, bad.username as reported_name, coalesce(who.username, '') as reporter_name,
             rp.reason, rp.note, rp.game, rp.created_at,
             (select count(*) from public.reports o where o.reported = rp.reported and o.status = 'open') as open_reports
        from public.reports rp
        join public.profiles bad on bad.id = rp.reported
        left join public.profiles who on who.id = rp.reporter
        where rp.status = 'open'
        order by rp.created_at desc limit 100) r), '[]'::jsonb));
end;
$$;
grant execute on function public.admin_reports(text) to authenticated;

-- Ban: 7 days (achievements stay; that's only for faked proof) and every open report on them is closed.
-- Dismiss: closes just this report. Returns null when done, otherwise why not.
create or replace function public.admin_handle_report(p_report uuid, p_ban boolean, p_code text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  problem text := public.admin_code_problem(p_code);
  r public.reports;
begin
  if problem is not null then return problem; end if;
  select * into r from public.reports where id = p_report;
  if r.id is null then return 'That report wasn''t found'; end if;
  if not p_ban then
    update public.reports set status = 'dismissed' where id = p_report;
    return null;
  end if;
  if exists (select 1 from public.admins where user_id = r.reported) then return 'You can''t ban an admin'; end if;
  update public.profiles set banned_until = greatest(coalesce(banned_until, now()), now() + interval '7 days')
    where id = r.reported;
  update public.reports set status = 'banned' where reported = r.reported and status = 'open';
  return null;
end;
$$;
grant execute on function public.admin_handle_report(uuid, boolean, text) to authenticated;

notify pgrst, 'reload schema';
select 'block and report ready' as status;
