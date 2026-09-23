// ── Pockit Course Builder ────────────────────────────────────
// Step 1: card set arrangement only. Cards are empty frames for now —
// content blocks come later.

import {
  MIN_BLOCK_ROWS, BLOCK_TYPES, SMALLEST_BLOCK_ROWS,
  blockType, listCount, matrixEntryCount, matrixColumns,
} from './block-types.js';
import {
  buildCard, configureRenderCard, renderMarkdown, paintPresentSlide,
  imageFit, IMAGE_FITS, DEFAULT_IMAGE_FIT, ACCEPTED_IMAGES, primeImageSrcCache,
} from './render-card.js';
import { defaults } from './params-defaults.js';
import * as localStorageAdapter from './storage/local-storage-adapter.js';
import { createVaultAdapter } from './storage/vault-adapter.js';
import * as vaultHandleStore from './storage/vault-handle-store.js';
import { createSupabaseAdapter } from './storage/supabase-adapter.js';
import { getSupabaseClient } from './storage/supabase-client.js';
import { listCourseAccess, inviteToCourse, revokeInvite } from './storage/course-invites.js';
import { isSupabaseConfigured } from './config/supabase-config.js';
import { getCurrentUser, signInWithEmail, signOut, trySessionRestore, onAuthStateChange } from './auth/auth.js';
import { positionPopover } from './popover.js';
import { hasSeenTour, markTourSeen, runTour } from './onboarding-tour.js';
// Remembers an explicit "Cloud" storage choice across reloads — Supabase
// Auth itself persists the *session* (see auth.js), but not which storage
// backend a signed-in user picked; switchStorageMode() below keeps this in
// sync with activeAdapterKind.
const CLOUD_STORAGE_PREFERENCE_KEY = 'pockit-use-cloud-storage';

// A course is its own params plus an ordered lesson set, remembering which
// lesson was last open in it:
//   { id, params, lessons: [...], activeLessonId }
let courses = [];
let activeCourseId = null;
let nextCourseId = 1;

// A lesson is a title plus its own ordered card set:
//   { id, title, cards: [{ id, blocks: [{ id, h }] }] }
//
// `params`, `lessons`, `activeLessonId` and (transitively) `cards` are all
// kept as live aliases into the active course/lesson — `params ===
// activeCourse().params`, `cards === activeLesson().cards`, and so on — so
// the existing param-reading and card/block code below can keep reading
// and mutating them directly without knowing courses or lessons exist.
// Anywhere that *reassigns* one of these outright (rather than mutating in
// place) has to write the new value back into the owning course/lesson —
// see `adoptCourse()` below, and e.g. `activeLesson().cards = cards` in
// `removeCard()` — so the alias and its owner never diverge.
let params = { ...defaults };
let lessons = [];
let activeLessonId = null;
let nextLessonId = 1;  // lesson id counter — shared across all courses

let cards = [];
let nextId = 1;       // card id counter — shared across all lessons
let nextBlockId = 1;  // block id counter — shared across all lessons
let nextTimetableId = 1;  // timetabled-class id counter — shared across all courses
let nextNoteId = 1;  // scratchpad note id counter — shared across all lessons

// One person's identity, used across every course — root-level state, like
// activeCourseId, not per-course. Persisted through whichever adapter is
// active exactly like everything else above (see snapshot()/load()): no
// sign-in required for the text fields, since local-storage-adapter.js and
// vault-adapter.js both handle it same as any other saved data. avatarSrc
// additionally needs the active adapter's own optional `avatar` capability
// (feature-detected like `attachments`) — absent on plain local storage,
// which has nowhere to put a photo — see updateProfileDetails().
function defaultProfile() {
  return { title: '', firstName: '', lastName: '', jobTitle: '', employer: '', avatarSrc: null };
}
let profile = defaultProfile();

function activeCourse() {
  return courses.find(c => c.id === activeCourseId);
}

function activeLesson() {
  return lessons.find(l => l.id === activeLessonId);
}

// Adopts a course's own state into the module-level aliases above —
// called whenever the active course changes (switch, add, remove, load).
function adoptCourse(course) {
  if (!course) {
    params = { ...defaults };
    lessons = [];
    activeLessonId = null;
    cards = [];
    return;
  }
  params = course.params;
  lessons = course.lessons;
  activeLessonId = course.activeLessonId;
  cards = activeLesson().cards;
}

function newLesson() {
  return { id: nextLessonId++, title: 'Untitled lesson', cards: [], scratchpad: [] };
}

function newCourse(courseCode = '', courseName = '') {
  const lesson = newLesson();
  return {
    id: nextCourseId++,
    params: { ...defaults, courseCode, courseName },
    lessons: [lesson],
    activeLessonId: lesson.id,
    timetable: [],
  };
}

// Blocks are sized in rows, and a row is two grid squares tall. The dot grid
// stays at gridSize; rows are the coarser unit content snaps to.
const GRID_PER_ROW = 2;

// Heights move in half rows, which is one grid square.
const ROW_STEP = 1 / GRID_PER_ROW;

function rowHeightMm() {
  return params.gridSize * GRID_PER_ROW;
}

function snapRows(rows) {
  return Math.round(rows / ROW_STEP) * ROW_STEP;
}

// Light tint of a hex color, for UI accents that should track a param color
// (e.g. the task block background tracking the punch color) without the
// caller juggling RGB math.
function tint(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// Card dimensions snap to whole grid units, so these are the unsnapped bounds.
const CARD_WIDTH_REF  = { min: 72,  max: 96,  default: 80  };
const CARD_HEIGHT_REF = { min: 148, max: 192, default: 160 };

function snapToGrid(value, gridSize) {
  return Math.round(value / gridSize) * gridSize;
}

// Grid size changes the valid card dimensions, so the sliders are re-bounded
// whenever it moves.
function updateCardSizeSliders(gridSize) {
  const specs = [
    ['cardWidth', CARD_WIDTH_REF],
    ['cardHeight', CARD_HEIGHT_REF],
  ];

  for (const [id, ref] of specs) {
    const el = document.getElementById(id);
    const min = snapToGrid(ref.min, gridSize);
    const max = snapToGrid(ref.max, gridSize);
    const current = parseInt(el.value) || ref.default;

    el.min = min;
    el.max = max;
    el.step = gridSize;
    el.value = Math.min(max, Math.max(min, snapToGrid(current, gridSize)));
  }
}

// ── Read form into params ────────────────────────────────────
function readParams() {
  params.courseCode  = document.getElementById('courseCode').value;
  params.courseName  = document.getElementById('courseName').value;

  params.gridSize = parseInt(document.getElementById('gridSize').value);
  document.getElementById('gridSizeDisplay').textContent = params.gridSize;
  updateCardSizeSliders(params.gridSize);

  params.cardWidth = parseInt(document.getElementById('cardWidth').value);
  document.getElementById('cardWidthDisplay').textContent = params.cardWidth;
  params.cardHeight = parseInt(document.getElementById('cardHeight').value);
  document.getElementById('cardHeightDisplay').textContent = params.cardHeight;

  params.dots     = document.getElementById('dots').checked;
  params.dotSize  = parseFloat(document.getElementById('dotSize').value) || 0.4;
  params.dotColor = document.getElementById('dotColor').value;

  params.header          = document.getElementById('header').checked;
  params.headerHeight    = parseFloat(document.getElementById('headerHeight').value) || 0;
  params.headerLine      = document.getElementById('headerLine').checked;
  params.headerLineColor = document.getElementById('headerLineColor').value;
  params.punchMark  = document.getElementById('punchMark').checked;
  params.punchColor = document.getElementById('punchColor').value;
  params.lessonCount      = document.getElementById('lessonCount').checked;
  params.lessonCountColor = document.getElementById('lessonCountColor').value;

  params.footer          = document.getElementById('footer').checked;
  params.footerHeight    = parseFloat(document.getElementById('footerHeight').value) || 0;
  params.footerLine      = document.getElementById('footerLine').checked;
  params.footerLineColor = document.getElementById('footerLineColor').value;
  params.footerTextColor = document.getElementById('footerTextColor').value;

  params.cardNumbers     = document.getElementById('cardNumbers').checked;
  params.cardNumberColor = document.getElementById('cardNumberColor').value;

  params.cardOutline       = document.getElementById('cardOutline').checked;
  params.cardOutlineColor  = document.getElementById('cardOutlineColor').value;
  params.cardOutlineWeight = parseFloat(document.getElementById('cardOutlineWeight').value) || 0.2;

  document.querySelector('#sidebar-header p').textContent =
    `${params.cardWidth}mm × ${params.cardHeight}mm · ${params.gridSize}mm grid`;

  // Design tokens shared by cards *and* workspace chrome outside them (the
  // lesson-title mark) — set on their nearest common ancestor rather than
  // per-card, so both inherit the same values without redeclaring them.
  const workspaceInner = document.getElementById('workspace-inner');
  workspaceInner.style.setProperty('--punch-color', params.punchColor);
  workspaceInner.style.setProperty('--task-tint', tint(params.punchColor, 0.12));
  workspaceInner.style.setProperty('--card-ratio', `${params.cardWidth} / ${params.cardHeight}`);

  // #present-view isn't a descendant of #workspace-inner (it's a sibling,
  // full-viewport overlay), so #present-mark needs its own copies of the
  // two tokens it actually uses rather than inheriting them.
  const presentView = document.getElementById('present-view');
  presentView.style.setProperty('--punch-color', params.punchColor);
  presentView.style.setProperty('--card-ratio', `${params.cardWidth} / ${params.cardHeight}`);

  // Same story again for #sidebar (also a sibling, not a descendant, of
  // #workspace-inner) — the active lesson row's own card-shaped mark (see
  // .lesson-drag-handle) needs --card-ratio to actually reach it.
  const sidebar = document.getElementById('sidebar');
  sidebar.style.setProperty('--punch-color', params.punchColor);
  sidebar.style.setProperty('--card-ratio', `${params.cardWidth} / ${params.cardHeight}`);

  renderCoverView();
}

// ── Push params back into the form ───────────────────────────
// Needed after restoring from storage, and after a reset.
function writeParams() {
  updateCardSizeSliders(params.gridSize);

  for (const [key, value] of Object.entries(params)) {
    const el = document.getElementById(key);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = value;
    else el.value = value;
  }
}

// ── Course cover ─────────────────────────────────────────────
// Flat, unfolded layout — back cover, spine, front cover — sized off the
// same params.cardWidth/cardHeight the cards themselves use, so it always
// tracks a course's current card size rather than needing its own
// separate width/height settings. 1mm larger than a card on every card
// edge (the cover wraps around, so it has to be slightly bigger); the
// spine is its own setting, independent of card size, since how thick it
// needs to be depends on how many cards the course ends up with, not on
// any single card's dimensions.
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// Natural pixel size of a cover image, keyed by its resolved src — read
// once per image (an <img> load, not a network refetch: the browser's own
// cache serves it) rather than on every render, since renderCoverView()
// re-runs on each drag tick.
const coverImageNaturalSize = new Map();
function loadNaturalSize(src) {
  if (!coverImageNaturalSize.has(src)) {
    coverImageNaturalSize.set(src, new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve(null);
      img.src = src;
    }));
  }
  return coverImageNaturalSize.get(src);
}

// How large an image needs to be drawn, and by how much it then overhangs
// a boxWmm×boxHmm box, to cover that box without distorting its aspect
// ratio (the CSS `background-size: cover` keyword does exactly this, but
// only for a single element — "whole cover" mode needs the same fit
// computed once against the *combined* back+spine+front box, then applied
// identically to all three panels, so it has to be done by hand here
// rather than left to CSS).
function coverFitGeometry(naturalW, naturalH, boxWmm, boxHmm) {
  const imgAspect = naturalW / naturalH;
  const boxAspect = boxWmm / boxHmm;
  const renderedWmm = imgAspect >= boxAspect ? boxHmm * imgAspect : boxWmm;
  const renderedHmm = imgAspect >= boxAspect ? boxHmm : boxWmm / imgAspect;
  return {
    renderedWmm,
    renderedHmm,
    overflowXmm: renderedWmm - boxWmm,
    overflowYmm: renderedHmm - boxHmm,
  };
}

// coverImageNaturalGeometry caches the *geometry* (not just the raw pixel
// size) of the most recent fit computed for each target — setupCoverDrag()
// below reads it back to convert a drag distance into an offset% change
// without redoing the async image load mid-drag.
const coverImageNaturalGeometry = {};

