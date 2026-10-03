// Hand-maintained static entries only. QR-block slugs now go live through
// the Supabase `shortlinks` table instead (see supabase/shortlinks.sql and
// src/404.njk) — published from the course-builder via Publish short URLs
// or claimed per-link in the link editor, with no rebuild. Only slugs that
// must exist without a signed-in publisher belong here.
//
// Each entry becomes one static redirect page at /<slug>/ — see
// src/redirects.njk, which paginates over this array.
export default [
  { slug: "example", url: "https://example.com" },
  { slug: "handwriting", url: "https://www.scientificamerican.com/article/why-writing-by-hand-is-better-for-memory-and-learning/" },
  { slug: "alphaschool", url: "https://alpha.school/" },
  { slug: "alphabootcamp", url: "https://buildcognitiveresonance.substack.com/p/special-report-my-so-called-alpha" },
  { slug: "sh35", url: "https://www.youtube.com/watch?v=jEOydUQXfl8" },
];
