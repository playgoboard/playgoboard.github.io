-- GoBoard step 19: solved puzzles are saved on your account, so every device shows the same ✓ marks.
-- Paste this whole file into Supabase: SQL Editor -> New query -> Run.
-- Safe to run more than once.
--
-- Puzzles are numbered by their place in js/puzzles-data.js (0 = the first one).

alter table public.profiles add column if not exists solved_puzzles integer[] not null default '{}';

-- Adds puzzles you solved (on this device) to your account, and returns everything you've solved
-- on any device, so the browser can show it all.
create or replace function public.add_solved_puzzles(p_puzzles integer[])
returns integer[]
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  merged integer[];
begin
  if me is null then raise exception 'Please log in first'; end if;
  if cardinality(coalesce(p_puzzles, '{}')) > 2000 then raise exception 'Too many puzzles at once'; end if;
  select coalesce(array_agg(distinct n order by n), '{}') into merged from (
    select unnest(solved_puzzles) as n from public.profiles where id = me
    union
    select unnest(coalesce(p_puzzles, '{}'))) all_solved
  where n between 0 and 9999;
  update public.profiles set solved_puzzles = merged where id = me;
  return merged;
end;
$$;
grant execute on function public.add_solved_puzzles(integer[]) to authenticated;

notify pgrst, 'reload schema';
select 'puzzle progress ready' as status;
