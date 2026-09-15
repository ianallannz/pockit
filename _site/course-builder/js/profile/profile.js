// ── User profile ─────────────────────────────────────────────
// Account-level identity fields (title, name, job title, employer, photo)
// — distinct from course data (storage/supabase-adapter.js) and from auth
// identity (auth.js only knows {id, email}). Requires sign-in by
// construction: a photo needs real file storage, which only the Supabase
// backend provides, so this whole feature is gated on being signed in,
// independent of which backend (local/vault/cloud) the current course
// happens to use — see updateProfileDetails() in course-builder.js.
import { getSupabaseClient } from '../storage/supabase-client.js';

// Same idea as supabase-adapter.js's IMAGE_EXTENSIONS/hashFile — narrower
// list (no SVG/GIF) since this is a photo, not an arbitrary card image.
const AVATAR_EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const SIGNED_URL_TTL_SECONDS = 3600;

async function hashFile(file) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
}

function unwrap({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

// null if never signed in this session — callers (course-builder.js) only
// call this once a user is already known to be signed in, same as every
// other profile.js export.
export async function loadProfile(userId) {
  const client = await getSupabaseClient();
  if (!client) return null;
  return unwrap(await client.from('profiles').select('*').eq('user_id', userId).maybeSingle());
}

// `fields`: { title, firstName, lastName, jobTitle, employer } — any
// subset; omitted keys are left alone (upsert only overwrites what's
// passed) except this always sends every key so a cleared field (typed
// then deleted) actually clears in storage rather than being skipped.
export async function saveProfile(userId, fields) {
  const client = await getSupabaseClient();
  if (!client) throw new Error('Cloud sign-in is not configured yet.');
  unwrap(await client.from('profiles').upsert({
    user_id: userId,
    title: fields.title || null,
    first_name: fields.firstName || null,
    last_name: fields.lastName || null,
    job_title: fields.jobTitle || null,
    employer: fields.employer || null,
    updated_at: new Date().toISOString(),
  }));
}

// Uploads the photo and records its path on the profile row in one call —
// returns the stored path (for resolveAvatarUrl()) rather than a signed
// URL, matching supabase-adapter.js attachments.save()'s "store a
// reference, resolve it separately" split.
export async function uploadAvatar(userId, file) {
  const client = await getSupabaseClient();
  if (!client) throw new Error('Cloud sign-in is not configured yet.');

  const extension = AVATAR_EXTENSIONS[file.type];
  if (!extension) throw new Error('Only PNG, JPEG and WebP are accepted.');

  const path = `${userId}/${await hashFile(file)}.${extension}`;
  const { error: uploadError } = await client.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type });
  if (uploadError) throw new Error(uploadError.message);

  // upsert() only touches the columns actually passed — this leaves any
  // already-saved title/name/job/employer fields alone (untouched, not
  // nulled), whether this is the very first profile write or not.
  unwrap(await client.from('profiles').upsert({ user_id: userId, avatar_path: path, updated_at: new Date().toISOString() }));
  return path;
}

// Private bucket + signed URL, same tradeoff as supabase-adapter.js's
// attachments.resolve() — not cached past the signed URL's own expiry.
export async function resolveAvatarUrl(userId, path) {
  if (!path) return null;
  const client = await getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client.storage.from('avatars').createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error) return null;
  return data.signedUrl;
}
