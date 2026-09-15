// Sits below its anchor and centred on it, flipping above if there isn't
// room, and clamped so it never hangs off either side. Pulled out of
// course-builder.js so onboarding-tour.js's tooltip can reuse the same
// viewport-clamped placement math instead of duplicating it.
export function positionPopover(picker, anchor) {
  const gap = 10;
  const margin = 8;
  const a = anchor.getBoundingClientRect();
  const p = picker.getBoundingClientRect();

  let left = a.left + a.width / 2 - p.width / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - p.width - margin));

  let top = a.bottom + gap;
  if (top + p.height > window.innerHeight - margin) top = a.top - gap - p.height;
  // Same clamp shape as `left` above — belt-and-suspenders for anchors near
  // the very top or bottom edge, where flipping alone isn't enough room.
  top = Math.max(margin, Math.min(top, window.innerHeight - p.height - margin));

  picker.style.left = `${left}px`;
  picker.style.top = `${top}px`;
}
