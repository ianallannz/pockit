// ── Shortlinks publish ───────────────────────────────────────
// Backend-agnostic bridge between QR (Link) blocks and the Supabase
// `shortlinks` table (see supabase/shortlinks.sql) that pockit.works/<slug>
// resolves through at runtime (see src/404.njk).
//
// Deliberately NOT tied to any storage adapter: slugs are collected off a
// plain state snapshot — identical whether the course lives in browser
// storage, a vault folder (slug/url already round-trip through
// card-format.js's Link attrs there), or cloud — and publishing only ever
// needs a signed-in Supabase client, never cloud storage itself.
//
// First claim wins, end to end: the table's primary key rejects a second
// claimant, and every write here filters out slugs owned by someone else
// before touching them, so this code can no more steal a slug than the
// database would let it.
//
// Same client-first-argument convention as course-invites.js, for the same
// reason: directly unit-testable against a mock client.

function unwrap({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

// Top-level site paths served as real static pages — 404.njk never even
// fires for these, so claiming one would be dead on arrival. Checked at
// claim time (not in the DB, which can't know the site's routes).
const RESERVED_SLUGS = new Set([
  'about', 'course', 'course-builder', 'css', 'docs', 'example',
  'images', 'js', 'note', 'note-builder', 'qr', 'thanks',
]);

export function isReservedSlug(slug) {
  return RESERVED_SLUGS.has(slug);
}

// Same rule as course-builder.js's sanitizeSlug() — duplicated, not
// imported, so this module stays DOM- and app-free (and unit-testable).
function normalizeSlug(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '');
}

// Every usable { slug, url } pair in a state snapshot, first occurrence
// wins. A block needs BOTH: a slug with no URL has nowhere to redirect to.
export function collectShortlinks(state) {
  const seen = new Set();
  const entries = [];
  for (const course of state?.courses || []) {
    for (const lesson of course.lessons || []) {
      for (const card of lesson.cards || []) {
        for (const block of card.blocks || []) {
          const slug = normalizeSlug(block.slug);
          const url = String(block.url || '').trim();
          if (!slug || !url || seen.has(slug)) continue;
          seen.add(slug);
          entries.push({ slug, url });
        }
      }
    }
  }
  return entries;
}

// Slugs the user's own courses point at two different URLs — publishing
// keeps the first, so this is the "did you mean that?" list for the UI.
export function findLocalDuplicates(state) {
  const urlsBySlug = new Map();
  for (const course of state?.courses || []) {
    for (const lesson of course.lessons || []) {
      for (const card of lesson.cards || []) {
        for (const block of card.blocks || []) {
          const slug = normalizeSlug(block.slug);
          const url = String(block.url || '').trim();
          if (!slug || !url) continue;
          if (!urlsBySlug.has(slug)) urlsBySlug.set(slug, new Set());
          urlsBySlug.get(slug).add(url);
        }
      }
    }
  }
  return [...urlsBySlug.entries()]
    .filter(([, urls]) => urls.size > 1)
    .map(([slug, urls]) => ({ slug, urls: [...urls] }));
}

// Full reconcile of one user's rows against their current entries: upserts
// what they claim, deletes owned rows they no longer use, and never touches
// (or reports as conflicts) slugs owned by someone else.
export async function publishShortlinks(client, userId, entries) {
  const wanted = new Map(entries.map(e => [e.slug, e.url]));
  // PostgREST rejects an empty `in=()` list outright — and with nothing
  // wanted there is nothing that could conflict anyway.
  const existing = wanted.size
    ? unwrap(await client.from('shortlinks').select('slug,owner_id').in('slug', [...wanted.keys()]))
    : [];

  const conflicts = [];
  const mine = [];
  for (const [slug, url] of wanted) {
    const row = existing.find(r => r.slug === slug);
    if (row && row.owner_id !== userId) conflicts.push(slug);
    else mine.push({ slug, url, owner_id: userId, updated_at: new Date().toISOString() });
  }

  const owned = unwrap(await client.from('shortlinks').select('slug').eq('owner_id', userId));
  const ownedSlugs = new Set(owned.map(r => r.slug));
  const stale = [...ownedSlugs].filter(slug => !wanted.has(slug));

  if (mine.length) {
    unwrap(await client.from('shortlinks').upsert(mine, { onConflict: 'slug' }));
  }
  if (stale.length) {
    unwrap(await client.from('shortlinks').delete().eq('owner_id', userId).in('slug', stale));
  }
  return { published: mine.length, removed: stale.length, conflicts };
}

// Single-slug claim for the link editor's immediate feedback — same
// first-claim rule as the bulk path, just one row and no pruning.
export async function claimShortlink(client, userId, rawSlug, rawUrl) {
  const slug = normalizeSlug(rawSlug);
  const url = String(rawUrl || '').trim();
  if (!slug) return { ok: false, reason: 'empty' };
  if (isReservedSlug(slug)) return { ok: false, reason: 'reserved' };
  if (!url) return { ok: false, reason: 'no-url' };

  const row = unwrap(await client.from('shortlinks').select('slug,url,owner_id').eq('slug', slug).maybeSingle());
  if (row && row.owner_id !== userId) return { ok: false, reason: 'claimed' };
  // Already ours with the same target: no write needed.
  if (row && row.url === url) return { ok: true };

  unwrap(await client.from('shortlinks').upsert(
    { slug, url, owner_id: userId, updated_at: new Date().toISOString() },
    { onConflict: 'slug' }
  ));
  return { ok: true };
}
