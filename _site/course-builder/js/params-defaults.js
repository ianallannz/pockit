// ── Course param defaults ────────────────────────────────────
// Everything here belongs to one course — shared by every lesson in it, not
// per-lesson — and is what a freshly created course starts from. Its own
// module (rather than living in course-builder.js) so storage adapters can
// merge saved params over these without importing back from
// course-builder.js, which would create a circular import.
export const defaults = {
  courseCode: 'BSNS5404',
  courseName: 'Managing Projects',
  gridSize: 4,
  cardWidth: 80,
  cardHeight: 160,
  dots: true,
  dotSize: 0.4,
  dotColor: '#cccccc',
  header: true,
  headerHeight: 12,
  headerLine: true,
  headerLineColor: '#dedede',
  punchMark: true,
  punchColor: '#00BB27',
  lessonCount: true,
  lessonCountColor: '#999999',
  footer: true,
  footerHeight: 8,
  footerLine: true,
  footerLineColor: '#dedede',
  footerTextColor: '#999999',
  cardNumbers: true,
  cardNumberColor: '#999999',
  cardOutline: true,
  cardOutlineColor: '#dedede',
  cardOutlineWeight: 0.2,
  spineWidth: 7,

  // Course cover — see renderCoverView()/buildCoverFillRow() in
  // course-builder.js. "whole" paints one image or color across the whole
  // flat back/spine/front spread with no seam at the fold lines; "perSide"
  // gives each of the three its own independent fill, so both stay set
  // (whichever isn't currently active is just unused, not cleared) —
  // switching modes back and forth doesn't lose anything already chosen.
  coverMode: 'whole',
  coverWholeFillType: 'color',
  coverWholeColor: '#ffffff',
  // 0-100 — transparency of a solid fill color (100 = opaque). Applies to
  // every cover* color below, not just this one; see hexToRgba() in
  // course-builder.js. No equivalent for image fills.
  coverWholeColorAlpha: 100,
  coverWholeImage: '',
  // 0-100 each — where the visible window sits along the image's overflow
  // past the panel once it's scaled to cover (never stretched); 50 is
  // centered, same reading as a plain CSS background-position percentage.
  // See coverFitGeometry()/applyCoverFill() in course-builder.js — dragging
  // the cover image updates these.
  coverWholeImageOffsetX: 50,
  coverWholeImageOffsetY: 50,
  // Whole-cover mode's spine gets an optional colour tint layered on top of
  // the shared image/color rather than a fill of its own — the spine is
  // usually too narrow to read as part of a continuous image anyway, but a
  // solid color there (uncovered by dropping the alpha) would break the
  // "one continuous image" illusion, so this stays fully transparent
  // (alpha 0) until deliberately turned on.
  coverWholeSpineColor: '#ffffff',
  coverWholeSpineColorAlpha: 0,
  coverBackFillType: 'color',
  coverBackColor: '#ffffff',
  coverBackColorAlpha: 100,
  coverBackImage: '',
  coverBackImageOffsetX: 50,
  coverBackImageOffsetY: 50,
  // Toggled via #coverBackTextEnabled, next to the Design toggle — whether
  // the back cover's text box (below) shows at all.
  coverBackTextEnabled: true,
  // Markdown, same as a card's own Text block body — see
  // buildCoverTextBox()/initCoverBackText() in course-builder.js, which
  // reuses that block's click-to-edit interaction and renderMarkdown().
  coverBackText: '',
  // Height in whole grid units (mm = this × gridSize), same unit the front
  // cover's mark/info panels use for their own fixed height — 10 is their
  // default too, so a fresh course's back box starts out the same height
  // as them. Resized (in grid-unit steps) by dragging #cover-back-resize.
  coverBackTextHeightGrids: 10,
  // 'top' or 'bottom' — which edge of the back cover the box (and its
  // padding) is anchored to; toggled via #cover-back-text-align.
  coverBackTextAlign: 'bottom',
  // Per-side mode's spine is colour-only — no image toggle, no upload —
  // narrow enough (7mm typical) that an independently-fit image there was
  // never going to read as anything but a sliver anyway.
  coverSpineColor: '#ffffff',
  coverSpineColorAlpha: 100,
  coverFrontFillType: 'color',
  coverFrontColor: '#ffffff',
  coverFrontColorAlpha: 100,
  coverFrontImage: '',
  coverFrontImageOffsetX: 50,
  coverFrontImageOffsetY: 50,
};
