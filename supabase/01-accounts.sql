-- GoBoard step 1: player accounts.
-- Paste this whole file into Supabase: SQL Editor -> New query -> Run.
-- Safe to run more than once.

-- One profile per player. Ratings start at 1200 like chess.com.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null check (username ~ '^[A-Za-z0-9_]{3,16}$'),
  rating integer not null default 1200,
  games integer not null default 0,
  wins integer not null default 0,
  losses integer not null default 0,
  created_at timestamptz not null default now()
);

-- Usernames are unique no matter the capital letters ("Bob" and "bob" can't both exist).
create unique index if not exists profiles_username_unique on public.profiles (lower(username));

-- Row level security: the browser can only READ profiles. Nobody can edit a rating
-- directly; ratings will only change through checked database functions (step 2).
alter table public.profiles enable row level security;

drop policy if exists "Profiles are public" on public.profiles;
create policy "Profiles are public" on public.profiles
  for select using (true);

-- When someone signs up, create their profile from the username they chose.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, username)
  values (new.id, new.raw_user_meta_data ->> 'username');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Is this username still free? (Used by the sign-up form before creating the account.)
create or replace function public.username_available(name text)
returns boolean
language sql
security definer set search_path = ''
stable
as $$
  select not exists (select 1 from public.profiles where lower(username) = lower(name));
$$;

-- Lets a logged-in player delete their own account and everything about them.
create or replace function public.delete_my_account()
returns void
language sql
security definer set search_path = ''
as $$
  delete from auth.users where id = auth.uid();
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
grant execute on function public.username_available(text) to anon, authenticated;
