// ── Storage switch guard ─────────────────────────────────────
// Pure, DOM-free helpers deciding what a switch TO a shared backend
// (cloud / vault folder) may do. Course-builder.js owns the DOM/dialogs;
// this module only answers "which side has data, and what follows?"
//
// Data rule (agreed): any saved `courses.length > 0` counts as data worth
// protecting — no "blank course" exception. A load *error* is never treated
// as empty; callers must stay put and surface the error instead.

export function hasUserData(state) {
  return Boolean(state && Array.isArray(state.courses) && state.courses.length > 0);
}

function courseName(course) {
  const code = course?.params?.courseCode;
  const name = course?.params?.courseName;
  return [code, name].filter(Boolean).join(' · ') || 'Untitled course';
}

function countLessons(state) {
  return (state.courses || []).reduce((n, c) => n + (c.lessons?.length || 0), 0);
}

function countCards(state) {
  return (state.courses || []).reduce(
    (n, c) => n + (c.lessons || []).reduce((m, l) => m + (l.cards?.length || 0), 0),
    0
  );
}

// "2 courses · 4 lessons · 11 cards" — counts only, for compact surfaces.
export function summarizeStateCounts(state) {
  const courses = state?.courses?.length || 0;
  return `${courses} course${courses === 1 ? '' : 's'} · ${countLessons(state)} lesson${countLessons(state) === 1 ? '' : 's'} · ${countCards(state)} card${countCards(state) === 1 ? '' : 's'}`;
}

// Multi-line detail for the conflict dialog: counts plus up to 5 course names.
export function summarizeStateDetail(state) {
  const names = (state.courses || []).slice(0, 5).map(courseName);
  const rest = state.courses.length > names.length ? ` (+${state.courses.length - names.length} more)` : '';
  return `${summarizeStateCounts(state)}: ${names.join(', ')}${rest}`;
}

// Where a planned switch stands. Never returns "overwrite remote":
//   'nothing'      — neither side has data; just adopt the backend.
//   'seed-remote'  — only local has data; safe to upload it.
//   'adopt-remote' — only remote has data; safe to download it.
//   'confirm'      — both sides have data; must ask before discarding local view.
export function decideStorageSwitch(localState, remoteState) {
  const localHas = hasUserData(localState);
  const remoteHas = hasUserData(remoteState);
  if (localHas && remoteHas) return 'confirm';
  if (localHas && !remoteHas) return 'seed-remote';
  if (!localHas && remoteHas) return 'adopt-remote';
  return 'nothing';
}

// Message for the both-nonempty warning. Names the remote side ("cloud
// account", "chosen folder") and spells out that continuing replaces the
// local view — and that the dialog never uploads local over remote.
export function buildStorageConflictMessage({ remoteKind, remoteState, localState }) {
  const remoteLabel = remoteKind === 'cloud' ? 'cloud account' : 'chosen folder';
  return `This ${remoteLabel} already has ${summarizeStateDetail(remoteState)}. `
    + `Switching will replace what is shown on this device (${summarizeStateDetail(localState)}) with the ${remoteLabel} data. `
    + `Your local view will be discarded. Continue?`;
}
