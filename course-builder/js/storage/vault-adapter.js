// ── Vault adapter ─────────────────────────────────────────────
// Reads/writes a course vault — a folder of files, chosen by the user via
// the File System Access API — implementing the storage-adapter.js shape.
// See card-format.md / the session's architecture notes for the layout:
//
//   <vault-root>/
//     <course-slug>/
//       course.yml                 — params, timetable, activeLessonId
//       lessons/
//         <lesson-slug>/
//           lesson.yml             — title, scratchpad, ordered card ids
//           cards/
//             card-<id>.md         — one file per card, via card-format.js
//
// A factory (createVaultAdapter(rootHandle)) rather than a singleton module,
// so each connected vault gets its own independent slug/content caches, and
// so this is trivially unit-testable against a plain-object mock of the
// FileSystemDirectoryHandle subset used here (getDirectoryHandle,
// getFileHandle, entries, removeEntry — see test/vault-adapter.test.js).
import { load as yamlLoad, dump as yamlDump } from 'js-yaml';
import { parse as parseCard, serialize as serializeCard } from '../../../_lib/card-format.js';
import { defaults } from '../params-defaults.js';

// Extension comes from the content type, never from the uploaded filename —
// same convention as the dev-server's lib/image-upload.js, which this
// mirrors so a vault-relative reference (attachments/<hash>.<ext>) means
// the same thing regardless of which backend produced it.
const IMAGE_EXTENSIONS = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg',
};

// Narrower than IMAGE_EXTENSIONS (no SVG/GIF) — this is a photo, not an
// arbitrary card image.
const AVATAR_EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

async function hashFile(file) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
}

function slugify(text) {
  return String(text || '').toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || 'untitled';
}

function uniqueSlug(base, taken) {
  let slug = base;
  let n = 2;
  while (taken.has(slug)) slug = `${base}-${n++}`;
  taken.add(slug);
  return slug;
}

async function readTextIfExists(dirHandle, name) {
  try {
    const fileHandle = await dirHandle.getFileHandle(name);
    return await (await fileHandle.getFile()).text();
  } catch {
    return null;
  }
}

async function getSubdirIfExists(dirHandle, name) {
  try {
    return await dirHandle.getDirectoryHandle(name);
  } catch {
    return null;
  }
}

async function listEntryNames(dirHandle) {
  const names = [];
  for await (const name of dirHandle.keys()) names.push(name);
  return names;
}

// Removes any entry not in `expected`, so a course/lesson/card deleted in
// the app disappears from disk too, not just the ones still in state.
async function removeStrayEntries(dirHandle, expected) {
  for (const name of await listEntryNames(dirHandle)) {
    if (!expected.has(name)) await dirHandle.removeEntry(name, { recursive: true });
  }
}

// Copies one entry, file or subdirectory, recursively, from srcParent to
// destParent under the same name. Tells file from directory by which
// accessor doesn't throw rather than a `.kind` check, so this works against
// both the real API and the plain-object test mock.
async function copyEntry(srcParent, destParent, name) {
  try {
    const fileHandle = await srcParent.getFileHandle(name);
    const file = await fileHandle.getFile();
    // Real File objects (images) write straight through; the test mock's
    // text files come back as a plain {text()} wrapper rather than a Blob,
    // so those need unwrapping first.
    const content = file instanceof Blob ? file : await file.text();
    const destHandle = await destParent.getFileHandle(name, { create: true });
    const writable = await destHandle.createWritable();
    await writable.write(content);
    await writable.close();
  } catch {
    const srcDir = await srcParent.getDirectoryHandle(name);
    const destDir = await destParent.getDirectoryHandle(name, { create: true });
    for await (const childName of srcDir.keys()) await copyEntry(srcDir, destDir, childName);
  }
}