function hexToRgb(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

// #rrggbb + a 0-100 transparency into the rgba() a solid cover fill is
// actually painted with — plain <input type="color"> has no alpha channel
// of its own, so every cover* color is stored as separate hex/alpha params
// (see params-defaults.js) and only combined here.
function hexToRgba(hex, alphaPercent) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${(alphaPercent ?? 100) / 100})`;
}

// Same alpha blend, but as {r,g,b} rather than a CSS string — used to work
// out what color is actually showing through a stack of cover fills, for
// picking the spine text's own black/white below, rather than to paint
// anything directly.
function compositeOver(base, color, alphaPercent) {
  const a = (alphaPercent ?? 100) / 100;
  return {
    r: color.r * a + base.r * (1 - a),
    g: color.g * a + base.g * (1 - a),
    b: color.b * a + base.b * (1 - a),
  };
}

// An image's average color, keyed by its resolved src and cached the same
// way loadNaturalSize() is — drawn at 1×1 so the browser's own image
// scaling does the averaging, far cheaper than reading and averaging every
// pixel by hand. Used only to decide the spine text's black/white below;
// null (rather than throwing) on any failure, e.g. a tainted canvas, so a
// broken sample just falls back to whatever's already on screen instead of
// breaking the render.
const coverImageAverageColor = new Map();
function loadAverageColor(src) {
  if (!coverImageAverageColor.has(src)) {
    coverImageAverageColor.set(src, new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 1;
          canvas.height = 1;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, 1, 1);
          const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
          resolve({ r, g, b });
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = src;
    }));
  }
  return coverImageAverageColor.get(src);
}

// Perceived-brightness threshold (the standard fast approximation, not
// full sRGB-linear luminance — plenty accurate for a binary black/white
// choice) — same idea as any "auto-contrast" text color picker.
function pickTextColor({ r, g, b }) {
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness > 140 ? '#000' : '#fff';
}

// One image or color, applied to a single panel. `target` names which of
// the four independent fills (whole/back/spine/front) this panel is
// currently showing — used to look up its own offset% params and to cache
// this fit's geometry for setupCoverDrag(). For "whole cover" mode, all
// three panels are called with the same target and boxWmm/boxHmm (the
// combined spread), each with its own panelLeftMm, so one continuously
// scaled image spans all three with no seam; per-side fills pass a target
// of their own and panelLeftMm 0, fitting independently within just that
// one panel. uploadImage()/resolveImageSrc() (below, in ── Images ──) are
// the exact same functions a card's own image block uses.
async function applyCoverFill(target, panelEl, fillType, color, colorAlpha, imageRef, boxWmm, boxHmm, panelLeftMm = 0) {
  const label = panelEl.querySelector('.cover-panel-label');
  if (fillType === 'image' && imageRef) {
    const src = await resolveImageSrc(imageRef);
    const natural = await loadNaturalSize(src);
    if (!natural) return;
    const geometry = coverFitGeometry(natural.w, natural.h, boxWmm, boxHmm);
    coverImageNaturalGeometry[target] = geometry;
    const offsetX = params[`cover${capitalize(target)}ImageOffsetX`];
    const offsetY = params[`cover${capitalize(target)}ImageOffsetY`];
    const posXmm = -(geometry.overflowXmm * offsetX / 100) - panelLeftMm;
    const posYmm = -(geometry.overflowYmm * offsetY / 100);
    panelEl.style.backgroundColor = '';
    panelEl.style.backgroundImage = `url("${src}")`;
    panelEl.style.backgroundSize = `${geometry.renderedWmm}mm ${geometry.renderedHmm}mm`;
    panelEl.style.backgroundPosition = `${posXmm}mm ${posYmm}mm`;
    panelEl.classList.toggle('is-draggable', geometry.overflowXmm > 0.01 || geometry.overflowYmm > 0.01);
    if (label) label.hidden = true;
  } else {
    panelEl.style.backgroundImage = 'none';
    panelEl.style.backgroundColor = hexToRgba(color || '#ffffff', colorAlpha);
    panelEl.classList.remove('is-draggable');
    if (label) label.hidden = false;
  }
}

// Flat, unfolded layout — back cover, spine, front cover — sized off the
// same params.cardWidth/cardHeight the cards themselves use, so it always
// tracks a course's current card size rather than needing its own
// separate width/height settings. 1mm larger than a card on every card
// edge (the cover wraps around, so it has to be slightly bigger); the
// spine is its own setting, independent of card size, since how thick it
// needs to be depends on how many cards the course ends up with, not on
// any single card's dimensions.
async function renderCoverView() {
  const backW = params.cardWidth + 1;
  const frontW = params.cardWidth + 1;
  const spineW = params.spineWidth;
  const height = params.cardHeight + 1;

  document.getElementById('cover-spread').style.height = `${height}mm`;
  document.getElementById('cover-back').style.width = `${backW}mm`;
  document.getElementById('cover-front').style.width = `${frontW}mm`;
  document.getElementById('cover-spine').style.width = `${spineW}mm`;

  // Every padding used across the cover is grid-based, not an arbitrary
  // fixed mm value, so it tracks a course's own grid rather than needing
  // its own separate setting — outer spacing off a panel's own edge
  // (markPadding/textPadding below) is a full grid unit; the padding
  // *inside* the white boxes (--cover-inner-pad, read by their CSS) is
  // half that, so text doesn't sit as far from their edges as the boxes
  // do from the panel's.
  const coverPad = params.gridSize;
  document.getElementById('cover-view').style.setProperty('--cover-inner-pad', `${coverPad / 2}mm`);

  // Front cover's brand mark — top-right, same width:height proportion as
  // this course's own cards, 10 grid units tall (about what a quarter of
  // the panel's own height used to work out to, but grid-based rather
  // than proportional so it doesn't shift around as cardHeight changes) —
  // and, to its left, a white info panel holding the course code/title, at
  // the same top and height, separated from the mark by the same padding
  // again and padded that much off the front panel's left edge in turn.
  // Neither is user-resizable (unlike the back cover's text box) — the
  // mark's own aspect ratio is the point, and the info panel's width is
  // just whatever's left over once the mark's width is set, so there's
  // nothing to resize independently. Applies in both modes (painted on the
  // front panel itself, above whatever fill that panel already has), so
  // this isn't inside the whole/per-side branch below.
  const frontMark = document.getElementById('cover-front-mark');
  const frontInfo = document.getElementById('cover-front-info');
  if (frontMark) {
    const markPadding = coverPad;
    const markHeight = 10 * params.gridSize;
    // Aspect ratio drives the width off that fixed height, so the mark
    // stays proportioned to this course's own cards regardless — and the
    // info panel's width (below) adjusts to match in turn, since it's
    // just whatever's left over.
    const markWidth = markHeight * (params.cardWidth / params.cardHeight);
    frontMark.style.top = `${markPadding}mm`;
    frontMark.style.right = `${markPadding}mm`;
    frontMark.style.width = `${markWidth}mm`;
    frontMark.style.height = `${markHeight}mm`;

    if (frontInfo) {
      const infoWidth = frontW - markPadding * 3 - markWidth;
      frontInfo.style.top = `${markPadding}mm`;
      frontInfo.style.left = `${markPadding}mm`;
      frontInfo.style.width = `${infoWidth}mm`;
      frontInfo.style.height = `${markHeight}mm`;
      document.getElementById('cover-front-code').textContent = params.courseCode;
      document.getElementById('cover-front-title').textContent = params.courseName;

      // Name (title included only if actually set) and job title/employer
      // (joined the same "a · b" way the spine already joins code/title),
      // from the Profile panel — app-level state, not per-course, so it's
      // the same on every course's cover. Hidden outright rather than
      // left blank when nothing's set, so an empty profile leaves no gap.
      const personEl = document.getElementById('cover-front-person');
      const fullName = [profile.title, profile.firstName, profile.lastName].filter(Boolean).join(' ');
      const role = [profile.jobTitle, profile.employer].filter(Boolean).join(' · ');
      personEl.hidden = !fullName && !role;
      document.getElementById('cover-front-person-name').textContent = fullName;
      document.getElementById('cover-front-person-role').textContent = role;
    }
  }

  // Blank space at the bottom of the front cover for a handwritten name/
  // contact — same left/right padding as the mark/info above, but its own
  // box rather than sized off either of them. left+right (no explicit
  // width) so it always spans whatever's between them, whatever frontW is.
  const frontContact = document.getElementById('cover-front-contact');
  if (frontContact) {
    frontContact.style.left = `${coverPad}mm`;
    frontContact.style.right = `${coverPad}mm`;
    frontContact.style.bottom = `${coverPad}mm`;
    frontContact.style.height = `${3 * params.gridSize}mm`;
  }

  // Back cover's text box — same left/right padding as the front's
  // mark/info above, height in the same whole-grid-unit terms as those
  // (see params.coverBackTextHeightGrids — resized via #cover-back-resize,
  // in grid-unit steps), anchored to whichever edge params.coverBackTextAlign
  // names with that same padding, so only one of top/bottom is ever set at
  // once — the other edge is left free to move when the box is resized.
  // Applies in both modes, same reasoning as the front mark.
  const backText = document.getElementById('cover-back-text');
  document.getElementById('coverBackTextEnabled').checked = params.coverBackTextEnabled;
  if (backText) {
    backText.hidden = !params.coverBackTextEnabled;
    const textPadding = coverPad;
    const alignBottom = params.coverBackTextAlign === 'bottom';
    backText.style.top = alignBottom ? '' : `${textPadding}mm`;
    backText.style.bottom = alignBottom ? `${textPadding}mm` : '';
    backText.style.left = `${textPadding}mm`;
    backText.style.width = `${backW - textPadding * 2}mm`;
    backText.style.height = `${params.coverBackTextHeightGrids * params.gridSize}mm`;

    // The resize handle always sits on the *free* edge — opposite
    // whichever one alignment just anchored above.
    const resizeHandle = document.getElementById('cover-back-resize');
    resizeHandle.style.top = alignBottom ? '-3px' : '';
    resizeHandle.style.bottom = alignBottom ? '' : '-3px';

    const alignBtn = document.getElementById('cover-back-text-align');
    alignBtn.title = alignBottom ? 'Align to top' : 'Align to bottom';
    alignBtn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${COVER_TEXT_ALIGN_ICONS[params.coverBackTextAlign]}</svg>`;

    const backPreview = document.getElementById('cover-back-preview');
    if (params.coverBackText) {
      backPreview.classList.remove('is-empty');
      backPreview.innerHTML = renderMarkdown(params.coverBackText);
    } else {
      backPreview.classList.add('is-empty');
      backPreview.textContent = 'Add text…';
    }
  }

  // The per-side control row spans the same overall width as #cover-spread
  // below, but (see #cover-fill-perside in the CSS) splits it into three
  // equal columns rather than matching each panel's own width — a
  // panel-matched spine column is normally far too narrow for real
  // controls, so the columns are deliberately untied from the covers/
  // spine's own proportions.
  const perSide = document.getElementById('cover-fill-perside');
  if (perSide) perSide.style.width = `${backW + spineW + frontW}mm`;

  document.querySelectorAll('#coverMode button').forEach(btn => {
    btn.classList.toggle('is-active', btn.dataset.value === params.coverMode);
  });
  document.getElementById('cover-fill-whole').hidden = params.coverMode !== 'whole';
  document.getElementById('cover-fill-perside').hidden = params.coverMode !== 'perSide';

  for (const target of ['whole', 'back', 'front']) {
    const row = document.querySelector(`.cover-fill-row[data-target="${target}"]`);
    if (!row) continue;
    const fillType = params[`cover${capitalize(target)}FillType`];
    row.querySelectorAll('.cover-fill-type-toggle button').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.type === fillType);
    });
    row.querySelector('.cover-fill-color').hidden = fillType !== 'color';
    row.querySelector('.cover-fill-color').value = params[`cover${capitalize(target)}Color`];
    row.querySelector('.cover-fill-alpha').hidden = fillType !== 'color';
    row.querySelector('.cover-fill-alpha').value = params[`cover${capitalize(target)}ColorAlpha`];
    row.querySelector('.cover-fill-image-btn').hidden = fillType !== 'image';
  }

  // Colour-only rows (see buildCoverColorRow()) — no type toggle to update,
  // just the swatch/slider values themselves.
  for (const target of ['spine', 'wholeSpine']) {
    const row = document.querySelector(`.cover-fill-row[data-target="${target}"]`);
    if (!row) continue;
    row.querySelector('.cover-fill-color').value = params[`cover${capitalize(target)}Color`];
    row.querySelector('.cover-fill-alpha').value = params[`cover${capitalize(target)}ColorAlpha`];
  }

  const backEl = document.getElementById('cover-back');
  const spineEl = document.getElementById('cover-spine');
  const frontEl = document.getElementById('cover-front');

  if (params.coverMode === 'whole') {
    // Same box (the full spread, not any one panel) and each panel's own
    // left-edge offset into it — the classic "one background sprite
    // across several boxes" trick, so the image reads as continuous once
    // the (gapless — see #cover-spread) panels sit side by side.
    const boxW = backW + spineW + frontW;
    await Promise.all([
      applyCoverFill('whole', backEl, params.coverWholeFillType, params.coverWholeColor, params.coverWholeColorAlpha, params.coverWholeImage, boxW, height, 0),
      applyCoverFill('whole', spineEl, params.coverWholeFillType, params.coverWholeColor, params.coverWholeColorAlpha, params.coverWholeImage, boxW, height, backW),
      applyCoverFill('whole', frontEl, params.coverWholeFillType, params.coverWholeColor, params.coverWholeColorAlpha, params.coverWholeImage, boxW, height, backW + spineW),
    ]);
    // The spine's own optional tint sits *over* whatever's already there
    // rather than being a fill in its own right — an inset box-shadow the
    // full size of the panel paints on top without needing an extra
    // element, and (being paint, not a layout box) doesn't block dragging
    // the whole image via the spine panel underneath it.
    spineEl.style.boxShadow = `inset 0 0 0 999px ${hexToRgba(params.coverWholeSpineColor, params.coverWholeSpineColorAlpha)}`;
  } else {
    spineEl.style.boxShadow = 'none';
    await Promise.all([
      applyCoverFill('back', backEl, params.coverBackFillType, params.coverBackColor, params.coverBackColorAlpha, params.coverBackImage, backW, height),
      applyCoverFill('spine', spineEl, 'color', params.coverSpineColor, params.coverSpineColorAlpha, null, spineW, height),
      applyCoverFill('front', frontEl, params.coverFrontFillType, params.coverFrontColor, params.coverFrontColorAlpha, params.coverFrontImage, frontW, height),
    ]);
  }

  // Same course code/title, running down the spine (see #cover-spine-info
  // in the CSS) — real content now, so the "Spine" placeholder label
  // underneath it (otherwise centered in the same spot, and just set by
  // applyCoverFill() above) is redundant; force it hidden regardless of
  // fillType. Its own top margin is 1.5 grid units: coverPad to match the
  // front info panel's own outer padding, plus half that again to match
  // that panel's own (half-grid) inner padding, so this lines up with
  // where the code text actually starts inside it rather than just the
  // panel's edge.
  document.getElementById('cover-spine-code').textContent = params.courseCode;
  document.getElementById('cover-spine-title').textContent = params.courseName;
  document.getElementById('cover-spine-info').style.marginTop = `${coverPad * 1.5}mm`;
  document.querySelector('#cover-spine .cover-panel-label').hidden = true;

  // Back cover's text box (see above), when on, already covers virtually
  // the whole panel, so its "Back" placeholder — set by applyCoverFill()
  // above, same as the spine's — would only ever render underneath it
  // either way; hidden for the same reason as the spine's own placeholder.
  // Left alone (i.e. still governed by fillType, same as Front) when the
  // text box is switched off, since the panel's actually blank again then.
  if (params.coverBackTextEnabled) {
    document.querySelector('#cover-back .cover-panel-label').hidden = true;
  }

  // Black or white, whichever reads against what the spine is actually
  // showing — composited the same way it's actually painted: the panel's
  // own white background, then the base fill (a flat color's own alpha, or
  // an image's average color, sampled rather than guessed), then — whole
  // cover mode only — the spine's own additional tint on top of that.
  let spineBase = { r: 255, g: 255, b: 255 };
  if (params.coverMode === 'whole') {
    if (params.coverWholeFillType === 'image' && params.coverWholeImage) {
      const avg = await loadAverageColor(await resolveImageSrc(params.coverWholeImage));
      if (avg) spineBase = avg;
    } else {
      spineBase = compositeOver(spineBase, hexToRgb(params.coverWholeColor), params.coverWholeColorAlpha);
    }
    spineBase = compositeOver(spineBase, hexToRgb(params.coverWholeSpineColor), params.coverWholeSpineColorAlpha);
  } else {
    spineBase = compositeOver(spineBase, hexToRgb(params.coverSpineColor), params.coverSpineColorAlpha);
  }
  document.getElementById('cover-spine-info').style.color = pickTextColor(spineBase);
}

function setCoverMode(mode) {
  params.coverMode = mode;
  save();
  renderCoverView();
}

function setCoverFillType(target, type) {
  params[`cover${capitalize(target)}FillType`] = type;
  save();
  renderCoverView();
}

// Which fill target and box a drag on this physical panel affects — in
// "whole cover" mode every panel drags the one shared 'whole' fit against
// the combined spread box; in "per side" mode each panel drags only its
// own fit against its own box. panelKind is the physical panel being
// dragged ('back'/'spine'/'front'); refEl is measured (getBoundingClientRect)
// to convert the drag's on-screen pixels to the same mm units the fit's
// geometry is in, so drag speed tracks 1:1 regardless of zoom.
function coverDragGeometry(panelKind) {
  const backW = params.cardWidth + 1;
  const frontW = params.cardWidth + 1;
  const spineW = params.spineWidth;
  const height = params.cardHeight + 1;
  if (params.coverMode === 'whole') {
    return { target: 'whole', boxWmm: backW + spineW + frontW, boxHmm: height, refEl: document.getElementById('cover-spread') };
  }
  const boxWmm = panelKind === 'back' ? backW : panelKind === 'spine' ? spineW : frontW;
  return { target: panelKind, boxWmm, boxHmm: height, refEl: document.getElementById(`cover-${panelKind}`) };
}

function clamp(value, min, max) { return Math.min(Math.max(value, min), max); }

