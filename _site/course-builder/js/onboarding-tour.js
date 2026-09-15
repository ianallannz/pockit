// ── First-time tour ──────────────────────────────────────────
// A short, skippable walkthrough of the sidebar/workspace, auto-played once
// right after a brand-new user creates their first course (see the
// #firstRunCreateBtn handler in course-builder.js), and re-playable any time
// from the profile panel's "Replay tour" button.
//
// "Seen" state is a plain localStorage flag, not routed through
// snapshot()/the storage adapters — it's a per-browser UI preference about
// this device, not course data that should travel with a vault or cloud
// course, same reasoning as CLOUD_STORAGE_PREFERENCE_KEY in
// course-builder.js.
import { positionPopover } from './popover.js';

const TOUR_SEEN_KEY = 'pockit-course-builder-tour-seen';

export function hasSeenTour() {
  return localStorage.getItem(TOUR_SEEN_KEY) === '1';
}

export function markTourSeen() {
  localStorage.setItem(TOUR_SEEN_KEY, '1');
}

const STEPS = [
  { selector: '#add-course-btn', title: 'Welcome! Courses', body: 'You can add more courses here at any time.' },
  { selector: '#lesson-group', title: 'Lessons', body: 'Each course is a set of lessons that you create and rearrange here.' },
  { selector: '#card-strip', title: 'Cards & blocks', body: 'You build each lesson as and when needed out of pocket-sized cards using a variety of content blocks.' },
  { selector: '#scratchpad-toggle', title: 'Lesson planner', body: 'You have a scratchpad for quickly mapping out your weekly timetabled lessons.' },
  { selector: '#teacher-overview-toggle', title: 'Presentation slides', body: 'You can add and present simple teacher slides for additional lesson guidance.' },
  { selector: '#course-cover-btn', title: 'Cover designer', body: 'Head here to design a beautiful cover folder to hold all printed lesson cards.' },
  { selector: '#print-btn', title: 'Print', body: 'Print your lesson cards on sheets of A4, ready for student cutting.' },
  { selector: '#profile-btn', title: 'Account & storage', body: 'Set how and where you want your data stored, no sign-up needed. And you can replay this tour from here any time.' },
];

// Only ever one tour on screen at once — module-level state, not a class,
// matching the rest of this codebase's singleton-panel style (openTypePicker,
// openProfilePanel, ...).
let scrim = null;
let highlight = null;
let tooltip = null;
let steps = STEPS;
let stepIndex = 0;

function currentAnchor() {
  return document.querySelector(steps[stepIndex].selector);
}

function positionHighlight() {
  const anchor = currentAnchor();
  if (!anchor) return;
  const rect = anchor.getBoundingClientRect();
  const pad = 6;
  highlight.style.left = `${rect.left - pad}px`;
  highlight.style.top = `${rect.top - pad}px`;
  highlight.style.width = `${rect.width + pad * 2}px`;
  highlight.style.height = `${rect.height + pad * 2}px`;
}

function renderStep() {
  const anchor = currentAnchor();
  // A step whose target isn't in the DOM right now (e.g. a browser without
  // the vault feature hiding a row) is skipped rather than shown pointing at
  // nothing.
  if (!anchor) {
    if (stepIndex < steps.length - 1) { stepIndex++; renderStep(); }
    else endTour();
    return;
  }

  positionHighlight();

  const step = steps[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;
  tooltip.innerHTML = `
    <p id="tour-tooltip-step">Tour ${stepIndex + 1} of ${steps.length}</p>
    <h2 id="tour-tooltip-title"></h2>
    <p id="tour-tooltip-body"></p>
    <div id="tour-tooltip-footer">
      <button id="tour-skip-btn" type="button">Skip</button>
      <div id="tour-tooltip-nav">
        <button id="tour-back-btn" type="button" ${isFirst ? 'disabled' : ''}>Back</button>
        <button id="tour-next-btn" type="button">${isLast ? 'Done' : 'Next'}</button>
      </div>
    </div>
  `;
  tooltip.querySelector('#tour-tooltip-title').textContent = step.title;
  tooltip.querySelector('#tour-tooltip-body').textContent = step.body;
  tooltip.querySelector('#tour-skip-btn').addEventListener('click', endTour);
  tooltip.querySelector('#tour-back-btn').addEventListener('click', () => { stepIndex--; renderStep(); });
  tooltip.querySelector('#tour-next-btn').addEventListener('click', () => {
    if (isLast) endTour();
    else { stepIndex++; renderStep(); }
  });

  positionPopover(tooltip, anchor);
}

function handleResize() {
  positionHighlight();
  const anchor = currentAnchor();
  if (anchor) positionPopover(tooltip, anchor);
}

function handleKeydown(event) {
  if (event.key === 'Escape') endTour();
}

function endTour() {
  scrim?.remove();
  highlight?.remove();
  tooltip?.remove();
  scrim = highlight = tooltip = null;
  window.removeEventListener('resize', handleResize);
  window.removeEventListener('scroll', handleResize, true);
  document.removeEventListener('keydown', handleKeydown);
}

// Deliberately built fresh each run (rather than hidden/shown static
// markup) — the tour is needed at most once or twice a session, so there's
// nothing worth keeping around between runs.
export function runTour(customSteps = STEPS) {
  endTour(); // guards against a double-invocation leaving two tours stacked
  steps = customSteps;
  stepIndex = 0;

  scrim = document.createElement('div');
  scrim.id = 'tour-scrim';

  highlight = document.createElement('div');
  highlight.id = 'tour-highlight';

  tooltip = document.createElement('div');
  tooltip.id = 'tour-tooltip';
  tooltip.setAttribute('role', 'dialog');
  tooltip.setAttribute('aria-modal', 'true');

  document.body.appendChild(scrim);
  document.body.appendChild(highlight);
  document.body.appendChild(tooltip);

  window.addEventListener('resize', handleResize);
  window.addEventListener('scroll', handleResize, true);
  document.addEventListener('keydown', handleKeydown);

  renderStep();
}