// The File System Access API has no native rename, so this copies the
// directory's contents to a freshly created sibling and removes the
// original — used when a course/lesson's slug source (title, courseCode)
// changes and its folder should follow.
async function renameDirectory(parentDir, oldName, newName) {
  const srcDir = await parentDir.getDirectoryHandle(oldName);
  const destDir = await parentDir.getDirectoryHandle(newName, { create: true });
  for await (const childName of srcDir.keys()) await copyEntry(srcDir, destDir, childName);
  await parentDir.removeEntry(oldName, { recursive: true });
}

// FileSystemWritableFileStream writes to a swap file and only replaces the
// real one on close() — that's the atomic write, no temp-file dance needed
// here. Content is skipped entirely when unchanged since the last read or
// write this adapter instance has seen, so an edit to one card doesn't
// rewrite every other file's mtime (and every other file's line in a git
// diff) on every autosave.
function makeContentCache() {
  const lastSeen = new Map();
  return {
    unchanged: (key, content) => lastSeen.get(key) === content,
    remember: (key, content) => lastSeen.set(key, content),
  };
}

async function writeIfChanged(dirHandle, filename, content, cache, cacheKey) {
  if (cache.unchanged(cacheKey, content)) return;
  const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
  cache.remember(cacheKey, content);
}

function stripBlockId({ id, ...rest }) {
  return rest;
}

// A card's id is always the filename's source of truth (matched back out
// by this regex) — the slug suffix is only there for someone browsing the
// vault folder directly, same spirit as the lesson/course folder names.
const CARD_FILENAME_RE = /^card-(\d+)(?:-.*)?\.md$/;

function cardFilename(id, title) {
  const slug = title ? slugify(title) : '';
  return slug ? `card-${id}-${slug}.md` : `card-${id}.md`;
}