// Click-drag repositioning for a cover image scaled to "cover" its box
// (see coverFitGeometry()) — there's nowhere for a slider to live in this
// small a control area, and dragging the image itself is the more direct
// gesture anyway. Reads the fit geometry applyCoverFill() cached on its
// last render rather than redoing the image load mid-drag.
function setupCoverDrag(panelKind) {
  const panelEl = document.getElementById(`cover-${panelKind}`);
  panelEl.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const { target, boxWmm, boxHmm, refEl } = coverDragGeometry(panelKind);
    if (params[`cover${capitalize(target)}FillType`] !== 'image') return;
    const geometry = coverImageNaturalGeometry[target];
    if (!geometry || (geometry.overflowXmm <= 0.01 && geometry.overflowYmm <= 0.01)) return;

    event.preventDefault();
    const rect = refEl.getBoundingClientRect();
    const pxPerMmX = rect.width / boxWmm;
    const pxPerMmY = rect.height / boxHmm;
    const startClientX = event.clientX;
    const startClientY = event.clientY;
    const startOffsetX = params[`cover${capitalize(target)}ImageOffsetX`];
    const startOffsetY = params[`cover${capitalize(target)}ImageOffsetY`];
    panelEl.classList.add('is-dragging');

    const onMove = moveEvent => {
      const dxMm = (moveEvent.clientX - startClientX) / pxPerMmX;
      const dyMm = (moveEvent.clientY - startClientY) / pxPerMmY;
      // Dragging the image itself right should reveal more of its left
      // edge — i.e. decrease the offset% — the inverse of dragging a crop
      // window over a fixed image.
      const dOffsetX = geometry.overflowXmm > 0 ? -(dxMm / geometry.overflowXmm) * 100 : 0;
      const dOffsetY = geometry.overflowYmm > 0 ? -(dyMm / geometry.overflowYmm) * 100 : 0;
      params[`cover${capitalize(target)}ImageOffsetX`] = clamp(startOffsetX + dOffsetX, 0, 100);
      params[`cover${capitalize(target)}ImageOffsetY`] = clamp(startOffsetY + dOffsetY, 0, 100);
      renderCoverView();
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      panelEl.classList.remove('is-dragging');
      save();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
}

// Same style as SOURCE_ICONS above — a palette (colour dabs, filled, on an
// otherwise stroke-only outline) and a picture frame, rather than the
// "Colour"/"Image" text this toggle used to show. Icon-only is also most
// of why .cover-fill-type-toggle no longer needs 140px of min-width to
// stay legible — see the CSS.
const COVER_FILL_ICONS = {
  color: '<path d="M12 3a9 9 0 100 18c1.4 0 2-.85 2-1.9 0-.5-.2-.9-.4-1.3-.2-.4-.4-.8-.4-1.3 0-.9.7-1.5 1.6-1.5H16.5A3.5 3.5 0 0020 11.5C20 6.8 16.4 3 12 3z"/>'
    + '<circle cx="7.5" cy="11" r="1.3" fill="currentColor" stroke="none"/>'
    + '<circle cx="9" cy="7.5" r="1.3" fill="currentColor" stroke="none"/>'
    + '<circle cx="13" cy="6.7" r="1.3" fill="currentColor" stroke="none"/>'
    + '<circle cx="16" cy="8.7" r="1.3" fill="currentColor" stroke="none"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/>'
    + '<circle cx="8.5" cy="9.5" r="1.5"/>'
    + '<path d="M21 16l-5.5-5.5a1.5 1.5 0 00-2.1 0L4 19"/>',
};

// A box outline with a filled band at whichever edge — used on
// #cover-back-text-align to show the back cover text box's *current*
// anchor side (its title explains the toggle itself).
const COVER_TEXT_ALIGN_ICONS = {
  top: '<rect x="4" y="9" width="16" height="11" rx="1"/>'
    + '<rect x="4" y="4" width="16" height="3" rx="1" fill="currentColor" stroke="none"/>',
  bottom: '<rect x="4" y="4" width="16" height="11" rx="1"/>'
    + '<rect x="4" y="17" width="16" height="3" rx="1" fill="currentColor" stroke="none"/>',
};

// Transparency slider shared by every colour swatch (see buildCoverFillRow()
// and buildCoverColorRow()) — plain <input type="color"> has no alpha
// channel, so this is the only way to set one; hexToRgba() reads it back.
function buildCoverAlphaInput(target) {
  const alphaInput = document.createElement('input');
  alphaInput.type = 'range';
  alphaInput.className = 'cover-fill-alpha';
  alphaInput.min = 0;
  alphaInput.max = 100;
  alphaInput.title = 'Transparency';
  alphaInput.addEventListener('input', () => {
    params[`cover${capitalize(target)}ColorAlpha`] = Number(alphaInput.value);
    save();
    renderCoverView();
  });
  return alphaInput;
}

// One row's worth of controls — a type toggle plus whichever of the color
// input/image button that type needs — built once per target (see
// initCoverFillRows()) and left in the DOM from then on; renderCoverView()
// only ever updates their values/visibility, never rebuilds them.
function buildCoverFillRow(target, label) {
  const row = document.createElement('div');
  row.className = 'cover-fill-row';
  row.dataset.target = target;

  const labelEl = document.createElement('span');
  labelEl.className = 'cover-fill-label';
  labelEl.textContent = label;
  row.appendChild(labelEl);

  // Toggle, colour swatch/image button and upload note all live together
  // on one line — a separate wrapper from `row` itself so the per-side
  // layout (row goes column: label above, this wrapper below) can still
  // keep the controls themselves inline, rather than every child stacking.
  const controls = document.createElement('div');
  controls.className = 'cover-fill-controls';
  row.appendChild(controls);

  const typeToggle = document.createElement('div');
  typeToggle.className = 'segmented cover-fill-type-toggle';
  for (const type of ['color', 'image']) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = type === 'color' ? 'Colour' : 'Image';
    btn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${COVER_FILL_ICONS[type]}</svg>`;
    btn.dataset.type = type;
    btn.addEventListener('click', () => setCoverFillType(target, type));
    typeToggle.appendChild(btn);
  }
  controls.appendChild(typeToggle);

  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.className = 'cover-fill-color';
  colorInput.addEventListener('input', () => {
    params[`cover${capitalize(target)}Color`] = colorInput.value;
    save();
    renderCoverView();
  });
  controls.appendChild(colorInput);
  controls.appendChild(buildCoverAlphaInput(target));

  const picker = document.createElement('input');
  picker.type = 'file';
  picker.accept = ACCEPTED_IMAGES;
  picker.hidden = true;

  const imageBtn = document.createElement('button');
  imageBtn.type = 'button';
  imageBtn.className = 'cover-fill-image-btn';
  imageBtn.textContent = 'Choose Image…';
  imageBtn.addEventListener('click', () => picker.click());
  controls.appendChild(imageBtn);

  const note = document.createElement('span');
  note.className = 'cover-fill-note';
  controls.appendChild(note);

  controls.appendChild(picker);
  picker.addEventListener('change', async () => {
    const file = picker.files[0];
    if (!file) return;
    note.textContent = 'Uploading…';
    try {
      const { src } = await uploadImage(file);
      params[`cover${capitalize(target)}Image`] = src;
      note.textContent = '';
      save();
      renderCoverView();
    } catch (error) {
      // Most likely cause: opened from file://, so there's no dev server —
      // same fallback message the card image block itself uses.
      note.textContent = error instanceof TypeError ? 'No dev server — run npm start.' : error.message;
    }
  });

  return row;
}

// Colour-only row — just a swatch and transparency slider, no type toggle
// or image option. Used for the spine in both modes: too narrow (7mm
// typical) for an independently-fit image to read as more than a sliver
// in per-side mode, and in whole-cover mode it's not a fill of its own at
// all but a tint over the shared image/color (see renderCoverView()'s
// spine box-shadow).
function buildCoverColorRow(target, label) {
  const row = document.createElement('div');
  row.className = 'cover-fill-row';
  row.dataset.target = target;

  const labelEl = document.createElement('span');
  labelEl.className = 'cover-fill-label';
  labelEl.textContent = label;
  row.appendChild(labelEl);

  const controls = document.createElement('div');
  controls.className = 'cover-fill-controls';
  row.appendChild(controls);

  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.className = 'cover-fill-color';
  colorInput.addEventListener('input', () => {
    params[`cover${capitalize(target)}Color`] = colorInput.value;
    save();
    renderCoverView();
  });
  controls.appendChild(colorInput);
  controls.appendChild(buildCoverAlphaInput(target));

  return row;
}

// Run once at startup (see the ── Wiring ── section) — the rows themselves
// are permanent; only their state changes after this.
function initCoverFillRows() {
  const whole = document.getElementById('cover-fill-whole');
  whole.appendChild(buildCoverFillRow('whole', 'Cover'));
  whole.appendChild(buildCoverColorRow('wholeSpine', 'Spine'));

  const perSide = document.getElementById('cover-fill-perside');
  perSide.appendChild(buildCoverFillRow('back', 'Back'));
  perSide.appendChild(buildCoverColorRow('spine', 'Spine'));
  perSide.appendChild(buildCoverFillRow('front', 'Front'));
}

// Back cover's text box — same click-to-edit interaction as a card's own
// Text block (buildMarkdownEditor() in render-card.js: a rendered preview
// that swaps for a plain textarea on click/focus, and back again on blur),
// backed by params.coverBackText instead of a block's body. Wired up once
// (see the ── Wiring ── section); renderCoverView() only updates its geometry and
// the preview's rendered content from then on.
function initCoverBackText() {
  const box = document.getElementById('cover-back-text');
  const preview = document.getElementById('cover-back-preview');
  const editor = document.getElementById('cover-back-editor');
  const alignBtn = document.getElementById('cover-back-text-align');
  const resizeHandle = document.getElementById('cover-back-resize');

  // setupCoverDrag()'s pointerdown listener lives on #cover-back itself
  // (for repositioning an image fill) — stop the bubble here so clicking
  // anywhere in this box (to edit text, resize, or flip alignment) never
  // also starts that drag.
  box.addEventListener('pointerdown', event => event.stopPropagation());

  const enterEditing = () => {
    editor.value = params.coverBackText || '';
    preview.hidden = true;
    editor.hidden = false;
    editor.focus();
    editor.setSelectionRange(editor.value.length, editor.value.length);
  };

  preview.addEventListener('click', enterEditing);
  preview.addEventListener('focus', enterEditing);

  editor.addEventListener('blur', () => {
    params.coverBackText = editor.value;
    editor.hidden = true;
    preview.hidden = false;
    save();
    renderCoverView();
  });

  alignBtn.addEventListener('click', () => {
    params.coverBackTextAlign = params.coverBackTextAlign === 'bottom' ? 'top' : 'bottom';
    save();
    renderCoverView();
  });

  // Pointer events, same reasoning as makeResizable()'s card-block-resize:
  // resize the element only while dragging (cheap), commit to the model
  // and do a full re-render on release so nothing gets torn out from under
  // the pointer mid-drag.
  resizeHandle.addEventListener('pointerdown', event => {
    event.preventDefault();
    const coverHeightMm = params.cardHeight + 1;
    // Measured rather than assumed, so it survives browser zoom.
    const pxPerMm = document.getElementById('cover-back').getBoundingClientRect().height / coverHeightMm;
    const startY = event.clientY;
    const startGrids = params.coverBackTextHeightGrids;
    const align = params.coverBackTextAlign;
    const minGrids = 1;
    const maxGrids = Math.floor((coverHeightMm * 0.95) / params.gridSize);
    let grids = startGrids;

    const onMove = moveEvent => {
      const dyMm = (moveEvent.clientY - startY) / pxPerMm;
      // Top-aligned: the box's top edge is the one pinned in place, so
      // dragging down (positive dy) is what grows it. Bottom-aligned: the
      // *bottom* edge is pinned instead, so it's dragging up that grows it.
      const deltaMm = align === 'bottom' ? -dyMm : dyMm;
      // Whole grid units, not a smooth drag — same idea as a card block's
      // own row-snapped resize (see snapRows()).
      grids = clamp(startGrids + Math.round(deltaMm / params.gridSize), minGrids, maxGrids);
      box.style.height = `${grids * params.gridSize}mm`;
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      params.coverBackTextHeightGrids = grids;
      save();
      renderCoverView();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
}

function openCoverView() {
  document.getElementById('cover-view').hidden = false;
  document.getElementById('lesson-title-row').hidden = true;
  document.getElementById('card-row').hidden = true;
  document.getElementById('teacher-overview-toggle').hidden = true;
  document.getElementById('course-cover-btn').classList.add('is-active');
  renderCoverView();
}

function closeCoverView() {
  document.getElementById('cover-view').hidden = true;
  document.getElementById('lesson-title-row').hidden = false;
  document.getElementById('card-row').hidden = false;
  document.getElementById('teacher-overview-toggle').hidden = false;
  document.getElementById('course-cover-btn').classList.remove('is-active');
}

// ── Persistence ──────────────────────────────────────────────
// Routed through whichever adapter is active (see storage/storage-adapter.js)
// rather than talking to localStorage directly — the rest of the file never
// needs to know which backend is live.
//
// Debounced: save() is called from ~40 sites on nearly every keystroke/drag
// tick, cheap enough for localStorage.setItem to shrug off but not something
// a real file-backed adapter (coming later) should take on every tick. The
// localStorage adapter doesn't need this, but sharing one path is simpler
// than branching per adapter. A trailing debounce alone could starve a long
// unbroken typing burst of ever flushing, so a max-wait timer forces a
// periodic flush too; visibility/unload flush best-effort on top of both.
let activeAdapter = localStorageAdapter;
// Which #storage-options radio activeAdapter corresponds to. Plain adapter
// objects (createVaultAdapter()/createSupabaseAdapter() return the same
// {load,save,describe,attachments} shape) have no type tag of their own,
// so this is tracked alongside activeAdapter explicitly — see
// updateStorageOptions()/switchStorageMode().
let activeAdapterKind = 'local'; // 'local' | 'vault' | 'cloud'
const SAVE_DEBOUNCE_MS = 500;
const SAVE_MAX_WAIT_MS = 2000;

let pendingState = null;
let saveDebounceTimer = null;
let saveMaxWaitTimer = null;

function snapshot() {
  return { courses, activeCourseId, nextId, nextBlockId, nextLessonId, nextCourseId, nextTimetableId, nextNoteId, profile };
}

// Chained rather than fired-and-forgotten bare: the vault adapter's writes
// are real (possibly slow) file I/O, so if the max-wait timer fires again
// before a previous save finishes, this keeps the two calls sequential
// instead of racing two overlapping writes to the same files. localStorage
// doesn't need this, but there's only one save path either adapter goes
// through.
let saveInFlight = Promise.resolve();

function flushSave() {
  clearTimeout(saveDebounceTimer);
  clearTimeout(saveMaxWaitTimer);
  saveDebounceTimer = null;
  saveMaxWaitTimer = null;
  if (pendingState === null) return;
  const state = pendingState;
  // Captured now, not read inside the .then() below — a vault switch
  // (pickNewVault) calls flushSave() and then reassigns activeAdapter
  // before this callback actually runs, so reading the live variable there
  // would misdirect an old vault's last edits onto the new one.
  const adapter = activeAdapter;
  pendingState = null;
  saveInFlight = saveInFlight
    .then(() => adapter.save(state))
    .catch(error => console.error('[course-builder] save failed', error));
}

function save() {
  pendingState = snapshot();
  clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
  if (!saveMaxWaitTimer) saveMaxWaitTimer = setTimeout(flushSave, SAVE_MAX_WAIT_MS);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushSave();
});
window.addEventListener('beforeunload', flushSave);

async function load() {
  const state = await activeAdapter.load();
  if (!state) return false;

  courses = state.courses;
  activeCourseId = state.activeCourseId;
  nextId = state.nextId;
  nextBlockId = state.nextBlockId;
  nextLessonId = state.nextLessonId;
  nextCourseId = state.nextCourseId;
  nextTimetableId = state.nextTimetableId;
  nextNoteId = state.nextNoteId;
  profile = state.profile || defaultProfile();

  adoptCourse(activeCourse());
  await updateProfileDetails();
  return true;
}

// ── Vault connection ─────────────────────────────────────────
// File System Access API is Chromium-only (Chrome/Edge/Opera; not Firefox
// or Safari) — feature-detected once. A browser without it still shows the
// vault row (disabled, with an explanatory note) rather than hiding it —
// see updateStorageOptions() — so the option isn't just invisible on the
// browsers where users would look for it most.
const vaultSupported = 'showDirectoryPicker' in window;

// Set by tryAutoReconnect() when a vault was connected in an earlier
// session but its permission has since lapsed — requestPermission() needs
// a user gesture, so this waits for switchStorageMode('vault') (via
// reconnectVault()) rather than re-requesting automatically. Cleared once
// reconnected (or once the user picks a different folder/backend instead).
let pendingVaultReconnectHandle = null;

// `isMigration`: true means the current in-memory state came from plain
// localStorage (not already synced anywhere) — the chosen folder gets
// seeded from it unconditionally. False (switching from a vault or cloud
// already in progress, or nothing local worth preferring) tries loading
// the folder's own content first and only falls back to seeding it if
// that comes back empty — the same as switching between two
// already-populated vaults should behave.
async function pickNewVault(isMigration) {
  let handle;
  try {
    handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  } catch {
    return; // Cancelled — leave the current adapter exactly as it was.
  }

  flushSave(); // Anything pending for the outgoing adapter goes there first.

  if (isMigration) {
    const seed = createVaultAdapter(handle);
    await seed.save(snapshot());
    activeAdapter = seed;
  } else {
    activeAdapter = createVaultAdapter(handle);
    if (!(await load())) {
      // Empty folder: seed it from what's currently loaded rather than
      // wiping the UI back to a single blank course.
      await activeAdapter.save(snapshot());
    }
  }
  activeAdapterKind = 'vault';
  pendingVaultReconnectHandle = null;

  // Same reasoning as useCloudStorage()'s matching cleanup the other way:
  // a stale preference here wouldn't bite immediately (tryAutoReconnect()
  // above finds this vault's own now-stored handle first every time, same
  // as it always has), but it would resurface — and silently override
  // this just-made choice — the moment that reconnect ever fails (revoked
  // folder permission, a different browser profile, ...), since the
  // cloud-restore guard only checks activeAdapterKind, not how it got there.
  localStorage.removeItem(CLOUD_STORAGE_PREFERENCE_KEY);
  await vaultHandleStore.saveHandle(handle);
  // The migration branch above doesn't go through load() (it seeds the
  // vault instead of reading from it), so it wouldn't otherwise pick up
  // vault's newly-available avatar capability — see updateProfileDetails().
  // Harmless to call again in the non-migration branch, which already did.
  await updateProfileDetails();
  render();
}

async function reconnectVault() {
  const handle = pendingVaultReconnectHandle;
  if (!handle || (await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') return;
  activeAdapter = createVaultAdapter(handle);
  activeAdapterKind = 'vault';
  pendingVaultReconnectHandle = null;
  await load();
  render();
}

// Runs once at startup if a vault was connected in an earlier session.
// queryPermission() doesn't need a user gesture, so a still-granted vault
// reconnects with no click at all; requestPermission() does, though, so a
// lapsed grant waits in pendingVaultReconnectHandle for reconnectVault()
// instead of re-requesting automatically.
async function tryAutoReconnect() {
  if (!vaultSupported) return;

  const handle = await vaultHandleStore.loadHandle();
  if (!handle) return;

  if ((await handle.queryPermission({ mode: 'readwrite' })) === 'granted') {
    activeAdapter = createVaultAdapter(handle);
    activeAdapterKind = 'vault';
    await load();
    render();
    return;
  }

  pendingVaultReconnectHandle = handle;
}

// ── Profile panel ────────────────────────────────────────────
// A floating popover off #profile-btn (top-right, always visible) rather
// than pinned in the sidebar — same transparent-backdrop shape as the
// dialogs below, just non-modal in spirit (nothing here demands an
// answer before the rest of the app is usable again, unlike e.g.
// #add-course-dialog). Holds #account-status and #storage-options — see
// updateAccountStatus()/updateStorageOptions() for their content.
function openProfilePanel() {
  document.getElementById('profile-panel-backdrop').hidden = false;
  const panel = document.getElementById('profile-panel');
  panel.hidden = false;
  positionPopover(panel, document.getElementById('profile-btn'));
}

function closeProfilePanel() {
  document.getElementById('profile-panel-backdrop').hidden = true;
  document.getElementById('profile-panel').hidden = true;
}

// ── Account (cloud sign-in) ──────────────────────────────────
// A signed-in session is entirely separate from storage — see auth.js's
// header comment and activeAdapterKind's above. Identity only: which
// storage backend is active lives in #storage-options below, not here, so
// signing in never silently changes where a course is saved.
function updateAccountStatus() {
  const label = document.getElementById('account-status-label');
  const action = document.getElementById('account-status-action');

  const user = getCurrentUser();
  if (user) {
    label.textContent = `Signed in: ${user.email}`;
    action.disabled = false;
    action.textContent = 'Sign out';
    action.onclick = async () => {
      if (activeAdapterKind === 'cloud') await switchStorageMode('local');
      await signOut();
      updateAccountStatus();
    };
    return;
  }

  // No project configured yet (see supabase-config.js) — shown rather than
  // hidden, so the panel's presence doesn't silently change once it is.
  label.textContent = isSupabaseConfigured ? 'Not signed in.' : 'Online sync coming soon.';
  action.disabled = !isSupabaseConfigured;
  action.textContent = 'Sign in…';
  action.onclick = openSignInDialog;
}

// ── Share ────────────────────────────────────────────────────
// Per-course read-only viewer access — see course-invites.js for the
// actual reads/writes against course_invites (RLS-enforced there, not
// here) and the plan at /home/ian/.claude/plans/graceful-exploring-cosmos.md
// for the feature's full design. This section is just the UI layer: a
// floating popover off #course-share-btn, same shape as #profile-panel.
// Cloud-only by construction (see the plan's scope boundary) — a
// local/vault-only course has no shared backend to grant access against.
function openSharePanel() {
  closeProfilePanel();
  document.getElementById('share-panel-backdrop').hidden = false;
  const panel = document.getElementById('share-panel');
  panel.hidden = false;
  positionPopover(panel, document.getElementById('course-share-btn'));
  document.getElementById('shareInviteEmail').value = '';
  document.getElementById('shareInviteNote').value = '';
  document.getElementById('shareInviteStatus').textContent = '';
  renderShareAccessList();
}

function closeSharePanel() {
  document.getElementById('share-panel-backdrop').hidden = true;
  document.getElementById('share-panel').hidden = true;
}

function buildShareEmptyRow(message) {
  const row = document.createElement('p');
  row.className = 'share-empty';
  row.textContent = message;
  return row;
}

// One row per invite, pending or accepted alike — same compact bordered-row
// shape as buildTimetableCompactRow(), own class names rather than reusing
// .timetable-* directly (see .share-access-row's own comment in style.css).
// Status and the optional invited_as note ride along in the same label,
// " · "-joined — the same convention courseLabel()/the printed card footer
// use, rather than a separate pill needing its own styling.
function buildShareAccessRow(invite) {
  const row = document.createElement('div');
  row.className = 'share-access-row';

  const label = document.createElement('span');
  label.className = 'share-access-label';
  label.textContent = [
    invite.invitedEmail,
    invite.status === 'accepted' ? 'Accepted' : 'Pending',
    invite.invitedAs,
  ].filter(Boolean).join(' · ');
  row.appendChild(label);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'header-btn share-access-remove';
  remove.textContent = '×';
  remove.title = 'Remove access';
  remove.addEventListener('click', () => revokeAccess(invite, remove));
  row.appendChild(remove);

  return row;
}

// Re-queries on every open/change rather than keeping its own state —
// invites aren't part of the regular save()/render() cycle (they live in
// their own Postgres table, not the course JSON), so this is simpler than
// threading them through snapshot()/load() for a panel that's opened
// occasionally, not on every keystroke.
async function renderShareAccessList() {
  const gate = document.getElementById('share-cloud-gate');
  const body = document.getElementById('share-body');

  if (activeAdapterKind !== 'cloud') {
    gate.hidden = false;
    body.hidden = true;
    return;
  }
  gate.hidden = true;
  body.hidden = false;

  const list = document.getElementById('share-access-list');
  list.replaceChildren();

  const user = getCurrentUser();
  const client = await getSupabaseClient();
  if (!user || !client) return;

  try {
    const invites = await listCourseAccess(client, user.id, activeCourseId);
    if (!invites.length) {
      list.appendChild(buildShareEmptyRow('No one has viewer access to this course yet.'));
    } else {
      invites.forEach(invite => list.appendChild(buildShareAccessRow(invite)));
    }
  } catch (error) {
    list.appendChild(buildShareEmptyRow(error.message));
  }
}

async function sendInvite() {
  const status = document.getElementById('shareInviteStatus');
  const email = document.getElementById('shareInviteEmail').value;
  const note = document.getElementById('shareInviteNote').value;

  const user = getCurrentUser();
  const client = await getSupabaseClient();
  if (!user || !client) return;

  try {
    await inviteToCourse(client, user.id, activeCourseId, email, note);
    document.getElementById('shareInviteEmail').value = '';
    document.getElementById('shareInviteNote').value = '';
    status.textContent = '';
    await renderShareAccessList();
  } catch (error) {
    status.textContent = error.message;
  }
}

// Confirmed first, same as removing a card/course — unlike a card block's
// own × (instant, trivially re-added), losing access is a real "someone
// who could see this course can no longer" action, and here specifically
// means asking the owner before they cut off someone who was actively
// using it.
function revokeAccess(invite, anchor) {
  openConfirmDialog(
    `Remove ${invite.invitedEmail}'s access to this course?`,
    async () => {
      const client = await getSupabaseClient();
      if (!client) return;
      await revokeInvite(client, invite.id);
      await renderShareAccessList();
    },
    anchor
  );
}

// No invite needed — the owner already owns the course. Opens the viewer
// (see Step 4) scoped to their own (owner=self, course=current), directly
// answering "a teacher may want to see what their course looks like to a
// viewer." A new tab, not a navigation away from the editor — same reason
// Present opens as an overlay rather than replacing the page: the editor
// stays exactly as the owner left it underneath.
function openViewerPreview() {
  const user = getCurrentUser();
  if (!user) return;
  const url = `view/index.html?owner=${encodeURIComponent(user.id)}&course=${activeCourseId}`;
  window.open(url, '_blank');
}

