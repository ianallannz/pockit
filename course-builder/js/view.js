// ── Pockit — Shared course viewer ────────────────────────────
// Read-only counterpart to course-builder.js — see the plan at
// /home/ian/.claude/plans/graceful-exploring-cosmos.md. No save(), no
// render() in the editor's sense, no editing affordances anywhere: every
// card here is built via buildCard(..., { interactive: false }), which
// structurally cannot write (see render-card.js's own header comment for
// why that's safe even though the same block-editor code is reused
// unchanged). Postgres RLS is the real access boundary regardless — see
// supabase/schema.sql's course_invites policies — this page just reflects
// back whatever that grants.
import { buildCard, configureRenderCard, paintPresentSlide } from './render-card.js';
import { createSupabaseAdapter } from './storage/supabase-adapter.js';
import { getSupabaseClient } from './storage/supabase-client.js';
import { listMyInvites, acceptInvite } from './storage/course-invites.js';
import { isSupabaseConfigured } from './config/supabase-config.js';
import {
  getCurrentUser, signInWithEmail, signOut, trySessionRestore, onAuthStateChange,
} from './auth/auth.js';

// ── State ─────────────────────────────────────────────────────
let client = null;
let user = null;

// One entry per (owner, course) this account can currently see — either
// via an accepted invite, or (see loadEverything()'s own comment) because
// the URL is the owner previewing their own course. `adapter` is only
// ever used for its .attachments capability here (see resolveImageSrc()
// below); its .load()/.save() write paths are simply never called.
let sharedCourses = [];
let pendingInvites = [];

let activeOwnerId = null;
let activeCourseId = null;
let activeLessonId = null;

function activeEntry() {
  return sharedCourses.find(e => e.ownerId === activeOwnerId && e.course.id === activeCourseId) || null;
}
function activeCourseObj() {
  return activeEntry()?.course || null;
}
function activeLesson() {
  const course = activeCourseObj();
  if (!course) return null;
  return course.lessons.find(l => l.id === activeLessonId) || course.lessons[0] || null;
}

// A running count across every lesson in the course, in lesson/card order
// — same definition as course-builder.js's own coursePageNumber(), just
// taking `course` as an argument instead of reading module state (this
// page can have more than one course loaded, so there's no single
// "active" course to read implicitly the way the editor has).
function coursePageNumber(course, card) {
  return course.lessons.flatMap(l => l.cards).findIndex(c => c.id === card.id) + 1;
}

