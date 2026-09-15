-- Pockit — Supabase schema for the cloud storage/entitlements architecture
-- described in card-format.md's "Going online" section and the plan at
-- /home/ian/.claude/plans/graceful-exploring-cosmos.md.
--
-- Not applied anywhere yet — no Supabase project exists for this app. Run
-- this against a real project's SQL editor (or via `supabase db push` once
-- the Supabase CLI is set up) once one is provisioned.
--
-- Design note: unlike vault-adapter.js, which has to invent folder-name
-- slugs because a filesystem has no other identity concept, these tables
-- are keyed directly by the app's own integer ids (course.id, lesson.id,
-- card.id) scoped per user via a composite (user_id, id) primary key —
-- see supabase-adapter.js. That sidesteps the whole slug/rename problem
-- vault-adapter.js has to solve.

-- ── Course data (mirrors vault-adapter.js's course → lesson → card tree)

create table if not exists courses (
  user_id uuid not null references auth.users(id) on delete cascade,
  id integer not null,
  code text,
  name text,
  params jsonb not null default '{}'::jsonb,
  timetable jsonb not null default '[]'::jsonb,
  active_lesson_id integer,
  position integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists lessons (
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id integer not null,
  id integer not null,
  title text,
  scratchpad jsonb not null default '[]'::jsonb,
  position integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, course_id) references courses (user_id, id) on delete cascade
);

create table if not exists cards (
  user_id uuid not null references auth.users(id) on delete cascade,
  lesson_id integer not null,
  id integer not null,
  -- Full card-format.js markdown (frontmatter + ::: containers), the same
  -- text a card-<id>.md file holds in a vault.
  markdown text not null default '',
  position integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, lesson_id) references lessons (user_id, id) on delete cascade
);

-- One row per user: mirrors vault.yml's sole field, activeCourseId.
create table if not exists user_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active_course_id integer,
  updated_at timestamptz not null default now()
);

-- ── Profile
--
-- Account-level identity fields — distinct from course data (above) and
-- from auth.users itself (which only really has email). This table is only
-- the Cloud-backed copy: the same fields also live in local-storage-adapter.js's
-- blob and vault-adapter.js's profile.yml, since a user doesn't need to be
-- signed in to set them (see the `profile` state and updateProfileDetails()
-- in course-builder.js). Only avatar_path requires this table specifically
-- — a photo needs real file storage, which only Cloud provides (see
-- storage-adapter.js's optional `avatar` capability).
create table if not exists profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  title text,
  first_name text,
  last_name text,
  job_title text,
  employer text,
  -- Storage object path in the avatars bucket below, e.g. "<user_id>/<hash>.<ext>"
  -- — same content-addressed convention as attachments, just its own
  -- bucket since an avatar isn't scoped to any one course.
  avatar_path text,
  updated_at timestamptz not null default now()
);

create index if not exists lessons_course_idx on lessons (user_id, course_id);
create index if not exists cards_lesson_idx on cards (user_id, lesson_id);

-- ── Course sharing (read-only viewer access)
--
-- See /home/ian/.claude/plans/graceful-exploring-cosmos.md. An owner
-- grants another account read-only access to one course by inviting a
-- specific email; the invited account must explicitly accept (a real,
-- visible step — the accept-transition update below) before RLS grants it
-- anything. Deliberately no trigger/auth.users-mirroring machinery: since
-- acceptance always happens while the recipient is signed in, the client
-- can perform the accept-transition itself under RLS.
create table if not exists course_invites (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  course_id integer not null,
  -- Locked to one person for v1 (not null, always checked in the accept
  -- policy below) — a future "anyone with the link" tier would relax this
  -- to nullable and add one extra accept-policy branch. Not built now.
  invited_email text not null check (invited_email = lower(invited_email)),
  user_id uuid references auth.users(id) on delete cascade,
  status text not null check (status in ('pending', 'accepted')) default 'pending',
  -- Free text, nullable, unenforced — the owner can optionally note what
  -- kind of access this is ("student", or left blank) at invite time. Not
  -- read or acted on anywhere yet; purely a forward-looking hook in case
  -- it turns out to matter later (e.g. roster/analytics-style features) —
  -- deliberately not a constrained enum, since that real future need isn't
  -- known yet.
  invited_as text,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  foreign key (owner_id, course_id) references courses (user_id, id) on delete cascade,
  unique (owner_id, course_id, invited_email)
);

