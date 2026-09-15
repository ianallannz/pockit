// Hand-maintained for now — until the course-builder composer has an export
// step (see card-format.md's "Where things actually stand"), there's no
// automatic path from a Link (QR) block's slug into this file. Once that
// export exists, it should regenerate this array from every course's blocks
// rather than this being edited by hand.
//
// Each entry becomes one static redirect page at /<slug>/ — see
// src/redirects.njk, which paginates over this array.
export default [
  { slug: "example", url: "https://example.com" },
];
