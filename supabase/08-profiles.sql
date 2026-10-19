-- GoBoard step 8: player profiles (picture + About me), and daily challenges to any player.
-- Paste this whole file into Supabase: SQL Editor -> New query -> Run.
-- Safe to run more than once.

-- The picture is one of the site's drawn pictures (no uploads), saved by its name.
alter table public.profiles add column if not exists avatar text;
alter table public.profiles add column if not exists about text not null default '';

-- Change your own picture and About me. The browser also filters bad words before saving;
-- here we check the length, the picture name, and that the text is English/Chinese only
-- (the same characters the chat allows).
create or replace function public.set_my_profile(p_avatar text, p_about text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  clean text := btrim(coalesce(p_about, ''));
begin
  if me is null then raise exception 'Please log in first'; end if;
  if p_avatar is not null and p_avatar not in ('black', 'white', 'dragon', 'tiger', 'fox', 'panda', 'owl', 'turtle',
      'cat', 'rabbit', 'frog', 'octopus', 'bamboo', 'blossom', 'moon', 'star') then
    raise exception 'That picture isn''t allowed';
  end if;
  if char_length(clean) > 160 then raise exception 'About me can be at most 160 characters'; end if;
  if clean !~ '^[ -~㐀-䶿一-鿿　-〿！-～‘’“”—…·×←-↓■□▲△◆◇○●★☆]*$' then
    raise exception 'About me can only use English and Chinese';
  end if;
  update public.profiles set avatar = p_avatar, about = clean where id = me;
end;
$$;
revoke all on function public.set_my_profile(text, text) from public, anon;
grant execute on function public.set_my_profile(text, text) to authenticated;

-- Daily challenges can now be sent to any player (from their profile), not only friends.
-- They can decline, and you can only have 5 open challenges at a time.
create or replace function public.create_daily_invite(p_size integer, p_days integer, p_rated boolean, p_color text, p_friend uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  new_id uuid;
begin
  if me is null then raise exception 'Please log in first'; end if;
  if p_size not in (9, 13, 19) or p_days not in (1, 3, 7) or p_color not in ('black', 'white', 'random') then
    raise exception 'Those game settings aren''t allowed';
  end if;
  if p_friend = me then raise exception 'You can''t challenge yourself'; end if;
  if p_friend is not null and not exists (select 1 from public.profiles where id = p_friend) then
    raise exception 'That player wasn''t found';
  end if;
  if (select count(*) from public.daily_games where created_by = me and status = 'open') >= 5 then
    raise exception 'You already have 5 open challenges. Wait for someone to join, or cancel one';
  end if;
  if (select count(*) from public.daily_games where (black = me or white = me) and status = 'playing') >= 50 then
    raise exception 'You already have 50 daily games going. Finish some first';
  end if;
  insert into public.daily_games (created_by, creator_color, board_size, days, rated, private, invited)
    values (me, p_color, p_size, p_days, coalesce(p_rated, false), true, p_friend)
    returning id into new_id;
  return new_id;
end;
$$;

notify pgrst, 'reload schema';
select 'profiles ready' as status;
