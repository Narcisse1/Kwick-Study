-- Kwick-Study database schema for Supabase.
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Safe to re-run: every statement is idempotent.

-- ---------------------------------------------------------------------------
-- Profiles: one row per account, holds the newsletter choice.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  newsletter boolean not null default false,
  newsletter_consented_at timestamptz,
  newsletter_unsubscribed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "Read own profile" on public.profiles;
create policy "Read own profile" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);

drop policy if exists "Update own profile" on public.profiles;
create policy "Update own profile" on public.profiles
  for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- Users may only change their newsletter choice; email and timestamps are set by the server.
revoke update on public.profiles from authenticated, anon;
grant update (newsletter) on public.profiles to authenticated;

-- Record when someone subscribes or unsubscribes (server time, not the browser's).
create or replace function public.profiles_newsletter_timestamps()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.newsletter and not coalesce(old.newsletter, false) then
    new.newsletter_consented_at := now();
    new.newsletter_unsubscribed_at := null;
  elsif not new.newsletter and coalesce(old.newsletter, false) then
    new.newsletter_unsubscribed_at := now();
  end if;
  return new;
end $$;

drop trigger if exists profiles_newsletter_timestamps on public.profiles;
create trigger profiles_newsletter_timestamps
  before update of newsletter on public.profiles
  for each row execute function public.profiles_newsletter_timestamps();

-- Create the profile when someone signs up. The sign-up form sends
-- { newsletter: true|false } as user metadata.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  wants_newsletter boolean := coalesce((new.raw_user_meta_data ->> 'newsletter')::boolean, false);
begin
  insert into public.profiles (id, email, newsletter, newsletter_consented_at)
  values (new.id, new.email, wants_newsletter, case when wants_newsletter then now() end)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Study data: each flashcard, takeaway, session, day and the settings are one
-- row, keyed the same way the app stores them locally (e.g. "card_abc123").
-- ---------------------------------------------------------------------------
create table if not exists public.user_docs (
  user_id uuid not null references auth.users (id) on delete cascade,
  key text not null check (char_length(key) between 1 and 120),
  value jsonb not null,
  updated_ms bigint not null,               -- when the user changed it (device clock)
  synced_at timestamptz not null default now(), -- when the server stored it
  primary key (user_id, key)
);

create index if not exists user_docs_user_synced on public.user_docs (user_id, synced_at);

alter table public.user_docs enable row level security;

drop policy if exists "Own study data" on public.user_docs;
create policy "Own study data" on public.user_docs
  for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Stamp server time on every write, and never let an older edit from another
-- device overwrite a newer one.
create or replace function public.user_docs_before_write()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.updated_ms < old.updated_ms then
    return null;
  end if;
  new.synced_at := clock_timestamp();
  return new;
end $$;

drop trigger if exists user_docs_before_write on public.user_docs;
create trigger user_docs_before_write
  before insert or update on public.user_docs
  for each row execute function public.user_docs_before_write();

-- ---------------------------------------------------------------------------
-- Let people delete their own account (removes their profile and study data).
-- ---------------------------------------------------------------------------
create or replace function public.delete_my_account()
returns void language sql security definer set search_path = '' as $$
  delete from auth.users where id = auth.uid();
$$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ---------------------------------------------------------------------------
-- Newsletter export (run on its own when you need the list, then Download CSV):
--
--   select p.email, p.newsletter_consented_at
--   from public.profiles p
--   join auth.users u on u.id = p.id
--   where p.newsletter and u.email_confirmed_at is not null
--   order by p.newsletter_consented_at;
-- ---------------------------------------------------------------------------
