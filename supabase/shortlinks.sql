-- ── Shortlinks (QR short URLs) ─────────────────────────────────
--
-- pockit.works/<slug> is one global namespace shared by every user, backed
-- by this table rather than by Eleventy-built redirect pages (see
-- src/redirects.njk + src/_data/shortlinks.js, which remain only for a few
-- hand-maintained static entries). A static site can't look anything up at
-- request time, so resolution happens client-side in src/404.njk: GitHub
-- Pages serves 404.html for any unknown path, and that page reads the slug
-- from the URL and fetches its row here.
--
-- First claim wins: the primary key on slug IS the collision rule — a
-- second claimant's insert fails on conflict, and RLS below guarantees a
-- user can only ever change rows they own, so nobody can steal a slug.
--
-- Run once via the Supabase SQL Editor, after schema.sql. Re-running is
-- safe (create table if not exists, drop-then-recreate policies).
--
-- NOTE (same lesson as schema.sql's Grants section): tables created via
-- the SQL Editor get NO grants automatically — the explicit GRANTs below
-- (including usage/select to anon, which logged-out scanners need) are
-- load-bearing, not decorative.

create table if not exists shortlinks (
  slug text primary key,
  url text not null,
  owner_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Mirrors course-builder.js's sanitizeSlug(): lowercase, hyphens for
  -- spaces, nothing outside a-z0-9-_. The hyphen sits LAST deliberately:
  -- mid-class it reads as a range operator, and Postgres rejected the
  -- mid-class form with "invalid character range", 400ing every upsert.
  constraint shortlinks_slug_format check (slug ~ '^[a-z0-9_-]+$')
);

alter table shortlinks enable row level security;

-- Logged-out scanners must resolve links: anyone can read every row.
-- Unquoted identifiers throughout (see schema.sql's naming note — spaced,
-- quoted names get mangled relaying through a chat client into the SQL
-- editor).
drop policy if exists shortlink_public_read on shortlinks;
create policy shortlink_public_read on shortlinks
  for select using (true);

-- Owners have full control of their own rows (claim/update/release) — and
-- only their own rows. Combined with the primary key, this is the whole
-- first-claim-wins rule: someone else's slug is unreadable-for-write, and
-- inserting it conflicts on the key.
drop policy if exists shortlink_owner_write on shortlinks;
create policy shortlink_owner_write on shortlinks
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- anon needs usage (schema) + select (table) for the logged-out 404-page
-- lookup; authenticated gets the full write set, scoped by RLS above.
grant usage on schema public to anon;
grant select on shortlinks to anon;
grant usage on schema public to authenticated;
grant select, insert, update, delete on shortlinks to authenticated;