// Copy of course-builder.js's own tint() — small and pure enough that
// importing it from there isn't worth the coupling for four lines.
function tint(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// Same tokens readParams() sets on the editor's #workspace-inner/
// #present-view — see buildCard()'s own CSS for --card-pad/--card-line
// (set inline, per-card) versus these (inherited from an ancestor, so
// they only need setting once per course switch).
function applyCourseTokens(params) {
  const workspaceInner = document.getElementById('workspace-inner');
  workspaceInner.style.setProperty('--punch-color', params.punchColor);
  workspaceInner.style.setProperty('--task-tint', tint(params.punchColor, 0.12));
  workspaceInner.style.setProperty('--card-ratio', `${params.cardWidth} / ${params.cardHeight}`);

  const presentView = document.getElementById('present-view');
  presentView.style.setProperty('--punch-color', params.punchColor);
  presentView.style.setProperty('--card-ratio', `${params.cardWidth} / ${params.cardHeight}`);

  // Same story again for #sidebar — also a sibling, not a descendant, of
  // #workspace-inner, and the active lesson row's own card-shaped mark
  // (see .lesson-drag-handle in style.css) needs --card-ratio to reach it.
  const sidebar = document.getElementById('sidebar');
  sidebar.style.setProperty('--punch-color', params.punchColor);
  sidebar.style.setProperty('--card-ratio', `${params.cardWidth} / ${params.cardHeight}`);
}

// The only render-card.js hook this page ever needs for real: every other
// hook (save, removeBlock, openImageEditor, ...) stays at its harmless
// no-op default, since interactive: false means the listeners that would
// call them can never fire — but resolveImageSrc() is called directly
// while *building* a card, to fill in an <img src>, so it has to actually
// work even in a strictly read-only view. Reads activeEntry() at call
// time (not a fixed owner) — same reasoning as course-builder.js's own
// resolveImageSrc() reading activeCourse() at call time instead of
// capturing it up front, since this page can have more than one owner's
// courses loaded, just never more than one showing on screen at once.
async function resolveImageSrc(reference) {
  if (!reference) return '';
  const entry = activeEntry();
  if (entry?.adapter.attachments && reference.startsWith('attachments/')) {
    return entry.adapter.attachments.resolve(activeCourseId, reference);
  }
  return reference;
}
configureRenderCard({ resolveImageSrc });

function buildViewEmptyState(message) {
  const p = document.createElement('p');
  p.className = 'view-empty';
  p.textContent = message;
  return p;
}

// ── Course/lesson selection ──────────────────────────────────
// Same "code · name" join courseLabel() uses in the editor.
function courseLabel(course) {
  return [course.params.courseCode, course.params.courseName].filter(Boolean).join(' · ')
    || 'Untitled course';
}

// course.id is only unique per owner, not globally — option values are
// "ownerId:courseId" pairs, parsed back on change.
function renderCourseSelect() {
  const select = document.getElementById('view-course-select');
  select.replaceChildren();
  sharedCourses.forEach(entry => {
    const option = document.createElement('option');
    option.value = `${entry.ownerId}:${entry.course.id}`;
    option.textContent = courseLabel(entry.course);
    option.selected = entry.ownerId === activeOwnerId && entry.course.id === activeCourseId;
    select.appendChild(option);
  });
}

function renderLessonList() {
  const list = document.getElementById('lesson-list');
  list.replaceChildren();
  const course = activeCourseObj();
  if (!course) return;

  course.lessons.forEach(lesson => {
    const row = document.createElement('div');
    row.className = `lesson-row${lesson.id === activeLessonId ? ' is-active' : ''}`;

    const mark = document.createElement('span');
    mark.className = 'lesson-mark';
    row.appendChild(mark);

    const title = document.createElement('span');
    title.className = 'lesson-row-title';
    title.textContent = lesson.title || 'Untitled lesson';
    row.appendChild(title);

    const count = document.createElement('span');
    count.className = 'lesson-row-count';
    count.textContent = lesson.cards.length;
    row.appendChild(count);

    row.addEventListener('click', () => switchLesson(lesson.id));
    list.appendChild(row);
  });
}

// ── Card strip (on-screen browsing) ──────────────────────────
function renderCardStrip() {
  const strip = document.getElementById('card-strip');
  strip.replaceChildren();

  const course = activeCourseObj();
  const lesson = activeLesson();
  document.getElementById('workspaceLessonTitle').value = lesson ? (lesson.title || 'Untitled lesson') : '';

  if (!course) return;
  if (!lesson || !lesson.cards.length) {
    strip.appendChild(buildViewEmptyState(
      lesson ? 'This lesson has no cards yet.' : 'This course has no lessons yet.'
    ));
    return;
  }

  lesson.cards.forEach((card, index) => {
    const slot = document.createElement('div');
    slot.className = 'card-slot';
    const frame = document.createElement('div');
    frame.className = 'card-frame';
    frame.appendChild(buildCard(card, index, course.params, {
      interactive: false,
      lessonTitle: lesson.title,
      totalCards: lesson.cards.length,
      pageNumber: coursePageNumber(course, card),
    }));
    slot.appendChild(frame);
    strip.appendChild(slot);
  });
}

function switchLesson(id) {
  if (id === activeLessonId) return;
  activeLessonId = id;
  renderLessonList();
  renderCardStrip();
}

function switchCourse(ownerId, courseId) {
  activeOwnerId = ownerId;
  activeCourseId = courseId;
  const course = activeCourseObj();
  activeLessonId = course?.activeLessonId ?? course?.lessons[0]?.id ?? null;
  if (course) applyCourseTokens(course.params);
  renderCourseSelect();
  renderLessonList();
  renderCardStrip();
}

// ── Pending invites ───────────────────────────────────────────
// A pending invite can't show its course's title/code — RLS only grants
// read access to courses/lessons/cards once the invite is accepted (see
// "viewer read access" in schema.sql), so there is genuinely nothing more
// to show here yet than the invite itself. Accepting immediately reloads
// everything, which is what actually reveals the course.
function renderPendingInvites() {
  const group = document.getElementById('view-pending-group');
  const list = document.getElementById('view-pending-list');
  list.replaceChildren();
  group.hidden = pendingInvites.length === 0;
  pendingInvites.forEach(invite => list.appendChild(buildPendingRow(invite)));
}

function buildPendingRow(invite) {
  const row = document.createElement('div');
  row.className = 'view-pending-row';

  const label = document.createElement('span');
  label.className = 'view-pending-label';
  label.textContent = invite.invitedAs ? `Invitation (${invite.invitedAs})` : 'Invitation to a course';
  row.appendChild(label);

  const accept = document.createElement('button');
  accept.type = 'button';
  accept.className = 'view-accept-btn';
  accept.textContent = 'Accept';
  accept.addEventListener('click', async () => {
    accept.disabled = true;
    try {
      await acceptInvite(client, invite.id, user.id, user.email);
      await loadEverything();
    } catch (error) {
      accept.disabled = false;
      label.textContent = error.message;
    }
  });
  row.appendChild(accept);

  return row;
}

// A distinct look from buildViewEmptyState()'s neutral "nothing here yet"
// message — this is loadEverything() actually failing (a real Supabase/
// network error), not a legitimately empty account, so it reads as a
// problem rather than a normal state.
function buildViewErrorState(message) {
  const p = document.createElement('p');
  p.className = 'view-error';
  p.textContent = message;
  return p;
}

// ── Load ──────────────────────────────────────────────────────
async function loadEverything() {
  user = getCurrentUser();
  client = await getSupabaseClient();
  if (!user || !client) return;

  document.getElementById('account-status-label').textContent = `Signed in: ${user.email}`;

  // Every call below can fail for reasons entirely outside this page's
  // control (a network drop, a Supabase-side hiccup, RLS/schema not fully
  // applied yet) — without this, an uncaught rejection here left the whole
  // shell blank with nothing telling the user why (course select empty,
  // no lessons, no cards, no error in sight). Surfacing it in #card-strip
  // means it shows up exactly where the missing content would otherwise
  // silently not be.
  try {
    // "Preview as viewer" (see openViewerPreview() in course-builder.js)
    // links straight to an owner's own course, no invite involved — RLS's
    // "owner full access" already lets them read it, same as their own
    // editor would. Adding their own id here, only when the URL actually
    // asks for it, is what makes that path work without course_invites
    // ever needing a self-invite row.
    const query = new URLSearchParams(location.search);
    const previewOwnerId = query.get('owner');
    const selfPreview = !!previewOwnerId && previewOwnerId === user.id;

    // Pending invites are about *other* owners' courses shared with this
    // account — irrelevant noise while previewing your own course, and
    // Sign out is a genuinely bad exit here too (see #view-preview-banner's
    // own comment in index.html for why), so both get replaced by the
    // preview banner's own "Close preview" instead.
    document.getElementById('view-preview-banner').hidden = !selfPreview;
    document.getElementById('account-status').hidden = selfPreview;

    const invites = await listMyInvites(client);
    pendingInvites = invites.filter(i => i.status === 'pending');
    const acceptedOwnerIds = new Set(invites.filter(i => i.status === 'accepted').map(i => i.ownerId));
    if (selfPreview) {
      document.getElementById('view-pending-group').hidden = true;
    } else {
      renderPendingInvites();
    }

    const ownerIds = new Set(acceptedOwnerIds);
    if (selfPreview) ownerIds.add(previewOwnerId);

    sharedCourses = [];
    for (const ownerId of ownerIds) {
      const adapter = createSupabaseAdapter(client, ownerId);
      const state = await adapter.load();
      for (const course of state?.courses || []) {
        sharedCourses.push({ ownerId, adapter, course });
      }
    }

    if (!sharedCourses.length) {
      activeOwnerId = null;
      activeCourseId = null;
      activeLessonId = null;
      renderCourseSelect();
      document.getElementById('lesson-list').replaceChildren();
      document.getElementById('workspaceLessonTitle').value = '';
      document.getElementById('card-strip').replaceChildren(
        buildViewEmptyState('No courses have been shared with you yet.')
      );
      return;
    }

    const previewCourseId = query.get('course') ? Number(query.get('course')) : null;
    const requested = previewOwnerId && previewCourseId != null
      ? sharedCourses.find(e => e.ownerId === previewOwnerId && e.course.id === previewCourseId)
      : null;
    const stillActive = sharedCourses.find(e => e.ownerId === activeOwnerId && e.course.id === activeCourseId);
    const chosen = requested || stillActive || sharedCourses[0];
    switchCourse(chosen.ownerId, chosen.course.id);
  } catch (error) {
    document.getElementById('card-strip').replaceChildren(buildViewErrorState(error.message));
  }
}

// ── Present ──────────────────────────────────────────────────
// Same shape as course-builder.js's own openPresentView()/
// closePresentView()/presentStep() — view state, not worth sharing; the
// actual slide content is painted by the one piece that IS shared, see
// paintPresentSlide() in render-card.js.
let presentIndex = 0;

function openPresentView() {
  const lesson = activeLesson();
  if (!lesson || !lesson.cards.length) return;
  presentIndex = 0;
  document.getElementById('present-view').hidden = false;
  renderPresentSlide();
  document.documentElement.requestFullscreen?.().catch(() => {});
}

function closePresentView() {
  document.getElementById('present-view').hidden = true;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

function renderPresentSlide() {
  const lesson = activeLesson();
  const course = activeCourseObj();
  const total = lesson?.cards.length || 0;
  if (total === 0) { closePresentView(); return; }
  presentIndex = Math.max(0, Math.min(presentIndex, total - 1));
  paintPresentSlide(lesson.cards[presentIndex], {
    index: presentIndex, total, lessonTitle: lesson.title,
    courseCode: course.params.courseCode, courseName: course.params.courseName,
  });
}

function presentStep(delta) {
  presentIndex += delta;
  renderPresentSlide();
}

// ── Print ────────────────────────────────────────────────────
// Simpler than the editor's own buildPrintPages(): always the active
// lesson's cards (matching what the on-screen strip is already showing),
// three per page — no whole-course/cover/blank-overleaf options. Cards
// are already interactive: false, so — unlike the editor — there's no
// editing chrome for print.css to hide in the first place.
function buildViewerPrintPages() {
  const root = document.getElementById('print-root');
  root.replaceChildren();

  const course = activeCourseObj();
  const lesson = activeLesson();
  if (!course || !lesson) return;

  const cardEls = lesson.cards.map((card, index) => buildCard(card, index, course.params, {
    interactive: false,
    lessonTitle: lesson.title,
    totalCards: lesson.cards.length,
    pageNumber: coursePageNumber(course, card),
  }));

  for (let i = 0; i < cardEls.length; i += 3) {
    const page = document.createElement('div');
    page.className = 'print-page';
    for (const el of cardEls.slice(i, i + 3)) page.appendChild(el);
    root.appendChild(page);
  }
}
window.addEventListener('beforeprint', buildViewerPrintPages);

// ── Sign-in gate ──────────────────────────────────────────────
function showSignedIn() {
  document.getElementById('view-signin').hidden = true;
  document.getElementById('view-app').hidden = false;
}

function showSignedOut() {
  document.getElementById('view-signin').hidden = false;
  document.getElementById('view-app').hidden = true;
}

async function sendViewSignInLink() {
  const email = document.getElementById('viewSignInEmail').value.trim();
  const status = document.getElementById('viewSignInStatus');
  if (!email) return;
  try {
    await signInWithEmail(email);
    status.textContent = 'Check your email for a sign-in link.';
  } catch (error) {
    status.textContent = error.message;
  }
}

// ── Wiring ───────────────────────────────────────────────────
document.getElementById('viewSignInBtn').addEventListener('click', sendViewSignInLink);
document.getElementById('viewSignInEmail').addEventListener('keydown', event => {
  if (event.key === 'Enter') sendViewSignInLink();
});
document.getElementById('account-status-action').addEventListener('click', () => signOut());
// Only ever reachable via openViewerPreview()'s window.open(), which is
// exactly what makes window.close() work here — a script can only close a
// tab/window it opened itself.
document.getElementById('view-preview-close').addEventListener('click', () => window.close());

document.getElementById('view-course-select').addEventListener('change', event => {
  const [ownerId, courseId] = event.target.value.split(':');
  switchCourse(ownerId, Number(courseId));
});

document.getElementById('present-btn').addEventListener('click', openPresentView);
document.getElementById('present-close').addEventListener('click', closePresentView);
document.getElementById('present-prev').addEventListener('click', () => presentStep(-1));
document.getElementById('present-next').addEventListener('click', () => presentStep(1));
document.addEventListener('keydown', event => {
  if (document.getElementById('present-view').hidden) return;
  if (event.key === 'Escape') closePresentView();
  else if (event.key === 'ArrowRight' || event.key === ' ') presentStep(1);
  else if (event.key === 'ArrowLeft') presentStep(-1);
});
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && !document.getElementById('present-view').hidden) closePresentView();
});

