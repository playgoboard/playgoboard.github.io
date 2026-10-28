-- GoBoard step 18: About me can use all the site's languages (French, Spanish, German letters,
-- Japanese and Korean too), the same characters the chat allows (js/chat-filter.js).
-- Paste this whole file into Supabase: SQL Editor -> New query -> Run.
-- Safe to run more than once.

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
      'cat', 'rabbit', 'frog', 'octopus', 'bamboo', 'blossom', 'moon', 'star')
     and not exists (select 1 from public.reward_groups() r
                     where r.picture = p_avatar and r.grp = any (public.finished_groups(me))) then
    raise exception 'That picture isn''t allowed';
  end if;
  if char_length(clean) > 160 then raise exception 'About me can be at most 160 characters'; end if;
  if clean !~ '^[ -~ -ɏḀ-ỿ㐀-䶿一-鿿　-〿぀-ヿㇰ-ㇿᄀ-ᇿ㄰-㆏가-힯！-～｡-ﾟ‘’‚“”„—…·×←-↓■□▲△◆◇○●★☆]*$' then
    raise exception 'About me can''t use some of those characters';
  end if;
  update public.profiles set avatar = p_avatar, about = clean where id = me;
end;
$$;

notify pgrst, 'reload schema';
select 'languages ready' as status;
