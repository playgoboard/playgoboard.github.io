-- GoBoard step 22: admins choose their admin code on the Admin page, once.
-- Paste this whole file into Supabase: SQL Editor -> New query -> Run.
-- It CLEARS every admin code, so every admin has to choose a new one. Running it again clears them again.
--
-- The site can only save a code when the admin has none. So a stolen password can't change a code
-- that's already chosen. To change a code later, clear it here, then choose a new one on the site:
--   delete from public.admin_codes where user_id = (select id from public.profiles where lower(username) = 'reinj');

-- Does this admin have a code yet?
create or replace function public.admin_code_is_set()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.admin_codes where user_id = auth.uid());
$$;
revoke all on function public.admin_code_is_set() from public, anon;
grant execute on function public.admin_code_is_set() to authenticated;

-- Returns null when saved, otherwise why not.
create or replace function public.admin_choose_code(p_code text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  chosen text := btrim(coalesce(p_code, ''));
begin
  if not public.is_admin() then return 'Only the admin can do that'; end if;
  if char_length(chosen) < 6 then return 'The code needs at least 6 characters'; end if;
  if octet_length(chosen) > 72 then return 'That code is too long'; end if;
  if exists (select 1 from public.admin_codes where user_id = auth.uid()) then
    return 'You already have an admin code';
  end if;
  insert into public.admin_codes (user_id, code_hash)
    values (auth.uid(), extensions.crypt(chosen, extensions.gen_salt('bf')));
  perform public.log_admin('code_chosen', auth.uid(), '');
  return null;
end;
$$;
revoke all on function public.admin_choose_code(text) from public, anon;
grant execute on function public.admin_choose_code(text) to authenticated;

delete from public.admin_codes;

notify pgrst, 'reload schema';
select 'admin codes cleared, choose a new one on the Admin page' as status;
