-- GoBoard step 25: your-turn alerts. Phone or browser alerts for your turn in a daily game and for
-- daily challenges, even when the site is closed.
-- Paste this whole file into Supabase: SQL Editor -> New query -> Run.
-- Safe to run more than once.
--
-- The database calls the send-alert function (supabase/functions/send-alert/index.ts) over the internet.
-- Nothing is sent until push_settings has its keys (tools/make-push-keys.html makes the SQL for that).
-- An alert problem must never stop a game, so the triggers ignore every error.

create extension if not exists pg_net;

-- One row. Nobody reads it directly: the secret stays here and in the function's Secrets.
create table if not exists public.push_settings (
  id integer primary key default 1 check (id = 1),
  public_key text not null,
  secret text not null
);
alter table public.push_settings enable row level security;

-- One row per device with alerts on.
create table if not exists public.push_devices (
  endpoint text primary key,
  player uuid not null references public.profiles (id) on delete cascade,
  p256dh text not null,
  auth text not null,
  lang text not null default 'en',
  created_at timestamptz not null default now()
);
create index if not exists push_devices_player on public.push_devices (player, created_at desc);
alter table public.push_devices enable row level security; -- nobody reads it directly

-- The public half of the key, which browsers need to turn alerts on. Null until it's set up.
create or replace function public.push_public_key()
returns text
language sql stable security definer set search_path = ''
as $$
  select public_key from public.push_settings where id = 1;
$$;
grant execute on function public.push_public_key() to anon, authenticated;

-- Turns alerts on for this device, on your account. At most 10 devices per player.
create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_lang text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'Please log in first'; end if;
  if p_endpoint !~ '^https://' or char_length(p_endpoint) > 1000
     or char_length(coalesce(p_p256dh, '')) not between 20 and 200
     or char_length(coalesce(p_auth, '')) not between 10 and 100 then
    raise exception 'This device can''t get alerts';
  end if;
  insert into public.push_devices (endpoint, player, p256dh, auth, lang)
    values (p_endpoint, me, p_p256dh, p_auth, left(coalesce(p_lang, 'en'), 10))
    on conflict (endpoint) do update
      set player = excluded.player, p256dh = excluded.p256dh, auth = excluded.auth, lang = excluded.lang;
  delete from public.push_devices where player = me and endpoint in (
    select endpoint from public.push_devices where player = me order by created_at desc offset 10);
end;
$$;
revoke all on function public.push_subscribe(text, text, text, text) from public, anon;
grant execute on function public.push_subscribe(text, text, text, text) to authenticated;

create or replace function public.push_unsubscribe(p_endpoint text)
returns void
language sql security definer set search_path = ''
as $$
  delete from public.push_devices where endpoint = p_endpoint and player = auth.uid();
$$;
revoke all on function public.push_unsubscribe(text) from public, anon;
grant execute on function public.push_unsubscribe(text) to authenticated;

-- The function calls this for devices that turned alerts off.
create or replace function public.push_remove_dead(p_secret text, p_endpoints text[])
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.push_settings where id = 1 and secret = p_secret) then
    delete from public.push_devices where endpoint = any(p_endpoints);
  end if;
end;
$$;
grant execute on function public.push_remove_dead(text, text[]) to anon, authenticated;

-- Sends one alert to all of a player's devices.
create or replace function public.push_send(p_player uuid, p_kind text, p_name text, p_url text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  s public.push_settings;
  list jsonb;
begin
  select * into s from public.push_settings where id = 1;
  if s.id is null then return; end if;
  select jsonb_agg(jsonb_build_object('endpoint', d.endpoint, 'p256dh', d.p256dh, 'auth', d.auth, 'lang', d.lang)) into list
    from public.push_devices d where d.player = p_player;
  if list is null then return; end if;
  perform net.http_post(
    url := 'https://iosvimeihfhpxsztqkkv.supabase.co/functions/v1/send-alert',
    body := jsonb_build_object('devices', list, 'kind', p_kind, 'name', coalesce(p_name, ''), 'url', p_url),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-alert-secret', s.secret));
end;
$$;
revoke all on function public.push_send(uuid, text, text, text) from public, anon, authenticated;

-- The "Send a test alert" button.
create or replace function public.push_test()
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Please log in first'; end if;
  perform public.push_send(auth.uid(), 'test', '', 'index.html');
end;
$$;
revoke all on function public.push_test() from public, anon;
grant execute on function public.push_test() to authenticated;

-- Daily games: a challenge sent to someone, or the turn moving to the other player.
create or replace function public.daily_games_alert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  who uuid;
  kind text;
  from_name text;
begin
  begin
    if tg_op = 'INSERT' then
      who := new.invited;
      kind := 'challenge';
    elsif new.status = 'playing' and (old.status is distinct from 'playing' or old.turn is distinct from new.turn) then
      who := case when new.turn = 'black' then new.black else new.white end;
      kind := 'turn';
    end if;
    -- Never alert the player who just acted.
    if who is not null and who is distinct from auth.uid() then
      select username into from_name from public.profiles where id = auth.uid();
      perform public.push_send(who, kind, from_name, 'daily.html?game=' || new.id::text);
    end if;
  exception when others then
    null; -- a failed alert must not stop the game
  end;
  return new;
end;
$$;
drop trigger if exists daily_games_alert on public.daily_games;
create trigger daily_games_alert after insert or update on public.daily_games
  for each row execute function public.daily_games_alert();

notify pgrst, 'reload schema';
select 'alerts ready for setup' as status;