// ── Profile ──────────────────────────────────────────────────
// Title/name/job/employer/photo — part of the regular saved state (see
// `profile` above, snapshot(), load()), available with no sign-in
// required, the same as everything else a course-builder.js user can set
// locally. Only the photo needs more than plain data storage — gated on
// activeAdapter.avatar (feature-detected, like activeAdapter.attachments
// for card images), absent on plain local storage.
async function updateProfileDetails() {
  document.getElementById('profileTitle').value = profile.title || '';
  document.getElementById('profileFirstName').value = profile.firstName || '';
  document.getElementById('profileLastName').value = profile.lastName || '';
  document.getElementById('profileJobTitle').value = profile.jobTitle || '';
  document.getElementById('profileEmployer').value = profile.employer || '';

  const avatarBtn = document.getElementById('profile-avatar-btn');
  const avatarNote = document.getElementById('profile-avatar-note');
  const btnAvatar = document.getElementById('profile-btn-avatar');
  const btnPlaceholder = document.getElementById('profile-btn-placeholder');
  const panelAvatar = document.getElementById('profile-avatar-img');
  const panelPlaceholder = document.getElementById('profile-avatar-placeholder');

  const supportsAvatar = Boolean(activeAdapter.avatar);
  avatarBtn.disabled = !supportsAvatar;
  avatarNote.textContent = supportsAvatar ? 'Change photo…' : 'Choose a folder or sign in to add a photo.';

  const url = (supportsAvatar && profile.avatarSrc) ? await activeAdapter.avatar.resolve(profile.avatarSrc) : null;
  btnAvatar.hidden = !url;
  btnPlaceholder.hidden = !!url;
  panelAvatar.hidden = !url;
  panelPlaceholder.hidden = !!url;
  if (url) {
    btnAvatar.src = url;
    panelAvatar.src = url;
  }
}

// Bound to each field's change event (fires on blur-with-a-real-edit, not
// every keystroke) — mutate in place and go through the regular debounced
// save(), same as every course-param field already does.
function saveProfileFields() {
  profile = {
    ...profile,
    title: document.getElementById('profileTitle').value.trim(),
    firstName: document.getElementById('profileFirstName').value.trim(),
    lastName: document.getElementById('profileLastName').value.trim(),
    jobTitle: document.getElementById('profileJobTitle').value.trim(),
    employer: document.getElementById('profileEmployer').value.trim(),
  };
  save();
  // The front cover's info box shows name/job title/employer — see
  // renderCoverView() — so an edit here needs to reach it live, the same
  // as any other params field's generic input handler already does.
  renderCoverView();
}

async function uploadProfileAvatar(file) {
  if (!activeAdapter.avatar) return;

  const note = document.getElementById('profile-avatar-note');
  note.textContent = 'Uploading…';
  try {
    const { src } = await activeAdapter.avatar.save(file);
    profile = { ...profile, avatarSrc: src };
    save();
  } catch (error) {
    console.error('[course-builder] avatar upload failed', error);
  } finally {
    await updateProfileDetails();
  }
}

// ── Storage options ──────────────────────────────────────────
// One radio group for all three backends — see index.html's #storage-options
// for why this replaced three separately-evolved controls. Reflects
// activeAdapterKind; switchStorageMode() below is what a click actually does.
function updateStorageOptions() {
  const vaultDetail = document.getElementById('storageModeVaultDetail');
  const cloudRadio = document.getElementById('storageModeCloud');
  const cloudDetail = document.getElementById('storageModeCloudDetail');

  document.getElementById('storageModeLocal').checked = activeAdapterKind === 'local';

  const vaultRadio = document.getElementById('storageModeVault');
  vaultRadio.disabled = !vaultSupported;
  if (vaultSupported) {
    vaultRadio.checked = activeAdapterKind === 'vault';
    if (activeAdapterKind === 'vault') {
      vaultDetail.textContent = `Saved to: ${activeAdapter.describe().label}`;
    } else if (pendingVaultReconnectHandle) {
      vaultDetail.textContent = `Not connected to "${pendingVaultReconnectHandle.name}" — click to reconnect.`;
    } else {
      vaultDetail.textContent = 'Real files you choose where to save.';
    }
  } else {
    vaultDetail.textContent = 'Requires Chrome, Edge, or Opera browsers.';
  }

  const user = getCurrentUser();
  cloudRadio.checked = activeAdapterKind === 'cloud';
  cloudRadio.disabled = !user;
  cloudDetail.textContent = user ? 'Sync course data across your devices.' : 'Sign in below to enable.';
}

// The one gesture that actually switches activeAdapter — clicking a row
// (even the already-active one) re-runs that mode's setup, which doubles
// as vault's "change folder" and reconnectVault()'s retry once connected.
// Each branch's own function updates activeAdapterKind on success (or
// leaves it alone on cancel/failure); updateStorageOptions() afterward
// re-syncs the radios either way, undoing the browser's own immediate
// (pre-click-handler) checked-state change on a cancelled/failed switch.
async function switchStorageMode(mode) {
  if (mode === 'local') {
    await useLocalStorage();
  } else if (mode === 'vault') {
    if (pendingVaultReconnectHandle) await reconnectVault();
    else await pickNewVault(activeAdapterKind === 'local');
  } else if (mode === 'cloud') {
    await useCloudStorage(activeAdapterKind === 'local');
  }
  updateStorageOptions();
}

// `isMigration`: true means the current in-memory state came from plain
// localStorage (not already synced anywhere) — seed the cloud copy from it
// unconditionally. False (switching from a vault, or nothing local worth
// preferring) tries loading the cloud copy first and only falls back to
// seeding it if that comes back empty.
async function useCloudStorage(isMigration) {
  const user = getCurrentUser();
  const client = await getSupabaseClient();
  if (!user || !client) return;

  flushSave();
  const adapter = createSupabaseAdapter(client, user.id);

  if (isMigration) {
    await adapter.save(snapshot());
    activeAdapter = adapter;
  } else {
    activeAdapter = adapter;
    if (!(await load())) {
      await activeAdapter.save(snapshot());
    }
  }
  activeAdapterKind = 'cloud';

  localStorage.setItem(CLOUD_STORAGE_PREFERENCE_KEY, '1');
  // Forgets a previously-connected vault the same way useLocalStorage()
  // does switching the other way — without this, tryAutoReconnect() on the
  // next load still finds that stored handle, reconnects it (it runs
  // before the cloud-preference restore below even gets a chance to),
  // and sets activeAdapterKind to 'vault' — which then makes the restore's
  // own `activeAdapterKind === 'local'` guard false, silently reverting a
  // just-made "use Cloud" choice back to the old folder on every reload.
  pendingVaultReconnectHandle = null;
  await vaultHandleStore.clearHandle();
  // See pickNewVault()'s matching comment — the migration branch above
  // doesn't go through load(), so it wouldn't otherwise pick up cloud's
  // newly-available avatar capability.
  await updateProfileDetails();
  render();
}

// Back to local storage — flushes whatever was pending against the
// outgoing adapter first (same capture-before-switch safety flushSave()
// already gives pickNewVault()), then seeds localStorage from what's
// currently shown so switching away doesn't leave it stale. Forgets a
// connected vault's stored handle and clears the cloud-storage preference
// (both harmless no-ops if neither applies) so neither silently reclaims
// activeAdapter on the next reload.
async function useLocalStorage() {
  flushSave();
  activeAdapter = localStorageAdapter;
  activeAdapterKind = 'local';
  pendingVaultReconnectHandle = null;
  await activeAdapter.save(snapshot());

  localStorage.removeItem(CLOUD_STORAGE_PREFERENCE_KEY);
  await vaultHandleStore.clearHandle();
  // Plain local storage has no avatar capability — this drops the photo
  // picker back to disabled and stops trying to resolve/show a stale
  // avatarSrc that came from vault/cloud (the field itself is untouched;
  // it'll show again if this course goes back to a backend that supports it).
  await updateProfileDetails();
  render();
}

// Anchored to #profile-btn itself, not whatever triggered it — the profile
// panel closes as this opens (there's no reason to show both floating
// panels off the same icon at once), so anchoring to a button inside the
// now-hidden panel would position against a collapsed, invisible rect.
function openSignInDialog() {
  closeProfilePanel();
  document.getElementById('signInEmail').value = '';
  document.getElementById('signInStatus').textContent = '';
  document.getElementById('sign-in-dialog-backdrop').hidden = false;
  const dialog = document.getElementById('sign-in-dialog');
  dialog.hidden = false;
  positionPopover(dialog, document.getElementById('profile-btn'));
  document.getElementById('signInEmail').focus();
}

function closeSignInDialog() {
  document.getElementById('sign-in-dialog-backdrop').hidden = true;
  document.getElementById('sign-in-dialog').hidden = true;
}

async function sendSignInLink() {
  const email = document.getElementById('signInEmail').value.trim();
  const status = document.getElementById('signInStatus');
  if (!email) return;
  try {
    await signInWithEmail(email);
    status.textContent = 'Check your email for a sign-in link.';
  } catch (error) {
    status.textContent = error.message;
  }
}

// ── Lessons ──────────────────────────────────────────────────
function addLesson() {
  const lesson = newLesson();
  lessons.push(lesson);
  activeLessonId = lesson.id;
  activeCourse().activeLessonId = activeLessonId;
  cards = lesson.cards;
  save();
  render();
}

function removeLesson(id) {
  lessons = lessons.filter(lesson => lesson.id !== id);
  activeCourse().lessons = lessons;
  if (lessons.length === 0) lessons.push(newLesson());
  if (!lessons.some(lesson => lesson.id === activeLessonId)) activeLessonId = lessons[0].id;
  activeCourse().activeLessonId = activeLessonId;
  cards = activeLesson().cards;
  save();
  render();
}

function switchLesson(id) {
  // Clicking a lesson clearly means "show me that lesson" — even the
  // already-active one, if the cover's what's actually on screen right
  // now — so this runs before the early return below, not after it.
  closeCoverView();
  if (id === activeLessonId) return;
  activeLessonId = id;
  activeCourse().activeLessonId = activeLessonId;
  cards = activeLesson().cards;
  save();
  render();
  // Left open across a lesson switch, the print panel's card list would
  // otherwise still show the lesson just left — jump it back to the new
  // lesson's own default (all checked) rather than go stale.
  if (printPanelOpen) buildPrintCardList();
}

function moveLesson(from, to) {
  if (to > from) to--;
  if (from === to) return;

  const [moved] = lessons.splice(from, 1);
  lessons.splice(to, 0, moved);
  save();
  render();
}

// ── Courses ──────────────────────────────────────────────────
// A course's own `params` object is entirely different from the one just
// left, so — unlike a plain lesson switch — the sidebar form has to be
// repopulated from it: the same writeParams(); readParams(); pairing
// init already uses. courseCode/courseName come from the add-course dialog
// (see openAddCourseDialog/closeAddCourseDialog) rather than this function
// prompting for them itself.
function addCourse(courseCode, courseName) {
  timetableDraft = null;
  const course = newCourse(courseCode, courseName);
  courses.push(course);
  activeCourseId = course.id;
  adoptCourse(course);
  save();
  writeParams();
  readParams();
  render();
}

function removeCourse(id) {
  timetableDraft = null;
  courses = courses.filter(course => course.id !== id);
  if (!courses.some(course => course.id === activeCourseId)) activeCourseId = courses[0]?.id ?? null;
  adoptCourse(activeCourse());
  save();
  writeParams();
  readParams();
  render();
}

function switchCourse(id) {
  if (id === activeCourseId) return;
  timetableDraft = null;
  closeSharePanel();
  activeCourseId = id;
  adoptCourse(activeCourse());
  save();
  writeParams();
  readParams();
  render();
}

// ── Card set ─────────────────────────────────────────────────
function addCard() {
  cards.push({ id: nextId++, blocks: [] });
  save();
  render();
}

function removeCard(id) {
  cards = cards.filter(card => card.id !== id);
  activeLesson().cards = cards;
  save();
  render();
}

// ── Content blocks ───────────────────────────────────────────
// How many whole grid rows the body has, and how many are still free.
function bodyRows() {
  const headerH = params.header ? params.headerHeight : 0;
  const footerH = params.footer ? params.footerHeight : 0;
  const exact = (params.cardHeight - headerH - footerH) / rowHeightMm();
  // Rounded down to a whole step, so the last half row is only offered when
  // it genuinely fits.
  return Math.floor(exact / ROW_STEP) * ROW_STEP;
}

function freeRows(card) {
  const used = card.blocks.reduce((sum, block) => sum + block.h, 0);
  return bodyRows() - used;
}

function addBlock(cardId, typeId) {
  const card = cards.find(c => c.id === cardId);
  const type = blockType(typeId);
  if (!card || !type) return;

  const free = freeRows(card);
  if (free < type.minRows) return;

  // Created at its default height, or as much of it as still fits.
  const rows = Math.max(type.minRows, Math.min(type.defaultRows, free));
  const block = { id: nextBlockId++, type: type.id, h: rows, body: '' };
  // Starts at the type's usual count, trimmed down if even that wouldn't fit
  // in the rows actually available (mirrors `rows` above, one row per thing
  // plus the prompt line).
  if (type.id === 'list') block.n = Math.min(type.maxN, Math.max(type.minN, rows - 1));
  if (type.id === 'matrix') {
    block.itemHeading = '';
    block.columns = Array.from({ length: type.defaultCols }, () => ({ caption: '' }));
    // Same trim-to-fit reasoning as List, minus one row each for the
    // prompt, the table's own header row, and each rating column's legend.
    block.entries = Math.min(type.maxN, Math.max(type.minN, rows - 2 - type.defaultCols));
  }
  card.blocks.push(block);

  focusBlockId = block.id;
  save();
  render();
}

// ── Content type picker ──────────────────────────────────────
// Opens against the add-slot that was clicked, so it's obvious which card the
// block is going into. Nothing is added until a type is chosen.
function openTypePicker(cardId, anchor) {
  const card = cards.find(c => c.id === cardId);
  if (!card) return;

  const picker = document.getElementById('type-picker');
  const backdrop = document.getElementById('type-picker-backdrop');
  const options = document.getElementById('type-picker-options');
  const free = freeRows(card);

  options.replaceChildren();
  for (const type of BLOCK_TYPES) {
    const option = document.createElement('button');
    option.className = 'type-option';
    option.title = type.label;
    option.innerHTML =
      `<svg viewBox="0 0 24 24" aria-hidden="true">${type.icon}</svg>`
      + `<span>${type.label}</span>`;
    // A type that needs more rows than are left can't be chosen.
    option.disabled = free < type.minRows;
    option.addEventListener('click', () => {
      closeTypePicker();
      addBlock(cardId, type.id);
    });
    options.appendChild(option);
  }

  backdrop.hidden = false;
  picker.hidden = false;
  positionPopover(picker, anchor);
  options.querySelector('.type-option:not(:disabled)')?.focus();
}

function closeTypePicker() {
  document.getElementById('type-picker').hidden = true;
  document.getElementById('type-picker-backdrop').hidden = true;
}

function removeBlock(cardId, blockId) {
  const card = cards.find(c => c.id === cardId);
  if (!card) return;

  card.blocks = card.blocks.filter(block => block.id !== blockId);
  save();
  render();
}

// ── Block content ────────────────────────────────────────────
// The block editors themselves (buildLineEditor, buildMarkdownEditor, ...)
// live in render-card.js now, shared with the read-only viewer — see
// buildBlockContent() there. Per-card Teacher Overview below is different:
// it isn't a block at all (no block.body, just card.teacherOverview
// directly), so it stayed here.

// Per-card "Teacher Overview" — same click-to-edit interaction as a card's
// own Text block above, reimplemented rather than called through: it isn't
// stored on a block (there's no block.body here, just card.teacherOverview
// directly) and doesn't belong inside a card's own absolutely-positioned
// block layout — same reasoning initCoverBackText() already established
// for the cover's back-text box. Shown by buildCardSlot() below, one per
// card, gated on the single shared teacherOverviewOpen toggle (see
// #teacher-overview-toggle).
function buildTeacherOverviewBox(card) {
  const wrap = document.createElement('div');
  wrap.className = 'teacher-overview-box';
  // Explicit, same as .card's own width (buildCard()) — .card-slot is a
  // plain align-items:center column with no width of its own, so it sizes
  // to its widest child; a CSS width:100% on this box would then be a
  // percentage of THAT (self-referential once real text is long/unbroken
  // enough to want to grow), rather than reliably matching the card.
  wrap.style.width = `${params.cardWidth}mm`;

  const preview = document.createElement('div');
  preview.className = 'teacher-overview-preview';
  preview.tabIndex = 0;
  if (card.teacherOverview) {
    preview.innerHTML = renderMarkdown(card.teacherOverview);
  } else {
    preview.classList.add('is-empty');
    preview.textContent = 'Teacher overview…';
  }

  const editor = document.createElement('textarea');
  editor.className = 'teacher-overview-editor';
  editor.value = card.teacherOverview || '';
  editor.hidden = true;
  editor.spellcheck = false;

  const enterEditing = () => {
    preview.hidden = true;
    editor.hidden = false;
    editor.focus();
    editor.setSelectionRange(editor.value.length, editor.value.length);
  };

  preview.addEventListener('click', enterEditing);
  preview.addEventListener('focus', enterEditing);

  editor.addEventListener('blur', () => {
    card.teacherOverview = editor.value;
    save();
    render();
  });

  wrap.append(preview, editor);
  return wrap;
}

// #teacher-overview-toggle sits absolutely inside #card-row (see the CSS),
// meant to have its own middle level with a card-label caption's middle —
// measured off the first card's own label directly (rather than, say,
// #card-strip's bottom edge) so it stays level with the captions even once
// teacherOverviewOpen adds a teacher-overview box below them, taller than
// the toggle. #card-row's own bottom edge is the wrong reference entirely:
// #scratchpad-panel, its other child, has a fixed height taller than
// #card-strip, so a plain `bottom: 0` lands well below the captions.
function positionTeacherOverviewToggle() {
  const toggle = document.getElementById('teacher-overview-toggle');
  const label = document.querySelector('.card-label');
  if (!label) {
    toggle.style.bottom = '0px';
    return;
  }
  const cardRow = document.getElementById('card-row').getBoundingClientRect();
  const labelRect = label.getBoundingClientRect();
  const labelCenter = labelRect.top + labelRect.height / 2;
  const toggleBottomEdge = labelCenter + toggle.offsetHeight / 2;
  toggle.style.bottom = `${cardRow.bottom - toggleBottomEdge}px`;
}

// ── Present ──────────────────────────────────────────────────
// One slide per card in the active lesson, walked with #present-prev/next
// or the arrow keys — see #present-btn, in the sidebar. Not saved (a view
// session, not data), same as scratchpadOpen/teacherOverviewOpen above.
let presentIndex = 0;

function openPresentView() {
  if (cards.length === 0) return;
  presentIndex = 0;
  document.getElementById('present-view').hidden = false;
  renderPresentSlide();
  // Best-effort — requires a user gesture, which the click that got here
  // already was, but this stays harmless (the fixed-position overlay
  // already fills the viewport either way) if the browser refuses it.
  document.documentElement.requestFullscreen?.().catch(() => {});
}

