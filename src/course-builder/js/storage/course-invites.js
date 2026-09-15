// ── Course invites ────────────────────────────────────────────
// Client-side API for read-only course sharing — see the course_invites
// table and its RLS policies in supabase/schema.sql, and the design notes
// in /home/ian/.claude/plans/graceful-exploring-cosmos.md. Every function
// here is a thin wrapper over a single Postgres statement; RLS (not this
// file) is what actually enforces who can see or change what row — see
// "owner full access"/"recipient read own"/"recipient accept" in
// schema.sql for the real access rules this API can only ever reflect
// back, never bypass.
//
// Each function takes an already-resolved Supabase `client` as its first
// argument, the same convention createSupabaseAdapter() uses (and the same
// reason: course-builder.js already calls getSupabaseClient() once itself
// — see useCloudStorage() — so every Supabase-touching module downstream
// of that just takes the resolved client rather than re-resolving it, and
// it's what makes this directly unit-testable against a mock client
// without touching module-level import state.

function unwrap({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

// snake_case row -> the camelCase shape callers work with, same idea as
// supabase-adapter.js's profileFromRow().
function inviteFromRow(row) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    courseId: row.course_id,
    invitedEmail: row.invited_email,
    userId: row.user_id,
    status: row.status,
    invitedAs: row.invited_as || '',
    createdAt: row.created_at,
    acceptedAt: row.accepted_at,
  };
}

// Owner side: everyone with access (or pending access) to one course of
// theirs — the Share panel's list. `ownerId` is required explicitly
// (rather than read off an imported auth.js) for the same reason
// supabase-adapter.js takes userId as a constructor argument — RLS scopes
// this to the caller's own rows regardless; this just keeps identity
// something the caller hands in, not something this file looks up itself.
export async function listCourseAccess(client, ownerId, courseId) {
  const rows = unwrap(await client
    .from('course_invites')
    .select('*')
    .eq('owner_id', ownerId)
    .eq('course_id', courseId)
    .order('created_at'));
  return rows.map(inviteFromRow);
}

// Owner side: grant access, locked to one email (see schema.sql's
// invited_email comment for the future "anyone with the link" extension
// point this deliberately doesn't build). `invitedAs` is the nullable,
// unenforced forward-looking hook for a future student/LMS distinction —
// optional, not read anywhere yet.
export async function inviteToCourse(client, ownerId, courseId, email, invitedAs = '') {
  const invitedEmail = email.trim().toLowerCase();
  if (!invitedEmail) throw new Error('Enter an email address.');

  const { error } = await client.from('course_invites').insert({
    owner_id: ownerId,
    course_id: courseId,
    invited_email: invitedEmail,
    invited_as: invitedAs.trim() || null,
  });
  // 23505 = unique_violation: (owner_id, course_id, invited_email) already
  // has a row, pending or accepted — a friendlier message than the raw
  // constraint error.
  if (error?.code === '23505') throw new Error(`${invitedEmail} already has access to this course.`);
  if (error) throw new Error(error.message);
}

// Owner side: revoke, for a pending or an already-accepted row alike — a
// plain delete rather than a status flag, matching "remove from a
// course's access list at any time" directly. Idempotent: revoking a row
// that's already gone is not an error.
export async function revokeInvite(client, inviteId) {
  unwrap(await client.from('course_invites').delete().eq('id', inviteId));
}

// Recipient side: every invite naming the signed-in account's email —
// pending and accepted alike, across every owner/course — for the
// viewer's own course list. Matches "recipient read own"'s RLS policy
// exactly (auth.email() = invited_email or user_id = auth.uid()), so no
// separate pending/accepted query is needed: RLS alone already scopes this
// to "my rows," nothing further to filter by on this end.
export async function listMyInvites(client) {
  const rows = unwrap(await client
    .from('course_invites')
    .select('*')
    .order('created_at'));
  return rows.map(inviteFromRow);
}

// Recipient side: the one write a non-owner is ever allowed to make (see
// "recipient accept" in schema.sql) — flips a pending invite naming their
// own email to accepted, under their own account. The .eq('invited_email',
// ...) here is redundant with RLS's own `using` clause (belt-and-
// suspenders, not the real boundary); what .select() at the end buys is
// visibility — an update that matches zero rows (stale link, wrong
// account, already-revoked invite) succeeds silently otherwise, so this
// turns that into a clear error instead of a no-op the caller can't detect.
export async function acceptInvite(client, inviteId, userId, email) {
  const rows = unwrap(await client
    .from('course_invites')
    .update({ user_id: userId, status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('id', inviteId)
    .eq('invited_email', email.trim().toLowerCase())
    .select());
  if (!rows.length) throw new Error('This invite is no longer available.');
  return inviteFromRow(rows[0]);
}
