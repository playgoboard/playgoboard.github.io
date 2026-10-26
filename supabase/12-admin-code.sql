-- GoBoard step 12: every admin action needs the admin's secret code.
-- Paste this whole file into Supabase: SQL Editor -> New query -> Run.
-- Safe to run more than once.
--
-- The code is set ONLY here in Supabase (never from the website), so someone who steals the
-- admin's password still can't ban players. Only a scrambled version (bcrypt) is stored.
-- 5 wrong codes in a row lock admin actions for 15 minutes.
--
-- To choose or change the code, run this separately (put your own code between the quotes):
--   insert into public.admin_codes (user_id, code_hash)
--     select id, extensions.crypt('YOUR-CODE-HERE', extensions.gen_salt('bf')) from public.profiles where lower(username) = 'reinj'
--     on conflict (user_id) do update set code_hash = excluded.code_hash, failed = 0, locked_until = null;

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.admin_codes (
  user_id uuid primary key references public.admins (user_id) on delete cascade,
  code_hash text not null,
  failed integer not null default 0,
  locked_until timestamptz
);
alter table public.admin_codes enable row level security; -- nobody reads it directly

-- The old admin functions had no code: remove them so they can't be used.
drop function if exists public.admin_proofs(boolean);
drop function if exists public.admin_mark_reviewed(uuid, text);
drop function if exists public.admin_ban(uuid);

-- Returns null when the code is right, otherwise why not. It never raises an error, so a
-- wrong try is still counted (an error would undo the count).
create or replace function public.admin_code_problem(p_code text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  c public.admin_codes;
begin
  if not public.is_admin() then return 'Only the admin can do that'; end if;
  select * into c from public.admin_codes where user_id = auth.uid() for update;
  if c.user_id is null then return 'No admin code is set yet. Set one in the Supabase SQL Editor.'; end if;
  if c.locked_until is not null and c.locked_until > now() then
    return 'Too many wrong codes. Admin actions are locked for 15 minutes.';
  end if;
  if p_code is not null and extensions.crypt(p_code, c.code_hash) = c.code_hash then
    update public.admin_codes set failed = 0, locked_until = null where user_id = c.user_id;
    return null;
  end if;
  if c.failed + 1 >= 5 then
    update public.admin_codes set failed = 0, locked_until = now() + interval '15 minutes' where user_id = c.user_id;
    return 'Too many wrong codes. Admin actions are locked for 15 minutes.';
  end if;
  update public.admin_codes set failed = c.failed + 1 where user_id = c.user_id;
  return 'Wrong admin code';
end;
$$;
revoke all on function public.admin_code_problem(text) from public, anon, authenticated;

-- { "error": "..." } or { "rows": [...] }
create or replace function public.admin_proofs(p_reviewed boolean, p_code text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  problem text := public.admin_code_problem(p_code);
begin
  if problem is not null then return jsonb_build_object('error', problem); end if;
  return jsonb_build_object('rows', coalesce((
    select jsonb_agg(r) from (
      select a.player, pr.username, a.achievement, a.unlocked_at, a.proof
        from public.player_achievements a join public.profiles pr on pr.id = a.player
        where a.proof is not null and a.reviewed = p_reviewed
        order by a.unlocked_at desc limit 100) r), '[]'::jsonb));
end;
$$;
grant execute on function public.admin_proofs(boolean, text) to authenticated;

-- Each returns null when done, otherwise why not.
create or replace function public.admin_mark_reviewed(p_player uuid, p_achievement text, p_code text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  problem text := public.admin_code_problem(p_code);
begin
  if problem is not null then return problem; end if;
  update public.player_achievements set reviewed = true where player = p_player and achievement = p_achievement;
  return null;
end;
$$;
grant execute on function public.admin_mark_reviewed(uuid, text, text) to authenticated;

-- 7-day ban and every achievement removed.
create or replace function public.admin_ban(p_player uuid, p_code text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  problem text := public.admin_code_problem(p_code);
begin
  if problem is not null then return problem; end if;
  if exists (select 1 from public.admins where user_id = p_player) then return 'You can''t ban an admin'; end if;
  update public.profiles set banned_until = now() + interval '7 days' where id = p_player;
  delete from public.player_achievements where player = p_player;
  delete from public.daily_puzzle_days where player = p_player;
  return null;
end;
$$;
grant execute on function public.admin_ban(uuid, text) to authenticated;

notify pgrst, 'reload schema';
select 'admin code ready' as status;
