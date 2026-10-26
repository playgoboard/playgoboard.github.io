-- GoBoard step 11: a speed limit against floods (a small DDoS shield for the database).
-- Paste this whole file into Supabase: SQL Editor -> New query -> Run.
-- Safe to run more than once.
--
-- Counts actions that change something (POST/PATCH/PUT/DELETE, which includes every database
-- function the site calls) per minute: 120 per account, 300 per internet address for guests
-- (many guests can share one address at a school). Normal play stays under about 25.
-- Plain reads can't be counted here (they run read-only); Supabase's own protection covers those.

-- "unlogged" = fast, and it's fine to lose these counts if the database restarts.
create unlogged table if not exists public.request_counts (
  key text not null,
  minute timestamptz not null,
  hits integer not null default 1,
  primary key (key, minute)
);
alter table public.request_counts enable row level security; -- nobody reads it directly

-- Runs before every request: two-step code (step 9), bans (step 10), and now the speed limit.
create or replace function public.check_two_step()
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  ban_end timestamptz;
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
      raise exception 'BANNED_UNTIL %', to_char(ban_end at time zone 'utc', 'YYYY-MM-DD HH24:MI "UTC"');
    end if;
  end if;

  if coalesce(current_setting('request.method', true), 'GET') in ('POST', 'PATCH', 'PUT', 'DELETE') then
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
notify pgrst, 'reload config';

select 'speed limit ready' as status;