export function createVaultAdapter(rootHandle) {
  // Learned from the last load()/save() — folder *names* aren't identity,
  // so writes go back to the folder a course/lesson was actually found in
  // rather than recomputing a fresh slug on every save. The folder is only
  // renamed (via renameDirectory, above) when the field it was slugified
  // from — courseCode/courseName, or a lesson's title — actually changes
  // since the last save (tracked in *SlugBasisById below), so a human's
  // manual rename in Finder is left alone until the app has its own reason
  // to touch that folder again.
  const courseFolderById = new Map();
  const lessonFolderById = new Map();
  const courseSlugBasisById = new Map();
  const lessonSlugBasisById = new Map();
  const cardFileById = new Map();
  const cardSlugBasisById = new Map();
  const contentCache = makeContentCache();

  async function loadCard(cardsDir, cardId, filename) {
    const text = await readTextIfExists(cardsDir, filename);
    if (text === null) return null;
    contentCache.remember(`card:${cardId}`, text);
    const { frontmatter, blocks } = parseCard(text);
    cardFileById.set(cardId, filename);
    cardSlugBasisById.set(cardId, frontmatter.title);
    return {
      id: cardId,
      title: frontmatter.title || undefined,
      teacherOverview: frontmatter.teacherOverview || undefined,
      blocks,
    };
  }

  async function loadLesson(lessonDir, folderName) {
    const raw = await readTextIfExists(lessonDir, 'lesson.yml');
    if (raw === null) return null;
    contentCache.remember(`lesson:meta:${folderName}`, raw);
    const meta = yamlLoad(raw) || {};

    const cardsDir = await getSubdirIfExists(lessonDir, 'cards');
    const cardFilenames = new Map();
    if (cardsDir) {
      for (const name of await listEntryNames(cardsDir)) {
        const match = name.match(CARD_FILENAME_RE);
        if (match) cardFilenames.set(Number(match[1]), name);
      }
    }
    const cards = [];
    for (const cardId of meta.cards || []) {
      const filename = cardFilenames.get(cardId);
      const card = filename && await loadCard(cardsDir, cardId, filename);
      if (card) cards.push(card);
    }

    lessonFolderById.set(meta.id, folderName);
    lessonSlugBasisById.set(meta.id, meta.title || 'Untitled lesson');
    return { id: meta.id, title: meta.title || 'Untitled lesson', scratchpad: meta.scratchpad || [], cards };
  }

  async function loadCourse(courseDir, folderName) {
    const raw = await readTextIfExists(courseDir, 'course.yml');
    if (raw === null) return null;
    contentCache.remember(`course:meta:${folderName}`, raw);
    const meta = yamlLoad(raw) || {};

    const lessonsDir = await getSubdirIfExists(courseDir, 'lessons');
    let lessons = [];
    if (lessonsDir) {
      for (const name of await listEntryNames(lessonsDir)) {
        const lessonDir = await getSubdirIfExists(lessonsDir, name);
        const lesson = lessonDir && await loadLesson(lessonDir, name);
        if (lesson) lessons.push(lesson);
      }
    }
    // Directory listing order isn't the lesson order — course.yml's own
    // `lessons` id list is authoritative; anything it doesn't mention (an
    // older vault saved before this list existed, or a folder added by
    // hand) is appended in whatever order it was found in.
    if (meta.lessons) {
      const byId = new Map(lessons.map(lesson => [lesson.id, lesson]));
      const known = new Set(meta.lessons);
      lessons = meta.lessons.map(id => byId.get(id)).filter(Boolean)
        .concat(lessons.filter(lesson => !known.has(lesson.id)));
    }

    const params = { ...defaults, ...(meta.params || {}) };
    courseFolderById.set(meta.id, folderName);
    courseSlugBasisById.set(meta.id, params.courseCode || params.courseName || 'course');
    return {
      id: meta.id,
      params,
      timetable: meta.timetable || [],
      activeLessonId: meta.activeLessonId,
      lessons,
    };
  }

  async function load() {
    const raw = await readTextIfExists(rootHandle, 'vault.yml');
    const vaultMeta = raw ? (yamlLoad(raw) || {}) : {};
    if (raw !== null) contentCache.remember('vault:meta', raw);

    // Root-level, not per-course — one person's identity used across every
    // course in this vault, same idea as vault.yml's own activeCourseId.
    const profileRaw = await readTextIfExists(rootHandle, 'profile.yml');
    const profile = profileRaw ? (yamlLoad(profileRaw) || {}) : {};
    if (profileRaw !== null) contentCache.remember('profile:meta', profileRaw);

    const courses = [];
    for (const name of await listEntryNames(rootHandle)) {
      const courseDir = await getSubdirIfExists(rootHandle, name);
      const course = courseDir && await loadCourse(courseDir, name);
      if (course) courses.push(course);
    }

    if (courses.length === 0) return null;

    const nextCourseId = Math.max(0, ...courses.map(c => c.id || 0)) + 1;
    const nextLessonId = Math.max(0, ...courses.flatMap(c => c.lessons.map(l => l.id || 0))) + 1;
    const nextId = Math.max(0, ...courses.flatMap(c => c.lessons.flatMap(l => l.cards.map(card => card.id || 0)))) + 1;
    const nextTimetableId = Math.max(0, ...courses.flatMap(c => c.timetable.map(t => t.id || 0))) + 1;
    const nextNoteId = Math.max(0, ...courses.flatMap(c => c.lessons.flatMap(l => l.scratchpad.map(n => n.id || 0)))) + 1;
    // Blocks have no persisted id (card-format.js's block shape is content
    // only) — freshly assigned here, unique for this load, same spirit as
    // local-storage-adapter's own fallback for blocks that predate ids.
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
      activeCourseId: vaultMeta.activeCourseId ?? courses[0]?.id ?? null,
      nextId, nextBlockId: nextBlockAssign, nextLessonId, nextCourseId, nextTimetableId, nextNoteId,
      profile,
    };
  }

  async function saveCard(cardsDir, card) {
    let filename = cardFileById.get(card.id);
    if (!filename || card.title !== cardSlugBasisById.get(card.id)) {
      const desired = cardFilename(card.id, card.title);
      if (filename && filename !== desired) await cardsDir.removeEntry(filename).catch(() => {});
      filename = desired;
      cardFileById.set(card.id, filename);
    }
    cardSlugBasisById.set(card.id, card.title);

    const frontmatter = {};
    if (card.title) frontmatter.title = card.title;
    if (card.teacherOverview) frontmatter.teacherOverview = card.teacherOverview;
    const markdown = serializeCard({ frontmatter, blocks: card.blocks.map(stripBlockId) });
    await writeIfChanged(cardsDir, filename, markdown, contentCache, `card:${card.id}`);
    return filename;
  }

  async function saveLesson(lessonsDir, lesson) {
    let folderName = lessonFolderById.get(lesson.id);
    if (!folderName) {
      const taken = new Set(await listEntryNames(lessonsDir));
      folderName = uniqueSlug(slugify(lesson.title), taken);
      lessonFolderById.set(lesson.id, folderName);
    } else if (lesson.title !== lessonSlugBasisById.get(lesson.id)) {
      const taken = new Set(await listEntryNames(lessonsDir));
      taken.delete(folderName);
      const desiredSlug = uniqueSlug(slugify(lesson.title), taken);
      if (desiredSlug !== folderName) {
        await renameDirectory(lessonsDir, folderName, desiredSlug);
        folderName = desiredSlug;
        lessonFolderById.set(lesson.id, folderName);
      }
    }
    lessonSlugBasisById.set(lesson.id, lesson.title);

    const lessonDir = await lessonsDir.getDirectoryHandle(folderName, { create: true });
    const meta = { id: lesson.id, title: lesson.title, scratchpad: lesson.scratchpad, cards: lesson.cards.map(c => c.id) };
    await writeIfChanged(lessonDir, 'lesson.yml', yamlDump(meta, { lineWidth: -1 }), contentCache, `lesson:meta:${folderName}`);

    const cardsDir = await lessonDir.getDirectoryHandle('cards', { create: true });
    const cardFilenames = new Set();
    for (const card of lesson.cards) cardFilenames.add(await saveCard(cardsDir, card));
    await removeStrayEntries(cardsDir, cardFilenames);

    return folderName;
  }

  async function saveCourse(course) {
    const slugSource = course.params?.courseCode || course.params?.courseName || 'course';
    let folderName = courseFolderById.get(course.id);
    if (!folderName) {
      const taken = new Set(await listEntryNames(rootHandle));
      folderName = uniqueSlug(slugify(slugSource), taken);
      courseFolderById.set(course.id, folderName);
    } else if (slugSource !== courseSlugBasisById.get(course.id)) {
      const taken = new Set(await listEntryNames(rootHandle));
      taken.delete(folderName);
      const desiredSlug = uniqueSlug(slugify(slugSource), taken);
      if (desiredSlug !== folderName) {
        await renameDirectory(rootHandle, folderName, desiredSlug);
        folderName = desiredSlug;
        courseFolderById.set(course.id, folderName);
      }
    }
    courseSlugBasisById.set(course.id, slugSource);

    const courseDir = await rootHandle.getDirectoryHandle(folderName, { create: true });
    const meta = {
      id: course.id, params: course.params, timetable: course.timetable, activeLessonId: course.activeLessonId,
      lessons: course.lessons.map(l => l.id),
    };
    await writeIfChanged(courseDir, 'course.yml', yamlDump(meta, { lineWidth: -1 }), contentCache, `course:meta:${folderName}`);

    const lessonsDir = await courseDir.getDirectoryHandle('lessons', { create: true });
    const lessonFolders = new Set();
    for (const lesson of course.lessons) lessonFolders.add(await saveLesson(lessonsDir, lesson));
    await removeStrayEntries(lessonsDir, lessonFolders);

    return folderName;
  }

  async function save(state) {
    // vault.yml/profile.yml/the avatar file are root-level entries, same as
    // any course folder — removeStrayEntries below has to know they're
    // wanted too, or it deletes them as stray on every save after the
    // first (they're written *after* this call, so on save #1 they don't
    // exist yet to be caught by it either way, but from save #2 onward
    // they're real entries the previous save created, sitting right next
    // to the course folders, and courseFolders alone doesn't mention them).
    const rootEntries = new Set(['vault.yml', 'profile.yml']);
    if (state.profile?.avatarSrc) rootEntries.add(state.profile.avatarSrc);

    for (const course of state.courses) rootEntries.add(await saveCourse(course));
    await removeStrayEntries(rootHandle, rootEntries);

    const vaultMeta = { activeCourseId: state.activeCourseId };
    await writeIfChanged(rootHandle, 'vault.yml', yamlDump(vaultMeta, { lineWidth: -1 }), contentCache, 'vault:meta');

    await writeIfChanged(rootHandle, 'profile.yml', yamlDump(state.profile || {}, { lineWidth: -1 }), contentCache, 'profile:meta');
  }

  function describe() {
    return { label: rootHandle.name || 'chosen folder' };
  }

  // Optional capability — course-builder.js's resolveImageSrc()/uploadImage()
  // check for this before falling back to the dev-server upload path, so a
  // backend without it (local-storage-adapter.js) just keeps working as
  // before. Images are content-addressed the same way the dev server's
  // lib/image-upload.js already does, and each vault-relative reference
  // resolves to a cached object URL — revoked never, which is fine for one
  // page session's worth of images.
  const resolvedUrls = new Map();

  async function getAttachmentsDir(courseId) {
    const folderName = courseFolderById.get(courseId);
    if (!folderName) throw new Error('This course has not been saved to the vault yet.');
    const courseDir = await rootHandle.getDirectoryHandle(folderName, { create: true });
    return courseDir.getDirectoryHandle('attachments', { create: true });
  }

  const attachments = {
    async save(courseId, file) {
      const extension = IMAGE_EXTENSIONS[file.type];
      if (!extension) throw new Error('Only PNG, JPEG, WebP, GIF and SVG are accepted.');

      const filename = `${await hashFile(file)}.${extension}`;
      const dir = await getAttachmentsDir(courseId);
      const fileHandle = await dir.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(file);
      await writable.close();

      return { src: `attachments/${filename}` };
    },

    async resolve(courseId, reference) {
      if (resolvedUrls.has(reference)) return resolvedUrls.get(reference);

      const dir = await getAttachmentsDir(courseId);
      const filename = reference.slice('attachments/'.length);
      const fileHandle = await dir.getFileHandle(filename);
      const url = URL.createObjectURL(await fileHandle.getFile());
      resolvedUrls.set(reference, url);
      return url;
    },
  };

  // Optional capability, unscoped by course (unlike attachments above) —
  // one profile per vault, not per course. Own resolvedUrls cache: same
  // idea as attachments', just a separate map since the two reference
  // namespaces could otherwise collide (a course attachment named exactly
  // "avatar.png" isn't possible — those are always "attachments/<hash>.<ext>"
  // — but keeping them apart is simpler than reasoning about why not).
  const avatarResolvedUrls = new Map();

  const avatar = {
    async save(file) {
      const extension = AVATAR_EXTENSIONS[file.type];
      if (!extension) throw new Error('Only PNG, JPEG and WebP are accepted.');

      // Fixed basename, not content-addressed like attachments/ — there's
      // only ever one avatar per vault, so replacing it should replace it,
      // not accumulate old versions. Old extension removed first in case
      // this upload's type differs from last time's (avatar.png -> .jpg).
      for (const name of await listEntryNames(rootHandle)) {
        if (/^avatar\.[a-z0-9]+$/i.test(name)) await rootHandle.removeEntry(name).catch(() => {});
      }

      const filename = `avatar.${extension}`;
      const fileHandle = await rootHandle.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(file);
      await writable.close();

      return { src: filename };
    },

    async resolve(reference) {
      if (avatarResolvedUrls.has(reference)) return avatarResolvedUrls.get(reference);

      const fileHandle = await rootHandle.getFileHandle(reference);
      const url = URL.createObjectURL(await fileHandle.getFile());
      avatarResolvedUrls.set(reference, url);
      return url;
    },
  };

  return { load, save, describe, attachments, avatar };
}
