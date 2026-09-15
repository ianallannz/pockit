// ── Supabase adapter ─────────────────────────────────────────
// Cloud counterpart to vault-adapter.js, implementing the same
// storage-adapter.js shape (load/save/describe/attachments) against a
// Supabase Postgres schema + Storage bucket instead of a folder on disk.
// See supabase/schema.sql for the tables this reads/writes.
//
// Unlike vault-adapter.js, Postgres rows are keyed directly by the app's
// own integer ids (scoped per user via a (user_id, id) primary key) —
// there's no filesystem-style name/identity split to manage here, so this
// needs none of vault's slug/rename machinery. What IS reused from
// vault-adapter.js's approach: content-diffing before writing
// (writeIfChanged's idea, here against rows instead of files — skips a
// network round trip for a card whose markdown hasn't actually changed
// since last seen) and stray-row deletion after each save
// (removeStrayEntries's idea, here as a DELETE ... NOT IN).
//
// A factory (createSupabaseAdapter(client, userId)), mirroring
// createVaultAdapter(rootHandle) — one instance per signed-in session, its
// own content cache, unit-testable against a mocked Supabase client (see
// test/supabase-adapter.test.js) the same way vault-adapter.js is tested
// against a mocked FileSystemDirectoryHandle.
//
// State also carries `profile` (title/name/job/employer/avatarSrc) — one
// row per user in the `profiles` table, root-level rather than per-course,
// same idea as vault-adapter.js's profile.yml. The optional `avatar`
// capability (unscoped by course, unlike `attachments`) is this backend's
// counterpart to vault's own avatar capability.
import { parse as parseCard, serialize as serializeCard } from '../../../_lib/card-format.js';
import { defaults } from '../params-defaults.js';

// Same convention vault-adapter.js and the dev server's lib/image-upload.js
// use — extension comes from content type, never the uploaded filename.
const IMAGE_EXTENSIONS = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg',
};

// Narrower than IMAGE_EXTENSIONS (no SVG/GIF) — this is a photo, not an
// arbitrary card image.
const AVATAR_EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

// A signed URL expires, unlike vault's URL.createObjectURL — resolve()
// below caches it for less than its real lifetime rather than forever.
const SIGNED_URL_TTL_SECONDS = 3600;

async function hashFile(file) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
}

// Same idea as vault-adapter.js's makeContentCache() — kept as its own
// copy here rather than a shared import, since vault-adapter.js isn't
// meant to change for this feature.
function makeContentCache() {
  const lastSeen = new Map();
  return {
    unchanged: (key, content) => lastSeen.get(key) === content,
    remember: (key, content) => lastSeen.set(key, content),
  };
}

function stripBlockId({ id, ...rest }) {
  return rest;
}

// profiles table row (snake_case columns) -> the same camelCase shape
// vault-adapter.js's profile.yml round-trips, so course-builder.js's
// profile fields work identically regardless of which backend is active.
function profileFromRow(row) {
  return {
    title: row?.title || '',
    firstName: row?.first_name || '',
    lastName: row?.last_name || '',
    jobTitle: row?.job_title || '',
    employer: row?.employer || '',
    avatarSrc: row?.avatar_path || null,
  };
}