function closePresentView() {
  document.getElementById('present-view').hidden = true;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

function renderPresentSlide() {
  const total = cards.length;
  if (total === 0) { closePresentView(); return; }
  presentIndex = clamp(presentIndex, 0, total - 1);
  paintPresentSlide(cards[presentIndex], {
    index: presentIndex, total, lessonTitle: activeLesson().title,
    courseCode: params.courseCode, courseName: params.courseName,
  });
}

function presentStep(delta) {
  presentIndex += delta;
  renderPresentSlide();
}

// Set by addBlock, consumed by the next render — the element to focus doesn't
// exist until that render has run.
let focusBlockId = null;

function focusBlock(blockEl) {
  // Checked ahead of .card-block-markdown below — Key Idea nests one for
  // its explanation, but naming the idea comes first.
  const term = blockEl.querySelector('.card-block-key-idea-term');
  if (term) {
    term.focus();
    return;
  }

  const markdown = blockEl.querySelector('.card-block-markdown');
  if (markdown?.enterEditing) {
    markdown.enterEditing();
    return;
  }

  const link = blockEl.querySelector('.card-block-link');
  if (link?.focusEditor) {
    link.focusEditor();
    return;
  }

  const image = blockEl.querySelector('.card-block-image');
  if (image?.focusEditor) {
    image.focusEditor();
    return;
  }

  const boxed = blockEl.querySelector('.card-block-boxed');
  if (boxed?.focusEditor) {
    boxed.focusEditor();
    return;
  }

  const quote = blockEl.querySelector('.card-block-quote-text');
  if (quote) {
    quote.focus();
    return;
  }

  blockEl.querySelector('.card-block-heading')?.focus();
}

// buildPlainEditor/buildFootnoteEditor/buildQuoteEditor/buildAutoGrowPrompt/
// buildListEditor now live in render-card.js, alongside buildBlockContent().
// changeListCount/changeMatrixEntries/changeMatrixColumns below stay here —
// they're real hook implementations (mutate state, call save()/render()),
// wired to render-card.js's buildListEditor/buildMatrixEditor via
// configureRenderCard() near the bottom of this file.

// Bumps a "list" block's count, growing the block itself if its current
// height can no longer fit one row per thing plus the prompt line.
function changeListCount(block, card, delta) {
  const type = blockType('list');
  const next = Math.min(type.maxN, Math.max(type.minN, listCount(block) + delta));
  if (next === listCount(block)) return;

  const neededRows = 1 + next;
  if (neededRows > block.h + freeRows(card)) return;

  block.n = next;
  if (block.h < neededRows) block.h = neededRows;
  save();
  render();
}

function changeMatrixEntries(block, card, delta) {
  const type = blockType('matrix');
  const current = matrixEntryCount(block);
  const next = Math.min(type.maxN, Math.max(type.minN, current + delta));
  if (next === current) return;

  const neededRows = 2 + next + matrixColumns(block).length;
  if (neededRows > block.h + freeRows(card)) return;

  block.entries = next;
  if (block.h < neededRows) block.h = neededRows;
  save();
  render();
}

// Growing appends a fresh blank column; shrinking drops the last one — the
// first column (and whatever's typed into it) is never the one removed.
function changeMatrixColumns(block, card, delta) {
  const type = blockType('matrix');
  const columns = matrixColumns(block);
  const currentCount = columns.length;
  const nextCount = Math.min(type.maxCols, Math.max(type.minCols, currentCount + delta));
  if (nextCount === currentCount) return;

  const neededRows = 2 + matrixEntryCount(block) + nextCount;
  if (neededRows > block.h + freeRows(card)) return;

  block.columns = nextCount > currentCount
    ? [...columns, { caption: '' }]
    : columns.slice(0, nextCount);
  if (block.h < neededRows) block.h = neededRows;
  save();
  render();
}

// buildMatrixStepper/buildMatrixEditor/buildKeyIdeaEditor now live in
// render-card.js alongside buildBlockContent().

// ── Images ───────────────────────────────────────────────────
// Blocks store a reference, never a URL. Everything that needs to display one
// goes through here, so moving storage is a change to these two functions
// alone — the first backend this actually gets exercised on: a vault-mode
// reference (`attachments/<hash>.<ext>`, vault-relative to the course
// folder) resolves through the active adapter's own attachments capability;
// anything else (a dev-server-issued `/images/courses/...` path) is handled
// exactly as before.
async function resolveImageSrc(reference) {
  if (!reference) return '';
  if (activeAdapter.attachments && reference.startsWith('attachments/')) {
    return activeAdapter.attachments.resolve(activeCourse().id, reference);
  }
  return reference;
}

async function uploadImage(file) {
  if (!file) throw new Error('No file.');

  if (activeAdapter.attachments) {
    return activeAdapter.attachments.save(activeCourse().id, file);
  }

  const response = await fetch(
    `/api/upload-image?course=${encodeURIComponent(params.courseCode || params.courseName)}`,
    { method: 'POST', headers: { 'content-type': file.type }, body: file }
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Upload failed (${response.status}).`);
  return data;
}

// Link sources (SOURCE_ICONS/UNKNOWN_SOURCE/linkSource) now live in
// render-card.js, used only by buildLinkEditor there.

// ── Image ────────────────────────────────────────────────────
// IMAGE_FITS/DEFAULT_IMAGE_FIT/imageFit() are imported from render-card.js —
// buildImageEditor there needs them too, so it's the single definition.
let editingImage = null;
// Fit previews live — you can't judge a crop from a label — so the value it
// started at is kept in order to put it back on Cancel.
let editingImageFitBefore = null;

function syncImageFitButtons(fit) {
  document.querySelectorAll('#imageFit button').forEach(button => {
    button.classList.toggle('is-active', button.dataset.fit === fit);
  });
}

function openImageEditor(block, anchor) {
  if (editingImage === block) return;
  editingImage = block;
  editingImageFitBefore = imageFit(block);

  const editor = document.getElementById('image-editor');
  document.getElementById('imageAlt').value = block.alt || '';
  syncImageFitButtons(imageFit(block));
  document.getElementById('image-editor-backdrop').hidden = false;
  editor.hidden = false;
  positionPopover(editor, anchor);
  document.getElementById('imageAlt').focus();
}

function dismissImageEditor() {
  editingImage = null;
  editingImageFitBefore = null;
  document.getElementById('image-editor').hidden = true;
  document.getElementById('image-editor-backdrop').hidden = true;
}

function cancelImageEditor() {
  const block = editingImage;
  const previousFit = editingImageFitBefore;
  dismissImageEditor();
  if (!block || previousFit === null) return;

  // Alt was never applied, but fit was — undo it.
  if (imageFit(block) !== previousFit) {
    block.fit = previousFit;
    save();
    render();
  }
}

function setImageFit(fit) {
  if (!editingImage || !IMAGE_FITS.includes(fit)) return;
  editingImage.fit = fit;
  syncImageFitButtons(fit);
  save();
  // Rebuilds the card; the popover sits outside it and stays put.
  render();
}

function closeImageEditor() {
  const block = editingImage;
  dismissImageEditor();
  if (!block) return;

  block.alt = document.getElementById('imageAlt').value.trim();
  save();
  render();
}

// buildImageEditor() now lives in render-card.js, wired via
// configureRenderCard()'s uploadImage/resolveImageSrc/openImageEditor hooks.

// renderQrSvg()/buildLinkEditor() now live in render-card.js, wired via
// configureRenderCard()'s openLinkEditor hook (implemented below).
let editingLink = null;

function setLinkNote(message, isError = false) {
  const note = document.getElementById('link-editor-note');
  note.textContent = message;
  note.classList.toggle('is-error', isError);
}

// Asks the dev server to read the page's OpenGraph tags. Only fills fields the
// author hasn't already written in — a hand-written title usually beats the
// site's own, which tends to be far too long for a pocket card.
async function fetchLinkMeta() {
  const url = document.getElementById('linkUrl').value.trim();
  const title = document.getElementById('linkTitle');
  const description = document.getElementById('linkDescription');
  const button = document.getElementById('linkFetch');

  if (!url) {
    setLinkNote('Paste a URL first.', true);
    return;
  }

  button.disabled = true;
  setLinkNote('Fetching…');

  try {
    let response = await fetch(`/api/link-meta?url=${encodeURIComponent(url)}`);
    let data = await response.json().catch(() => ({}));
    
    // If we get 404, we're on static hosting - use fallback
    if (!response.ok && response.status === 404) {
      // Fallback to r.jina.ai proxy service
      const fallbackUrl = `https://r.jina.ai/http://${encodeURIComponent(url)}`;
      response = await fetch(fallbackUrl);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch link metadata: ${response.status}`);
      }
      
      const text = await response.text();
      data = parseJinaResponse(text, url);
    } else if (!response.ok) {
      throw new Error(data.error || `Request failed (${response.status}).`);
    }

    const filled = [];
    if (data.title && !title.value.trim()) { title.value = data.title; filled.push('title'); }
    if (data.description && !description.value.trim()) {
      description.value = data.description;
      filled.push('description');
    }

    setLinkNote(
      filled.length ? `Filled ${filled.join(' and ')}.`
      : 'Nothing to fill — clear a field to replace it.'
    );
  } catch (error) {
    // Most likely cause: opened from file://, so there's no dev server.
    const offline = error instanceof TypeError;
    setLinkNote(
      offline ? 'No dev server — run npm start, or type the fields in.' : error.message,
      true
    );
  } finally {
    button.disabled = false;
  }
}

// Helper function to parse r.jina.ai response for link metadata
function parseJinaResponse(text, sourceUrl) {
  // Clean up the text
  const cleaned = text.trim();
  
  // Split by double newlines to get paragraphs
  const paragraphs = cleaned.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 0);
  
  // Extract title and description from paragraphs
  let title = paragraphs.length > 0 ? paragraphs[0].substring(0, 200) : '';
  let description = paragraphs.length > 1 ? paragraphs[1].substring(0, 300) : '';
  
  // Fallback: if paragraph approach didn't work well, use first few lines
  if (!title || !description) {
    const lines = cleaned.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (!title && lines.length > 0) {
      // Title: first substantial line
      const titleLine = lines.find(l => l.length > 10);
      if (titleLine) {
        const titleMatch = titleLine.match(/^[^.!?]{10,200}[.!?]?/);
        if (titleMatch) {
          title = titleMatch[0];
        }
      }
    }
    if (!description && lines.length > 1) {
      // Description: second substantial line or first few sentences
      const descLines = lines.slice(1, 3); // Take up to 2 lines after title
      if (descLines.length > 0) {
        description = descLines.join(' ').substring(0, 300);
      }
    }
  }
  
  return {
    url: sourceUrl,
    title: title.trim(),
    description: description.trim()
  };
}

function openLinkEditor(block, anchor) {
  if (editingLink === block) return;
  editingLink = block;

  const editor = document.getElementById('link-editor');
  const backdrop = document.getElementById('link-editor-backdrop');
  const url = document.getElementById('linkUrl');
  const slug = document.getElementById('linkSlug');
  const title = document.getElementById('linkTitle');
  const description = document.getElementById('linkDescription');

  url.value = block.url || '';
  slug.value = block.slug || '';
  title.value = block.title || '';
  description.value = block.body || '';
  setLinkNote('');

  backdrop.hidden = false;
  editor.hidden = false;
  positionPopover(editor, anchor);
  url.focus();
  url.select();
}

// Discards whatever is in the fields. Nothing is written to the block until
// it's confirmed, so there is nothing to undo.
function cancelLinkEditor() {
  dismissLinkEditor();
}

// Hides the popover without writing anything back — for when the block being
// edited has gone away.
function dismissLinkEditor() {
  editingLink = null;
  document.getElementById('link-editor').hidden = true;
  document.getElementById('link-editor-backdrop').hidden = true;
}

function closeLinkEditor() {
  const block = editingLink;
  dismissLinkEditor();
  if (!block) return;

  block.url = document.getElementById('linkUrl').value.trim();
  block.slug = sanitizeSlug(document.getElementById('linkSlug').value);
  block.title = document.getElementById('linkTitle').value.trim();
  block.body = document.getElementById('linkDescription').value.trim();
  save();
  render();
}

// Matches what actually has to survive into a URL path segment — lowercase,
// hyphens for spaces, nothing else. Cleans up on save rather than fighting
// the user keystroke-by-keystroke while they're still typing.
function sanitizeSlug(value) {
  return value.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '');
}

// boxContent()/buildBlockContent() now live in render-card.js.

// ── Dragging a block ─────────────────────────────────────────
// Kept separate from the card drag: each checks its own state and ignores the
// other's, so a block drag bubbling up to the card slot can't be read as a
// card reorder.
let dragBlockRef = null;

function clearBlockDropMarkers() {
  document.querySelectorAll('.drop-above, .drop-below').forEach(el => {
    el.classList.remove('drop-above', 'drop-below');
  });
  document.querySelectorAll('.card-body.is-rejecting, .card-body.is-shrinking').forEach(el => {
    el.classList.remove('is-rejecting', 'is-shrinking');
  });
}

// "list" is the one type whose minimum isn't a per-type constant — it grows
// with the block's own count, so it reads its instance data instead of the
// type's (add-time-only) minRows.
function minRowsFor(block) {
  if (block.type === 'list') return 1 + listCount(block);
  // 1 prompt row + 1 table-header row (item/rating headers) + one row per
  // item entry + one legend line per rating column.
  if (block.type === 'matrix') return 2 + matrixEntryCount(block) + matrixColumns(block).length;
  return blockType(block.type)?.minRows ?? MIN_BLOCK_ROWS;
}

// A block shrinks to whatever the target card has free, so it only needs room
// for its type's minimum. Its own card always has room for it.
function blockFits(block, fromCard, toCard) {
  return fromCard === toCard || freeRows(toCard) >= minRowsFor(block);
}

// True when the move will cost the block some of its height.
function blockWillShrink(block, fromCard, toCard) {
  return fromCard !== toCard && freeRows(toCard) < block.h;
}

function moveBlockTo(fromCard, fromIndex, toCard, toIndex) {
  if (fromCard === toCard) {
    // Lifting the block out shifts everything after it up one.
    if (toIndex > fromIndex) toIndex--;
    if (fromIndex === toIndex) return;
    const [moved] = fromCard.blocks.splice(fromIndex, 1);
    fromCard.blocks.splice(toIndex, 0, moved);
  } else {
    const free = freeRows(toCard);
    const [moved] = fromCard.blocks.splice(fromIndex, 1);
    // Trimmed to fit, but never below what the type needs.
    moved.h = Math.max(minRowsFor(moved), Math.min(moved.h, free));
    toCard.blocks.splice(toIndex, 0, moved);
  }

  save();
  render();
}

// `index` is where this element sits; the drop point depends on which half of
// it the pointer is over. The add-slot always means "last".
function makeBlockDropTarget(el, card, index) {
  const isAddSlot = el.classList.contains('card-block-add');
  let insertIndex = index;

  el.addEventListener('dragover', event => {
    if (!dragBlockRef) return;
    event.stopPropagation();
    clearBlockDropMarkers();

    // Not preventing the default is what makes a drop impossible. Only reached
    // when even the type's minimum won't fit.
    if (!blockFits(dragBlockRef.block, dragBlockRef.card, card)) {
      el.closest('.card-body')?.classList.add('is-rejecting');
      return;
    }

    // Flagged up front, so losing height on drop isn't a surprise.
    if (blockWillShrink(dragBlockRef.block, dragBlockRef.card, card)) {
      el.closest('.card-body')?.classList.add('is-shrinking');
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';

    if (isAddSlot) {
      el.classList.add('drop-above');
      insertIndex = card.blocks.length;
      return;
    }

    const rect = el.getBoundingClientRect();
    const below = event.clientY > rect.top + rect.height / 2;
    el.classList.add(below ? 'drop-below' : 'drop-above');
    insertIndex = below ? index + 1 : index;
  });

  el.addEventListener('drop', event => {
    if (!dragBlockRef) return;
    event.preventDefault();
    event.stopPropagation();

    const { card: fromCard, index: fromIndex, block } = dragBlockRef;
    dragBlockRef = null;
    clearBlockDropMarkers();

    // Re-checked here rather than trusting dragover to have refused, so the
    // rule holds wherever a drop comes from.
    if (!blockFits(block, fromCard, card)) return;
    moveBlockTo(fromCard, fromIndex, card, insertIndex);
  });
}

// A grip rather than the whole block, so dragging never competes with
// selecting text in the editors a block contains.
function makeBlockDraggable(blockEl, card, index, block) {
  blockEl.draggable = false;

  const grip = document.createElement('div');
  grip.className = 'card-block-grip';
  grip.title = 'Drag to reorder';
  grip.addEventListener('mousedown', () => { blockEl.draggable = true; });
  blockEl.appendChild(grip);

  blockEl.addEventListener('dragstart', event => {
    dragBlockRef = { card, index, block };
    blockEl.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', `block:${index}`);
    event.stopPropagation();
  });

  blockEl.addEventListener('dragend', event => {
    event.stopPropagation();
    dragBlockRef = null;
    blockEl.draggable = false;
    blockEl.classList.remove('dragging');
    clearBlockDropMarkers();
  });

  makeBlockDropTarget(blockEl, card, index);
}

// ── Resizing a block ─────────────────────────────────────────
// Pointer events rather than HTML5 drag: this is a resize, and it has to stay
// out of the way of the block dragging that comes later. Heights move in whole
// grid rows, bounded below by the type's minimum and above by the free space
// left on the card.
function makeResizable(blockEl, card, block) {
  const handle = document.createElement('div');
  handle.className = 'card-block-resize';
  handle.title = 'Drag to resize';

  handle.addEventListener('pointerdown', event => {
    event.preventDefault();
    event.stopPropagation();

    const minRows = minRowsFor(block);
    const maxRows = block.h + freeRows(card);
    // Measured rather than assumed, so it survives browser zoom.
    const pxPerRow = blockEl.getBoundingClientRect().height / block.h;
    const startY = event.clientY;
    const startRows = block.h;
    let rows = startRows;

    const body = blockEl.parentElement;
    body.classList.add('is-resizing');

    // Capture keeps the cursor sane over other elements, but the drag doesn't
    // depend on it — the listeners below are on window, so the pointer leaving
    // this 6px strip can't drop the drag.
    try { handle.setPointerCapture(event.pointerId); } catch { /* no active pointer */ }

    // Resize the element only; the model is committed on release, so a full
    // re-render never tears the element out from under the pointer.
    const onMove = moveEvent => {
      const delta = snapRows((moveEvent.clientY - startY) / pxPerRow);
      const next = snapRows(Math.min(maxRows, Math.max(minRows, startRows + delta)));
      if (next === rows) return;
      rows = next;
      blockEl.style.height = `${rows * rowHeightMm()}mm`;
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      body.classList.remove('is-resizing');

      if (rows !== startRows) {
        block.h = rows;
        save();
      }
      render();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });

  blockEl.appendChild(handle);
}

// Move the card at `from` so it lands at insertion point `to`, where `to` is
// counted against the list as it stands before the card is lifted out.
function moveCard(from, to) {
  if (to > from) to--;
  if (from === to) return;

  const [moved] = cards.splice(from, 1);
  cards.splice(to, 0, moved);
  save();
  render();
}

// ── Drag to reorder ──────────────────────────────────────────
let dragSrcIndex = null;

// HTML5 drag has no notion of a handle, so the slot is only made draggable
// while the pointer is down on one. Anything else in the card — content
// blocks, later — is then free to start a drag of its own.
function useAsDragHandle(el, slot) {
  el.classList.add('card-drag-handle');
  el.addEventListener('mousedown', () => { slot.draggable = true; });
}

function clearDropMarkers() {
  document.querySelectorAll('.card-slot').forEach(el => {
    el.classList.remove('drop-before', 'drop-after');
  });
}

// Marks which side of `slot` the card would land on, and returns that
// insertion index. The add-slot always means "put it last".
function markDropTarget(slot, insertIndex, event) {
  const rect = slot.getBoundingClientRect();
  const after = event.clientX > rect.left + rect.width / 2;

  clearDropMarkers();
  if (slot.classList.contains('is-add-slot')) {
    slot.classList.add('drop-before');
    return cards.length;
  }

  slot.classList.add(after ? 'drop-after' : 'drop-before');
  return after ? insertIndex + 1 : insertIndex;
}

// Wires a slot as a drop target. `indexFor` resolves the insertion point at
// drop time, since it depends on which half of the slot the pointer is over.
function makeDropTarget(slot, index) {
  let insertIndex = index;

  slot.addEventListener('dragover', event => {
    if (dragSrcIndex === null) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    insertIndex = markDropTarget(slot, index, event);
  });

  slot.addEventListener('drop', event => {
    if (dragSrcIndex === null) return;
    event.preventDefault();
    const from = dragSrcIndex;
    dragSrcIndex = null;
    clearDropMarkers();
    moveCard(from, insertIndex);
  });
}

// ── Lesson list ──────────────────────────────────────────────
// A dedicated drag-to-reorder implementation rather than a generalization of
// the card version above — same pattern this file already uses for blocks
// (see makeBlockDropTarget), just oriented vertically like the sidebar list
// it belongs to, and over a single flat array like the card version's splice.
let dragLessonSrcIndex = null;

function clearLessonDropMarkers() {
  document.querySelectorAll('.lesson-row').forEach(el => {
    el.classList.remove('drop-before', 'drop-after');
  });
}

function markLessonDropTarget(row, insertIndex, event) {
  const rect = row.getBoundingClientRect();
  const after = event.clientY > rect.top + rect.height / 2;

  clearLessonDropMarkers();
  row.classList.add(after ? 'drop-after' : 'drop-before');
  return after ? insertIndex + 1 : insertIndex;
}

function makeLessonDropTarget(row, index) {
  let insertIndex = index;

  row.addEventListener('dragover', event => {
    if (dragLessonSrcIndex === null) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    insertIndex = markLessonDropTarget(row, index, event);
  });

  row.addEventListener('drop', event => {
    if (dragLessonSrcIndex === null) return;
    event.preventDefault();
    const from = dragLessonSrcIndex;
    dragLessonSrcIndex = null;
    clearLessonDropMarkers();
    moveLesson(from, insertIndex);
  });
}

function buildLessonRow(lesson, index) {
  const row = document.createElement('div');
  row.className = 'lesson-row' + (lesson.id === activeLessonId ? ' is-active' : '');
  row.dataset.lessonId = lesson.id;

  const handle = document.createElement('span');
  handle.className = 'lesson-drag-handle';
  handle.textContent = '⋮⋮';
  handle.addEventListener('mousedown', () => { row.draggable = true; });
  row.appendChild(handle);

  const title = document.createElement('span');
  title.className = 'lesson-row-title';
  title.textContent = lesson.title || 'Untitled lesson';
  row.appendChild(title);

  const count = document.createElement('span');
  count.className = 'lesson-row-count';
  count.textContent = lesson.cards.length;
  row.appendChild(count);

  const remove = document.createElement('button');
  remove.className = 'lesson-remove';
  remove.textContent = '×';
  remove.title = 'Remove this lesson';
  remove.addEventListener('click', event => {
    event.stopPropagation();
    openConfirmDialog(
      `Delete "${lesson.title || 'Untitled lesson'}"? This removes all its cards.`,
      () => removeLesson(lesson.id),
      remove
    );
  });
  row.appendChild(remove);

  row.addEventListener('click', () => switchLesson(lesson.id));

  row.addEventListener('dragstart', event => {
    dragLessonSrcIndex = index;
    row.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(index));
  });

  row.addEventListener('dragend', () => {
    dragLessonSrcIndex = null;
    row.draggable = false;
    row.classList.remove('dragging');
    clearLessonDropMarkers();
  });

  makeLessonDropTarget(row, index);

  return row;
}

function renderLessonList() {
  const list = document.getElementById('lesson-list');
  list.replaceChildren();
  lessons.forEach((lesson, index) => list.appendChild(buildLessonRow(lesson, index)));

  // Never stomps on what's being typed — only synced from other renders
  // (switching lessons, loading, removing a lesson, and so on). No active
  // lesson at all (zero courses, behind the first-run gate) just clears it.
  const titleInput = document.getElementById('workspaceLessonTitle');
  if (document.activeElement !== titleInput) titleInput.value = activeLesson()?.title ?? '';
}

// ── Timetabled classes ───────────────────────────────────────
// Stored per-course, for later use elsewhere (e.g. printing a per-lesson
// schedule) — not read by anything else yet. Referenced straight off
// activeCourse() rather than as a module-level live alias like `params`/
// `lessons`, since only the handful of functions below ever touch it.
const WEEKDAYS = [
  { key: 'mon', label: 'Monday' },
  { key: 'tue', label: 'Tuesday' },
  { key: 'wed', label: 'Wednesday' },
  { key: 'thu', label: 'Thursday' },
  { key: 'fri', label: 'Friday' },
  { key: 'sat', label: 'Saturday' },
  { key: 'sun', label: 'Sunday' },
];

// The one "Add Timetabled Class" entry currently being filled in, if any —
// not part of any course's saved `timetable` until OK commits it, so Cancel
// (or just navigating away) can drop it with nothing to undo.
let timetableDraft = null;

function startTimetableDraft() {
  timetableDraft = { day: 'mon', startTime: '09:00', length: 1, room: '' };
  render();
}

function commitTimetableDraft() {
  activeCourse().timetable.push({ id: nextTimetableId++, ...timetableDraft });
  timetableDraft = null;
  save();
  render();
}

function cancelTimetableDraft() {
  timetableDraft = null;
  render();
}

function removeTimetableClass(id) {
  const course = activeCourse();
  course.timetable = course.timetable.filter(entry => entry.id !== id);
  save();
  render();
}

// "1pm", "1:30pm" — hour without a leading zero, minutes only when the
// class doesn't start on the hour.
function formatTimetableTime(value) {
  const [h, m] = value.split(':').map(Number);
  const hour = ((h + 11) % 12) + 1;
  const period = h < 12 ? 'am' : 'pm';
  return m ? `${hour}:${String(m).padStart(2, '0')}${period}` : `${hour}${period}`;
}

// A committed class reads as one compact line — "Mon, 1pm, 3hrs, PM131" —
// rather than the input row it was entered through.
function buildTimetableCompactRow(entry) {
  const row = document.createElement('div');
  row.className = 'timetable-row timetable-row-compact';

  const label = document.createElement('span');
  label.className = 'timetable-row-label';
  const dayLabel = WEEKDAYS.find(w => w.key === entry.day)?.label.slice(0, 3) || entry.day;
  const parts = [dayLabel, formatTimetableTime(entry.startTime), `${entry.length}hrs`];
  if (entry.room) parts.push(entry.room);
  label.textContent = parts.join(', ');
  row.appendChild(label);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'header-btn timetable-remove';
  remove.textContent = '×';
  remove.title = 'Remove this class';
  remove.addEventListener('click', () => removeTimetableClass(entry.id));
  row.appendChild(remove);

  return row;
}

// The input row for the in-progress draft — same fields as before, minus a
// remove button (there's nothing committed yet to remove), plus Cancel/OK.
// Field edits mutate the draft object directly without saving or
// re-rendering, so typing never gets interrupted by a render triggered
// elsewhere (e.g. an unrelated Course Settings field).
function buildTimetableDraftRow() {
  const row = document.createElement('div');
  row.className = 'timetable-row timetable-row-draft';

  const day = document.createElement('select');
  WEEKDAYS.forEach(({ key, label }) => {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = label;
    option.selected = key === timetableDraft.day;
    day.appendChild(option);
  });
  day.addEventListener('change', () => { timetableDraft.day = day.value; });
  row.appendChild(day);

  const fields = document.createElement('div');
  fields.className = 'timetable-row-fields';

  const start = document.createElement('input');
  start.type = 'time';
  start.value = timetableDraft.startTime;
  start.addEventListener('input', () => { timetableDraft.startTime = start.value; });
  fields.appendChild(start);

  const lengthField = document.createElement('div');
  lengthField.className = 'timetable-length-field';
  const length = document.createElement('input');
  length.type = 'number';
  length.min = '1';
  length.step = '1';
  length.value = timetableDraft.length;
  length.addEventListener('input', () => { timetableDraft.length = Number(length.value) || 1; });
  const lengthSuffix = document.createElement('span');
  lengthSuffix.textContent = 'h';
  lengthField.append(length, lengthSuffix);
  fields.appendChild(lengthField);

  row.appendChild(fields);

  const room = document.createElement('input');
  room.type = 'text';
  room.placeholder = 'Room';
  room.value = timetableDraft.room;
  room.addEventListener('input', () => { timetableDraft.room = room.value; });
  row.appendChild(room);

  const footer = document.createElement('div');
  footer.className = 'timetable-draft-footer';

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'timetable-draft-cancel';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', cancelTimetableDraft);
  footer.appendChild(cancel);

  const ok = document.createElement('button');
  ok.type = 'button';
  ok.className = 'timetable-draft-ok';
  ok.textContent = 'OK';
  ok.addEventListener('click', commitTimetableDraft);
  footer.appendChild(ok);

  row.appendChild(footer);

  return row;
}

function renderTimetable() {
  const list = document.getElementById('timetable-list');
  list.replaceChildren();
  (activeCourse()?.timetable ?? []).forEach(entry => list.appendChild(buildTimetableCompactRow(entry)));
  if (timetableDraft) list.appendChild(buildTimetableDraftRow());

  // Only one draft at a time.
  document.getElementById('add-timetable-btn').hidden = !!timetableDraft;
}

// ── Lesson Planner (Scratchpad) ──────────────────────────────
// A freeform per-lesson canvas, to the left of the card strip — light guides
// (see buildScratchpadGuide()) one per timetabled class, printed like
// markings on a page, plus draggable/resizable sticky-note-style text boxes
// the user places directly (see wireScratchpadCanvas()). Notes are the only
// thing actually saved (lesson.scratchpad); the guides are recomputed fresh
// from the course's timetable every render.
//
// CSS "mm" is a fixed physical unit — exactly 96/25.4 px, regardless of
// zoom or element size — so pointer-drag deltas convert to the note
// coordinates' mm units with this constant rather than a measured ratio
// (contrast makeResizable()'s pxPerRow, which has to be measured because a
// "row" isn't a real CSS unit).
const MM_PER_PX = 25.4 / 96;

// Open/closed is a view preference, not lesson data — not saved, same as
// the Course Settings drawer's own collapsed state.
let scratchpadOpen = false;

// Same reasoning — whether each card's Teacher Overview box (see
// buildTeacherOverviewBox()) is showing at all is a view preference, not
// data, so it's a single shared toggle rather than per-card state.
let teacherOverviewOpen = false;

function timetableSorted() {
  return [...(activeCourse()?.timetable ?? [])].sort((a, b) => {
    const dayDiff = WEEKDAYS.findIndex(w => w.key === a.day) - WEEKDAYS.findIndex(w => w.key === b.day);
    return dayDiff || a.startTime.localeCompare(b.startTime);
  });
}

// "13:00" + 2h → "15:00", for the label's end-of-session time.
function addHoursToTime(value, hours) {
  const [h, m] = value.split(':').map(Number);
  const total = (h * 60 + m + hours * 60) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// Day and time stand out in their own bold span; the room, if any, stays
// alongside at normal weight.
function buildScratchpadGuideLabel(entry) {
  const label = document.createElement('div');
  label.className = 'scratchpad-guide-label';

  const dayLabel = WEEKDAYS.find(w => w.key === entry.day)?.label.slice(0, 3) || entry.day;
  const endTime = addHoursToTime(entry.startTime, entry.length);

  const dayTime = document.createElement('span');
  dayTime.className = 'scratchpad-guide-daytime';
  dayTime.textContent = `${dayLabel} · ${formatTimetableTime(entry.startTime)}–${formatTimetableTime(endTime)}`;
  label.appendChild(dayTime);

  if (entry.room) label.append(` · ${entry.room}`);

  return label;
}

// One card-shaped guide per timetabled class: the label above it, then
// dashed 15-minute lines inside (a thicker one every 4th, on the hour). Pure
// display — nothing here is read back out or saved.
function buildScratchpadGuide(entry) {
  const guide = document.createElement('div');
  guide.className = 'scratchpad-guide';
  guide.appendChild(buildScratchpadGuideLabel(entry));

  const card = document.createElement('div');
  card.className = 'scratchpad-guide-card';
  card.style.width = `${params.cardWidth}mm`;
  card.style.height = `${params.cardHeight}mm`;

  const segments = Math.round(entry.length * 4);
  for (let i = 1; i < segments; i++) {
    const top = (params.cardHeight / segments) * i;

    const line = document.createElement('div');
    line.className = 'scratchpad-guide-line' + (i % 4 === 0 ? ' is-hour' : '');
    line.style.top = `${top}mm`;
    card.appendChild(line);

    const lineLabel = document.createElement('span');
    lineLabel.className = 'scratchpad-guide-line-label';
    lineLabel.style.top = `${top}mm`;
    lineLabel.textContent = '15min';
    card.appendChild(lineLabel);
  }

  guide.appendChild(card);
  return guide;
}

function addScratchpadNote(x, y, w, h) {
  const note = { id: nextNoteId++, x: Math.max(0, x), y: Math.max(0, y), w, h, text: '' };
  activeLesson().scratchpad.push(note);
  save();
  render();
  document.querySelector(`.scratchpad-note[data-note-id="${note.id}"] .scratchpad-note-text`)?.focus();
}

function removeScratchpadNote(id) {
  const lesson = activeLesson();
  lesson.scratchpad = lesson.scratchpad.filter(note => note.id !== id);
  save();
  render();
}

// Grip-driven reposition. Pointer events (not HTML5 drag) for the same
// reason makeResizable() uses them: this has to coexist with the notes
// layer's own pointerdown-to-create-a-note handling without either
// triggering the other. Moves the element directly and only commits to the
// model — save() + render() — on release, so a mid-drag render never tears
// the element out from under the pointer.
function makeScratchpadNoteDraggable(el, note, grip) {
  grip.addEventListener('pointerdown', event => {
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startY = event.clientY;
    const startLeft = note.x;
    const startTop = note.y;
    try { grip.setPointerCapture(event.pointerId); } catch { /* no active pointer */ }

    const onMove = moveEvent => {
      const left = Math.max(0, startLeft + (moveEvent.clientX - startX) * MM_PER_PX);
      const top = Math.max(0, startTop + (moveEvent.clientY - startY) * MM_PER_PX);
      el.style.left = `${left}mm`;
      el.style.top = `${top}mm`;
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      note.x = parseFloat(el.style.left);
      note.y = parseFloat(el.style.top);
      save();
      render();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
}

// Corner-handle free 2D resize — unlike makeResizable()'s row-snapped
// height-only drag, notes have no grid to snap to, just a floor so a note
// can't be dragged down to nothing.
const MIN_NOTE_W = 20;
const MIN_NOTE_H = 10;

function makeScratchpadNoteResizable(el, note, handle) {
  handle.addEventListener('pointerdown', event => {
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startY = event.clientY;
    const startW = note.w;
    const startH = note.h;
    try { handle.setPointerCapture(event.pointerId); } catch { /* no active pointer */ }

    const onMove = moveEvent => {
      const w = Math.max(MIN_NOTE_W, startW + (moveEvent.clientX - startX) * MM_PER_PX);
      const h = Math.max(MIN_NOTE_H, startH + (moveEvent.clientY - startY) * MM_PER_PX);
      el.style.width = `${w}mm`;
      el.style.height = `${h}mm`;
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      note.w = parseFloat(el.style.width);
      note.h = parseFloat(el.style.height);
      save();
      render();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
}

function buildScratchpadNote(note) {
  const el = document.createElement('div');
  el.className = 'scratchpad-note';
  el.dataset.noteId = note.id;
  el.style.left = `${note.x}mm`;
  el.style.top = `${note.y}mm`;
  el.style.width = `${note.w}mm`;
  el.style.height = `${note.h}mm`;

  const grip = document.createElement('div');
  grip.className = 'scratchpad-note-grip';
  grip.title = 'Drag to move';
  el.appendChild(grip);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'scratchpad-note-remove';
  remove.textContent = '×';
  remove.title = 'Remove this note';
  remove.addEventListener('click', () => removeScratchpadNote(note.id));
  el.appendChild(remove);

  const text = document.createElement('textarea');
  text.className = 'scratchpad-note-text';
  text.value = note.text || '';
  text.spellcheck = false;
  text.addEventListener('pointerdown', event => event.stopPropagation());
  text.addEventListener('input', () => {
    note.text = text.value;
    save();
  });
  el.appendChild(text);

  const resize = document.createElement('div');
  resize.className = 'scratchpad-note-resize';
  resize.title = 'Drag to resize';
  el.appendChild(resize);

  makeScratchpadNoteDraggable(el, note, grip);
  makeScratchpadNoteResizable(el, note, resize);

  return el;
}

// Click-or-drag directly on empty canvas to place a note — a plain click
// (drag distance under the threshold) drops one at a default size; dragging
// draws its actual position and size in one gesture. Only fires when the
// pointer actually starts on the layer itself, not bubbled up from a note
// (see .scratchpad-note-text's own pointerdown stopping propagation, and
// buildScratchpadNote()'s children sitting above this listener in z-order).
const NOTE_CLICK_THRESHOLD = 4;
const DEFAULT_NOTE_W = 60;
const DEFAULT_NOTE_H = 15;

function wireScratchpadCanvas() {
  const layer = document.getElementById('scratchpad-notes');

  layer.addEventListener('pointerdown', event => {
    if (event.target !== layer) return;
    if (event.button !== 0) return;
    event.preventDefault();

    const rect = layer.getBoundingClientRect();
    const startX = (event.clientX - rect.left) * MM_PER_PX;
    const startY = (event.clientY - rect.top) * MM_PER_PX;

    const ghost = document.createElement('div');
    ghost.className = 'scratchpad-note-ghost';
    layer.appendChild(ghost);

    const onMove = moveEvent => {
      const curX = (moveEvent.clientX - rect.left) * MM_PER_PX;
      const curY = (moveEvent.clientY - rect.top) * MM_PER_PX;
      const x = Math.min(startX, curX);
      const y = Math.min(startY, curY);
      ghost.style.left = `${x}mm`;
      ghost.style.top = `${y}mm`;
      ghost.style.width = `${Math.abs(curX - startX)}mm`;
      ghost.style.height = `${Math.abs(curY - startY)}mm`;
    };

    const onUp = moveEvent => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      ghost.remove();

      const curX = (moveEvent.clientX - rect.left) * MM_PER_PX;
      const curY = (moveEvent.clientY - rect.top) * MM_PER_PX;
      const dragW = Math.abs(curX - startX);
      const dragH = Math.abs(curY - startY);

      if (dragW < NOTE_CLICK_THRESHOLD && dragH < NOTE_CLICK_THRESHOLD) {
        addScratchpadNote(startX, startY, DEFAULT_NOTE_W, DEFAULT_NOTE_H);
      } else {
        addScratchpadNote(
          Math.min(startX, curX), Math.min(startY, curY),
          Math.max(dragW, MIN_NOTE_W), Math.max(dragH, MIN_NOTE_H)
        );
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
}

function renderScratchpad() {
  const toggle = document.getElementById('scratchpad-toggle');
  const panel = document.getElementById('scratchpad-panel');
  const guides = document.getElementById('scratchpad-guides');
  const notesLayer = document.getElementById('scratchpad-notes');

  toggle.classList.toggle('is-active', scratchpadOpen);
  panel.classList.toggle('is-open', scratchpadOpen);

  const buildBlank = () => {
    const blank = document.createElement('div');
    blank.className = 'scratchpad-blank';
    blank.style.width = `${params.cardWidth}mm`;
    blank.style.height = `${params.cardHeight}mm`;
    return blank;
  };

  guides.replaceChildren();
  const timetable = timetableSorted();
  // One free card-width of planning room on each side of the timetabled
  // guides, rather than both together on one side. Rendered even when
  // there are no timetabled classes yet — the empty-state button below
  // sits in its own overlay on top rather than replacing this, since
  // #scratchpad-notes (see below) already fully covers this same area for
  // note-dragging and would otherwise swallow clicks meant for a button
  // living inside #scratchpad-guides.
  guides.appendChild(buildBlank());
  timetable.forEach(entry => guides.appendChild(buildScratchpadGuide(entry)));
  guides.appendChild(buildBlank());

  // Covers #scratchpad-guides/#scratchpad-notes with a "no timetable yet"
  // prompt — its own overlay, not a child of either: #scratchpad-notes
  // sits on top of the guides and claims every pointerdown across its
  // whole area for note-dragging (see wireScratchpadCanvas()), so a button
  // placed inside #scratchpad-guides would never actually receive a click.
  // Also gated on scratchpadOpen: while collapsed, #scratchpad-panel is
  // clipped to a 30px sliver via overflow: hidden, same as the real guides
  // — but this button, centered rather than laid out left-to-right like
  // they are, would have its own *middle* fall inside that visible sliver
  // instead of clipping cleanly off to one side. Simplest fix is to just
  // not show the prompt for a drawer that isn't even open.
  document.getElementById('scratchpad-empty-overlay').hidden = timetable.length > 0 || !scratchpadOpen;

  // The notes layer and the panel's open width both track the guides row's
  // own rendered size — measured rather than hand-computed from cardWidth/
  // gap/padding, so any spacing tweak to .scratchpad-guides above stays
  // automatically in sync instead of needing matching arithmetic here.
  // scrollWidth/Height, not offsetWidth/Height: the guides row is a block
  // box whose own width auto-fills #scratchpad-panel (which is exactly what
  // animates between 30px and full width), so its *offset* size tracks the
  // panel instead of its flex-shrink:0 children's true, possibly-overflowing
  // extent — scroll size is what actually reports that content size.
  panel.style.setProperty('--scratchpad-width', `${guides.scrollWidth}px`);
  notesLayer.style.width = `${guides.scrollWidth}px`;
  notesLayer.style.height = `${guides.scrollHeight}px`;

  notesLayer.replaceChildren();
  (activeLesson()?.scratchpad ?? []).forEach(note => notesLayer.appendChild(buildScratchpadNote(note)));
}

// ── Course list ──────────────────────────────────────────────
// A plain dropdown rather than a draggable list — with more than a handful
// of courses, a full row-per-course list would cost more sidebar space than
// it's worth, and courses don't need reordering the way lessons or cards do.
// Reuses the same code/name joining logic the printed card footer uses (see
// buildCard()'s `label` below) so the dropdown and the printed footer always
// read the same way.
function courseLabel(course) {
  return [course.params.courseCode, course.params.courseName].filter(Boolean).join(' · ')
    || 'Untitled course';
}

function renderCourseList() {
  const select = document.getElementById('courseSelect');
  select.replaceChildren();
  courses.forEach(course => {
    const option = document.createElement('option');
    option.value = course.id;
    option.textContent = courseLabel(course);
    option.selected = course.id === activeCourseId;
    select.appendChild(option);
  });
}

// A running count across every lesson in the course, in lesson/card order —
// deliberately different from .card-lesson-count's "N of M" below, which
// resets per lesson. This is the printed page number, so it shouldn't.
function coursePageNumber(card) {
  return activeCourse().lessons.flatMap(lesson => lesson.cards).findIndex(c => c.id === card.id) + 1;
}

// ── Build one card ───────────────────────────────────────────
// buildCard()/buildBlockContent()/lockBlockContent() now live in
// render-card.js, shared with the read-only viewer. coursePageNumber()
// stays here (reads active course state) — call sites below now compute it
// and pass it in as buildCard()'s `pageNumber` option, along with
// `lessonTitle`/`totalCards`, which buildCard() used to read directly off
// this module's own activeLesson()/cards globals.
function buildCardSlot(card, index) {
  const slot = document.createElement('div');
  slot.className = 'card-slot';
  // Armed only from a drag handle — see useAsDragHandle.
  slot.draggable = false;
  slot.dataset.index = index;

  const frame = document.createElement('div');
  frame.className = 'card-frame';
  frame.appendChild(buildCard(card, index, params, {
    lessonTitle: activeLesson().title,
    totalCards: cards.length,
    pageNumber: coursePageNumber(card),
  }));

  const remove = document.createElement('button');
  remove.className = 'card-remove';
  remove.textContent = '×';
  remove.title = 'Remove this card';
  remove.draggable = false;
  remove.addEventListener('click', () => {
    openConfirmDialog(
      `Delete card ${index + 1}? This removes all its content.`,
      () => removeCard(card.id),
      remove
    );
  });
  frame.appendChild(remove);

  const label = buildCardLabel(card, index);

  slot.addEventListener('dragstart', event => {
    dragSrcIndex = index;
    slot.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
    // Firefox won't start a drag unless some data is set.
    event.dataTransfer.setData('text/plain', String(index));
  });

  slot.addEventListener('dragend', () => {
    dragSrcIndex = null;
    slot.draggable = false;
    slot.classList.remove('dragging');
    clearDropMarkers();
  });

  makeDropTarget(slot, index);

  // The card body will hold its own draggable content blocks, so a drag that
  // starts there has to belong to the block. Only the header band arms the
  // card drag — plus the label's own grip, so a card with its header
  // switched off is still movable.
  const header = frame.querySelector('.card-header');
  if (header) useAsDragHandle(header, slot);
  useAsDragHandle(label.querySelector('.card-label-grip'), slot);

  slot.appendChild(frame);
  slot.appendChild(label);
  if (teacherOverviewOpen) slot.appendChild(buildTeacherOverviewBox(card));
  return slot;
}

// The caption strip below a card: a drag grip (bottom-left — the rest of
// the strip used to double as the drag handle, which made the name
// underneath it unclickable) and the card's own title, editable in place.
// Position within the lesson (card N of M) is shown elsewhere, on the card
// itself (see .card-lesson-count/.card-number in buildCard()) — it's always
// index-driven there, so renaming here never touches it.
//
// The title commits to `card.title` and autosaves on every keystroke (see
// workspaceLessonTitle's own input handler for the same pattern) but
// deliberately skips render() until blur/Enter — this input lives inside
// #card-strip, which render() rebuilds, and doing that mid-keystroke would
// drop focus and cursor position.
function buildCardLabel(card, index) {
  const label = document.createElement('div');
  label.className = 'card-label';

  const grip = document.createElement('span');
  grip.className = 'card-label-grip';
  grip.title = 'Drag to reorder';
  grip.textContent = '⠿';
  label.appendChild(grip);

  const input = document.createElement('input');
  input.className = 'card-label-input';
  input.type = 'text';
  input.placeholder = `Card ${index + 1}`;
  input.value = card.title || '';
  input.spellcheck = false;

  input.addEventListener('input', () => {
    card.title = input.value || undefined;
    save();
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === 'Escape') input.blur();
  });
  input.addEventListener('blur', () => {
    const trimmed = input.value.trim();
    card.title = trimmed || undefined;
    save();
    render();
  });
  label.appendChild(input);

  return label;
}

// ── The dotted "add another card" slot ───────────────────────
function buildAddSlot() {
  const slot = document.createElement('div');
  slot.className = 'card-slot is-add-slot';

  const button = document.createElement('button');
  button.className = 'card add-card';
  button.title = 'Add another card';
  button.textContent = '+';
  button.style.cssText = `
    width: ${params.cardWidth}mm;
    height: ${params.cardHeight}mm;
  `;
  button.addEventListener('click', addCard);

  const label = document.createElement('div');
  label.className = 'card-label';
  label.textContent = 'Add card';

  // Dropping on the add-slot sends the card to the end of the set.
  makeDropTarget(slot, cards.length);

  slot.appendChild(button);
  slot.appendChild(label);
  return slot;
}

// ── Render ───────────────────────────────────────────────────
// Zero courses (fresh install, or the last one just got deleted) blocks
// the whole app behind a "create your first course" gate rather than
// silently fabricating a blank course the way this used to — see the Init
// section and removeCourse() above. `inert` (not just `hidden`/CSS) is what
// actually keeps the sidebar/workspace/profile button out of tab order and
// unclickable while the gate is up; the gate's own opaque, full-viewport
// backdrop handles the visual blocking.
function updateFirstRunGate() {
  const isEmpty = courses.length === 0;
  document.getElementById('first-run-gate').hidden = !isEmpty;
  document.getElementById('sidebar').inert = isEmpty;
  document.getElementById('workspace').inert = isEmpty;
  document.getElementById('profile-btn').inert = isEmpty;
  if (isEmpty) {
    // Clears out whatever the previous (now-deleted) course's code/name
    // were — this only ever runs right as the gate becomes visible again
    // (nothing else triggers a render while it's inert), so there's no
    // typed-text-in-progress to stomp on.
    document.getElementById('firstRunCourseName').value = '';
    document.getElementById('firstRunCourseCode').value = '';
    document.getElementById('firstRunCourseName').focus();
  }
}

function render() {
  updateFirstRunGate();
  renderCourseList();
  renderLessonList();
  renderTimetable();
  renderScratchpad();
  document.getElementById('teacher-overview-toggle').classList.toggle('is-active', teacherOverviewOpen);

  // Covers every route by which an edited block can disappear — its own ×,
  // its card being removed, or a reset — rather than just the one.
  const stillPresent = block => cards.some(card => card.blocks.includes(block));
  if (editingLink && !stillPresent(editingLink)) dismissLinkEditor();
  if (editingImage && !stillPresent(editingImage)) dismissImageEditor();

  const strip = document.getElementById('card-strip');

  // Every block/box editor in here (Text, Heading, Teacher Overview, ...)
  // is rebuilt from scratch below — removing a *focused* one via
  // replaceChildren() doesn't fire its blur handler the way an explicit
  // .blur() call does, so whatever's unsaved there would otherwise just
  // vanish, discarded rather than committed. Blurring it here first, while
  // it's still actually in the document, runs that handler normally (it
  // commits the value, saves, and re-renders) before the teardown that
  // would've silently swallowed it. That re-render happens inside this
  // same render() call, so this one continues into a second, redundant
  // rebuild once it returns — harmless, just some repeated work, and only
  // on the render() that catches a focused editor at all.
  if (document.activeElement && strip.contains(document.activeElement)) {
    document.activeElement.blur();
  }

  strip.replaceChildren();

  cards.forEach((card, index) => strip.appendChild(buildCardSlot(card, index)));
  strip.appendChild(buildAddSlot());
  positionTeacherOverviewToggle();

  if (focusBlockId !== null) {
    const blockEl = strip.querySelector(`.card-block[data-block-id="${focusBlockId}"]`);
    // Cleared before focusing: entering the markdown editor is a no-op here,
    // but blurring it re-renders, and a stale id would steal focus back.
    focusBlockId = null;
    if (blockEl) focusBlock(blockEl);
  }
}

// ── Print ────────────────────────────────────────────────────
// Runs off the browser's own beforeprint event (not a direct call), so
// Ctrl+P/File>Print — not just #print-btn — always sees #print-root
// freshly built, three cards per page (see css/print.css for the actual
// page layout). Reads #printModeCourse/#print-card-list directly off the
// DOM rather than a separate JS state mirror — see buildPrintCardList()
// and its change handlers below for how those stay correct — so there's
// only one source of truth for "what got checked."
//
// Rebuilds each card via buildCard() rather than cloning it out of
// #card-strip: that's fine for the active lesson (the only thing
// #card-strip ever has rendered), but printing the whole course needs
// cards #card-strip never had in the first place. buildCard() takes the
// header title/"N of M"/page number as explicit arguments (see
// render-card.js), so this just walks each lesson in turn passing its own
// title/card count straight through — no need to point module state at it
// the way switchLesson() would.
// Which (lesson, card, index) triples buildPrintPages() will actually turn
// into pages — pulled out so the print button's own image-cache prewarm
// (see its click handler below) can ask the same question without
// duplicating (and risking drifting from) this selection logic. Cover
// mode has no cards of its own, so this is only ever called for the
// non-cover path.
function cardsToPrint() {
  const printWholeCourse = document.getElementById('printModeCourse').checked;
  // #print-card-list is empty until the panel's been opened at least once
  // (see buildPrintCardList()) — nothing checked yet to read, so this
  // falls back to "every card in the active lesson," same as if it'd been
  // opened and left untouched.
  const checkedIds = printWholeCourse ? null : new Set(
    [...document.querySelectorAll('#print-card-list input:checked')].map(cb => Number(cb.dataset.cardId))
  );
  const hasCardList = document.querySelector('#print-card-list input') !== null;

  const course = activeCourse();
  const lessonsToBuild = printWholeCourse ? course.lessons : [activeLesson()];

  const entries = [];
  for (const lesson of lessonsToBuild) {
    lesson.cards.forEach((card, index) => {
      if (!printWholeCourse && hasCardList && !checkedIds.has(card.id)) return;
      entries.push({ lesson, card, index });
    });
  }
  return entries;
}

function buildPrintPages() {
  const root = document.getElementById('print-root');
  root.replaceChildren();

  if (document.getElementById('printModeCover').checked) {
    root.appendChild(buildPrintCoverPage());
    return;
  }

  const cardEls = cardsToPrint().map(({ lesson, card, index }) => buildCard(card, index, params, {
    lessonTitle: lesson.title,
    totalCards: lesson.cards.length,
    pageNumber: coursePageNumber(card),
  }));

  const blankOverleaf = document.getElementById('printBlankOverleaf').checked;

  for (let i = 0; i < cardEls.length; i += 3) {
    const group = cardEls.slice(i, i + 3);
    const page = document.createElement('div');
    page.className = 'print-page';
    for (const el of group) page.appendChild(el);
    root.appendChild(page);

    // For double-sided printing: one blank grid card per real card on the
    // page just written, so cutting the sheet apart leaves each physical
    // card with real content on one side and blank grid on the other.
    if (blankOverleaf) {
      const blankPage = document.createElement('div');
      blankPage.className = 'print-page';
      for (const el of group) {
        blankPage.appendChild(buildBlankCard(el.querySelector('.card-header-text')?.textContent || ''));
      }
      root.appendChild(blankPage);
    }
  }
}

// A filler card for buildPrintPages()'s "blank grids overleaf" option:
// same header/footer/dot-grid as a real card, but with no blocks — and
// (see buildCard()'s own `blank` handling) no card count/page number,
// since it has no real position of its own to report. `headerTitle` comes
// from whichever real card it's backing, copied from that card's own
// already-built header rather than re-derived from lesson state, so it's
// still right even when one print page mixes cards from two lessons.
function buildBlankCard(headerTitle) {
  const el = buildCard({ id: null, blocks: [] }, 0, params, { blank: true });
  const headerText = el.querySelector('.card-header-text');
  if (headerText) headerText.textContent = headerTitle;
  return el;
}

// Cover printing is one page at true size — no cut-apart 3-up layout, no
// "blank grids overleaf" (there's nothing to double-side). #cover-spread is
// cloned rather than rebuilt (same idiom buildCard() uses: reuse the real
// element structure, let print.css hide the screen-only chrome that comes
// along for the ride, rather than a second parallel builder), so it needs
// renderCoverView() to have already run — #print-btn's click handler
// awaits that first when this mode is selected, since beforeprint itself
// can't be awaited and this fires from that event.
function buildPrintCoverPage() {
  const page = document.createElement('div');
  page.className = 'print-page print-page-cover';
  const spread = document.getElementById('cover-spread').cloneNode(true);

  // The live elements' current edit state (mid-edit textarea, an empty
  // box's "Add text…" placeholder) has no business printing.
  const editor = spread.querySelector('.cover-text-editor');
  const preview = spread.querySelector('.cover-text-preview');
  if (editor) editor.hidden = true;
  if (preview) {
    preview.hidden = false;
    if (preview.classList.contains('is-empty')) preview.textContent = '';
  }

  page.appendChild(spread);
  return page;
}

window.addEventListener('beforeprint', buildPrintPages);

// ── Print options panel ─────────────────────────────────────
// Lifts up above #print-actions rather than a popover — see
// #print-panel/#print-panel-group in the CSS — since (per the brief) more
// print settings than just this are expected to land here later.
let printPanelOpen = false;

function openPrintPanel() {
  printPanelOpen = true;
  buildPrintCardList();
  document.getElementById('print-panel').classList.add('is-open');
  document.getElementById('print-panel-toggle').classList.add('is-active');
}

function closePrintPanel() {
  printPanelOpen = false;
  document.getElementById('print-panel').classList.remove('is-open');
  document.getElementById('print-panel-toggle').classList.remove('is-active');
}

// One checkbox per card in the active lesson, all checked, and
// #printModeCourse cleared — the "everything reset to its default" state
// this panel always opens (or, on a lesson switch while left open, jumps
// back to) rather than remembering a stale selection from a lesson that's
// no longer active.
function buildPrintCardList() {
  const list = document.getElementById('print-card-list');
  list.replaceChildren();
  document.getElementById('printModeCourse').checked = false;
  document.getElementById('printModeCover').checked = false;
  syncPrintBlankOverleafRow();

  activeLesson().cards.forEach((card, index) => {
    const row = document.createElement('label');
    row.className = 'print-card-row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = true;
    checkbox.dataset.cardId = card.id;
    checkbox.addEventListener('change', () => {
      updatePrintLessonCheckbox();
      // Checking any one card only makes sense as "print from this
      // lesson" — Course/Cover are exclusive with that, same as clicking
      // either of them directly clears every card (see their own handlers
      // below).
      if (checkbox.checked) {
        document.getElementById('printModeCourse').checked = false;
        document.getElementById('printModeCover').checked = false;
        syncPrintBlankOverleafRow();
      }
    });
    row.appendChild(checkbox);

    const text = document.createElement('span');
    text.textContent = card.title || `Card ${index + 1}`;
    row.appendChild(text);

    list.appendChild(row);
  });
  updatePrintLessonCheckbox();
}

// "Lesson" mirrors the card list the way Excel's filter-list "(Select
// All)" mirrors its items: checked when every card is, unchecked when
// none are, indeterminate for anything in between. It has no meaning of
// its own beyond that reflection.
function updatePrintLessonCheckbox() {
  const boxes = [...document.querySelectorAll('#print-card-list input')];
  const checkedCount = boxes.filter(cb => cb.checked).length;
  const lessonCheckbox = document.getElementById('printModeLesson');
  lessonCheckbox.checked = boxes.length > 0 && checkedCount === boxes.length;
  lessonCheckbox.indeterminate = checkedCount > 0 && checkedCount < boxes.length;
}

// "Blank grids overleaf" only means anything for the two card-based modes
// (Lesson/Course) — there's no equivalent for a cover, a single page at
// true size rather than cut-apart cards — so Cover hides the row outright
// (see #print-blank-overleaf-row[hidden] in the CSS) and clears it, rather
// than leaving a stale, inapplicable choice behind for when a card mode is
// picked again.
function syncPrintBlankOverleafRow() {
  const coverChecked = document.getElementById('printModeCover').checked;
  document.getElementById('print-blank-overleaf-row').hidden = coverChecked;
  if (coverChecked) document.getElementById('printBlankOverleaf').checked = false;
}

document.getElementById('printModeLesson').addEventListener('change', () => {
  const lessonCheckbox = document.getElementById('printModeLesson');
  lessonCheckbox.indeterminate = false;
  document.querySelectorAll('#print-card-list input').forEach(cb => { cb.checked = lessonCheckbox.checked; });
  if (lessonCheckbox.checked) {
    document.getElementById('printModeCourse').checked = false;
    document.getElementById('printModeCover').checked = false;
    syncPrintBlankOverleafRow();
  }
});

// Course is exclusive with Lesson-and-its-cards/Cover — selecting it
// clears every other checkbox in the panel, same as the brief asks for.
document.getElementById('printModeCourse').addEventListener('change', () => {
  const courseCheckbox = document.getElementById('printModeCourse');
  if (!courseCheckbox.checked) return;
  const lessonCheckbox = document.getElementById('printModeLesson');
  lessonCheckbox.checked = false;
  lessonCheckbox.indeterminate = false;
  document.querySelectorAll('#print-card-list input').forEach(cb => { cb.checked = false; });
  document.getElementById('printModeCover').checked = false;
  syncPrintBlankOverleafRow();
});

// Cover is exclusive with Lesson-and-its-cards/Course, same as they are
// with each other.
document.getElementById('printModeCover').addEventListener('change', () => {
  const coverCheckbox = document.getElementById('printModeCover');
  if (coverCheckbox.checked) {
    const lessonCheckbox = document.getElementById('printModeLesson');
    lessonCheckbox.checked = false;
    lessonCheckbox.indeterminate = false;
    document.querySelectorAll('#print-card-list input').forEach(cb => { cb.checked = false; });
    document.getElementById('printModeCourse').checked = false;
  }
  syncPrintBlankOverleafRow();
});

// ── Confirm dialog ───────────────────────────────────────────
// Generic yes/no modal for anything destructive (lesson/card deletion).
// Holds the callback for whichever call opened it; only one can be open at
// once, same as the link/image editors.
let confirmAction = null;

// Anchored next to whatever triggered it (the remove button), same as the
// link/image editors, rather than centered — so it reads as a reaction to
// the click rather than an unrelated interruption.
function openConfirmDialog(message, onConfirm, anchor) {
  const dialog = document.getElementById('confirm-dialog');
  document.getElementById('confirm-dialog-message').textContent = message;
  confirmAction = onConfirm;
  document.getElementById('confirm-dialog-backdrop').hidden = false;
  dialog.hidden = false;
  positionPopover(dialog, anchor);
  document.getElementById('confirmOk').focus();
}

// Backdrop and Cancel both back out without running the action — same as
// dismissing the link/image editors, only an explicit Delete commits.
function closeConfirmDialog(confirmed) {
  document.getElementById('confirm-dialog-backdrop').hidden = true;
  document.getElementById('confirm-dialog').hidden = true;
  const action = confirmAction;
  confirmAction = null;
  if (confirmed) action?.();
}

// Anchored next to the + button, same as the other popovers. Always opens
// blank (placeholders only) — unlike the link/image editors, there's no
// existing course to prefill from, that's the point of asking.
function openAddCourseDialog(anchor) {
  document.getElementById('newCourseName').value = '';
  document.getElementById('newCourseCode').value = '';
  document.getElementById('add-course-dialog-backdrop').hidden = false;
  const dialog = document.getElementById('add-course-dialog');
  dialog.hidden = false;
  positionPopover(dialog, anchor);
  document.getElementById('newCourseName').focus();
}

// Backdrop and Cancel both back out with no course added — only an explicit
// OK creates one, same shape as closeConfirmDialog above.
function closeAddCourseDialog(confirmed) {
  document.getElementById('add-course-dialog-backdrop').hidden = true;
  document.getElementById('add-course-dialog').hidden = true;
  if (confirmed) {
    addCourse(
      document.getElementById('newCourseCode').value.trim(),
      document.getElementById('newCourseName').value.trim()
    );
  }
}

// ── Wiring ───────────────────────────────────────────────────
document.querySelectorAll('.param-group:not(.no-collapse) h2').forEach(h2 => {
  h2.addEventListener('click', () => {
    h2.parentElement.classList.toggle('collapsed');
  });
});

// #courseSelect is excluded: it switches which course's params this form
// reads/writes at all, and has its own dedicated handler below — routing it
// through this generic one too would readParams() the outgoing course's
// stale field values back over the incoming course's params.
document.querySelectorAll('#sidebar input, #sidebar select:not(#courseSelect)').forEach(el => {
  const handler = () => {
    readParams();
    save();
    render();
  };
  el.addEventListener('input', handler);
  el.addEventListener('change', handler);
});

document.getElementById('add-lesson-btn').addEventListener('click', addLesson);
document.getElementById('add-timetable-btn').addEventListener('click', startTimetableDraft);
document.getElementById('add-timetable-from-scratchpad-btn').addEventListener('click', openCourseSettings);

document.getElementById('scratchpad-toggle').addEventListener('click', () => {
  scratchpadOpen = !scratchpadOpen;
  render();
});
document.getElementById('teacher-overview-toggle').addEventListener('click', () => {
  teacherOverviewOpen = !teacherOverviewOpen;
  render();
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
// Covers exiting fullscreen some other way (Esc, F11, the browser's own
// fullscreen-exit control) — the present view itself should close with it
// rather than being left stranded windowed.
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && !document.getElementById('present-view').hidden) closePresentView();
});
wireScratchpadCanvas();
initCoverFillRows();
initCoverBackText();
document.getElementById('coverMode').addEventListener('click', event => {
  const button = event.target.closest('button');
  if (button) setCoverMode(button.dataset.value);
});
document.getElementById('coverBackTextEnabled').addEventListener('change', event => {
  params.coverBackTextEnabled = event.target.checked;
  save();
  renderCoverView();
});
setupCoverDrag('back');
setupCoverDrag('spine');
setupCoverDrag('front');
document.getElementById('add-course-btn').addEventListener('click', event => {
  openAddCourseDialog(event.currentTarget);
});
document.getElementById('addCourseCancel').addEventListener('click', () => closeAddCourseDialog(false));
document.getElementById('addCourseOk').addEventListener('click', () => closeAddCourseDialog(true));
document.getElementById('add-course-dialog-backdrop').addEventListener('click', () => closeAddCourseDialog(false));

// Terms of Use — opened from the .terms-link in either course-creation
// entry point (the + button's dialog, and the first-run gate). Its own
// backdrop/z-index sit above everything else, including #add-course-
// dialog itself, so opening it from inside that dialog doesn't also
// close the dialog underneath — only its own close button/backdrop/
// Escape dismiss it.
function openTermsDialog() {
  document.getElementById('terms-dialog-backdrop').hidden = false;
  document.getElementById('terms-dialog').hidden = false;
}
function closeTermsDialog() {
  document.getElementById('terms-dialog-backdrop').hidden = true;
  document.getElementById('terms-dialog').hidden = true;
}
document.querySelectorAll('.terms-link').forEach(link => {
  link.addEventListener('click', event => {
    event.preventDefault();
    openTermsDialog();
  });
});
document.getElementById('terms-dialog-close').addEventListener('click', closeTermsDialog);
document.getElementById('terms-dialog-backdrop').addEventListener('click', closeTermsDialog);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !document.getElementById('terms-dialog').hidden) closeTermsDialog();
});
// The gate's own course-creation button — separate from openAddCourseDialog/
// closeAddCourseDialog above (different ids, always visible while the gate
// is up rather than opened/closed), but calls the same addCourse(). The
// tour auto-plays exactly once, tied to this button specifically, so
// creating a 2nd/3rd course later via the ordinary + button never re-triggers
// it — see hasSeenTour()/markTourSeen() in onboarding-tour.js.
document.getElementById('firstRunCreateBtn').addEventListener('click', () => {
  addCourse(
    document.getElementById('firstRunCourseCode').value.trim(),
    document.getElementById('firstRunCourseName').value.trim()
  );
  if (!hasSeenTour()) {
    markTourSeen();
    runTour();
  }
});
document.getElementById('replay-tour-btn').addEventListener('click', () => {
  closeProfilePanel();
  runTour();
});
document.getElementById('signInCancel').addEventListener('click', closeSignInDialog);
document.getElementById('signInSend').addEventListener('click', sendSignInLink);
document.getElementById('sign-in-dialog-backdrop').addEventListener('click', closeSignInDialog);
document.getElementById('profile-btn').addEventListener('click', () => {
  if (document.getElementById('profile-panel').hidden) openProfilePanel(); else closeProfilePanel();
});
document.getElementById('profile-panel-backdrop').addEventListener('click', closeProfilePanel);
document.getElementById('course-share-btn').addEventListener('click', () => {
  if (document.getElementById('share-panel').hidden) openSharePanel(); else closeSharePanel();
});
document.getElementById('share-panel-backdrop').addEventListener('click', closeSharePanel);
document.getElementById('shareInviteBtn').addEventListener('click', sendInvite);
document.getElementById('shareInviteCancel').addEventListener('click', closeSharePanel);
document.getElementById('share-preview-btn').addEventListener('click', openViewerPreview);
// click, not change — a radio re-clicked while already checked fires no
// change event, but this should still re-run (vault's "change folder",
// cloud/local's harmless reseed) — see switchStorageMode()'s own comment.
document.getElementById('storageModeLocal').addEventListener('click', () => switchStorageMode('local'));
document.getElementById('storageModeVault').addEventListener('click', () => switchStorageMode('vault'));
document.getElementById('storageModeCloud').addEventListener('click', () => switchStorageMode('cloud'));
document.getElementById('profile-avatar-btn').addEventListener('click', () => document.getElementById('profileAvatarPicker').click());
// #profile-avatar-note is a <span>, not a real form control — disabled
// doesn't apply to it the way it does to #profile-avatar-btn above, so it
// needs its own guard against activeAdapter.avatar being unsupported.
document.getElementById('profile-avatar-note').addEventListener('click', () => {
  if (activeAdapter.avatar) document.getElementById('profileAvatarPicker').click();
});
document.getElementById('profileAvatarPicker').addEventListener('change', () => {
  const file = document.getElementById('profileAvatarPicker').files[0];
  if (file) uploadProfileAvatar(file);
});
['profileTitle', 'profileFirstName', 'profileLastName', 'profileJobTitle', 'profileEmployer'].forEach(id => {
  document.getElementById(id).addEventListener('change', saveProfileFields);
});
document.getElementById('print-btn').addEventListener('click', async () => {
  if (document.getElementById('printModeCover').checked) {
    // Cover mode's own async work (image loads, average-color sampling for
    // the spine text color — see applyCoverFill()/loadAverageColor())
    // needs to have already landed on #cover-spread's real inline styles
    // before buildPrintCoverPage() clones it on beforeprint, which can't
    // itself be awaited — so this runs ahead of window.print() instead.
    await renderCoverView();
  } else {
    // Same "can't await beforeprint" problem, for card images this time
    // (see primeImageSrcCache()'s own comment in render-card.js) — resolve
    // every image this print run will actually use ahead of time, so
    // buildPrintPages()'s synchronous rebuild finds them already cached.
    const refs = new Set();
    for (const { card } of cardsToPrint()) {
      for (const block of card.blocks) {
        if (block.type === 'image' && block.src) refs.add(block.src);
      }
    }
    await Promise.all([...refs].map(async ref => primeImageSrcCache(ref, await resolveImageSrc(ref))));
  }
  window.print();
});
document.getElementById('print-panel-toggle').addEventListener('click', () => {
  if (printPanelOpen) closePrintPanel(); else openPrintPanel();
});
document.getElementById('delete-course-btn').addEventListener('click', event => {
  openConfirmDialog(
    `Delete "${courseLabel(activeCourse())}"? This removes all its lessons and cards.`,
    () => removeCourse(activeCourseId),
    event.currentTarget
  );
});
document.getElementById('courseSelect').addEventListener('change', event => {
  switchCourse(Number(event.target.value));
});

// Settings swaps places with the lesson list rather than just expanding
// alongside it: opening it hides #lesson-group and takes over the space
// right under the course selector; closing it reverses that.
function openCourseSettings() {
  document.getElementById('settings-group').hidden = false;
  document.getElementById('lesson-group').hidden = true;
  document.getElementById('course-settings-toggle').classList.add('is-active');
}

// Triggered from #course-settings-toggle up by "Course" (a .header-btn,
// matching +/✎ there) rather than a header inside the panel itself — see
// index.html. Also opened directly from the scratchpad's own empty state
// (see renderScratchpad()) when there's no timetable to plan against yet.
document.getElementById('course-settings-toggle').addEventListener('click', () => {
  const settings = document.getElementById('settings-group');
  if (settings.hidden) { openCourseSettings(); return; }
  settings.hidden = true;
  document.getElementById('lesson-group').hidden = false;
  document.getElementById('course-settings-toggle').classList.remove('is-active');
});

document.getElementById('course-cover-btn').addEventListener('click', () => {
  if (document.getElementById('cover-view').hidden) openCoverView(); else closeCoverView();
});

// Lives in the workspace rather than the sidebar (right next to what it's
// sizing — see renderCoverView()), so it's outside the generic
// `#sidebar input` wiring and needs its own handler.
document.getElementById('spineWidth').addEventListener('input', () => {
  params.spineWidth = parseFloat(document.getElementById('spineWidth').value) || defaults.spineWidth;
  renderCoverView();
  save();
});

// Lives in the workspace rather than the sidebar, so it's outside the
// generic `#sidebar input` wiring above and needs its own handler. A full
// render is safe here — it only touches #card-strip and #lesson-list,
// neither of which contains this input, and renderLessonList()'s own
// focus check keeps it from clobbering the value mid-type.
document.getElementById('workspaceLessonTitle').addEventListener('input', () => {
  activeLesson().title = document.getElementById('workspaceLessonTitle').value;
  save();
  render();
});

document.getElementById('type-picker-backdrop').addEventListener('click', closeTypePicker);

document.getElementById('link-editor-backdrop').addEventListener('click', closeLinkEditor);
document.getElementById('linkFetch').addEventListener('click', fetchLinkMeta);
document.getElementById('linkDone').addEventListener('click', closeLinkEditor);
document.getElementById('linkCancel').addEventListener('click', cancelLinkEditor);

document.getElementById('image-editor-backdrop').addEventListener('click', closeImageEditor);
document.getElementById('confirm-dialog-backdrop').addEventListener('click', () => closeConfirmDialog(false));
document.getElementById('confirmCancel').addEventListener('click', () => closeConfirmDialog(false));
document.getElementById('confirmOk').addEventListener('click', () => closeConfirmDialog(true));
document.getElementById('imageDone').addEventListener('click', closeImageEditor);
document.getElementById('imageCancel').addEventListener('click', cancelImageEditor);
document.getElementById('imageFit').addEventListener('click', event => {
  const button = event.target.closest('button');
  if (button) setImageFit(button.dataset.fit);
});

// Enter confirms from either single-line field. Not from the description,
// where a newline is the useful thing.
for (const id of ['linkUrl', 'linkTitle']) {
  document.getElementById(id).addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    closeLinkEditor();
  });
}

// Same Enter-confirms shape as linkUrl/linkTitle above.
for (const id of ['newCourseCode', 'newCourseName']) {
  document.getElementById(id).addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    closeAddCourseDialog(true);
  });
}

