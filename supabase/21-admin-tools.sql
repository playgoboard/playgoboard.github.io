-- GoBoard step 21: more admin tools. Numbers, player cards, ban length + reason, unban, warnings,
-- profile reset, forced rename, rating fixes and a log of every admin action.
-- Paste this whole file into Supabase: SQL Editor -> New query -> Run.
-- Safe to run more than once. Needs steps 12, 14 and 20 first.
--
-- Like step 12, every admin_* function takes p_code and RETURNS the problem instead of raising,
-- so wrong codes are still counted (an error would undo the count).

-- ---- Tables ----

-- Why someone is banned. Kept apart from profiles, because profiles can be read by everyone.
create table if not exists public.ban_reasons (
  player uuid primary key references public.profiles (id) on delete cascade,
  reason text not null
);
alter table public.ban_reasons enable row level security; -- nobody reads it directly

create table if not exists public.player_warnings (
  id uuid primary key default gen_random_uuid(),
  player uuid not null references public.profiles (id) on delete cascade,
  message text not null check (char_length(message) <= 500),
  created_at timestamptz not null default now(),
  seen_at timestamptz
);
create index if not exists player_warnings_player on public.player_warnings (player, created_at desc);
alter table public.player_warnings enable row level security;
drop policy if exists "See your own warnings" on public.player_warnings;
create policy "See your own warnings" on public.player_warnings for select using (player = auth.uid());

create table if not exists public.admin_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  admin uuid references public.profiles (id) on delete set null,
  action text not null,
  player uuid references public.profiles (id) on delete set null,
  player_name text not null default '',
  detail text not null default ''
);
create index if not exists admin_log_at on public.admin_log (at desc);
create index if not exists admin_log_player on public.admin_log (player, at desc);
alter table public.admin_log enable row level security; -- nobody reads it directly

alter table public.profiles add column if not exists must_rename boolean not null default false;
alter table public.rated_games add column if not exists rating_undone boolean not null default false;
alter table public.daily_games add column if not exists rating_undone boolean not null default false;

create or replace function public.log_admin(p_action text, p_player uuid, p_detail text)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.admin_log (admin, action, player, player_name, detail)
    values (auth.uid(), p_action, p_player,
            coalesce((select username from public.profiles where id = p_player), ''), coalesce(p_detail, ''));
$$;
revoke all on function public.log_admin(text, uuid, text) from public, anon, authenticated;

-- ---- The check before every request: same as step 11, but the ban text now carries the reason ----
-- (format: "BANNED_UNTIL <when or forever>|<reason>", read by js/accounts.js).

create or replace function public.check_two_step()
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  ban_end timestamptz;
  ban_why text;
  who text;
  max_hits integer;
  n integer;
begin
  if auth.uid() is not null then
    if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2'
       and exists (select 1 from auth.mfa_factors where user_id = auth.uid() and status = 'verified') then
      raise exception 'Two-step verification code needed';
    end if;
    select banned_until into ban_end from public.profiles where id = auth.uid();
    if ban_end is not null and ban_end > now() then
      select reason into ban_why from public.ban_reasons where player = auth.uid();
      raise exception 'BANNED_UNTIL %|%',
        case when ban_end >= timestamptz '9000-01-01 00:00+00' then 'forever'
             else to_char(ban_end at time zone 'utc', 'YYYY-MM-DD HH24:MI "UTC"') end,
        coalesce(ban_why, '');
    end if;
  end if;

  -- Read-only calls (plain reads, and functions that only look things up) can't write a count.
  if coalesce(current_setting('request.method', true), 'GET') in ('POST', 'PATCH', 'PUT', 'DELETE')
     and current_setting('transaction_read_only') = 'off' then
    if auth.uid() is not null then
      who := 'user:' || auth.uid()::text;
      max_hits := 120;
    else
      who := 'ip:' || coalesce(nullif(btrim(split_part(
        coalesce(current_setting('request.headers', true), '{}')::json ->> 'x-forwarded-for', ',', 1)), ''), 'unknown');
      max_hits := 300;
    end if;
    insert into public.request_counts (key, minute) values (who, date_trunc('minute', now()))
      on conflict (key, minute) do update set hits = public.request_counts.hits + 1
      returning hits into n;
    if n > max_hits then
      raise exception 'Too many actions. Please wait a minute and try again.';
    end if;
    -- Now and then, throw away old counts.
    if random() < 0.02 then
      delete from public.request_counts where minute < now() - interval '5 minutes';
    end if;
  end if;
