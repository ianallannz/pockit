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
    id: 'image', label: 'Image', defaultRows: 5, minRows: MIN_BLOCK_ROWS,
    editor: 'image', placeholder: 'Drop an image, or click to choose',
    format: { body: null, attrs: ['src', 'alt', 'fit'] },
    icon: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/>'
        + '<path d="M21 16l-5-5-6 6-2-2-5 4"/>',
  },
  {
    // Not boxed like Reflection (no inset container): a plain markdown table
    // with its own grid rules — one header row plus data rows, every cell
    // its own Text-like markdown field (see buildTableEditor()). Stored as
    // markdown table syntax in block.body,
    // not structured attrs, so it reads as prose in vault files and cloud
    // rows alike. minN/maxN/defaultN count DATA rows (the header is extra);
    // minCols/maxCols/defaultCols count columns — the same stepper
    // vocabulary Matrix already uses — except rows, which are uncapped
    // (maxN: Infinity): the row-height accounting already refuses inserts
    // the card has no room for, so an arbitrary ceiling would only lie.
    id: 'table', label: 'Table', defaultRows: 1 + 3, minRows: 1 + 1,
    minN: 1, maxN: Infinity, defaultN: 3, minCols: 1, maxCols: 5, defaultCols: 3,
    // Free resize: the box may be dragged smaller than its content (see
    // makeResizable()), clipping the overflow — the author, not the row
    // count, decides the box size. Moves between cards stay content-aware
    // (see minRowsFor()), only the resize floor is lifted.
    freeResize: true,
    editor: 'table', placeholder: 'Add text…',
    // Column widths ride the fence line as relative weights
    // (widths="2|1|1"), not per-column units — fractions of whatever the
    // card width currently is, so they survive card-size changes. Omitted
    // when uniform, so untouched tables keep a bare `::: table` fence.
    format: {
      body: 'body', attrs: [],
      toAttrs(block) {
        const pairs = [];
        if (Array.isArray(block.widths) && block.widths.length
            && !block.widths.every(w => w === block.widths[0])) {
          pairs.push(['widths', block.widths.join('|')]);
        }
        if (Array.isArray(block.align) && block.align.length
            && block.align.some(a => a !== 'left')) {
          pairs.push(['align', block.align.join('|')]);
        }
        return pairs;
      },
      fromAttrs(attrs, block) {
        const consumed = [];
        if (attrs.widths !== undefined) {
          const parts = String(attrs.widths).split('|').map(Number).filter(n => Number.isFinite(n) && n > 0);
          if (parts.length) block.widths = parts;
          consumed.push('widths');
        }
        if (attrs.align !== undefined) {
          // Invalid tokens become 'left' rather than filtering out — dropping
          // them would shift every later column's alignment sideways.
          const parts = String(attrs.align).split('|').map(a => TABLE_ALIGNMENTS.includes(a) ? a : 'left');
          if (parts.length) block.align = parts;
          consumed.push('align');
        }
        return consumed;
      },
    },
    icon: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 9.5h18M9 9.5V20M15 9.5V20"/>',
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
    id: 'task', label: 'Activity', defaultRows: 4, minRows: MIN_BLOCK_ROWS,
    boxed: true, editor: 'markdown', placeholder: 'Describe the task…',
    format: { body: 'body', attrs: [] },
    icon: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 12l3 3 5-6"/>',
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
    id: 'reflection', label: 'Question', defaultRows: 5, minRows: MIN_BLOCK_ROWS,
    group: 'reflection',
    boxed: true, editor: 'plain', placeholder: 'Write a question…',
    format: { body: 'body', attrs: [] },
    icon: '<path d="M20 5H4v10h5l4 4v-4h7z"/><path d="M9 10h6"/>',
  },
  {
    id: 'rating', label: 'Rating', defaultRows: 4, minRows: MIN_BLOCK_ROWS,
    group: 'reflection',
    boxed: true, editor: 'rating', placeholder: 'Write a question that requests a rating…',
    format: { body: 'body', attrs: ['lowLabel', 'highLabel'] },
    icon: '<path d="M4 16a8 8 0 0 1 16 0"/><path d="M12 16l4-5"/><circle cx="12" cy="16" r="1"/>',
  },
    // Numbered blank lines under a one-line prompt — "List 3 takeaways from
    // the reading" — for the student to fill in by hand, not on screen.
    // minN/maxN/defaultN drive the count stepper on the block itself; minRows
    // and defaultRows are the worst-case (minN) and typical (defaultN) sizes,
    // used before the block exists yet (add-time gating, picker disabling).
    // Once a block exists, minRowsFor() derives its real minimum from its own
    // `n` instead.
  {
    id: 'list', label: 'List', defaultRows: 1 + 3, minRows: 1 + 2,
    minN: 2, maxN: 5, defaultN: 3, group: 'reflection',
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
    group: 'reflection',
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

// ── Table grid ─────────────────────────────────────────────────
// The Table block keeps its whole grid as markdown table syntax in
// block.body (not structured attrs), so vault files and cloud rows carry it
// as readable prose — parse/serialize here are the only structural
// interface, used by the editor, the steppers and the tests alike. Cell
// text is opaque: pipes typed inside a cell would resplit the row on the
// next parse (same documented trade-off as Matrix's `cols` join above),
// so cells are plain prose, not nested tables.
const TABLE_DEFAULT_ROWS = 3;
const TABLE_DEFAULT_COLS = 3;

// Newlines can't survive raw inside a line-oriented markdown table — a
// multi-bullet cell would resplit into extra rows on the next parse.
// Cells are therefore escaped on the way out (\ → \\, newline → \n as a
// literal two-character sequence) and restored on the way in, so the body
// text stays one line per table row no matter what a cell holds. A single
// regex pass each way keeps `\\n` (escaped backslash + n) distinct from an
// escaped newline.
function escapeCellText(text) {
  return String(text ?? '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n');
}

function unescapeCellText(text) {
  return String(text ?? '').replace(/\\\\|\\n/g, match => (match === '\\\\' ? '\\' : '\n'));
}

function splitTableRow(line) {
  let cells = String(line || '').trim();
  if (cells.startsWith('|')) cells = cells.slice(1);
  if (cells.endsWith('|')) cells = cells.slice(0, -1);
  return cells.split('|').map(cell => unescapeCellText(cell.trim()));
}

function isDelimiterRow(cells) {
  return cells.length > 0 && cells.every(cell => /^:?-+:?$/.test(cell));
}

// Tolerates anything: blank lines dropped, uneven rows padded, a missing
// delimiter row treated as "no header yet" (blank header), and a body with
// no pipes at all read as one single-column row per line. Empty body means
// a blank default grid, not zero columns — steppers and the editor always
// have a real grid to work on.
export function parseTableBody(body) {
  const lines = String(body || '').split('\n').map(line => line.trim()).filter(Boolean);
  if (!lines.length) {
    return {
      header: Array(TABLE_DEFAULT_COLS).fill(''),
      rows: Array.from({ length: TABLE_DEFAULT_ROWS }, () => Array(TABLE_DEFAULT_COLS).fill('')),
    };
  }
  const parsed = lines.map(splitTableRow);
  let header;
  let rows;
  if (parsed.length > 1 && isDelimiterRow(parsed[1])) {
    header = parsed[0];
    rows = parsed.slice(2);
  } else {
    header = [];
    rows = parsed;
  }
  // Padded to the actual widest row (never the default width — a 1-column
  // table the user shrank on purpose must stay 1 column, not spring back).
  const width = Math.max(1, header.length, ...rows.map(r => r.length));
  const pad = row => [...row, ...Array(Math.max(0, width - row.length)).fill('')];
  return { header: pad(header), rows: rows.map(pad) };
}

export function serializeTableBody({ header, rows }) {
  const width = Math.max(1, header.length, ...rows.map(r => r.length));
  const pad = row => [...row, ...Array(Math.max(0, width - row.length)).fill('')];
  const line = row => `| ${pad(row).map(escapeCellText).join(' | ')} |`;
  const delimiter = `| ${Array(width).fill('---').join(' | ')} |`;
  return [line(header), delimiter, ...rows.map(line)].join('\n');
}

export function tableGrid(block) {
  return parseTableBody(block.body);
}

export function tableRowCount(block) {
  const type = blockType('table');
  return Math.min(type.maxN, Math.max(type.minN, tableGrid(block).rows.length));
}

export function tableColCount(block) {
  const type = blockType('table');
  return Math.min(type.maxCols, Math.max(type.minCols, tableGrid(block).header.length));
}

// Grows with blank cells, shrinks off the end — the first row/column (and
// whatever's typed into them) is never the one removed. Writes straight
// back to block.body: the markdown text is the single source of truth.
export function setTableSize(block, rowCount, colCount) {
  const grid = clampedTableGrid(block);
  const resizeRow = row => [...row.slice(0, colCount), ...Array(Math.max(0, colCount - row.length)).fill('')];
  const blankRow = () => Array(colCount).fill('');
  const rows = [...grid.rows.slice(0, rowCount).map(resizeRow), ...Array(Math.max(0, rowCount - grid.rows.length)).fill(null).map(blankRow)];
  block.body = serializeTableBody({ header: resizeRow(grid.header), rows });
  tableColWidths(block, colCount);
  tableColAligns(block, colCount);
}

// Per-column text alignment, one token per column — same repair contract
// as widths above (overlong trims, short fills with 'left', garbage reads
// as 'left' positionally). Headers and cells alike default to left.
export const TABLE_ALIGNMENTS = ['left', 'center', 'right'];

export function nextTableAlign(align) {
  const i = TABLE_ALIGNMENTS.indexOf(align);
  return TABLE_ALIGNMENTS[(i + 1) % TABLE_ALIGNMENTS.length];
}

export function tableColAligns(block, colCount) {
  const saved = Array.isArray(block.align)
    ? block.align.map(a => (TABLE_ALIGNMENTS.includes(a) ? a : 'left'))
    : [];
  const aligns = saved.slice(0, colCount);
  while (aligns.length < colCount) aligns.push('left');
  block.align = aligns;
  return aligns;
}

// The grid as the editor actually shows it: parsed, then cut to the type's
// own row/column limits and normalized rectangular. Positional edits below
// all go through here, so what they change is exactly what's on screen —
// never silently more (an oversized hand-edited body normalizes on the
// first structural edit, matching the display).
function clampedTableGrid(block) {
  const grid = tableGrid(block);
  const cols = tableColCount(block);
  const norm = row => [...row.slice(0, cols), ...Array(Math.max(0, cols - row.length)).fill('')];
  return { header: norm(grid.header), rows: grid.rows.slice(0, tableRowCount(block)).map(norm) };
}

// Positional edits for the hover edge controls (see buildTableEditor()):
// insert lands a blank row/column AT the index, remove takes exactly the
// indexed one. Out-of-range indices clamp (insert) or no-op (remove);
// min/max gating lives with the caller, next to the row-height accounting.
export function insertTableRowAt(block, index) {
  const grid = clampedTableGrid(block);
  const at = Math.max(0, Math.min(index, grid.rows.length));
  grid.rows.splice(at, 0, Array(grid.header.length).fill(''));
  block.body = serializeTableBody(grid);
}

export function removeTableRowAt(block, index) {
  const grid = clampedTableGrid(block);
  if (index < 0 || index >= grid.rows.length) return;
  grid.rows.splice(index, 1);
  block.body = serializeTableBody(grid);
}

export function insertTableColAt(block, index) {
  const grid = clampedTableGrid(block);
  const at = Math.max(0, Math.min(index, grid.header.length));
  grid.header.splice(at, 0, '');
  grid.rows.forEach(row => row.splice(at, 0, ''));
  // The newcomer takes the average width (so existing columns don't jump)
  // and left alignment, matching a fresh table.
  const widths = tableColWidths(block, grid.header.length - 1);
  widths.splice(at, 0, widths.reduce((a, b) => a + b, 0) / widths.length);
  block.widths = widths;
  const aligns = tableColAligns(block, grid.header.length - 1);
  aligns.splice(at, 0, 'left');
  block.align = aligns;
  block.body = serializeTableBody(grid);
}

export function removeTableColAt(block, index) {
  const grid = clampedTableGrid(block);
  if (index < 0 || index >= grid.header.length) return;
  grid.header.splice(index, 1);
  grid.rows.forEach(row => row.splice(index, 1));
  const widths = tableColWidths(block, grid.header.length + 1);
  widths.splice(index, 1);
  block.widths = widths;
  const aligns = tableColAligns(block, grid.header.length + 1);
  aligns.splice(index, 1);
  block.align = aligns;
  block.body = serializeTableBody(grid);
}

// Column width weights, one per column — relative units (fractions of the
// table width), not mm, so they track card-size changes. Repairs like
// matrixColumns: overlong arrays trim, short ones fill with the average
// (or 1), garbage falls back to uniform. Written back, the same repair
// contract — invisible in storage while uniform (see toAttrs above).
export function tableColWidths(block, colCount) {
  const saved = Array.isArray(block.widths)
    ? block.widths.filter(n => Number.isFinite(n) && n > 0)
    : [];
  const widths = saved.slice(0, colCount);
  const fill = saved.length
    ? saved.reduce((a, b) => a + b, 0) / saved.length
    : 1;
  while (widths.length < colCount) widths.push(fill);
  block.widths = widths;
  return widths;
}
