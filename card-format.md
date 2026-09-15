# Pockit card format — design notes

Status: **prototype composer built, writes real `:::`-container markdown
to a user-chosen folder on disk** (not just `localStorage`), via
`card-format.js` and a vault storage layer, and **can print a lesson**
(3-up landscape A4) — see "Where things actually stand". Not yet connected
to the Eleventy site build. **A third, Supabase-backed storage adapter now
works end-to-end against a real project** — sign-in, switching to cloud
storage, and attachment uploads all verified live — alongside (not instead
of) the existing local/vault backends; the licensing/entitlements side of
that architecture is designed but still inert/unbuilt — see "Going online"
under Open questions. Last updated 2026-08-28.

## Where things actually stand

`src/course-builder/` is a working, standalone authoring tool — vanilla
HTML/CSS/JS, no build step, run with any static file server pointed at
that directory (or via Eleventy's own dev server, which passthrough-copies
it to `/course-builder/`). It implements the "structured block UI" chosen
below, and — as of this session — it *is* the `parse`/`serialize`
architecture the rest of this document describes, for one storage backend.
Read the rest of this document as the target design; this section is what
exists today, including where it now matches that target and where it
still doesn't.

**Data model** (`src/course-builder/js/course-builder.js`): courses →
lessons → cards → blocks, each level owning the one below it. A course
carries its own params (code, name, grid size, card width/height in mm,
header/footer/outline settings) and its own lesson list; a lesson carries
its own title, scratchpad notes, and card set; a card carries an ordered
list of blocks and (new) an optional `title`.

**Two storage backends, one interface** — `src/course-builder/js/storage/
storage-adapter.js` documents the shape (`load()` / `save(state)` /
`describe()`) both implement, so course-builder.js never needs to know
which is active. This is the extension point for a future hosted/online
backend — see Open questions.
- `local-storage-adapter.js`: the original backend, one JSON blob under
  `localStorage['pockit-course-builder']`, with a defensive migration
  chain for two earlier, narrower schema versions (single-lesson, then
  single-course). Always available; what a browser without the File
  System Access API (non-Chromium) is limited to.
- `vault-adapter.js`: **new this session.** Reads/writes a real folder on
  disk ("vault"), chosen once via `showDirectoryPicker()` and reconnected
  automatically on later visits (permission allowing) via
  `vault-handle-store.js`'s IndexedDB-persisted handle. This is the
  `parse`/`serialize` architecture actually landing — see layout below.
  Chromium-only; the sidebar's "Saved to: …" banner (bottom of the left
  nav) and its ⇄ button are only shown when the API exists at all.

**`card-format.js` is built** (`src/_lib/card-format.js`), exactly matching
the two-function shape in Architecture rule below, with round-trip tests
in `test/card-format.test.js`. Both `vault-adapter.js` and (eventually) the
Eleventy build can import it — only the former does yet.

**Vault file layout**, written/read by `vault-adapter.js`:

```
<vault-root>/                      — the folder the user picked; NOT src/courses/**
  vault.yml                        — activeCourseId
  <course-slug>/
    course.yml                     — id, params, timetable, activeLessonId,
                                      lessons: [id, id, …]   (explicit order)
    attachments/
      <sha256-prefix>.<ext>        — content-addressed images; a card's
                                      `src=` attr is the vault-relative
                                      reference "attachments/<hash>.<ext>"
    lessons/
      <lesson-slug>/
        lesson.yml                 — id, title, scratchpad, cards: [id, …] (order)
        cards/
          card-<id>.md             — untitled card
          card-<id>-<slug>.md      — once the card has a title (id prefix
                                      stays authoritative; the suffix is
                                      only for someone browsing the folder)
```

Folder/file **names are never identity** — every level tracks its own
id → current-name mapping in memory for the life of one connected session,
discovered from `*.yml` (or, for cards, the `card-<id>` filename prefix) on
load. A course/lesson/card folder or file is only renamed when the field
it's slugified from (courseCode/courseName, a lesson's title, a card's
title) actually *changes* since the last save — so a human's manual rename
in Finder is left alone until the app has its own reason to touch that
entry again, and an in-app rename doesn't churn every unrelated file's
mtime. Name collisions get a numeric suffix (`week-2`, `week-2-2`, …).

