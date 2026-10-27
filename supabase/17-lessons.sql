-- GoBoard step 17: the Learn Go achievements ("First lesson" and "Graduate"), in the Fun group.
-- Paste this whole file into Supabase: SQL Editor -> New query -> Run.
-- Safe to run more than once.

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
  elsif p_id in ('first-puzzle', 'puzzles-beginner', 'puzzles-intermediate', 'puzzles-advanced', 'all-sizes', 'stylist',
                 'first-lesson', 'graduate') then
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

create or replace function public.reward_groups()
returns table (grp text, achievements text[], picture text, title text, frame text)
language sql immutable set search_path = ''
as $$
  values
    ('Bots', array['beat-pebble', 'beat-sprout', 'beat-fox', 'beat-tiger', 'beat-dragon', 'dragon-19', 'flawless'], 'robot', 'Dragon Slayer', 'red'),
    ('Puzzles', array['first-puzzle', 'puzzles-beginner', 'puzzles-intermediate', 'puzzles-advanced', 'daily-puzzle-7', 'rush-10', 'rush-20', 'rush-30'], 'puzzle-piece', 'Puzzle Master', 'gold'),
    ('Online', array['first-win', 'wins-10', 'wins-50', 'wins-100', 'rating-1400', 'rating-1600', 'rating-1800', 'win-streak-3', 'daily-win'], 'crown', 'Champion', 'purple'),
    ('Fun', array['first-friend', 'big-capture', 'half-point', 'all-sizes', 'stylist', 'first-lesson', 'graduate'], 'rainbow', 'Trickster', 'cyan'),
    ('Streak', array['streak-3', 'streak-7', 'streak-30', 'streak-100'], 'flame', 'Unstoppable', 'orange')
$$;

notify pgrst, 'reload schema';
select 'lessons ready' as status;
