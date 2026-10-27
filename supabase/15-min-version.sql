-- GoBoard step 15: achievements only from up-to-date versions of the website.
-- Paste this whole file into Supabase: SQL Editor -> New query -> Run.
-- Safe to run more than once.
--
-- The website sends its version number (the ?v= of its files) when it claims an achievement.
-- Claims from versions older than min_client_version are refused, so an old open tab with a
-- fixed bug can't be used. After fixing another cheat, raise the number (see the last line).

create table if not exists public.app_settings (
  id boolean primary key default true check (id), -- only one row
  min_client_version integer not null default 0
);
alter table public.app_settings enable row level security; -- read only through functions
insert into public.app_settings (id, min_client_version) values (true, 62) on conflict (id) do nothing;

-- The old claim without a version number can't be used any more.
drop function if exists public.claim_achievement(text, jsonb);

create or replace function public.claim_achievement(p_id text, p_proof jsonb, p_version integer)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  needs_proof boolean;
begin
  if me is null then raise exception 'Please log in first'; end if;
  if coalesce(p_version, 0) < (select min_client_version from public.app_settings) then
    raise exception 'Please refresh the page to get the newest version of GoBoard';
  end if;
  if p_id in ('beat-pebble', 'beat-sprout', 'beat-fox', 'beat-tiger', 'beat-dragon', 'dragon-19', 'flawless', 'big-capture') then
    needs_proof := true;
  elsif p_id in ('first-puzzle', 'puzzles-beginner', 'puzzles-intermediate', 'puzzles-advanced', 'all-sizes', 'stylist') then
    needs_proof := false;
  else
    raise exception 'That achievement can''t be claimed';
  end if;
  if needs_proof and (p_proof is null or jsonb_typeof(p_proof -> 'moves') <> 'array'
                      or jsonb_array_length(p_proof -> 'moves') > 1500 or octet_length(p_proof::text) > 60000) then
    raise exception 'This achievement needs the game as proof';
  end if;
  insert into public.player_achievements (player, achievement, proof)
    values (me, p_id, case when needs_proof then p_proof else null end)
    on conflict do nothing;
  return found;
end;
$$;
grant execute on function public.claim_achievement(text, jsonb, integer) to authenticated;

notify pgrst, 'reload schema';
select 'version check ready' as status;

-- Later, after fixing a cheat in version N, run just this line:
--   update public.app_settings set min_client_version = N;