// Same shape again for the first-run gate's own inputs.
for (const id of ['firstRunCourseCode', 'firstRunCourseName']) {
  document.getElementById(id).addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    document.getElementById('firstRunCreateBtn').click();
  });
}

// Escape pairs with Cancel now that there is an explicit OK — the backdrop
// still commits, so clicking away doesn't throw away what you typed.
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  closeTypePicker();
  cancelLinkEditor();
  cancelImageEditor();
  closeConfirmDialog(false);
  closeAddCourseDialog(false);
});

// The picker is anchored in viewport coordinates, so it would drift away from
// its add-slot if the strip scrolled underneath it.
for (const [target, type] of [[document.getElementById('workspace'), 'scroll'], [window, 'resize']]) {
  target.addEventListener(type, () => {
    closeTypePicker();
    closeLinkEditor();
    closeImageEditor();
  });
}

// A file dropped anywhere but an image block would otherwise navigate the page
// away to it.
for (const type of ['dragover', 'drop']) {
  document.addEventListener(type, event => {
    if ([...(event.dataTransfer?.types || [])].includes('Files')) event.preventDefault();
  });
}

// A handle arms the slot on mousedown; disarm on any release, including one
// that lands outside the card.
document.addEventListener('mouseup', () => {
  document.querySelectorAll(
    '.card-slot[draggable="true"], .card-block[draggable="true"], .lesson-row[draggable="true"]'
  ).forEach(el => { el.draggable = false; });
});

