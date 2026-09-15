// ── Block types ──────────────────────────────────────────────
// Pure data/logic, no DOM — shared between the composer UI and card-format.js
// (the markdown parse/serialize module), so the markdown container vocabulary
// is always derived from here, never hand-duplicated.

// Nothing smaller than a single row. Types may raise their own minimum.
export const MIN_BLOCK_ROWS = 1;

// The `id` of each becomes the container name in the markdown format, so
// these are worth renaming now rather than after cards exist on disk.
// defaultRows is the height a block is created at; minRows is how far it can
// then be dragged down. Icons are inline SVG paths on a 24×24 grid, stroked in
// currentColor.
//
// `format` describes how a block round-trips through a markdown `:::`
// container: `body` names which field is the fenced prose (`null` if the
// type has none), `attrs` lists which scalar fields become `key=value`
// tokens on the fence line, in order. A type whose data isn't flat scalars
// (currently just Matrix, for its `columns` array) instead provides
// `toAttrs(block)`/`fromAttrs(attrs, block)` to own its own shape — the
// parse/serialize core never special-cases a type by id.
export const BLOCK_TYPES = [
  {
    id: 'heading', label: 'Heading', defaultRows: 1, minRows: MIN_BLOCK_ROWS,
    editor: 'line',
    format: { body: 'body', attrs: [] },
    icon: '<path d="M6 5v14M18 5v14M6 12h12"/>',
  },
  {
    id: 'explanatory', label: 'Text', defaultRows: 4, minRows: MIN_BLOCK_ROWS,
    editor: 'markdown',
    format: { body: 'body', attrs: [] },
    icon: '<path d="M5 7h14M5 12h14M5 17h9"/>',
  },
  {
    id: 'qr', label: 'Link (QR)', defaultRows: 3, minRows: MIN_BLOCK_ROWS,
    editor: 'link', placeholder: 'Add a link…',
    format: { body: 'body', attrs: ['url', 'slug', 'title'] },
    icon: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/>'
        + '<rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2v2h-2zM18 18h2v2h-2z"/>',
  },
  {
    // A key idea/term, a Text-like markdown explanation, and a small
    // citation line — flush like Task (no side inset, ruled top and
    // bottom only), not the inset-box Reflection/List share.
    // Hyphenated id (unlike the other, single-word ids) because boxContent()
    // builds the box's class as `is-${type.id}` verbatim — camelCase here
    // would've produced .is-keyIdea, silently missing the kebab-case
    // .is-key-idea the CSS actually targets.
    id: 'key-idea', label: 'Key Idea', defaultRows: 6, minRows: MIN_BLOCK_ROWS,
    boxed: true, editor: 'key-idea', placeholder: 'Explain the idea…',
    format: { body: 'body', attrs: ['term', 'source'] },
    icon: '<path d="M9 18h6"/><path d="M10 22h4"/>'
        + '<path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2z"/>',
  },
  {
    id: 'image', label: 'Image', defaultRows: 5, minRows: MIN_BLOCK_ROWS,
    editor: 'image', placeholder: 'Drop an image, or click to choose',
    format: { body: null, attrs: ['src', 'alt', 'fit'] },
    icon: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/>'
        + '<path d="M21 16l-5-5-6 6-2-2-5 4"/>',
  },
  {
    // Flush like Key Idea/Task (no outer margin) — not boxed, since the
    // big background quote marks are its own flourish and a corner icon
    // would just compete with them.
    id: 'quote', label: 'Quote', defaultRows: 6, minRows: MIN_BLOCK_ROWS,
    editor: 'quote', placeholder: 'Quote…',
    format: { body: 'body', attrs: ['reference'] },
    icon: '<path d="M8 7c-1.7 0-3 1.3-3 3v4"/><path d="M16 7c-1.7 0-3 1.3-3 3v4"/>',
  },
  {
    id: 'task', label: 'Task', defaultRows: 4, minRows: MIN_BLOCK_ROWS,
    boxed: true, editor: 'markdown', placeholder: 'Describe the task…',
    format: { body: 'body', attrs: [] },
    icon: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 12l3 3 5-6"/>',
  },
  {
    id: 'reflection', label: 'Reflection', defaultRows: 5, minRows: MIN_BLOCK_ROWS,
    boxed: true, editor: 'plain', placeholder: 'Write a question…',
    format: { body: 'body', attrs: [] },
    icon: '<path d="M20 5H4v10h5l4 4v-4h7z"/><path d="M9 10h6"/>',
  },
  {
    // Numbered blank lines under a one-line prompt — "List 3 takeaways from
    // the reading" — for the student to fill in by hand, not on screen.
    // minN/maxN/defaultN drive the count stepper on the block itself; minRows
    // and defaultRows are the worst-case (minN) and typical (defaultN) sizes,
    // used before the block exists yet (add-time gating, picker disabling).
    // Once a block exists, minRowsFor() derives its real minimum from its own
    // `n` instead.
    id: 'list', label: 'List', defaultRows: 1 + 3, minRows: 1 + 2,
    minN: 2, maxN: 5, defaultN: 3,
    boxed: true, editor: 'list', placeholder: 'List the items…',
    format: { body: 'body', attrs: ['n'] },
    icon: '<circle cx="5" cy="6" r="1.4"/><path d="M9 6h11"/>'
        + '<circle cx="5" cy="12" r="1.4"/><path d="M9 12h11"/>'
        + '<circle cx="5" cy="18" r="1.4"/><path d="M9 18h11"/>',
  },
  {
    // An explanatory prompt (like List's) over a grid of blank item rows
    // against 1-2 narrow rating columns — too narrow for real header text,
    // so each rating column's header is derived from the first letter of
    // its own legend line below the table (e.g. "E" from "Effectiveness
    // (1-5, 5 is Great)") rather than typed separately. minN/maxN/defaultN
    // is the row-count stepper (item rows); minCols/maxCols/defaultCols is
    // the column-count stepper (rating columns, 1 or 2 — so 2 or 3 columns
    // total). minRows and defaultRows are the worst-case/typical sizes for
    // add-time gating, same reasoning as List — minRowsFor() takes over
    // from the block's own data once it exists. Boxed like Reflection/
    // List (not flush): the border is what marks this out as a place for
    // the student to fill in, same as those two.
    id: 'matrix', label: 'Matrix', defaultRows: 1 + 1 + 3 + 1, minRows: 1 + 1 + 3 + 1,
    minN: 3, maxN: 5, defaultN: 3, minCols: 1, maxCols: 2, defaultCols: 1,
    boxed: true, hideIcon: true, editor: 'matrix', placeholder: 'Describe this list and ranking task…',
    format: {
      body: 'body', attrs: ['entries', 'itemHeading'],
      // `columns` is an array of `{ caption }` objects — not a flat scalar,
      // so it gets its own attr rather than going through the generic list
      // above. Captions can't themselves contain `|` (not a realistic loss
      // for a short rating-column label).
      toAttrs(block) {
        const columns = matrixColumns(block);
        return columns.length ? [['cols', columns.map(c => c.caption || '').join('|')]] : [];
      },
      // Returns which raw attr keys it consumed, so card-format.js knows
      // `cols` isn't an unrecognized attribute to preserve verbatim.
      fromAttrs(attrs, block) {
        if (attrs.cols === undefined) return [];
        block.columns = attrs.cols.split('|').map(caption => ({ caption }));
        return ['cols'];
      },
    },
    icon: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 9h18"/><path d="M15 9v11"/>',
  },
  {
    // Deliberately not boxed: no corner icon, no background — just a quiet
    // one-row strip with a top rule inset from both edges (not full-width
    // like Key Idea/Task's flush rule).
    id: 'footnote', label: 'Footnote', defaultRows: MIN_BLOCK_ROWS, minRows: MIN_BLOCK_ROWS,
    editor: 'footnote', placeholder: 'Footnote…',
    format: { body: 'body', attrs: [] },
    icon: '<path d="M12 5v14"/><path d="M5.5 8.5l13 7"/><path d="M18.5 8.5l-13 7"/>',
  },
];

// The least any type needs, which is what decides whether another block fits.
export const SMALLEST_BLOCK_ROWS = Math.min(...BLOCK_TYPES.map(type => type.minRows));

export function blockType(id) {
  return BLOCK_TYPES.find(type => type.id === id);
}

// Clamped read of a "list" block's count — covers blocks from before `n`
// existed, or a stale value outside the type's current min/max.
export function listCount(block) {
  const type = blockType('list');
  return Math.min(type.maxN, Math.max(type.minN, block.n || type.defaultN));
}

export function matrixEntryCount(block) {
  const type = blockType('matrix');
  return Math.min(type.maxN, Math.max(type.minN, block.entries || type.defaultN));
}

// Repairs as well as reads: a block created before `columns` existed (or one
// left empty by some other bug) gets a real one-column array written back,
// so the header/caption inputs built from it have somewhere real to save to.
export function matrixColumns(block) {
  if (!block.columns || !block.columns.length) block.columns = [{ caption: '' }];
  return block.columns;
}
