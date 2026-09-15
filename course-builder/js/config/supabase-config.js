// ── Supabase config ───────────────────────────────────────────
// Plain committed constants, not a secret: a Supabase anon key is meant to
// be public — it identifies the project, not a user; access control is
// enforced by the RLS policies in supabase/schema.sql, not by hiding this
// key. This is a deliberately different pattern from card-format.js's
// js-yaml importmap trick (that solves module resolution across Node and
// the browser, not configuration) — see the architecture plan's §3
// (/home/ian/.claude/plans/graceful-exploring-cosmos.md) for why a plain
// constants module is the right tool here instead.
//
// No Supabase project exists yet for this app — both fields are empty
// until one is provisioned and these are filled in. Every call site that
// might use them (auth.js, supabase-client.js) checks
// isSupabaseConfigured first, so an empty config is inert — no thrown
// errors, no network calls — rather than half-working.
// Project created 2026-08-28. The key below is the new-format "publishable"
// key (sb_publishable_…), Supabase's current replacement for the legacy
// anon JWT — same public/RLS-protected trust model, just a newer format;
// supabase-js 2.112.4 (vendored here) accepts it directly.
export const supabaseUrl = 'https://lcwkvegclhhioalusixc.supabase.co';
export const supabaseAnonKey = 'sb_publishable_5VBDuzmiTgZwri7pdhNZLA_KjgXeJOO';

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