end;
$$;

-- ---- What the player does ----

create or replace function public.ack_warning(p_warning uuid)
returns void
language sql security definer set search_path = ''
as $$
  update public.player_warnings set seen_at = now()
    where id = p_warning and player = auth.uid() and seen_at is null;
$$;
revoke all on function public.ack_warning(uuid) from public, anon;
grant execute on function public.ack_warning(uuid) to authenticated;

-- Only works when the admin asked this player to pick a new name.
create or replace function public.set_my_new_username(p_name text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  wanted text := btrim(coalesce(p_name, ''));
begin
  if me is null then raise exception 'Please log in first'; end if;
  if not exists (select 1 from public.profiles where id = me and must_rename) then
    raise exception 'Your username can''t be changed';
  end if;
  if wanted !~ '^[A-Za-z0-9_]{3,16}$' then raise exception 'Usernames are 3–16 letters, numbers or _ (no spaces).'; end if;
  if exists (select 1 from public.profiles where lower(username) = lower(wanted) and id <> me) then
    raise exception 'That username is taken. Try another one.';
  end if;
  update public.profiles set username = wanted, must_rename = false where id = me;
end;
$$;
revoke all on function public.set_my_new_username(text) from public, anon;
grant execute on function public.set_my_new_username(text) to authenticated;

-- ---- Admin: looking ----

-- { "error": "..." } or { "numbers": {...} }
create or replace function public.admin_numbers(p_code text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  problem text := public.admin_code_problem(p_code);
begin
  if problem is not null then return jsonb_build_object('error', problem); end if;
  return jsonb_build_object('numbers', jsonb_build_object(
    'players', (select count(*) from public.profiles),
    'new_week', (select count(*) from public.profiles where created_at > now() - interval '7 days'),
    'games_today', (select count(distinct game_key) from public.game_records where created_at >= date_trunc('day', now())),
    'games_week', (select count(distinct game_key) from public.game_records where created_at > now() - interval '7 days'),
    'open_reports', (select count(*) from public.reports where status = 'open'),
    'proofs', (select count(*) from public.player_achievements where proof is not null and not reviewed),
    'banned', (select count(*) from public.profiles where banned_until > now())));
end;
$$;
grant execute on function public.admin_numbers(text) to authenticated;

-- { "error": "..." } or { "rows": [...] }, newest first.
create or replace function public.admin_log_list(p_code text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  problem text := public.admin_code_problem(p_code);
begin
  if problem is not null then return jsonb_build_object('error', problem); end if;
  return jsonb_build_object('rows', coalesce((
    select jsonb_agg(r) from (
      select l.at, l.action, l.player_name, l.detail
        from public.admin_log l order by l.at desc limit 200) r), '[]'::jsonb));
end;
$$;
grant execute on function public.admin_log_list(text) to authenticated;

-- Everything the admin needs to know about one player. { "error": "..." } or { "card": {...} }
create or replace function public.admin_player_card(p_player uuid, p_code text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  problem text := public.admin_code_problem(p_code);
begin
  if problem is not null then return jsonb_build_object('error', problem); end if;
  if not exists (select 1 from public.profiles where id = p_player) then
    return jsonb_build_object('error', 'That player wasn''t found');
  end if;
  return jsonb_build_object('card', jsonb_build_object(
    'player', (select jsonb_build_object(
        'id', p.id, 'username', p.username, 'rating', p.rating, 'games', p.games, 'wins', p.wins, 'losses', p.losses,
        'created_at', p.created_at, 'about', p.about, 'avatar', p.avatar, 'must_rename', p.must_rename,
        'banned_until', case when p.banned_until > now() then p.banned_until end,
        'ban_reason', (select b.reason from public.ban_reasons b where b.player = p.id),
        'is_admin', exists (select 1 from public.admins a where a.user_id = p.id))
      from public.profiles p where p.id = p_player),
    'warnings', coalesce((select jsonb_agg(r) from (
        select w.message, w.created_at, w.seen_at from public.player_warnings w
          where w.player = p_player order by w.created_at desc limit 30) r), '[]'::jsonb),
    'against', coalesce((select jsonb_agg(r) from (
        select coalesce(who.username, '') as other, rp.reason, rp.note, rp.status, rp.game, rp.created_at
          from public.reports rp left join public.profiles who on who.id = rp.reporter
          where rp.reported = p_player order by rp.created_at desc limit 30) r), '[]'::jsonb),
    'sent', coalesce((select jsonb_agg(r) from (
        select bad.username as other, rp.reason, rp.note, rp.status, rp.game, rp.created_at
          from public.reports rp join public.profiles bad on bad.id = rp.reported
          where rp.reporter = p_player order by rp.created_at desc limit 30) r), '[]'::jsonb),
    'log', coalesce((select jsonb_agg(r) from (
        select l.at, l.action, l.detail from public.admin_log l
          where l.player = p_player order by l.at desc limit 30) r), '[]'::jsonb),
    'games', coalesce((select jsonb_agg(r order by r.finished_at desc) from (
        select * from (
          select 'live' as kind, g.id, g.finished_at, g.board_size, g.rating_undone,
                 case when g.black = p_player then g.black_change else g.white_change end as change,
                 g.winner = case when g.black = p_player then 'black' else 'white' end as won,
                 (select o.username from public.profiles o
                    where o.id = case when g.black = p_player then g.white else g.black end) as opponent,
                 (select gr.id from public.game_records gr where gr.rated_game_id = g.id and gr.player = p_player limit 1) as record
            from public.rated_games g
            where (g.black = p_player or g.white = p_player) and g.black_change is not null
          union all
          select 'daily', d.id, d.finished_at, d.board_size, d.rating_undone,
                 case when d.black = p_player then d.black_change else d.white_change end,
                 d.winner = case when d.black = p_player then 'black' else 'white' end,
                 (select o.username from public.profiles o
                    where o.id = case when d.black = p_player then d.white else d.black end),
                 (select gr.id from public.game_records gr
                    where gr.game_key = 'daily' || replace(d.id::text, '-', '') and gr.player = p_player limit 1)
            from public.daily_games d
            where (d.black = p_player or d.white = p_player) and d.black_change is not null
        ) both_kinds order by finished_at desc limit 20) r), '[]'::jsonb)));
end;
$$;
grant execute on function public.admin_player_card(uuid, text) to authenticated;

-- ---- Admin: acting. Each returns null when done, otherwise why not. ----

-- p_days: 1, 7 or 30, or 0 for forever. The new length replaces the old one, so it can also shorten a ban.
-- Open reports on this player are closed. Achievements stay (only faked proof removes those).
create or replace function public.admin_set_ban(p_player uuid, p_days integer, p_reason text, p_code text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  problem text := public.admin_code_problem(p_code);
  why text := left(regexp_replace(btrim(coalesce(p_reason, '')), '\s+', ' ', 'g'), 200);
begin
  if problem is not null then return problem; end if;
  if p_days not in (0, 1, 7, 30) then return 'Pick how long the ban lasts'; end if;
  if why = '' then return 'Write the reason the player will see'; end if;
  if not exists (select 1 from public.profiles where id = p_player) then return 'That player wasn''t found'; end if;
  if exists (select 1 from public.admins where user_id = p_player) then return 'You can''t ban an admin'; end if;
  update public.profiles
    set banned_until = case when p_days = 0 then timestamptz '9999-01-01 00:00+00' else now() + make_interval(days => p_days) end
    where id = p_player;
  insert into public.ban_reasons (player, reason) values (p_player, why)
    on conflict (player) do update set reason = excluded.reason;
  update public.reports set status = 'banned' where reported = p_player and status = 'open';
  perform public.log_admin('ban', p_player, case when p_days = 0 then 'Forever' else p_days || ' days' end || ': ' || why);
  return null;
end;
$$;
grant execute on function public.admin_set_ban(uuid, integer, text, text) to authenticated;

create or replace function public.admin_unban(p_player uuid, p_code text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  problem text := public.admin_code_problem(p_code);
begin
  if problem is not null then return problem; end if;
  update public.profiles set banned_until = null where id = p_player;
  delete from public.ban_reasons where player = p_player;
  perform public.log_admin('unban', p_player, '');
  return null;
end;
$$;
grant execute on function public.admin_unban(uuid, text) to authenticated;

create or replace function public.admin_warn(p_player uuid, p_message text, p_code text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  problem text := public.admin_code_problem(p_code);
  words text := left(btrim(coalesce(p_message, '')), 500);
begin
  if problem is not null then return problem; end if;
  if words = '' then return 'Write the message first'; end if;
  if not exists (select 1 from public.profiles where id = p_player) then return 'That player wasn''t found'; end if;
  insert into public.player_warnings (player, message) values (p_player, words);
  perform public.log_admin('warn', p_player, words);
  return null;
end;
$$;
grant execute on function public.admin_warn(uuid, text, text) to authenticated;

-- Clears the picture and About me (a title and frame are earned, so they stay).
create or replace function public.admin_reset_profile(p_player uuid, p_code text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  problem text := public.admin_code_problem(p_code);
begin
  if problem is not null then return problem; end if;
  perform public.log_admin('reset_profile', p_player, coalesce((select about from public.profiles where id = p_player), ''));
  update public.profiles set avatar = null, about = '' where id = p_player;
  return null;
end;
$$;
grant execute on function public.admin_reset_profile(uuid, text) to authenticated;

-- Gives a temporary name right away; the player has to pick a new one on their next visit.
create or replace function public.admin_force_rename(p_player uuid, p_code text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  problem text := public.admin_code_problem(p_code);
  old_name text;
  temp_name text;
begin
  if problem is not null then return problem; end if;
  select username into old_name from public.profiles where id = p_player;
  if old_name is null then return 'That player wasn''t found'; end if;
  loop
    temp_name := 'Player_' || (100000 + floor(random() * 900000))::integer;
    exit when not exists (select 1 from public.profiles where lower(username) = lower(temp_name));
  end loop;
  update public.profiles set username = temp_name, must_rename = true where id = p_player;
  perform public.log_admin('force_rename', p_player, old_name || ' → ' || temp_name);
  return null;
end;
$$;
grant execute on function public.admin_force_rename(uuid, text) to authenticated;

create or replace function public.admin_set_rating(p_player uuid, p_rating integer, p_reason text, p_code text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  problem text := public.admin_code_problem(p_code);
  old_rating integer;
begin
  if problem is not null then return problem; end if;
  if p_rating is null or p_rating < 100 or p_rating > 3000 then return 'The rating must be between 100 and 3000'; end if;
  select rating into old_rating from public.profiles where id = p_player;
  if old_rating is null then return 'That player wasn''t found'; end if;
  update public.profiles set rating = p_rating where id = p_player;
  perform public.log_admin('set_rating', p_player,
    old_rating || ' → ' || p_rating || coalesce(nullif(': ' || left(btrim(coalesce(p_reason, '')), 200), ': '), ''));
  return null;
end;
$$;
grant execute on function public.admin_set_rating(uuid, integer, text, text) to authenticated;

-- Takes one game's rating change, and its win and loss, away from both players.
-- p_kind: 'live' (rated_games) or 'daily' (daily_games).
create or replace function public.admin_undo_game(p_kind text, p_game uuid, p_code text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  problem text := public.admin_code_problem(p_code);
  v_black uuid;
  v_white uuid;
  v_winner text;
  black_delta integer;
  white_delta integer;
  undone boolean;
begin
  if problem is not null then return problem; end if;
  if p_kind = 'live' then
    select black, white, winner, black_change, white_change, rating_undone
      into v_black, v_white, v_winner, black_delta, white_delta, undone
      from public.rated_games where id = p_game for update;
  elsif p_kind = 'daily' then
    select black, white, winner, black_change, white_change, rating_undone
      into v_black, v_white, v_winner, black_delta, white_delta, undone
      from public.daily_games where id = p_game for update;
  else
    return 'That game wasn''t found';
  end if;
  if black_delta is null then return 'That game wasn''t found'; end if;
  if undone then return 'This game was already undone'; end if;

  update public.profiles set rating = rating - black_delta, games = greatest(games - 1, 0),
      wins = greatest(wins - case when v_winner = 'black' then 1 else 0 end, 0),
      losses = greatest(losses - case when v_winner = 'white' then 1 else 0 end, 0)
    where id = v_black;
  update public.profiles set rating = rating - white_delta, games = greatest(games - 1, 0),
      wins = greatest(wins - case when v_winner = 'white' then 1 else 0 end, 0),
      losses = greatest(losses - case when v_winner = 'black' then 1 else 0 end, 0)
    where id = v_white;

  -- The saved change becomes 0, so the rating graphs still add up.
  if p_kind = 'live' then
    update public.rated_games set black_change = 0, white_change = 0, rating_undone = true where id = p_game;
  else
    update public.daily_games set black_change = 0, white_change = 0, rating_undone = true where id = p_game;
    update public.game_records set rating_change = 0 where game_key = 'daily' || replace(p_game::text, '-', '');
  end if;
  perform public.log_admin('undo_game', v_black, 'Black ' || black_delta || ', White ' || white_delta);
  perform public.log_admin('undo_game', v_white, 'Black ' || black_delta || ', White ' || white_delta);
  return null;
end;
$$;
grant execute on function public.admin_undo_game(text, uuid, text) to authenticated;

-- ---- The older admin actions, now written to the log too ----

create or replace function public.admin_mark_reviewed(p_player uuid, p_achievement text, p_code text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  problem text := public.admin_code_problem(p_code);
begin
  if problem is not null then return problem; end if;
  update public.player_achievements set reviewed = true where player = p_player and achievement = p_achievement;
  perform public.log_admin('proof_fine', p_player, p_achievement);
  return null;
end;
$$;

-- Faked proof: 7-day ban, and achievements, titles, frames and reward pictures are removed.
create or replace function public.admin_ban(p_player uuid, p_code text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  problem text := public.admin_code_problem(p_code);
begin
  if problem is not null then return problem; end if;
  if exists (select 1 from public.admins where user_id = p_player) then return 'You can''t ban an admin'; end if;
  update public.profiles
    set banned_until = greatest(coalesce(banned_until, now()), now() + interval '7 days'), title = null, frame = null,
        avatar = case when avatar in (select picture from public.reward_groups()) then null else avatar end
    where id = p_player;
  insert into public.ban_reasons (player, reason) values (p_player, 'Cheating on achievements')
    on conflict (player) do update set reason = excluded.reason;
  delete from public.player_achievements where player = p_player;
  delete from public.daily_puzzle_days where player = p_player;
  perform public.log_admin('proof_ban', p_player, '7 days, achievements removed');
  return null;
end;
$$;

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
  if p_ban then return 'Use the ban window'; end if; -- bans go through admin_set_ban, with a length and reason
  update public.reports set status = 'dismissed' where id = p_report;
  perform public.log_admin('dismiss_report', r.reported, r.reason);
  return null;
end;
$$;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';
select 'admin tools ready' as status;
