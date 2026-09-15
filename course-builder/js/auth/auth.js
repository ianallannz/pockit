// ── Auth ──────────────────────────────────────────────────────
// Sign-in/out and session restore, shaped like pickNewVault()/
// tryAutoReconnect() in course-builder.js. Critically, a signed-in
// *session* is a separate thing from which storage adapter is active (see
// the architecture plan's §1): signing in never itself switches
// activeAdapter — only an explicit "Use cloud storage" gesture (not yet
// built — see the plan's phased rollout, step 4) does that.
//
// Magic-link sign-in (signInWithOtp) rather than a password field: no
// password to store/validate ourselves, and Supabase Auth supports it
// directly — picking between magic-link and password was called out in
// the plan as a UX detail, not an architecture one; this just needed a
// choice made to write real code.
import { getSupabaseClient } from '../storage/supabase-client.js';

let currentUser = null; // { id, email } | null

export function getCurrentUser() {
  return currentUser;
}

export async function signInWithEmail(email) {
  const client = await getSupabaseClient();
  if (!client) throw new Error('Cloud sign-in is not configured yet.');
  // Without this, Supabase Auth sends the user back to the project's
  // default Site URL (its dashboard-configured root) rather than wherever
  // they actually signed in from — window.location.href is exactly "this
  // page, right now", so it's correct in dev, in a subpath deployment, and
  // after a future domain change alike, with nothing to keep in sync by
  // hand. Supabase still requires this URL (or a matching pattern) to be
  // present in the project's Authentication → URL Configuration →
  // Redirect URLs allow-list, or it's ignored in favor of the default.
  const { error } = await client.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.href },
  });
  if (error) throw new Error(error.message);
}

export async function signOut() {
  const client = await getSupabaseClient();
  if (!client) return;
  await client.auth.signOut();
  currentUser = null;
}

// Runs once at startup, mirroring tryAutoReconnect()'s shape. A genuine
// no-op — no import, no network call — for a browser where Supabase isn't
// configured at all (getSupabaseClient() resolves null synchronously
// before ever reaching for vendor/supabase-js.mjs). Once configured, still
// only fires for a browser that has actually signed in before: Supabase
// Auth persists its own session under its own localStorage key, so
// getSession() answers from that without a network round trip when there's
// nothing to restore.
export async function trySessionRestore() {
  const client = await getSupabaseClient();
  if (!client) return null;

  const { data } = await client.auth.getSession();
  if (!data.session) return null;

  currentUser = { id: data.session.user.id, email: data.session.user.email };
  return currentUser;
}

// Lets the UI (updateAccountStatus() in course-builder.js) stay in sync
// with sign-in/out/token-refresh events firing after startup — e.g.
// finishing a magic-link round trip in this same tab.
export function onAuthStateChange(callback) {
  getSupabaseClient().then(client => {
    if (!client) return;
    client.auth.onAuthStateChange((_event, session) => {
      currentUser = session ? { id: session.user.id, email: session.user.email } : null;
      callback(currentUser);
    });
  });
}