// Resets only the active course's Card Grid/Features/Outline settings back
// to their defaults — courseCode/courseName are course identity, not a
// "setting", so they're preserved rather than wiped along with the rest of
// `defaults`. Unlike the old Reset Everything, this never touches
// localStorage, other courses, lessons, or cards.
document.getElementById('reset-settings-btn').addEventListener('click', () => {
  const { courseCode, courseName } = params;
  Object.assign(params, defaults, { courseCode, courseName });
  writeParams();
  save();
  render();
});

// render-card.js's block editors (buildImageEditor, buildLinkEditor, ...)
// call these by name unchanged from when they lived in this file — wiring
// them here, once, is what makes that work. None of this runs for the
// read-only viewer, which never imports course-builder.js at all.
configureRenderCard({
  save, render, removeBlock, openTypePicker,
  makeBlockDraggable, makeResizable, makeBlockDropTarget,
  changeListCount, changeMatrixEntries, changeMatrixColumns,
  openImageEditor, openLinkEditor, uploadImage, resolveImageSrc,
});

// ── Init ─────────────────────────────────────────────────────
// A fresh install (load() → false) and a returning user whose only course
// got deleted (load() → true, courses: []) both land here with zero
// courses — the module-level `let` declarations above are already the
// correct empty state for that; updateFirstRunGate() (called from
// render() below) is what actually surfaces it to the user.
await load();

await tryAutoReconnect();

const restoredUser = await trySessionRestore();
// Cloud storage only auto-resumes if nothing stronger already claimed
// activeAdapter (tryAutoReconnect() above runs first and wins if a vault
// reconnected) — mirrors vault's own permission-gated, no-surprise-switch
// approach to restoring a previous session's storage choice.
if (restoredUser && activeAdapterKind === 'local' && localStorage.getItem(CLOUD_STORAGE_PREFERENCE_KEY)) {
  await useCloudStorage(false);
}
updateAccountStatus();
updateStorageOptions();
// Covers the fresh-install case (load() above returned false, so its own
// call never ran) — harmless, idempotent re-call otherwise.
await updateProfileDetails();
onAuthStateChange(() => {
  updateAccountStatus();
  updateStorageOptions();
});

writeParams();
readParams();
render();
// Only now — render() above has already set #first-run-gate's real
// hidden state via updateFirstRunGate(), so whichever of the two
// #app-loading was covering is correct the instant it's gone, not a
// guess (empty) that then gets corrected once loading actually finishes.
document.getElementById('app-loading').hidden = true;
