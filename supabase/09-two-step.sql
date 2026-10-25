-- GoBoard step 9: two-step verification (codes from an authenticator app).
-- Paste this whole file into Supabase: SQL Editor -> New query -> Run.
-- Safe to run more than once.
--
-- The codes themselves are handled by Supabase (free, on by default). This makes the database
-- refuse every request from an account that has two-step turned on but hasn't typed its code yet,
-- so a stolen password alone isn't enough, even when going around the website.
--
-- Someone lost their phone? In Supabase: Authentication -> Users -> click the player ->
-- remove their MFA factor. Then they can log in with just their password again.

create or replace function public.check_two_step()
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is not null
     and coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2'
     and exists (select 1 from auth.mfa_factors where user_id = auth.uid() and status = 'verified') then
    raise exception 'Two-step verification code needed';
  end if;
end;
$$;
grant execute on function public.check_two_step() to anon, authenticated;

-- Run it before every request to the database.
alter role authenticator set pgrst.db_pre_request = 'public.check_two_step';
notify pgrst, 'reload config';

select 'two-step ready' as status;