function unwrap({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

// PostgREST's "not in" filter parses list elements as literal typed values
// — unlike real SQL, it has no NULL to fall back on for "match nothing," so
// an empty remaining-id set can't be expressed as a not-in filter at all
// (a literal "(null)" errors: "invalid input syntax for type integer").
// deleteStrayRows() below just skips the filter entirely in that case,
// which is the correct behavior anyway: nothing remaining under this
// parent means delete everything under it.
function inListLiteral(ids) {
  return `(${ids.join(',')})`;
}

async function deleteStrayRows(query, remainingIds) {
  unwrap(await (remainingIds.length ? query.not('id', 'in', inListLiteral(remainingIds)) : query));
}

export function createSupabaseAdapter(client, userId) {
  const contentCache = makeContentCache();

  async function load() {
    const courseRows = unwrap(await client.from('courses').select('*').eq('user_id', userId).order('position'));
    if (!courseRows.length) return null;

    const lessonRows = unwrap(await client.from('lessons').select('*').eq('user_id', userId).order('position'));
    const cardRows = unwrap(await client.from('cards').select('*').eq('user_id', userId).order('position'));
    const stateRow = unwrap(await client.from('user_state').select('*').eq('user_id', userId).maybeSingle());
    // Root-level, not per-course — one row per signed-in user, same idea
    // as vault-adapter.js's profile.yml sitting at the vault root.
    const profileRow = unwrap(await client.from('profiles').select('*').eq('user_id', userId).maybeSingle());
    const profile = profileFromRow(profileRow);
    contentCache.remember('profile', JSON.stringify(profile));

    for (const row of courseRows) {
      contentCache.remember(`course:${row.id}`, JSON.stringify({ params: row.params, timetable: row.timetable, active_lesson_id: row.active_lesson_id }));
    }
    for (const row of lessonRows) {
      contentCache.remember(`lesson:${row.id}`, JSON.stringify({ title: row.title, scratchpad: row.scratchpad }));
    }
    for (const row of cardRows) contentCache.remember(`card:${row.id}`, row.markdown);

    const cardsByLesson = new Map();
    for (const row of cardRows) {
      const { frontmatter, blocks } = parseCard(row.markdown || '');
      const card = { id: row.id, title: frontmatter.title || undefined, teacherOverview: frontmatter.teacherOverview || undefined, blocks };
      (cardsByLesson.get(row.lesson_id) || cardsByLesson.set(row.lesson_id, []).get(row.lesson_id)).push(card);
    }

    const lessonsByCourse = new Map();
    for (const row of lessonRows) {
      const lesson = { id: row.id, title: row.title || 'Untitled lesson', scratchpad: row.scratchpad || [], cards: cardsByLesson.get(row.id) || [] };
      (lessonsByCourse.get(row.course_id) || lessonsByCourse.set(row.course_id, []).get(row.course_id)).push(lesson);
    }

    const courses = courseRows.map(row => ({
      id: row.id,
      params: { ...defaults, ...(row.params || {}) },
      timetable: row.timetable || [],
      activeLessonId: row.active_lesson_id,
      lessons: lessonsByCourse.get(row.id) || [],
    }));

    // Same recompute-don't-trust-a-stored-counter approach as vault-adapter.js.
    const nextCourseId = Math.max(0, ...courses.map(c => c.id || 0)) + 1;
    const nextLessonId = Math.max(0, ...courses.flatMap(c => c.lessons.map(l => l.id || 0))) + 1;
    const nextId = Math.max(0, ...courses.flatMap(c => c.lessons.flatMap(l => l.cards.map(card => card.id || 0)))) + 1;
    const nextTimetableId = Math.max(0, ...courses.flatMap(c => c.timetable.map(t => t.id || 0))) + 1;
    const nextNoteId = Math.max(0, ...courses.flatMap(c => c.lessons.flatMap(l => l.scratchpad.map(n => n.id || 0)))) + 1;
    // Block ids aren't persisted (card-format.js's block shape is content
    // only) — freshly assigned here, matching vault-adapter.js exactly.
    let nextBlockAssign = 1;
    for (const course of courses) {
      for (const lesson of course.lessons) {
        for (const card of lesson.cards) {
          card.blocks = card.blocks.map(block => ({ id: nextBlockAssign++, ...block }));
        }
      }
    }

    return {
      courses,
      activeCourseId: stateRow?.active_course_id ?? courses[0]?.id ?? null,
      nextId, nextBlockId: nextBlockAssign, nextLessonId, nextCourseId, nextTimetableId, nextNoteId,
      profile,
    };
  }

  async function saveCard(lessonId, card, position) {
    const frontmatter = {};
    if (card.title) frontmatter.title = card.title;
    if (card.teacherOverview) frontmatter.teacherOverview = card.teacherOverview;
    const markdown = serializeCard({ frontmatter, blocks: card.blocks.map(stripBlockId) });

    if (contentCache.unchanged(`card:${card.id}`, markdown)) return;
    unwrap(await client.from('cards').upsert({
      user_id: userId, id: card.id, lesson_id: lessonId, markdown, position,
      updated_at: new Date().toISOString(),
    }));
    contentCache.remember(`card:${card.id}`, markdown);
  }

  async function saveLesson(courseId, lesson, position) {
    const content = JSON.stringify({ title: lesson.title, scratchpad: lesson.scratchpad });
    if (!contentCache.unchanged(`lesson:${lesson.id}`, content)) {
      unwrap(await client.from('lessons').upsert({
        user_id: userId, id: lesson.id, course_id: courseId, title: lesson.title,
        scratchpad: lesson.scratchpad, position, updated_at: new Date().toISOString(),
      }));
      contentCache.remember(`lesson:${lesson.id}`, content);
    }

    const cardIds = [];
    for (let i = 0; i < lesson.cards.length; i++) {
      await saveCard(lesson.id, lesson.cards[i], i);
      cardIds.push(lesson.cards[i].id);
    }
    await deleteStrayRows(client.from('cards').delete().eq('user_id', userId).eq('lesson_id', lesson.id), cardIds);
  }

  async function saveCourse(course, position) {
    const content = JSON.stringify({ params: course.params, timetable: course.timetable, active_lesson_id: course.activeLessonId });
    if (!contentCache.unchanged(`course:${course.id}`, content)) {
      unwrap(await client.from('courses').upsert({
        user_id: userId, id: course.id,
        code: course.params?.courseCode || null, name: course.params?.courseName || null,
        params: course.params, timetable: course.timetable, active_lesson_id: course.activeLessonId,
        position, updated_at: new Date().toISOString(),
      }));
      contentCache.remember(`course:${course.id}`, content);
    }

    const lessonIds = [];
    for (let i = 0; i < course.lessons.length; i++) {
      await saveLesson(course.id, course.lessons[i], i);
      lessonIds.push(course.lessons[i].id);
    }
    await deleteStrayRows(client.from('lessons').delete().eq('user_id', userId).eq('course_id', course.id), lessonIds);
  }

  async function save(state) {
    const courseIds = [];
    for (let i = 0; i < state.courses.length; i++) {
      await saveCourse(state.courses[i], i);
      courseIds.push(state.courses[i].id);
    }
    await deleteStrayRows(client.from('courses').delete().eq('user_id', userId), courseIds);

    unwrap(await client.from('user_state').upsert({
      user_id: userId, active_course_id: state.activeCourseId, updated_at: new Date().toISOString(),
    }));

    const profile = state.profile || {};
    const profileContent = JSON.stringify(profile);
    if (!contentCache.unchanged('profile', profileContent)) {
      unwrap(await client.from('profiles').upsert({
        user_id: userId,
        title: profile.title || null,
        first_name: profile.firstName || null,
        last_name: profile.lastName || null,
        job_title: profile.jobTitle || null,
        employer: profile.employer || null,
        avatar_path: profile.avatarSrc || null,
        updated_at: new Date().toISOString(),
      }));
      contentCache.remember('profile', profileContent);
    }
  }

  function describe() {
    return { label: 'cloud account' };
  }

  // Optional capability — course-builder.js's resolveImageSrc()/uploadImage()
  // check for this generically (see storage-adapter.js), the same as vault.
  // The one contract requirement: attachments.save() must return the same
  // course-relative "attachments/<hash>.<ext>" reference shape vault uses,
  // so that code needs no changes regardless of which backend is active.
  const resolvedUrls = new Map();

  const attachments = {
    async save(courseId, file) {
      const extension = IMAGE_EXTENSIONS[file.type];
      if (!extension) throw new Error('Only PNG, JPEG, WebP, GIF and SVG are accepted.');

      const filename = `${await hashFile(file)}.${extension}`;
      const path = `${userId}/${courseId}/${filename}`;
      const { error } = await client.storage.from('attachments').upload(path, file, { upsert: true, contentType: file.type });
      if (error) throw new Error(error.message);

      return { src: `attachments/${filename}` };
    },

    // Private bucket + signed URL, unlike vault's cached-forever object URL
    // — deliberately not cached past the signed URL's own expiry.
    async resolve(courseId, reference) {
      const cached = resolvedUrls.get(reference);
      if (cached && cached.expiresAt > Date.now()) return cached.url;

      const filename = reference.slice('attachments/'.length);
      const path = `${userId}/${courseId}/${filename}`;
      const { data, error } = await client.storage.from('attachments').createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
      if (error) throw new Error(error.message);

      resolvedUrls.set(reference, { url: data.signedUrl, expiresAt: Date.now() + (SIGNED_URL_TTL_SECONDS - 60) * 1000 });
      return data.signedUrl;
    },
  };

  // Optional capability, unscoped by course (unlike attachments above) —
  // one profile per signed-in user, not per course. Own resolvedUrls
  // cache: same idea as attachments', just a separate map since it's a
  // different bucket/reference namespace.
  const avatarResolvedUrls = new Map();

  const avatar = {
    async save(file) {
      const extension = AVATAR_EXTENSIONS[file.type];
      if (!extension) throw new Error('Only PNG, JPEG and WebP are accepted.');

      const filename = `${await hashFile(file)}.${extension}`;
      const path = `${userId}/${filename}`;
      const { error } = await client.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type });
      if (error) throw new Error(error.message);

      return { src: filename };
    },

    async resolve(reference) {
      const cached = avatarResolvedUrls.get(reference);
      if (cached && cached.expiresAt > Date.now()) return cached.url;

      const path = `${userId}/${reference}`;
      const { data, error } = await client.storage.from('avatars').createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
      if (error) throw new Error(error.message);

      avatarResolvedUrls.set(reference, { url: data.signedUrl, expiresAt: Date.now() + (SIGNED_URL_TTL_SECONDS - 60) * 1000 });
      return data.signedUrl;
    },
  };

  return { load, save, describe, attachments, avatar };
}