create index if not exists course_invites_owner_idx on course_invites (owner_id, course_id);
create index if not exists course_invites_user_idx on course_invites (user_id);

-- ── Entitlements & licensing
--
-- Written to by a future (out-of-scope here) payment integration. Both
-- online plan types grant the same runtime capability ("cloud storage
-- access"); they differ only in how `status` should be interpreted:
--   subscription:     active iff status <> 'canceled' and now() < renews_at + grace
--   perpetual_online:  active iff status = 'active' and purchased_at is not null
--   local_license:     see license_keys below — this row just records the
--                       purchase for account/support purposes; the local
--                       app never queries it directly (see license.js).

create table if not exists entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_type text not null check (plan_type in ('subscription', 'perpetual_online', 'local_license')),
  status text not null check (status in ('active', 'expired', 'canceled')),
  renews_at timestamptz,
  purchased_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists entitlements_user_idx on entitlements (user_id);

-- A local_license entitlement's actual, offline-verifiable artifact — the
-- signed token string a user pastes into the (possibly always-offline)
-- local app. See license.js/license-public-key.js: verification is a pure
-- Web Crypto signature check against this row's issuance, not a live query
-- against this table.
create table if not exists license_keys (
  id uuid primary key default gen_random_uuid(),
  entitlement_id uuid not null references entitlements(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  key_code text not null unique,
  issued_at timestamptz not null default now(),
  revoked boolean not null default false
);

-- ── Row Level Security
--
-- Every table is owner-scoped: a signed-in user can only read/write rows
-- where user_id = auth.uid(). Exact policy syntax below is a starting
-- point, not exhaustively reviewed — see the plan's open questions.
--
-- `create policy` has no `if not exists` in Postgres (unlike `create table`
-- above or `on conflict do nothing` below) — re-running this file without
-- the matching `drop policy if exists` first errors on the first policy
-- that already exists from an earlier run, silently aborting everything
-- after it in the same script. Each policy below is dropped-then-recreated
-- so the whole file stays safe to paste and run again anytime.

alter table courses enable row level security;
alter table lessons enable row level security;
alter table cards enable row level security;
alter table user_state enable row level security;
alter table profiles enable row level security;
alter table entitlements enable row level security;
alter table license_keys enable row level security;
alter table course_invites enable row level security;

drop policy if exists "owner full access" on courses;
create policy "owner full access" on courses
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "owner full access" on lessons;
create policy "owner full access" on lessons
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "owner full access" on cards;
create policy "owner full access" on cards
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "owner full access" on user_state;
create policy "owner full access" on user_state
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "owner full access" on profiles;
create policy "owner full access" on profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- Entitlements/license_keys are read-only from the client's perspective —
-- only a future server-side payment integration (using the service role
-- key, which bypasses RLS) should write these.
drop policy if exists "owner read only" on entitlements;
create policy "owner read only" on entitlements
  for select using (auth.uid() = user_id);
drop policy if exists "owner read only" on license_keys;
create policy "owner read only" on license_keys
  for select using (auth.uid() = user_id);

-- ── Course sharing RLS
--
-- course_invites itself: the owner has full control (create/list/revoke —
-- revoke is a plain delete, not a status flag); the invited recipient can
-- only ever read their own invite rows and perform the one narrow accept
-- transition — never insert or delete. Multiple named policies on the same
-- table are OR'd together (Postgres default "permissive" policies), so an
-- owner and a recipient each get exactly the access their own policy
-- grants, nothing more.
--
-- Unlike the Arc-A policy names above (spaced, quoted), every policy name
-- from here down is a plain unquoted identifier — underscores instead of
-- spaces. Not a style preference: a spaced name needs double-quoting, and
-- this SQL routinely gets relayed through a chat client on its way into
-- the Supabase SQL editor, where a straight `"` reliably gets silently
-- autocorrected to a curly “smart quote” — Postgres then can't parse it as
-- a quoted identifier at all ("syntax error at or near ..." pointing right
-- at the mangled token). An unquoted identifier has no quote character for
-- anything to mangle, so it survives that trip intact.
drop policy if exists owner_full_access on course_invites;
create policy owner_full_access on course_invites
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists recipient_read_own on course_invites;
create policy recipient_read_own on course_invites
  for select using (auth.email() = invited_email or user_id = auth.uid());

-- The only write a non-owner is ever allowed to make anywhere in this
-- feature: accept a pending invite addressed to their own signed-in email.
drop policy if exists recipient_accept on course_invites;
create policy recipient_accept on course_invites
  for update
  using (auth.email() = invited_email and status = 'pending')
  with check (user_id = auth.uid() and status = 'accepted' and invited_email = auth.email());

-- Additive SELECT-only policies granting a viewer read access to a shared
-- course — the existing "owner full access" policies above are untouched.
-- cards has no course_id of its own, so its policy joins through lessons
-- (cards.user_id = lessons.user_id is already guaranteed by cards' own
-- foreign key onto lessons(user_id, id) — see the table definition above).
drop policy if exists viewer_read_access on courses;
create policy viewer_read_access on courses
  for select using (
    exists (select 1 from course_invites
      where course_invites.owner_id = courses.user_id
        and course_invites.course_id = courses.id
        and course_invites.user_id = auth.uid()
        and course_invites.status = 'accepted')
  );

drop policy if exists viewer_read_access on lessons;
create policy viewer_read_access on lessons
  for select using (
    exists (select 1 from course_invites
      where course_invites.owner_id = lessons.user_id
        and course_invites.course_id = lessons.course_id
        and course_invites.user_id = auth.uid()
        and course_invites.status = 'accepted')
  );

drop policy if exists viewer_read_access on cards;
create policy viewer_read_access on cards
  for select using (
    exists (
      select 1 from lessons
      join course_invites
        on course_invites.owner_id = lessons.user_id
        and course_invites.course_id = lessons.course_id
      where lessons.user_id = cards.user_id
        and lessons.id = cards.lesson_id
        and course_invites.user_id = auth.uid()
        and course_invites.status = 'accepted'
    )
  );

-- ── Grants
--
-- RLS policies above only govern *which rows* a role can touch once it's
-- allowed near the table at all — that's a separate, plain Postgres GRANT,
-- which a table created here via the SQL Editor does NOT get automatically
-- (unlike a table created through the dashboard's Table Editor UI, which
-- grants this for you). Missing it produces a hard "permission denied for
-- table X" error from PostgREST rather than the RLS-filtered-to-empty-
-- result a policy mismatch would give — easy to misdiagnose as an RLS bug
-- when it's actually one level below RLS.
grant usage on schema public to authenticated;
grant select, insert, update, delete on courses, lessons, cards, user_state, profiles to authenticated;
-- Read-only from the client's perspective, matching the RLS policies above.
grant select on entitlements, license_keys to authenticated;
-- RLS above (not this grant) is what actually stops a recipient from
-- inserting/deleting — see "course sharing RLS" above.
grant select, insert, update, delete on course_invites to authenticated;

-- ── Storage bucket for attachments (images)
-- Path convention (see supabase-adapter.js): <user_id>/<course_id>/<hash>.<ext>
-- `on conflict do nothing` so this is safe to re-run whether or not the
-- bucket was already created by hand via the dashboard's Storage tab.
insert into storage.buckets (id, name, public) values ('attachments', 'attachments', false)
  on conflict (id) do nothing;

-- storage.objects has RLS on by default in every Supabase project — unlike
-- the public-schema tables above, it already carries the right grants to
-- authenticated/anon out of the box, so only the policy itself is needed
-- here, not an explicit `grant`.
drop policy if exists "owner attachment access" on storage.objects;
create policy "owner attachment access" on storage.objects
  for all using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);

-- Read-only extension for a shared course's viewer — mirrors
-- viewer_read_access on courses/lessons/cards above. (storage.foldername
-- (name))[1] is the owner's own user_id segment, [2] is the course_id
-- segment (see the attachments path convention noted above).
drop policy if exists viewer_attachment_access on storage.objects;
create policy viewer_attachment_access on storage.objects
  for select using (
    bucket_id = 'attachments' and exists (
      select 1 from course_invites
      where course_invites.owner_id::text = (storage.foldername(name))[1]
        and course_invites.course_id::text = (storage.foldername(name))[2]
        and course_invites.user_id = auth.uid()
        and course_invites.status = 'accepted'
    )
  );

-- ── Storage bucket for profile photos
-- Path convention (see the "Profile" section above and
-- storage/supabase-adapter.js's avatar capability): <user_id>/<hash>.<ext>
-- — no course_id segment, since a profile photo isn't scoped to any one
-- course.
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', false)
  on conflict (id) do nothing;

drop policy if exists "owner avatar access" on storage.objects;
create policy "owner avatar access" on storage.objects
  for all using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