Card frontmatter today is just `{ title }` when set, `{}` otherwise —
none of `kind`/`handout` from Format below exist in a real card yet.

**Block vocabulary as actually implemented** (`BLOCK_TYPES` in
`block-types.js`) is bigger than either previous version of this doc
described: `heading`, `explanatory` (label "Text"), `qr` (label "Link
(QR)"), `key-idea`, `image`, `quote`, `task`, `reflection`, `list`,
`matrix`, `footnote`. Still **no reconciliation** with the `copy` /
`question` / `qr` / `note` vocabulary in Format below — that section
remains aspirational, not what a real card's frontmatter/containers
contain. Whoever tackles this needs to decide whether the doc's vocabulary
gets dropped in favour of the composer's real one, or the composer's types
get renamed/pared down to match. Each real type's container shape (which
attrs, which field is the markdown body) is defined once, in that type's
`format` entry in `block-types.js` — `card-format.js` never hard-codes the
list, so adding a type there doesn't require touching the parser.

**Card renaming (new this session):** the small caption under each card
(previously just an auto-numbered, unclickable drag handle reading "Card
N") is now an editable title, with the drag handle demoted to a small grip
at its left edge. A card's fixed position ("N of M") is shown elsewhere on
the card itself and stays purely index-driven — renaming never touches it.
The title reaches disk via frontmatter and the filename slug — see "Vault
file layout" above.

**Lesson order** is now explicit (`course.yml`'s `lessons:` id list) rather
than inferred from directory-listing order, which — being filesystem-
dependent — didn't reliably match the order last set in the composer.

**UI**, roughly matching the "layout composer" brief below: a card strip
with drag-to-reorder cards and blocks, a live mm-accurate preview (dot
grid, header/footer, hole-punch mark, outline — all print-scale and
printable as-is), row-budget snapping in half-grid steps, and a sidebar
for course/lesson switching plus the print-feature settings (now behind a
small gear icon next to "Course" rather than its own always-present
section — same reveal/collapse behaviour, just relocated, and Course
Code/Name now live inside it permanently instead of behind a toggle).
Adding a course opens a small modal (code/name, OK/Cancel) rather than
creating one immediately with placeholder values. Multiple courses and
multiple lessons per course are both supported, each course carrying its
own independent card-design settings (so "one card size will be settled
on," in Config below, is no longer quite the plan — see Open questions).

**The composer can now print a lesson directly** (new 2026-08-26) —
`src/course-builder/css/print.css`, active via Ctrl+P/File>Print (no
button; hooked to the browser's own `beforeprint` event, which rebuilds
`#print-root` from whatever's live in `#card-strip` right before the
dialog opens). Three cards per A4-landscape page, flush against each other
(no gap, for fewer cuts) and centered as a group on the page — including
the last, partial page, if the lesson's card count isn't a multiple of
three. This is **unrelated to** `src/css/print.css`/`print.njk` below (the
Eleventy-built site's own print route) — that one is still 4 lines and
does none of this; "the print CSS" now needs disambiguating between the
two.

**Not yet built, from the plan below:** any bridge between a vault and
`src/courses/**`/Eleventy, and the *site's* print CSS/imposition step
(`src/css/print.css` is still 4 lines — see above, this is the other one).
The eight existing stub cards under
`src/courses/eit/l5-business-functions/materials/` are still plain
markdown, not container syntax — nothing has touched them. A vault is a
folder the browser has permission to read/write on one machine; it has no
relationship to the Eleventy build today.

## Purpose

Markdown-based lesson cards for a course. Primary output is smartphone-sized
cards printed 2–3 up on A4. Secondary output is the published site, where the
same source renders as a responsive page.

## Decisions made

- **VitePress is dropped.** `docs/` is the old approach; too much working around
  VitePress's conventions. Eleventy is the build.
- **Obsidian-as-vault was considered and rejected.** Workable for a single
  author, but too finicky to hand to anyone else (wikilinks, attachment folders,
  `.obsidian/` in the repo, no validation).
- **A structured block UI is the chosen authoring approach.** Not a document
  editor — a *layout composer*: block palette, row-budget meter, reorderable
  rows, live mm-accurate preview. Block bodies are small type-aware fields.
- `src/note/js/note-designer.js` already implements the renderer half of this.
  `buildBlock()` (line 383) dispatches on `block.type` and sizes blocks as
  `block.height * GRID` in mm. Its block model (line 380) is the basis for the
  card format. What it lacks: markdown bodies (bodies are plain strings) and
  persistence (config is a hand-edited JS array literal at line 106).

## Format

Fenced containers with attributes — same `:::` syntax as VitePress, which is
already familiar.

```markdown
---
title: "Introduction to Business Functions"
handout: 1
kind: card
---

::: copy h=2
Businesses exist to solve problems. Every function inside a business
is there to make that solving **repeatable**.
:::

::: question h=4
What problem does your chosen business solve?
:::

::: qr h=2 url="https://youtu.be/xyz"
Watch: What is a business function? (6 min)
:::

::: note h=fill border=dashed
Bring your notes next week.
:::
```

Rules:

- `h=N` is height in grid rows. Omitted means `auto` (measured at render).
- `h=fill` absorbs leftover slack. At most one per card.
- Body is ordinary markdown — lists, bold, links all work inside a block.
- **Unknown attributes are preserved verbatim.** This lets new block types be
  added without breaking old cards, and stops the UI destroying attributes it
  doesn't understand.
- Columns, if ever needed, come from nesting with a longer fence
  (`:::: row` containing two `::: col`). Not being built now, but the syntax
  leaves room.

### Why containers and not a `rows:` array in YAML

YAML parses more cleanly, but block bodies become indentation-sensitive quoted
strings: no syntax highlighting, re-indenting on every paste, escaping problems
the first time someone writes a colon. It stops being a markdown file and
becomes a YAML file wearing a `.md` extension. Containers keep prose as prose,
which matters because prose is what a human edits by hand when the UI is
inconvenient.

## Two kinds, one vocabulary

```yaml
kind: card   # row-budgeted, pocket size, 2–3 up on A4
kind: page   # unconstrained flow, prints A4 — teacher notes, activities
```

A `page` uses the same block vocabulary with the budget switched off and every
height `auto`. It can still use a `qr` or `question` block where handy. No
second format, no second parser, no second UI.

## Height model

- `h` is a **print-only hint.** Web layout is free-flowing and responsive, so
  `h` never affects web output. A card with no `h` anywhere still renders
  correctly on the web.
- Budget, not exact sum: blocks must not *exceed* the row count; leftover falls
  as whitespace at the bottom. Strict sum-to-N forces a rebalance on every edit.
- The budget check is a **print-preview concern**, shown in the UI. It is not
  build-time validation — don't fail a site build over a layout detail.
- Height stays authorable because for `question` blocks **the height is the
  content**: `h=4` means one row of prompt and three rows of ruled answer space.
  Only `copy`-type blocks have content-determined height.

## Print vs web rendering

Each block type has two renderers:

| block      | print                        | web                              |
|------------|------------------------------|----------------------------------|
| `copy`     | text in a fixed row box      | flowing paragraph                |
| `question` | prompt + ruled answer lines  | prompt, optionally with textarea |
| `qr`       | QR code + caption            | tappable link + caption          |

The `qr` row is the clearest payoff: on paper a URL is useless so you need the
QR; on a phone the QR is useless so you need the link. One source line, correct
affordance in both media.

## Architecture rule

**Built** — one module, `src/_lib/card-format.js`, exporting exactly two
functions:

```js
parse(markdown)                    → { frontmatter, blocks: [{ type, h, …type-specific fields }] }
serialize({ frontmatter, blocks }) → markdown
```

(The real shape spreads each type's own fields — e.g. `qr`'s `url`,
`image`'s `src`/`alt` — straight onto the block via that type's `format`
entry in `block-types.js`, rather than a generic `attrs`/`body` pair as
first sketched here; an attribute no type claims round-trips verbatim via
`block._unknownAttrs`.)

So far only `vault-adapter.js` imports it — the Eleventy build doesn't yet,
since nothing bridges a vault into `src/courses/**` (see Open questions).
"Nothing else knows the syntax" still holds within the composer itself.

Round-trip properties, tested in `test/card-format.test.js`:

- `parse(serialize(x))` equals `x`
- `serialize(parse(f))` equals `f`

These are what let hand-editing and UI-editing coexist safely. Without them the
UI will eventually eat a hand-written card.

## Config

Card dimensions and row count were meant to be properties of the card
*design*, not of an individual card — one card size settled on for
everything. That plan has since drifted: the composer makes card width,
height, and grid size a per-*course* setting (adjustable in its sidebar,
defaulting to 80mm × 160mm at a 4mm grid), not a single fixed value in
`src/_data/card.js`. If a single settled size is still the goal for the
eventual markdown format, that's a real decision to make, not just an
implementation detail — see Open questions.

## Frontmatter should stay minimal

Derive `provider` / `course` / `week` from the input path with a
`src/courses/courses.11tydata.js` directory data file. That logic already exists
in the wrong place — the `courses` collection in `.eleventy.js` computes
`provider` from `inputPath`. `handout` can come from the filename prefix.

That leaves roughly `title` and `kind` to author, so the UI is almost entirely a
layout tool with barely a settings panel.

## Known limitation

note-designer sets `overflow: hidden` on every block, so print content that
doesn't fit is **silently clipped** — no error, no truncation mark, you find out
on paper. The composer inherited the same `overflow: hidden` (`.card` in
course-builder's CSS) and has **not** inherited a fix for it — there is no
overflow/red-state detection built yet, so this limitation is still live in
the actual tool, not just a historical note about note-designer.

Don't try to catch this at build time; measuring rendered text height in Node
means driving a headless browser. Catch it in the UI: same `overflow: hidden`
box plus a red state when scroll height exceeds the box. ~10 lines, and the
single most valuable thing the composer does.

## Next steps

The composer UI (originally step 5 below) is built, and — new this session
— actually persists through `card-format.js` to real files in a vault
rather than just `localStorage`. Remaining from the original list:

1. ~~Write `card-format.js` with `parse` / `serialize` and the two
   round-trip tests.~~ **Done** — `src/_lib/card-format.js`,
   `test/card-format.test.js`.
2. Convert the eight existing stub cards under
   `src/courses/eit/l5-business-functions/materials/` to container syntax.
   Still not started — and now there's a real converter to point at them
   (`card-format.js`'s `serialize`), it's more "write a one-off migration
   script" than "hand-convert eight files."
3. Move `provider` / `course` / `week` derivation into `.11tydata.js`.
4. Build the real print CSS *for the Eleventy-built site*: `@page` box at
   card mm, imposition on A4. (`src/css/print.css` is currently 4 lines
   and does none of this.) Not the same thing as the composer's own
   `src/course-builder/css/print.css` — see "Where things actually
   stand" — which is done, for one lesson at a time, 3-up landscape.
5. ~~Build the composer UI, local-only, writing straight into
   `src/courses/**`.~~ Built. Writes to real files now too — just not into
   `src/courses/**`; into a separate, user-chosen vault folder instead (see
   "Where things actually stand"). Bridging that gap is its own open
   question below, not resolved by this.
6. Add the overflow/red-state detection described above — still missing.

## Open questions

- **Vault ↔ `src/courses/**`/Eleventy bridge.** A vault is real, working,
  container-syntax markdown — but on a folder the user picked, disconnected
  from the Eleventy build. Nothing reads a vault into `src/courses/**`, or
  points Eleventy at a vault directly. Worth deciding before doing more
  vault work: does Eleventy's `courses` collection eventually read straight
  from a configured vault path, or does content move from vault →
  `src/courses/**` some other way (a build step? a one-off export?)?
- **Going online.** Raised 2026-08-25; architecture resolved 2026-08-28,
  built and verified working against a real Supabase project the same day
  — sign-in (magic link), switching to cloud storage, course/lesson/card
  save+load round-trips, and attachment uploads all confirmed live. See
  `/home/ian/.claude/plans/graceful-exploring-cosmos.md` for the full
  plan, and `supabase/schema.sql` for the schema actually applied. Two
  real bugs found and fixed only once tested against a live project rather
  than the mocked adapter tests alone: missing `grant`s on tables created
  via the SQL Editor (RLS alone isn't enough — see schema.sql's Grants
  section) and PostgREST's `not.in.()` filter rejecting a literal "null"
  for the empty-remaining-ids case (see `deleteStrayRows()` in
  `supabase-adapter.js`, now also covered by a regression test). Summary
  of the design: a `supabase-adapter.js` implements the same
  `storage-adapter.js` contract against normalized Postgres tables
  (`supabase/schema.sql`) mirroring vault's course→lesson→card hierarchy,
  reusing `card-format.js` for card bodies exactly as vault does.
  `attachments.save()/resolve()` is now formalized as part of the
  documented (optional) contract in `storage-adapter.js`, not vault-only.
  Auth is Supabase Auth, added opt-in alongside the existing two backends —
  a signed-out user sees zero behavior/network change. An `entitlements`
  table supports both a subscription and a one-time "perpetual online"
  plan type without committing to one; a separate outright local license
  is verified fully offline via an ECDSA signature
  (`js/license/license.js`) rather than a live account check, since that's
  the one plan type meant to work on a machine that's never online again.
  What a missing/expired entitlement should actually restrict is still an
  open product decision — the whole mechanism ships inert until that's
  answered. Multi-device conflict resolution deliberately stays
  last-write-wins for v1, same as vault today.

  **User profile added 2026-08-29, redesigned same day per explicit
  correction:** title/first name/last name/job title/employer/photo were
  first built as a Supabase-only, sign-in-gated feature — the user then
  clarified this needs to work for non-signed-in users too (stored
  locally/on disk), since it feeds into course output (cover, teacher
  slides). Redesigned so `profile` is root-level app state, exactly like
  `activeCourseId` — carried through every adapter's `load()`/`save()`
  (`local-storage-adapter.js` included, no gating at all for the text
  fields) rather than a side channel. Only the photo needs an optional
  `avatar` capability (mirroring `attachments`, feature-detected via
  `activeAdapter.avatar`) — present on vault (root-level `profile.yml` +
  a fixed `avatar.<ext>` file) and cloud (`profiles` table + `avatars`
  bucket), absent on plain local storage, which has nowhere to put binary
  data. Found and fixed a real pre-existing bug while extending
  `vault-adapter.js`'s `save()` for this: `removeStrayEntries(rootHandle,
  courseFolders)` never included `vault.yml` itself in its "expected" set,
  so `vault.yml` (holding `activeCourseId`) silently disappeared starting
  from a vault's *second* save and was never recreated — confirmed
  empirically, fixed alongside protecting the new `profile.yml`/avatar
  file the same way, now covered by a regression test.
  Course output (cover/present) doesn't read from `profile` yet — this
  session only covered storing it.
- **One card size, or per-course sizes?** The composer already lets each
  course set its own card width/height/grid. Reconcile with "one card size
  will be settled on" above — was that assumption wrong, or should the
  composer be constrained back down to one shared size?
- Whether the web `question`-equivalent block(s) get a real textarea or just
  show the prompt — "question" itself isn't a real block type any more (see
  next bullet); this needs re-asking against whichever of task/reflection/
  key-idea it actually applies to.
- Full block type list: reconcile `copy` / `question` / `qr` / `note` (this
  doc) against the composer's real, larger vocabulary — `heading`,
  `explanatory`, `qr`, `key-idea`, `image`, `quote`, `task`, `reflection`,
  `list`, `matrix`, `footnote` (`BLOCK_TYPES` in `block-types.js`). More
  consequential now than when this was first written: it's the vocabulary
  actually landing in real frontmatter/containers on disk, not just an
  in-browser model.
- `{{ }}` in markdown is executed by Nunjucks (`markdownTemplateEngine: "njk"`).
  Old VitePress lessons are full of `{{ $frontmatter.title }}` — these will throw
  if that content is ever migrated.
