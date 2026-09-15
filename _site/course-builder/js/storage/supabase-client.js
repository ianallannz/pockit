// ── Supabase client ───────────────────────────────────────────
// Thin wrapper around @supabase/supabase-js — the one place in this app
// that imports it, and only via dynamic import(), so a user who never
// signs in never fetches vendor/supabase-js.mjs and never triggers its own
// session-restore network call. See the architecture plan's §1/§3.
import { supabaseUrl, supabaseAnonKey, isSupabaseConfigured } from '../config/supabase-config.js';

// Cached as a promise (not the resolved client) so two callers racing to
// get the client before the dynamic import lands both await the same
// createClient() call rather than triggering it twice — createClient()
// sets up its own internal auth-state machinery, which must only run once.
let clientPromise = null;

// Resolves to the same client instance on every call within a page load,
// or null if no project is configured yet — callers check for null rather
// than this throwing, matching license.js's "inert until configured" style.
export function getSupabaseClient() {
  if (!isSupabaseConfigured) return Promise.resolve(null);
  if (!clientPromise) {
    clientPromise = import('@supabase/supabase-js')
      .then(({ createClient }) => createClient(supabaseUrl, supabaseAnonKey));
  }
  return clientPromise;
}
