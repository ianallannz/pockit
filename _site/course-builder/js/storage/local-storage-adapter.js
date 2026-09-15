// ── localStorage adapter ─────────────────────────────────────
// The original (and, outside Chromium, only) storage backend — a single
// JSON blob under one key. Implements the storage-adapter.js shape: see
// that file for what load()/save()/describe() are contracted to do.
//
// Also owns migrating the two schema versions this replaced (a single
// top-level course, and before that a single top-level lesson) — that
// migration is inherent to *this* format's history, not something a fresh
// vault-file backend would ever need to reproduce.
import { defaults } from '../params-defaults.js';

const STORAGE_KEY = 'pockit-course-builder';

// Cards saved before blocks existed have no blocks array.
function normalizeCards(list) {
  return (list || []).map(card => ({ ...card, blocks: card.blocks || [] }));
}

function normalizeLessons(list) {
  return (list || []).map(lesson => ({
    ...lesson,
    cards: normalizeCards(lesson.cards),
    scratchpad: lesson.scratchpad || [],
  }));
}

export function describe() {
  return { label: 'this browser only' };
}

export async function save(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export async function load() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    const saved = JSON.parse(raw);
    let courses;
    let activeCourseId;

    if (saved.courses) {
      // Merge over defaults so params added in later versions still resolve.
      courses = saved.courses.map(course => ({
        ...course,
        params: { ...defaults, ...(course.params || {}) },
        lessons: normalizeLessons(course.lessons),
        timetable: course.timetable || [],
      }));
      activeCourseId = saved.activeCourseId ?? courses[0]?.id ?? null;
    } else if (saved.lessons) {
      // Migrate the single-course schema this replaced: one course, holding
      // what was the top-level params and lesson set.
      courses = [{
        id: 1,
        params: { ...defaults, ...(saved.params || {}) },
        lessons: normalizeLessons(saved.lessons),
        activeLessonId: saved.activeLessonId,
        timetable: [],
      }];
      activeCourseId = 1;
    } else {
      // Migrate the original single-lesson schema, two versions back: one
      // course, one lesson (titled from the old params.lessonTitle),
      // holding what was the flat card set.
      courses = [{
        id: 1,
        params: { ...defaults, ...(saved.params || {}) },
        lessons: [{
          id: 1,
          title: saved.params?.lessonTitle || 'Untitled lesson',
          cards: normalizeCards(saved.cards),
          scratchpad: [],
        }],
        activeLessonId: 1,
        timetable: [],
      }];
      activeCourseId = 1;
    }

    const nextCourseId = saved.nextCourseId || courses.length + 1;
    const nextLessonId = saved.nextLessonId || courses.reduce((n, c) => n + c.lessons.length, 0) + 1;
    const nextId = saved.nextId
      || courses.reduce((n, c) => n + c.lessons.reduce((m, l) => m + l.cards.length, 0), 0) + 1;
    const nextBlockId = saved.nextBlockId
      || Math.max(0, ...courses.flatMap(c => c.lessons.flatMap(l => l.cards.flatMap(card => card.blocks.map(b => b.id || 0))))) + 1;
    const nextTimetableId = saved.nextTimetableId
      || Math.max(0, ...courses.flatMap(c => c.timetable.map(t => t.id || 0))) + 1;
    const nextNoteId = saved.nextNoteId
      || Math.max(0, ...courses.flatMap(c => c.lessons.flatMap(l => l.scratchpad.map(n => n.id || 0)))) + 1;

    // Profile fields (title/name/job/employer) predate this key too — an
    // absent one just means "nothing set yet", same spirit as the other
    // next*Id/course-shape defaults above. save()'s plain JSON.stringify
    // needs no matching change: whatever's in state.profile round-trips
    // through this backend for free.
    const profile = saved.profile || {};

    return { courses, activeCourseId, nextId, nextBlockId, nextLessonId, nextCourseId, nextTimetableId, nextNoteId, profile };
  } catch {
    console.warn('[course-builder] Could not read saved state, starting fresh.');
    return null;
  }
}