document.getElementById('print-btn').addEventListener('click', () => window.print());

// Two-finger trackpad scroll — indistinguishable at the DOM level from a
// plain mouse wheel, so this responds to either — switches lessons up/down,
// leaving horizontal scroll to move between cards as it already does. Same
// shape as course-builder.js's own version, just reading this page's own
// activeCourseObj()/activeLessonId instead of module-level lessons/
// activeLessonId, and with no drag-in-progress guard (nothing here is ever
// draggable — see render-card.js's own header comment on interactive:
// false). One gesture fires many small wheel events rather than one, so
// deltaY accumulates until it crosses a threshold before acting; a short
// cooldown after that stops the rest of the same swipe from flying through
// several lessons at once. No wrap at the first/last lesson — it just
// stops there.
let lessonScrollAccum = 0;
let lessonScrollLastTime = 0;
let lessonScrollCooldownUntil = 0;
const LESSON_SCROLL_THRESHOLD = 120;
const LESSON_SCROLL_COOLDOWN_MS = 500;
// Gap after which a new vertical wheel tick counts as a fresh gesture rather
// than a continuation of the last one's leftover accumulation.
const LESSON_SCROLL_GESTURE_GAP_MS = 150;

document.getElementById('workspace').addEventListener('wheel', event => {
  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
  event.preventDefault();

  const now = Date.now();
  if (now < lessonScrollCooldownUntil) return;

  if (now - lessonScrollLastTime > LESSON_SCROLL_GESTURE_GAP_MS) lessonScrollAccum = 0;
  lessonScrollLastTime = now;
  lessonScrollAccum += event.deltaY;
  if (Math.abs(lessonScrollAccum) < LESSON_SCROLL_THRESHOLD) return;

  const direction = lessonScrollAccum > 0 ? 1 : -1;
  lessonScrollAccum = 0;

  const lessons = activeCourseObj()?.lessons || [];
  const index = lessons.findIndex(l => l.id === activeLessonId);
  const next = lessons[index + direction];
  if (!next) return;

  switchLesson(next.id);
  lessonScrollCooldownUntil = now + LESSON_SCROLL_COOLDOWN_MS;
}, { passive: false });

// ── Init ─────────────────────────────────────────────────────
if (!isSupabaseConfigured) {
  document.getElementById('viewSignInStatus').textContent = 'Online sync coming soon.';
  document.getElementById('viewSignInBtn').disabled = true;
} else {
  const restoredUser = await trySessionRestore();
  if (restoredUser) {
    showSignedIn();
    await loadEverything();
  }
  // Covers finishing a magic-link round trip in this same tab (the sign-in
  // gate's only path to actually getting signed in), and — going the other
  // way — a sign-out anywhere this session is listening.
  onAuthStateChange(async signedInUser => {
    if (signedInUser) {
      showSignedIn();
      await loadEverything();
    } else {
      user = null;
      sharedCourses = [];
      pendingInvites = [];
      showSignedOut();
    }
  });
}
