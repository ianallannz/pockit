// ── Card rendering ───────────────────────────────────────────
// buildCard() and everything it needs to draw a card's real content —
// extracted from course-builder.js so the read-only student viewer can
// reuse the exact same rendering course-builder.js's own card-strip and
// print pipeline use, rather than a separate reimplementation. See the
// plan at /home/ian/.claude/plans/graceful-exploring-cosmos.md.
//
// Every block editor here (buildLineEditor/buildMarkdownEditor/etc., ~10
// of them) turned out to be genuinely editing-oriented — real inputs/
// textareas with live 'input'/'blur' listeners, not display-only
// renderers — so extracting them unchanged and making them *safe* to call
// from a strictly read-only context needed two things, both already
// covered by the time this module is used:
//
//   1. buildCard's own `interactive: false` path (below) skips creating
//      the remove/add/drag/resize affordances outright, and calls
//      lockBlockContent() on each block's content, which sets
//      pointer-events: none at the root — this blocks every click/drag/
//      hover from reaching *anything* inside, regardless of which editor
//      built it or what kind of element it attached a listener to (a
//      plain <div>, in buildImageEditor's case, not just inputs/buttons)
//      — plus strips every tabindex, closing the one gap pointer-events
//      doesn't cover (keyboard Tab navigation, e.g. onto a markdown
//      block's preview, whose own 'focus' listener would otherwise still
//      reveal its editor textarea).
//   2. Every mutating action these editors reference (save, render,
//      removeBlock, uploadImage, ...) is a **hook**, not a direct
//      call — see configureRenderCard() below. Since JS resolves a name
//      referenced inside an event-listener body lazily, only at the
//      moment that listener actually fires, an unconfigured hook is
//      completely harmless wherever lockBlockContent() guarantees the
//      listener can never fire in the first place (the viewer's entire
//      use of this module). course-builder.js configures real
//      implementations once, for its own interactive: true (default) use.
import { blockType, listCount, matrixEntryCount, matrixColumns, tableGrid, tableRowCount, tableColCount, tableColWidths, tableColAligns, nextTableAlign, serializeTableBody, MIN_BLOCK_ROWS, SMALLEST_BLOCK_ROWS } from './block-types.js';

const GRID_PER_ROW = 2;
const ROW_STEP = 1 / GRID_PER_ROW;

function rowHeightMm(params) {
  return params.gridSize * GRID_PER_ROW;
}

function bodyRows(params) {
  const headerH = params.header ? params.headerHeight : 0;
  const footerH = params.footer ? params.footerHeight : 0;
  const exact = (params.cardHeight - headerH - footerH) / rowHeightMm(params);
  return Math.floor(exact / ROW_STEP) * ROW_STEP;
}

function freeRows(card, params) {
  const used = card.blocks.reduce((sum, block) => sum + block.h, 0);
  return bodyRows(params) - used;
}

// ── Markdown ─────────────────────────────────────────────────
// Only what a card needs: paragraphs, "-"/numbered bullets, bold and
// italic. Source is escaped first, so the emphasis markers are the only
// markup that survives. Pure — no hook needed, unlike everything below.
function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function renderInline(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/_([^_\n]+)_/g, '<em>$1</em>');
}

export function renderMarkdown(source) {
  const lines = escapeHtml(source || '').split('\n');
  const out = [];
  let listItems = null;
  let listTag = null;
  let paragraph = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    out.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!listItems) return;
    out.push(`<${listTag}>${listItems.join('')}</${listTag}>`);
    listItems = null;
    listTag = null;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const bullet = trimmed.match(/^-\s+(.*)$/);
    const numbered = trimmed.match(/^\d+\.\s+(.*)$/);
    const tag = bullet ? 'ul' : numbered ? 'ol' : null;

    if (tag) {
      if (listTag && listTag !== tag) flushList();
      flushParagraph();
      listTag = tag;
      (listItems ||= []).push(`<li>${renderInline((bullet || numbered)[1])}</li>`);
    } else if (listItems && /^\s/.test(line)) {
      const lastLi = listItems[listItems.length - 1];
      const liEnd = lastLi.indexOf('</li>');
      if (liEnd > 0) {
        listItems[listItems.length - 1] =
          lastLi.substring(0, liEnd) + ' ' + line.trim() + lastLi.substring(liEnd);
      }
    } else if (!trimmed) {
      flushParagraph();
      flushList();
    } else {
      flushList();
      paragraph.push(trimmed);
    }
  }

  flushParagraph();
  flushList();
  return out.join('');
}

// ── Configurable behavior hooks ──────────────────────────────
// course-builder.js provides real implementations once, via
// configureRenderCard(), immediately after all of these exist in its own
// scope. The viewer never calls this — every hook stays at its harmless
// default, safe because nothing can ever reach the listeners that
// reference them (see this file's header comment).
let hooks = {
  save: () => {},
  render: () => {},
  removeBlock: () => {},
  openTypePicker: () => {},
  makeBlockDraggable: () => {},
  makeResizable: () => {},
  makeBlockDropTarget: () => {},
  changeListCount: () => {},
  changeMatrixEntries: () => {},
  changeMatrixColumns: () => {},
  insertTableRow: () => {},
  removeTableRow: () => {},
  insertTableCol: () => {},
  removeTableCol: () => {},
  openImageEditor: () => {},
  openLinkEditor: () => {},
  uploadImage: async () => { throw new Error('uploadImage is not configured on this page.'); },
  resolveImageSrc: async reference => reference || '',
};

export function configureRenderCard(overrides) {
  hooks = { ...hooks, ...overrides };
}

// Memoizes resolveImageSrc() results by reference. buildImageEditor() below
// checks this before making a fresh async call — most of the time this is
// pure caching, but it also fixes a real bug: buildPrintPages() rebuilds
// every card synchronously off the 'beforeprint' event, which can't itself
// be awaited (same limitation the Cover-mode print path already has to
// work around — see its own comment in course-builder.js), so any
// reference resolved for the first time during that rebuild set img.src
// too late for the browser's print capture, leaving that image blank —
// most often the very first card printed, since it's the one with the
// least time to have already resolved from ordinary on-screen viewing.
// print-btn's click handler pre-resolves every image the run will use
// (via primeImageSrcCache()) before calling window.print(), so by the time
// 'beforeprint' fires, this cache already has them.
const resolvedImageSrcCache = new Map();

export function primeImageSrcCache(reference, src) {
  if (reference) resolvedImageSrcCache.set(reference, src);
}

// Same names as course-builder.js's own top-level functions, on purpose —
// every editor body below is otherwise a verbatim copy, so its existing
// bare `save()`/`removeBlock(...)`/etc. calls keep working unchanged,
// now routed through whichever hooks are currently configured.
function save() { hooks.save(); }
function render() { hooks.render(); }
function removeBlock(cardId, blockId) { hooks.removeBlock(cardId, blockId); }
function openTypePicker(cardId, anchor) { hooks.openTypePicker(cardId, anchor); }
function makeBlockDraggable(el, card, index, block) { hooks.makeBlockDraggable(el, card, index, block); }
function makeResizable(el, card, block) { hooks.makeResizable(el, card, block); }
function makeBlockDropTarget(el, card, index) { hooks.makeBlockDropTarget(el, card, index); }
function changeListCount(block, card, delta) { hooks.changeListCount(block, card, delta); }
function changeMatrixEntries(block, card, delta) { hooks.changeMatrixEntries(block, card, delta); }
function changeMatrixColumns(block, card, delta) { hooks.changeMatrixColumns(block, card, delta); }
function insertTableRow(block, card, index) { hooks.insertTableRow(block, card, index); }
function removeTableRow(block, card, index) { hooks.removeTableRow(block, card, index); }
function insertTableCol(block, card, index) { hooks.insertTableCol(block, card, index); }
function removeTableCol(block, card, index) { hooks.removeTableCol(block, card, index); }
function openImageEditor(block, anchor) { hooks.openImageEditor(block, anchor); }
function openLinkEditor(block, anchor) { hooks.openLinkEditor(block, anchor); }
function uploadImage(file) { return hooks.uploadImage(file); }
function resolveImageSrc(reference) { return hooks.resolveImageSrc(reference); }

// ── Block editors ────────────────────────────────────────────
// A wrapping textarea rather than a single-line input, so a long heading
// wraps inside its box the way List/Matrix prompts do — grown by the shared
// buildAutoGrowPrompt() below (function declarations hoist, so the later
// definition is fine) and frozen for print the same way. The wrapper keeps
// the bottom-aligned placement the input had: headings sit on the baseline
// at the foot of their block.
function buildLineEditor(block, type) {
  const input = buildAutoGrowPrompt(block, type, 'card-block-heading');

  const wrap = document.createElement('div');
  wrap.className = 'card-block-line';
  wrap.appendChild(input);
  wrap.addEventListener('click', () => input.focus());
  return wrap;
}

// Markdown can't be edited in place and still show bold, bullets and italics,
// so the block shows rendered output and swaps to the source on click.
function buildMarkdownEditor(block, type) {
  const wrap = document.createElement('div');
  wrap.className = 'card-block-markdown';

  const preview = document.createElement('div');
  preview.className = 'card-block-preview';
  preview.tabIndex = 0;
  if (block.body) {
    preview.innerHTML = renderMarkdown(block.body);
  } else {
    preview.classList.add('is-empty');
    preview.textContent = type.placeholder || type.label;
  }

  const editor = document.createElement('textarea');
  editor.className = 'card-block-editor';
  editor.value = block.body || '';
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
  // Read back by focusBlock when a block has just been added.
  wrap.enterEditing = enterEditing;

  editor.addEventListener('blur', () => {
    block.body = editor.value;
    save();
    render();
  });

  wrap.append(preview, editor);
  return wrap;
}

function buildPlainEditor(block, type) {
  const editor = document.createElement('textarea');
  editor.className = 'card-block-input';
  editor.value = block.body || '';
  editor.placeholder = type.placeholder || '';
  editor.spellcheck = false;
  editor.addEventListener('input', () => {
    block.body = editor.value;
    save();
  });
  return editor;
}

// Its own class rather than reusing .card-block-input: that class only gets
// styling nested under .card-block-boxed (Reflection's box), and Footnote is
// deliberately not boxed.
// A one-line question over 5 evenly spaced outline circles (1–5) — print
// space for circling a score by hand, so only the prompt and the two
// endpoint labels are live. Behaves like Reflection otherwise (same boxed
// treatment).
function buildRatingEditor(block, type) {
  const wrap = document.createElement('div');
  wrap.className = 'card-block-rating';

  const prompt = document.createElement('textarea');
  prompt.className = 'card-block-rating-prompt';
  prompt.value = block.body || '';
  prompt.placeholder = type.placeholder || '';
  prompt.spellcheck = false;
  prompt.addEventListener('input', () => {
    block.body = prompt.value;
    save();
  });
  wrap.appendChild(prompt);

  const response = document.createElement('div');
  response.className = 'card-block-rating-response';

  // Endpoint labels ("Never" / "Always"): what a 1 and a 5 mean. One row
  // split left/right, sitting directly above the first/last circles.
  const labels = document.createElement('div');
  labels.className = 'card-block-rating-labels';

  const low = document.createElement('input');
  low.type = 'text';
  low.className = 'card-block-rating-label is-low';
  low.value = block.lowLabel || '';
  low.placeholder = '1 means…';
  low.addEventListener('input', () => {
    block.lowLabel = low.value;
    save();
  });

  const high = document.createElement('input');
  high.type = 'text';
  high.className = 'card-block-rating-label is-high';
  high.value = block.highLabel || '';
  high.placeholder = '5 means…';
  high.addEventListener('input', () => {
    block.highLabel = high.value;
    save();
  });

  labels.append(low, high);
  response.appendChild(labels);

  const scale = document.createElement('div');
  scale.className = 'card-block-rating-scale';
  for (let i = 1; i <= 5; i++) {
    const option = document.createElement('div');
    option.className = 'card-block-rating-option';
    const circle = document.createElement('span');
    circle.className = 'card-block-rating-circle';
    const number = document.createElement('span');
    number.className = 'card-block-rating-number';
    number.textContent = i;
    option.append(circle, number);
    scale.appendChild(option);
  }
  response.appendChild(scale);
  wrap.appendChild(response);

  return wrap;
}

function buildFootnoteEditor(block, type) {
  const editor = document.createElement('textarea');
  editor.className = 'card-block-footnote';
  editor.value = block.body || '';
  editor.placeholder = type.placeholder || '';
  editor.spellcheck = false;
  editor.addEventListener('input', () => {
    block.body = editor.value;
    save();
  });
  return editor;
}

// Quote text plus a reference line. The em dash is drawn as a fixed glyph
// rather than typed — it's a formatting convention, not part of the
// reference's actual text — and the two big background quote marks are pure
// CSS (::before/::after on the wrapper), not part of this DOM at all.
function buildQuoteEditor(block, type) {
  const wrap = document.createElement('div');
  wrap.className = 'card-block-quote';

  const text = document.createElement('textarea');
  text.className = 'card-block-quote-text';
  text.value = block.body || '';
  text.placeholder = type.placeholder || '';
  text.spellcheck = false;
  text.addEventListener('input', () => {
    block.body = text.value;
    save();
  });

  const referenceRow = document.createElement('div');
  referenceRow.className = 'card-block-quote-reference-row';

  const dash = document.createElement('span');
  dash.className = 'card-block-quote-dash';
  dash.textContent = '—';

  const reference = document.createElement('input');
  reference.type = 'text';
  reference.className = 'card-block-quote-reference';
  reference.value = block.reference || '';
  reference.placeholder = 'Source';
  reference.addEventListener('input', () => {
    block.reference = reference.value;
    save();
  });

  referenceRow.append(dash, reference);
  wrap.append(text, referenceRow);
  return wrap;
}

// A textarea rather than a single-line input, so a long prompt can wrap to a
// second or third line like Reflection's — grown by hand via scrollHeight
// since "auto-size to content" isn't a native textarea behaviour. Shared by
// List and Matrix, both of which put one of these above their real content.
function buildAutoGrowPrompt(block, type, className) {
  const prompt = document.createElement('textarea');
  prompt.className = className;
  prompt.value = block.body || '';
  prompt.placeholder = type.placeholder || type.label;
  prompt.rows = 1;
  prompt.spellcheck = false;
  const grow = () => {
    prompt.style.height = 'auto';
    prompt.style.height = `${prompt.scrollHeight}px`;
  };
  prompt.addEventListener('input', () => {
    block.body = prompt.value;
    save();
    grow();
  });
  // Deferred: `prompt` has no scrollHeight until it's actually attached to
  // the document, which only happens once this function's caller has
  // appended the tree we're building all the way up to #card-strip.
  queueMicrotask(grow);
  return prompt;
}

// Swaps every auto-grow textarea under `root` (list/matrix prompts and the
// wrapping heading) for a static div with the same text — for the print
// pipeline only. Replaces flushAutoGrowPrompts (which measured scrollHeight
// synchronously, but #print-root is display:none on screen so that measured
// 0 and hid every prompt outright): a div sizes to its content with no
// measurement at all, so it renders all lines wherever the tree ends up
// being displayed.
export function freezeAutoGrowPrompts(root) {
  root.querySelectorAll('textarea.card-block-list-prompt, textarea.card-block-heading').forEach(prompt => {
    const frozen = document.createElement('div');
    frozen.className = prompt.className;
    if (prompt.value) {
      frozen.textContent = prompt.value;
    } else {
      frozen.classList.add('is-empty');
      frozen.textContent = prompt.placeholder;
    }
    prompt.replaceWith(frozen);
  });
}

// One-line prompt over N blank numbered lines — the lines are print space for
// handwriting, not fields, so only the prompt and the +/− count are live.
function buildListEditor(block, type, card, params) {
  const wrap = document.createElement('div');
  wrap.className = 'card-block-list';

  const header = document.createElement('div');
  header.className = 'card-block-list-header';

  const prompt = buildAutoGrowPrompt(block, type, 'card-block-list-prompt');

  const n = listCount(block);

  const count = document.createElement('div');
  count.className = 'card-block-list-count';

  const minus = document.createElement('button');
  minus.type = 'button';
  minus.className = 'list-count-btn';
  minus.textContent = '−';
  minus.title = 'One fewer thing';
  minus.disabled = n <= type.minN;
  minus.addEventListener('click', event => {
    event.stopPropagation();
    changeListCount(block, card, -1);
  });

  const value = document.createElement('span');
  value.className = 'list-count-value';
  value.textContent = n;

  const plus = document.createElement('button');
  plus.type = 'button';
  plus.className = 'list-count-btn';
  plus.textContent = '+';
  plus.title = 'One more thing';
  // Growing needs a free row on the card too, not just headroom under maxN.
  plus.disabled = n >= type.maxN || 1 + n + 1 > block.h + freeRows(card, params);
  plus.addEventListener('click', event => {
    event.stopPropagation();
    changeListCount(block, card, 1);
  });

  count.append(minus, value, plus);
  header.append(prompt, count);

  const list = document.createElement('div');
  list.className = 'card-block-list-items';
  for (let i = 1; i <= n; i++) {
    const item = document.createElement('div');
    item.className = 'card-block-list-item';
    const number = document.createElement('span');
    number.className = 'card-block-list-number';
    number.textContent = `${i}.`;
    item.appendChild(number);
    list.appendChild(item);
  }

  wrap.append(header, list);
  return wrap;
}

function buildMatrixStepper(count, min, max, canGrow, onChange) {
  const group = document.createElement('div');
  group.className = 'card-block-matrix-stepper';

  const minus = document.createElement('button');
  minus.type = 'button';
  minus.className = 'list-count-btn';
  minus.textContent = '−';
  minus.disabled = count <= min;
  minus.addEventListener('click', event => {
    event.stopPropagation();
    onChange(-1);
  });

  const value = document.createElement('span');
  value.className = 'list-count-value';
  value.textContent = count;

  const plus = document.createElement('button');
  plus.type = 'button';
  plus.className = 'list-count-btn';
  plus.textContent = '+';
  plus.disabled = count >= max || !canGrow;
  plus.addEventListener('click', event => {
    event.stopPropagation();
    onChange(1);
  });

  group.append(minus, value, plus);
  return group;
}

// A grid of blank handwriting rows (item column) against 1-2 narrow rating
// columns, each with its own short typed header and legend line below the
// table — see the BLOCK_TYPES comment for why headers aren't auto-derived.
function buildMatrixEditor(block, type, card, params) {
  const wrap = document.createElement('div');
  wrap.className = 'card-block-matrix';

  const columns = matrixColumns(block);
  const entryCount = matrixEntryCount(block);
  const free = freeRows(card, params);

  // Prompt + steppers share one row, same layout as List's header — the
  // prompt is explanatory text for the whole matrix ("Rate each idea
  // against..."), not tied to any one column.
  const headerRow = document.createElement('div');
  headerRow.className = 'card-block-matrix-header';

  const prompt = buildAutoGrowPrompt(block, type, 'card-block-list-prompt');
  headerRow.appendChild(prompt);

  const toolbar = document.createElement('div');
  toolbar.className = 'card-block-matrix-toolbar';
  toolbar.appendChild(buildMatrixStepper(
    entryCount, type.minN, type.maxN,
    2 + (entryCount + 1) + columns.length <= block.h + free,
    delta => changeMatrixEntries(block, card, delta)
  ));
  toolbar.appendChild(buildMatrixStepper(
    columns.length, type.minCols, type.maxCols,
    2 + entryCount + (columns.length + 1) <= block.h + free,
    delta => changeMatrixColumns(block, card, delta)
  ));
  headerRow.appendChild(toolbar);
  wrap.appendChild(headerRow);

  const table = document.createElement('div');
  table.className = 'card-block-matrix-table';
  table.style.gridTemplateColumns = `1fr repeat(${columns.length}, 7mm)`;
  table.style.gridTemplateRows = `auto repeat(${entryCount}, 1fr)`;

  const itemHeading = document.createElement('input');
  itemHeading.type = 'text';
  itemHeading.className = 'card-block-matrix-item-heading';
  itemHeading.value = block.itemHeading || '';
  itemHeading.placeholder = 'Item';
  itemHeading.addEventListener('input', () => {
    block.itemHeading = itemHeading.value;
    save();
  });
  table.appendChild(itemHeading);

  // The rating column is only 7mm wide — too narrow to type a header into
  // directly alongside the row/column steppers — so the header is read-only,
  // derived from the caption's own first letter instead of a field of its
  // own. Typing the caption below is the only way to set it.
  columns.forEach(col => {
    const headerCell = document.createElement('div');
    headerCell.className = 'card-block-matrix-rating-header';
    headerCell.textContent = (col.caption || '').trim().charAt(0).toUpperCase() || '•';
    table.appendChild(headerCell);
  });

  for (let r = 0; r < entryCount; r++) {
    table.appendChild(document.createElement('div')).className = 'card-block-matrix-item-cell';
    columns.forEach(() => {
      table.appendChild(document.createElement('div')).className = 'card-block-matrix-rating-cell';
    });
  }

  wrap.appendChild(table);

  const legend = document.createElement('div');
  legend.className = 'card-block-matrix-legend';
  columns.forEach((col, i) => {
    const caption = document.createElement('input');
    caption.type = 'text';
    caption.className = 'card-block-matrix-caption';
    caption.value = col.caption || '';
    // Rating columns start at column 2 (column 1 is the item column).
    caption.placeholder = i === 0
      ? 'Label column 2 rating; e.g., Effectiveness (1-5, 5 is Great)'
      : `Label column ${i + 2} rating`;
    caption.addEventListener('input', () => {
      col.caption = caption.value;
      save();
      // The header letter is derived from this, so it needs its own redraw —
      // re-rendering the whole block would drop focus mid-type.
      header(i).textContent = caption.value.trim().charAt(0).toUpperCase() || '•';
    });
    legend.appendChild(caption);
  });
  wrap.appendChild(legend);

  function header(i) {
    return table.querySelectorAll('.card-block-matrix-rating-header')[i];
  }

  return wrap;
}

// One cell of a Table block: a Text-like markdown field — rendered preview
// until clicked, then a textarea; typing writes straight back through the
// grid into block.body (no re-render mid-type, same as Matrix's caption
// inputs), blur commits and re-renders to show the fresh preview. `get`/
// `set` close over the live grid arrays, so every keystroke lands in the
// same structure the steppers below resize.
function buildTableCell(tag, get, set) {
  const cell = document.createElement(tag);
  cell.className = 'card-block-table-cell';

  const preview = document.createElement('div');
  preview.className = 'card-block-table-preview';
  preview.tabIndex = 0;
  if (get()) {
    preview.innerHTML = renderMarkdown(get());
  } else {
    preview.classList.add('is-empty');
  }

  const editor = document.createElement('textarea');
  editor.className = 'card-block-table-editor';
  editor.rows = 1;
  editor.value = get() || '';
  editor.spellcheck = false;
  editor.hidden = true;

  const grow = () => {
    editor.style.height = 'auto';
    editor.style.height = `${editor.scrollHeight}px`;
  };
  const enterEditing = () => {
    preview.hidden = true;
    editor.hidden = false;
    editor.focus();
    editor.setSelectionRange(editor.value.length, editor.value.length);
    grow();
  };
  preview.addEventListener('click', enterEditing);
  preview.addEventListener('focus', enterEditing);

  editor.addEventListener('input', () => {
    set(editor.value);
    save();
    grow();
  });
  editor.addEventListener('blur', () => {
    set(editor.value);
    save();
    render();
  });

  cell.append(preview, editor);
  return cell;
}

// One overlay edge control: a tiny round button positioned against the
// tableWrap below in JS (not anchored in cells — position:relative on
// table cells is unreliable across browsers, which can hide the controls
// entirely). display:none until a hover places it, so print (no hover)
// and the locked viewer (no pointer) never see it. Everything stays
// inside table bounds: the card itself clips (overflow:hidden).
// mousedown is swallowed so clicking a control never blurs a cell editor
// mid-type — without this, the blur's re-render would detach the button
// before its own click ever fires.
function buildTableControl(label, positionClass, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `card-block-table-ctrl ${positionClass}`;
  button.textContent = label;
  button.style.display = 'none';
  button.addEventListener('mousedown', event => event.preventDefault());
  button.addEventListener('click', event => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

// A markdown table with its own grid rules — one header row plus data
// rows, stored as markdown syntax in block.body (see block-types.js).
// Rows/columns are added and removed positionally, right where they
// belong: hovering a row rides + (left edge, inserts below) and − (right
// edge, removes that row) along it; hovering the header rides + above a
// column (inserts right of it); hovering a last-row cell rides − below
// its column. One shared set of four buttons per table, repositioned onto
// the hovered row/column — and always shown while hovering, disabled with
// a reason when gated (maximums, minimums, or a full card), so the
// controls are discoverable rather than mysteriously absent.
function buildTableEditor(block, type, card, params) {
  const wrap = document.createElement('div');
  wrap.className = 'card-block-table';

  const grid = tableGrid(block);
  const rowCount = tableRowCount(block);
  const colCount = tableColCount(block);
  const rows = grid.rows.slice(0, rowCount).map(row => row.slice(0, colCount));
  const header = grid.header.slice(0, colCount);
  const aligns = tableColAligns(block, colCount);
  const free = freeRows(card, params);

  const rowFull = 1 + (rowCount + 1) > block.h + free;
  const canAddRow = rowCount < type.maxN && !rowFull;
  const canRemoveRow = rowCount > type.minN;
  const canAddCol = colCount < type.maxCols;
  const canRemoveCol = colCount > type.minCols;

  const tableWrap = document.createElement('div');
  tableWrap.className = 'card-block-table-grid-wrap';

  const table = document.createElement('table');
  table.className = 'card-block-table-grid';

  // Relative column weights (see tableColWidths()) as real column widths —
  // table-layout: fixed below divides the table width exactly this way, on
  // screen, in print and in the viewer alike.
  const colWidths = tableColWidths(block, colCount);
  const colTotal = colWidths.reduce((a, b) => a + b, 0);
  const colgroup = document.createElement('colgroup');
  const colEls = colWidths.map(weight => {
    const col = document.createElement('col');
    col.style.width = `${(weight / colTotal) * 100}%`;
    colgroup.appendChild(col);
    return col;
  });
  table.appendChild(colgroup);

  const applyColWidths = weights => {
    const total = weights.reduce((a, b) => a + b, 0);
    weights.forEach((weight, i) => {
      colEls[i].style.width = `${(weight / total) * 100}%`;
    });
  };

  const headRow = document.createElement('tr');
  headRow.className = 'card-block-table-head-row';
  header.forEach((_, c) => {
    const th = buildTableCell(
      'th',
      () => grid.header[c],
      value => { grid.header[c] = value; block.body = serializeTableBody(grid); }
    );
    th.classList.add('is-header');
    th.style.textAlign = aligns[c];
    headRow.appendChild(th);
  });
  const thead = document.createElement('thead');
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  rows.forEach((row, r) => {
    const tr = document.createElement('tr');
    row.forEach((_, c) => {
      const td = buildTableCell(
        'td',
        () => grid.rows[r][c],
        value => { grid.rows[r][c] = value; block.body = serializeTableBody(grid); }
      );
      td.style.textAlign = aligns[c];
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  tableWrap.appendChild(table);

  // Three bars that sit where the text sits — left, centred or right — so
  // the alignment control shows the column's current state, not a static
  // glyph. currentColor inherits the button's own colour.
  const tableAlignIcon = align => {
    const bars = align === 'center'
      ? [[1, 10], [3, 6], [2, 8]]
      : align === 'right'
        ? [[1, 10], [5, 6], [3, 8]]
        : [[1, 10], [1, 6], [1, 8]];
    const rects = bars
      .map(([x, w], i) => `<rect x="${x}" y="${1 + i * 4}" width="${w}" height="2"/>`)
      .join('');
    return `<svg viewBox="0 0 12 12" aria-hidden="true"><g fill="currentColor">${rects}</g></svg>`;
  };

  // The overlay controls, placed by the hover handler below. Indices ride
  // in `pending` because the same buttons serve every row/column.
  const pending = { rowPlus: 0, rowMinus: 0, colPlus: 0, colMinus: 0, colAlign: 0 };
  const rowPlus = buildTableControl('+', 'is-plus-row',
    () => insertTableRow(block, card, pending.rowPlus));
  const rowMinus = buildTableControl('−', 'is-minus-row',
    () => removeTableRow(block, card, pending.rowMinus));
  const colPlus = buildTableControl('+', 'is-plus-col',
    () => insertTableCol(block, card, pending.colPlus));
  const colMinus = buildTableControl('−', 'is-minus-col',
    () => removeTableCol(block, card, pending.colMinus));
  // Alignment cycler: sits left of the column + control, shows the current
  // alignment as its icon, and steps left -> center -> right -> left on
  // each click. Ungated (it edits an existing column, never grows the
  // table), so it shows on every header hover.
  const colAlign = buildTableControl('', 'is-align-col', () => {
    const current = tableColAligns(block, colCount);
    current[pending.colAlign] = nextTableAlign(current[pending.colAlign]);
    block.align = [...current];
    save();
    render();
  });
  const controls = [rowPlus, rowMinus, colPlus, colMinus, colAlign];
  tableWrap.append(rowPlus, rowMinus, colPlus, colMinus, colAlign);

  // Drag handles on every inner vertical grid line (one per boundary, so
  // colCount - 1): a wide transparent grab zone straddling the line with a
  // green marker that appears on hover. Dragging borrows width from the
  // neighbour, keeping the pair's total — the table never changes size.
  const TABLE_MIN_COL_MM = 10;
  const resizeHandles = [];
  for (let c = 0; c < colCount - 1; c++) {
    const handle = document.createElement('div');
    handle.className = 'card-block-table-resize';
    handle.title = 'Drag to resize columns';
    tableWrap.appendChild(handle);
    resizeHandles.push(handle);

    handle.addEventListener('pointerdown', event => {
      // Swallowed like the edge controls above: clicking mid-type must not
      // blur the cell editor (whose re-render would detach this handle
      // before the drag even starts).
      event.preventDefault();
      event.stopPropagation();

      const weights = tableColWidths(block, colCount);
      const tablePx = table.getBoundingClientRect().width;
      const pairTotal = weights[c] + weights[c + 1];
      // Table spans the padded block width: card width minus both insets.
      const tableMm = params.cardWidth - params.gridSize;
      const minWeight = (TABLE_MIN_COL_MM / tableMm) * pairTotal;
      const pxPerWeight = tablePx / pairTotal;
      const startX = event.clientX;
      const startLeft = weights[c];
      handle.classList.add('is-dragging');
      try { handle.setPointerCapture(event.pointerId); } catch { /* no active pointer */ }

      const onMove = moveEvent => {
        const deltaWeight = (moveEvent.clientX - startX) / pxPerWeight;
        const left = Math.min(Math.max(startLeft + deltaWeight, minWeight), pairTotal - minWeight);
        weights[c] = left;
        weights[c + 1] = pairTotal - left;
        applyColWidths(weights);
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        handle.classList.remove('is-dragging');
        block.widths = [...weights];
        save();
        render();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    });
  }

  const hideTableControls = () => {
    for (const button of controls) button.style.display = 'none';
    for (const handle of resizeHandles) handle.style.display = 'none';
  };

  const showTableControl = (button, positionPx, enabled, title) => {
    button.style.top = positionPx.top !== undefined ? `${positionPx.top}px` : '';
    button.style.left = positionPx.left !== undefined ? `${positionPx.left}px` : '';
    button.disabled = !enabled;
    button.title = title;
    button.style.display = 'flex';
  };

  tableWrap.addEventListener('mouseover', event => {
    // Moving onto a control or handle itself must keep everything where it
    // is — both live directly under the wrap now, not inside cells, so
    // without this guard the handler below would hide them out from under
    // the pointer (and swallow the click/drag with them).
    if (event.target.closest && event.target.closest('.card-block-table-ctrl, .card-block-table-resize')) return;
    const cell = event.target.closest ? event.target.closest('th, td') : null;
    if (!cell || !tableWrap.contains(cell)) {
      hideTableControls();
      return;
    }
    const tr = cell.parentElement;
    const inHead = tr.parentElement.tagName === 'THEAD';
    const r = tr.sectionRowIndex;
    const c = cell.cellIndex;
    const wrapRect = tableWrap.getBoundingClientRect();
    const rowRect = tr.getBoundingClientRect();

    // Row controls ride the hovered row's left/right edges — the header
    // row's plus inserts the new row at the very top (index 0).
    pending.rowPlus = inHead ? 0 : r + 1;
    showTableControl(rowPlus, { top: rowRect.top - wrapRect.top + rowRect.height / 2 }, canAddRow,
      canAddRow ? 'Add row below'
        : rowCount >= type.maxN ? 'Already at maximum rows'
        : 'Card is full — free a row to add another');
    if (!inHead) {
      pending.rowMinus = r;
      showTableControl(rowMinus, { top: rowRect.top - wrapRect.top + rowRect.height / 2 }, canRemoveRow,
        canRemoveRow ? 'Remove this row' : 'Already at minimum rows');
    } else {
      rowMinus.style.display = 'none';
    }

    // Column controls ride the hovered column's top/bottom edges — plus
    // above the header (with the alignment cycler to its left), minus
    // below the table at the last row's columns.
    if (inHead) {
      const cellRect = cell.getBoundingClientRect();
      const centerX = cellRect.left - wrapRect.left + cellRect.width / 2;
      // The pair straddles the column centre as a group: 14px buttons with
      // a 4px gap, so each centre sits 9px either side of it.
      pending.colPlus = c + 1;
      showTableControl(colPlus, { left: centerX + 9 }, canAddCol,
        canAddCol ? 'Add column to the right' : 'Already at maximum columns');
      pending.colAlign = c;
      colAlign.innerHTML = tableAlignIcon(aligns[c]);
      showTableControl(colAlign, { left: centerX - 9 }, true,
        `Column text alignment: ${aligns[c]} — click to change`);
    } else {
      colPlus.style.display = 'none';
      colAlign.style.display = 'none';
    }
    if (!inHead && r === rowCount - 1) {
      const cellRect = cell.getBoundingClientRect();
      const tableRect = table.getBoundingClientRect();
      pending.colMinus = c;
      showTableControl(colMinus, {
        left: cellRect.left - wrapRect.left + cellRect.width / 2,
        top: tableRect.bottom - wrapRect.top,
      }, canRemoveCol, canRemoveCol ? 'Remove this column' : 'Already at minimum columns');
    } else {
      colMinus.style.display = 'none';
    }

    // Resize handles ride every inner vertical grid line for as long as
    // the pointer is anywhere over the table — positioned fresh each time
    // (cell textareas grow while typing, so cached coordinates go stale).
    const tableRect = table.getBoundingClientRect();
    const headCells = table.querySelectorAll('thead th');
    resizeHandles.forEach((handle, i) => {
      const edge = headCells[i].getBoundingClientRect().right;
      handle.style.left = `${edge - wrapRect.left}px`;
      handle.style.top = `${tableRect.top - wrapRect.top}px`;
      handle.style.height = `${tableRect.height}px`;
      handle.style.display = 'block';
    });
  });
  tableWrap.addEventListener('mouseleave', hideTableControls);

  wrap.appendChild(tableWrap);

  return wrap;
}

// A key idea/term, a Text-like markdown explanation, and a small citation
// line. The explanation reuses buildMarkdownEditor wholesale (preview/edit
// toggle, bold/italic/bullets) rather than reimplementing it — only the
// placeholder is swapped out, via a throwaway type-shaped object rather than
// a new param on buildMarkdownEditor itself.
function buildKeyIdeaEditor(block, type) {
  const wrap = document.createElement('div');
  wrap.className = 'card-block-key-idea';

  const term = document.createElement('input');
  term.type = 'text';
  term.className = 'card-block-key-idea-term';
  term.value = block.term || '';
  term.placeholder = 'Key idea';
  term.addEventListener('input', () => {
    block.term = term.value;
    save();
  });

  const explanation = buildMarkdownEditor(block, { placeholder: type.placeholder, label: type.label });

  const source = document.createElement('input');
  source.type = 'text';
  source.className = 'card-block-key-idea-source';
  source.value = block.source || '';
  source.placeholder = 'Source';
  source.addEventListener('input', () => {
    block.source = source.value;
    save();
  });

  wrap.append(term, explanation, source);
  return wrap;
}

// ── Images ───────────────────────────────────────────────────
// Cards get printed, so a picture that looks sharp on screen at 96dpi can be a
// quarter of what the printer wants.
const PRINT_DPI = 300;
export const ACCEPTED_IMAGES = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml';
export const IMAGE_FITS = ['contain', 'cover'];
export const DEFAULT_IMAGE_FIT = 'cover';

// Blocks store fit only once it's been chosen, so the default stays a single
// value here rather than something baked into every block on creation.
// Exported: course-builder.js's own image-settings popover (openImageEditor's
// implementation) needs this too, so this is the one definition both share.
export function imageFit(block) {
  return IMAGE_FITS.includes(block.fit) ? block.fit : DEFAULT_IMAGE_FIT;
}

function buildImageEditor(block, type) {
  const wrap = document.createElement('div');
  wrap.className = 'card-block-image';

  const picker = document.createElement('input');
  picker.type = 'file';
  picker.accept = ACCEPTED_IMAGES;
  picker.hidden = true;

  const note = document.createElement('div');
  note.className = 'card-block-image-note';

  const setNote = (message, kind = '') => {
    note.textContent = message;
    note.className = `card-block-image-note${kind ? ` is-${kind}` : ''}`;
  };

  const accept = async file => {
    if (!file) return;
    setNote('Uploading…');
    try {
      const { src } = await uploadImage(file);
      block.src = src;
      save();
      render();
} catch (error) {
       // Most likely cause: opened from file://, so there's no dev server.
       let message = error instanceof TypeError ? 'No dev server — run npm start.' : error.message;
       // If this is an upload failure due to missing server endpoint, provide more helpful guidance
       if (error.message && (error.message.includes('Upload failed') || error.message.includes('405') || error.message.includes('404'))) {
         message += ' Change to local folder storage or cloud storage under Account Settings.';
       }
       setNote(message, 'error');
     }
  };

  if (block.src) {
    const img = document.createElement('img');
    // Vault-backed references resolve asynchronously (a real file read) —
    // a cached resolution (see resolvedImageSrcCache above) applies
    // synchronously; otherwise set once ready rather than blocking the
    // rest of this render on it.
    if (resolvedImageSrcCache.has(block.src)) {
      img.src = resolvedImageSrcCache.get(block.src);
    } else {
      resolveImageSrc(block.src).then(src => {
        resolvedImageSrcCache.set(block.src, src);
        img.src = src;
      });
    }
    img.alt = block.alt || '';
    img.style.objectFit = imageFit(block);

    // Screen-only: the settings behind it — fit and alt text — have no place
    // as form fields on a print preview. Stays visible while alt is missing,
    // since that's the one thing worth nagging about.
    const settings = document.createElement('button');
    settings.type = 'button';
    settings.className = `card-block-settings${block.alt ? '' : ' is-missing-alt'}`;
    settings.title = block.alt ? `Image settings — alt: ${block.alt}` : 'Image settings — no alt text yet';
    settings.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3.2"/>
      <path d="M18.9 14.3a1.5 1.5 0 00.3 1.7l.1.1a1.9 1.9 0 11-2.6 2.6l-.1-.1a1.5 1.5 0 00-1.7-.3 1.5 1.5 0 00-.9 1.4v.2a1.9 1.9 0 11-3.8 0V20a1.5 1.5 0 00-1-1.4 1.5 1.5 0 00-1.7.3l-.1.1a1.9 1.9 0 11-2.6-2.6l.1-.1a1.5 1.5 0 00.3-1.7 1.5 1.5 0 00-1.4-.9H4a1.9 1.9 0 110-3.8h.2a1.5 1.5 0 001.4-1 1.5 1.5 0 00-.3-1.7l-.1-.1a1.9 1.9 0 112.6-2.6l.1.1a1.5 1.5 0 001.7.3H10a1.5 1.5 0 00.9-1.4V4a1.9 1.9 0 113.8 0v.2a1.5 1.5 0 00.9 1.4 1.5 1.5 0 001.7-.3l.1-.1a1.9 1.9 0 112.6 2.6l-.1.1a1.5 1.5 0 00-.3 1.7V10a1.5 1.5 0 001.4.9h.2a1.9 1.9 0 110 3.8H20a1.5 1.5 0 00-1.4.9z"/>
    </svg>`;
    settings.addEventListener('click', event => {
      event.stopPropagation();   // Clicking the image itself replaces the file.
      openImageEditor(block, wrap);
    });
    wrap.appendChild(settings);
    // Checked once loaded, since natural dimensions aren't known before then.
    // Cover scales to fill both axes and contain to fit inside, so the mode
    // decides how far the pixels are being stretched.
    img.addEventListener('load', () => {
      if (!img.naturalWidth || !img.naturalHeight) return;
      const box = img.getBoundingClientRect();
      const scales = [box.width / img.naturalWidth, box.height / img.naturalHeight];
      const scale = imageFit(block) === 'cover' ? Math.max(...scales) : Math.min(...scales);

      // One CSS pixel is 1/96in, so the printed resolution is just 96/scale.
      const effectiveDpi = Math.round(96 / scale);
      if (effectiveDpi < PRINT_DPI) {
        setNote(`${effectiveDpi}dpi — ${PRINT_DPI}dpi wanted for print`, 'warn');
      }
    });
    wrap.appendChild(img);
  } else {
    wrap.classList.add('is-empty');
    const prompt = document.createElement('div');
    prompt.className = 'card-block-image-prompt';
    prompt.textContent = type.placeholder;
    wrap.appendChild(prompt);
  }

  wrap.addEventListener('click', () => picker.click());
  picker.addEventListener('change', () => accept(picker.files[0]));

  // File drags only — a block being dragged past must still reach the block
  // drop targets underneath.
  const isFileDrag = event => [...(event.dataTransfer?.types || [])].includes('Files');

  wrap.addEventListener('dragover', event => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    wrap.classList.add('is-dropping');
  });
  wrap.addEventListener('dragleave', () => wrap.classList.remove('is-dropping'));
  wrap.addEventListener('drop', event => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    wrap.classList.remove('is-dropping');
    accept(event.dataTransfer.files[0]);
  });

  wrap.append(picker, note);
  wrap.focusEditor = () => picker.click();
  return wrap;
}

// ── Link sources ─────────────────────────────────────────────
// Glyphs are shared where two services mean the same kind of thing — a Google
// Doc and a Word file both get the document mark.
const SOURCE_ICONS = {
  play: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M10.5 9.5l5 2.5-5 2.5z"/>',
  pdf: '<path d="M14 3H7a1 1 0 00-1 1v16a1 1 0 001 1h10a1 1 0 001-1V7z"/><path d="M14 3v4h4"/>'
     + '<rect x="8.5" y="12.5" width="7" height="5" rx="1"/>',
  doc: '<path d="M14 3H7a1 1 0 00-1 1v16a1 1 0 001 1h10a1 1 0 001-1V7z"/><path d="M14 3v4h4"/>'
     + '<path d="M9 12h6M9 15h6M9 18h3.5"/>',
  sheet: '<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M4 10h16M4 15h16M10.5 4v16"/>',
  slides: '<rect x="3" y="5" width="18" height="11.5" rx="1.5"/><path d="M12 16.5V20M9.5 20h5"/>',
  drive: '<path d="M12 3.5L20.5 18h-17z"/><path d="M7.5 18l4.5-7.5 4.5 7.5"/>',
  cloud: '<path d="M7 18.5h10a4 4 0 000-8 6 6 0 00-11.6 1.6A3.6 3.6 0 006.4 18.5z"/>',
  link: '<path d="M10.2 13.8a4.5 4.5 0 006.7.5l2.6-2.6a4.5 4.5 0 00-6.4-6.4l-1.3 1.3"/>'
      + '<path d="M13.8 10.2a4.5 4.5 0 00-6.7-.5l-2.6 2.6a4.5 4.5 0 006.4 6.4l1.3-1.3"/>',
};

const UNKNOWN_SOURCE = { id: 'link', label: 'Link', icon: SOURCE_ICONS.link };

// Ordered — first match wins. A .pdf path beats the host it sits on.
function linkSource(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return UNKNOWN_SOURCE;
  }

  const host = url.hostname.replace(/^www\./, '');
  const path = url.pathname;
  const at = (id, label, icon) => ({ id, label, icon });

  if (/\.pdf$/i.test(path)) return at('pdf', 'PDF', SOURCE_ICONS.pdf);

  if (/^(m\.)?(youtube\.com|youtube-nocookie\.com)$|^youtu\.be$/.test(host)) {
    return at('youtube', 'YouTube', SOURCE_ICONS.play);
  }

  if (host === 'docs.google.com') {
    if (path.startsWith('/document/')) return at('gdoc', 'Google Doc', SOURCE_ICONS.doc);
    if (path.startsWith('/spreadsheets/')) return at('gsheet', 'Google Sheet', SOURCE_ICONS.sheet);
    if (path.startsWith('/presentation/')) return at('gslides', 'Google Slides', SOURCE_ICONS.slides);
    if (path.startsWith('/forms/')) return at('gform', 'Google Form', SOURCE_ICONS.doc);
    return at('gdrive', 'Google Drive', SOURCE_ICONS.drive);
  }
  if (host === 'drive.google.com') return at('gdrive', 'Google Drive', SOURCE_ICONS.drive);

  // Office files, wherever they're hosted.
  if (/\.docx?$/i.test(path)) return at('word', 'Word', SOURCE_ICONS.doc);
  if (/\.xlsx?$/i.test(path)) return at('excel', 'Excel', SOURCE_ICONS.sheet);
  if (/\.pptx?$/i.test(path)) return at('powerpoint', 'PowerPoint', SOURCE_ICONS.slides);

  if (/(^|\.)sharepoint\.com$/.test(host) || host === 'onedrive.live.com' || host === '1drv.ms') {
    // SharePoint puts the app in the path as /:w:/ , /:x:/ , /:p:/ , /:b:/
    if (path.includes('/:w:')) return at('word', 'Word', SOURCE_ICONS.doc);
    if (path.includes('/:x:')) return at('excel', 'Excel', SOURCE_ICONS.sheet);
    if (path.includes('/:p:')) return at('powerpoint', 'PowerPoint', SOURCE_ICONS.slides);
    if (path.includes('/:b:')) return at('pdf', 'PDF', SOURCE_ICONS.pdf);
    return at('onedrive', 'OneDrive', SOURCE_ICONS.cloud);
  }

  return UNKNOWN_SOURCE;
}

// ── Link (QR) ────────────────────────────────────────────────
// SVG rather than a raster so the code stays crisp at print resolution.
// Returns null for an empty or unencodable URL — a very long one overruns the
// largest QR version. `qrcode` is the vendored global (see vendor/qrcode.js,
// loaded as a plain <script> — same as course-builder.js relies on).
function renderQrSvg(url) {
  if (!url || typeof qrcode === 'undefined') return null;
  try {
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    return qr.createSvgTag({ scalable: true, margin: 0 });
  } catch {
    return null;
  }
}

// The card shows the finished result; the three fields behind it are edited in
// a popover, because an 80mm card has no room for a form.
function buildLinkEditor(block, type) {
  const wrap = document.createElement('div');
  wrap.className = 'card-block-link';
  wrap.tabIndex = 0;

  const code = document.createElement('div');
  code.className = 'card-block-qr';
  const svg = renderQrSvg(block.url);
  if (svg) {
    code.innerHTML = svg;
  } else {
    code.classList.add('is-empty');
  }

  const text = document.createElement('div');
  text.className = 'card-block-link-text';

  const title = document.createElement('div');
  title.className = 'card-block-link-title';
  title.textContent = block.title || (block.url ? block.url : type.placeholder);
  if (!block.title && !block.url) title.classList.add('is-empty');

  const description = document.createElement('div');
  description.className = 'card-block-link-description';
  description.textContent = block.body || '';

  text.appendChild(title);

  // Right under the title rather than under the QR (most short-domain slugs
  // are too long to fit at the QR's smaller sizes) or after the description
  // (which routinely fills all the space there is, pushing this off-card).
  if (block.slug) {
    const shortlink = document.createElement('div');
    shortlink.className = 'card-block-link-shortlink';
    shortlink.textContent = `Goto: pockit.works/${block.slug}`;
    text.appendChild(shortlink);
  }

  text.appendChild(description);
  wrap.append(code, text);

  // Top right, clear of the title. Only once there's a URL to identify.
  if (block.url) {
    const source = linkSource(block.url);
    const mark = document.createElement('span');
    mark.className = `card-block-link-icon is-${source.id}`;
    mark.title = source.label;
    mark.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${source.icon}</svg>`;
    wrap.appendChild(mark);
  }

  const open = () => openLinkEditor(block, wrap);
  wrap.addEventListener('click', open);
  wrap.addEventListener('focus', open);
  wrap.focusEditor = open;
  return wrap;
}

// The rounded-box treatment, kept separate from what goes inside it: a boxed
// block may hold plain text or markdown.
function boxContent(content, type) {
  const box = document.createElement('div');
  box.className = `card-block-boxed is-${type.id}`;

  // Matrix's narrow rating column leaves no room for this in the header row
  // that would otherwise sit under it — type.icon still exists, just for the
  // content-type picker tile, not the card face.
  if (!type.hideIcon) {
    const icon = document.createElement('span');
    icon.className = 'card-block-icon';
    icon.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${type.icon}</svg>`;
    box.appendChild(icon);
  }

  box.appendChild(content);
  // Read back by focusBlock; markdown content handles its own focus.
  box.focusEditor = () => box.querySelector(
    '.card-block-input, .card-block-rating-prompt, .card-block-list-prompt, .card-block-matrix-item-heading'
  )?.focus();
  return box;
}

function buildBlockContent(block, type, card, params) {
  if (!type?.editor) {
    // Types without an editor yet keep the placeholder label.
    const label = document.createElement('div');
    label.className = 'card-block-label';
    label.textContent = type?.label || '';
    return label;
  }

  const content =
    type.editor === 'line' ? buildLineEditor(block, type)
    : type.editor === 'markdown' ? buildMarkdownEditor(block, type)
    : type.editor === 'link' ? buildLinkEditor(block, type)
    : type.editor === 'image' ? buildImageEditor(block, type)
    : type.editor === 'list' ? buildListEditor(block, type, card, params)
    : type.editor === 'matrix' ? buildMatrixEditor(block, type, card, params)
    : type.editor === 'table' ? buildTableEditor(block, type, card, params)
    : type.editor === 'key-idea' ? buildKeyIdeaEditor(block, type)
    : type.editor === 'footnote' ? buildFootnoteEditor(block, type)
    : type.editor === 'quote' ? buildQuoteEditor(block, type)
    : type.editor === 'rating' ? buildRatingEditor(block, type)
    : buildPlainEditor(block, type);

  return type.boxed ? boxContent(content, type) : content;
}

// Neutralizes a block's content DOM for `interactive: false`. Rather than
// auditing every block editor's own quirks (buildImageEditor, for one,
// attaches click/dragover/drop listeners straight to a plain <div>, not a
// button — readOnly/disabled alone wouldn't touch that), this blocks all
// pointer interaction at the root, universally: pointer-events: none stops
// every click/drag/hover from ever reaching anything inside, regardless of
// what kind of element it's attached to or which of the ~10 block editors
// built it. tabIndex is stripped everywhere too, closing the one gap
// pointer-events doesn't cover — keyboard Tab navigation (e.g. onto a
// markdown block's preview, whose own 'focus' listener reveals its editor
// textarea the same as a click would — see buildMarkdownEditor). The
// input/textarea/button pass underneath is belt-and-suspenders: harmless
// once nothing can reach them, but cheap insurance against anything ever
// focusing one programmatically from outside this subtree.
function lockBlockContent(root) {
  root.classList.add('is-locked');
  root.style.pointerEvents = 'none';
  root.querySelectorAll('input, textarea').forEach(el => { el.readOnly = true; });
  root.querySelectorAll('button').forEach(el => { el.disabled = true; });
  root.querySelectorAll('[tabindex]').forEach(el => { el.tabIndex = -1; });
}

// ── Build one card ───────────────────────────────────────────
// `blank`: true for a filler grid card printed overleaf — has no real
// position of its own (it isn't in any lesson's card list), so the
// header's "N of M" and the footer's page number, both of which mean
// "this card's place among real ones," are skipped rather than shown
// wrong.
// `interactive: false` (used by the read-only student viewer) skips every
// editing affordance this function would otherwise attach (remove/add
// buttons, drag, resize) and additionally locks each block's own content
// down via lockBlockContent() above. Default true preserves the editor's
// existing behavior exactly.
// `lessonTitle`/`totalCards`/`pageNumber` replace what used to be read
// straight off course-builder.js's own module-global `activeLesson()`/
// `cards`/`coursePageNumber()` — now the caller's job, since this module
// has no course/lesson state of its own to read them from.
export function buildCard(card, index, params, {
  blank = false,
  interactive = true,
  lessonTitle = '',
  totalCards = 0,
  pageNumber = 0,
} = {}) {
  const el = document.createElement('div');
  el.className = blank ? 'card is-blank' : 'card';
  el.dataset.cardId = card.id;
  el.style.cssText = `
    /* One source for the card's side margin — header, footer and block
       content all read this, so they stay aligned. */
    --card-pad: ${params.gridSize / 2}mm;
    /* Body text sits on the grid: one line of copy is one grid square, so a
       half-row of height is exactly one more line. */
    --card-line: ${params.gridSize}mm;
    width: ${params.cardWidth}mm;
    height: ${params.cardHeight}mm;
  `;

  // Header and footer eat into the card, so the grid only covers what's left.
  const headerH = params.header ? params.headerHeight : 0;
  const footerH = params.footer ? params.footerHeight : 0;

  // Dot grid, inset to the body area and tiled so dots land on the grid origin
  // rather than cell centres. Blocks will sit on this same grid, so its origin
  // is the top of the body — not the top of the card.
  if (params.dots) {
    const radius = params.dotSize / 2;
    const grid = document.createElement('div');
    grid.className = 'card-grid';
    const dotSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${params.gridSize}" height="${params.gridSize}" viewBox="0 0 ${params.gridSize} ${params.gridSize}"><circle cx="${params.gridSize / 2}" cy="${params.gridSize / 2}" r="${radius}" fill="${params.dotColor}"/></svg>`;
    grid.style.cssText = `
      top: ${headerH}mm;
      bottom: ${footerH}mm;
      background-image: url("data:image/svg+xml,${encodeURIComponent(dotSvg)}");
      background-size: ${params.gridSize}mm ${params.gridSize}mm;
      background-position: -${params.gridSize / 2}mm -${params.gridSize / 2}mm;
    `;
    el.appendChild(grid);
  }

  // Body: content blocks stacked from the top of the grid, with the dotted
  // add-slot trailing them.
  const body = document.createElement('div');
  body.className = 'card-body';
  body.style.cssText = `top: ${headerH}mm; bottom: ${footerH}mm;`;

  card.blocks.forEach((block, index) => {
    const blockEl = document.createElement('div');
    blockEl.className = 'card-block';
    blockEl.dataset.blockId = block.id;
    blockEl.style.height = `${block.h * rowHeightMm(params)}mm`;

    blockEl.appendChild(buildBlockContent(block, blockType(block.type), card, params));

    if (interactive) {
      const remove = document.createElement('button');
      remove.className = 'card-block-remove';
      remove.textContent = '×';
      remove.title = 'Remove this content';
      remove.draggable = false;
      remove.addEventListener('click', () => removeBlock(card.id, block.id));
      blockEl.appendChild(remove);

      makeBlockDraggable(blockEl, card, index, block);
      makeResizable(blockEl, card, block);
    } else {
      lockBlockContent(blockEl);
    }
    body.appendChild(blockEl);
  });

  // Hidden once not even the smallest type would fit. The slot shrinks below
  // its usual height rather than overflowing the last row or two. Also
  // skipped outright for a non-interactive (viewer) card — there's nothing
  // to add to.
  const free = freeRows(card, params);
  if (interactive && free >= SMALLEST_BLOCK_ROWS) {
    const add = document.createElement('button');
    add.className = 'card-block-add';
    add.title = 'Add content or reflection';
    add.textContent = '+';
    add.style.height = `${Math.min(MIN_BLOCK_ROWS, free) * rowHeightMm(params)}mm`;
    add.addEventListener('click', () => openTypePicker(card.id, add));
    makeBlockDropTarget(add, card, card.blocks.length);
    body.appendChild(add);
  }

  el.appendChild(body);

  if (params.header) {
    const header = document.createElement('div');
    header.className = 'card-header';
    header.style.cssText = `
      height: ${params.headerHeight}mm;
      padding: 0 var(--card-pad);
      ${params.headerLine ? `box-shadow: inset 0 -0.1mm 0 ${params.headerLineColor};` : ''}
    `;

    // Where the card gets hole-punched for the folder. Sits immediately before
    // the title, which the stylesheet then shifts clear of it.
    if (params.punchMark) {
      const punch = document.createElement('div');
      punch.className = 'card-punch';
      punch.style.background = params.punchColor;
      header.appendChild(punch);
    }

    // Title and count stack against the right edge, clear of the punch.
    const stack = document.createElement('div');
    stack.className = 'card-header-stack';

    const text = document.createElement('div');
    text.className = 'card-header-text';
    text.textContent = lessonTitle;
    stack.appendChild(text);

    // Position within this lesson's set. The footer number is a course-wide
    // page count, so the two deliberately don't agree.
    if (params.lessonCount && !blank) {
      const count = document.createElement('div');
      count.className = 'card-lesson-count';
      count.style.color = params.lessonCountColor;
      count.textContent = `${index + 1} of ${totalCards}`;
      stack.appendChild(count);
    }

    header.appendChild(stack);
    el.appendChild(header);
  }

  if (params.footer) {
    const footer = document.createElement('div');
    footer.className = 'card-footer';
    footer.style.cssText = `
      height: ${params.footerHeight}mm;
      padding: 0 var(--card-pad);
      ${params.footerLine ? `box-shadow: inset 0 0.1mm 0 ${params.footerLineColor};` : ''}
    `;

    // Course code and name, joined only when both are set so a lone value
    // doesn't trail a separator.
    const label = [params.courseCode, params.courseName].filter(Boolean).join(' · ');
    if (label) {
      const text = document.createElement('div');
      text.className = 'card-footer-text';
      text.style.color = params.footerTextColor;
      text.textContent = label;
      footer.appendChild(text);
    }

    if (params.cardNumbers && !blank) {
      const number = document.createElement('div');
      number.className = 'card-number';
      number.style.color = params.cardNumberColor;
      number.textContent = pageNumber;
      footer.appendChild(number);
    }
    el.appendChild(footer);
  }

  // Trim-line indicator, appended last so it paints on top of the body,
  // header and footer — an inline `outline` on the card itself would sit
  // *under* its own children and get hidden behind any opaque content block.
  // Also exposes its weight/color as custom properties, unused on screen —
  // print.css reads them back to redraw this as a border instead of an
  // outline for print (see there for why).
  if (params.cardOutline) {
    const outline = document.createElement('div');
    outline.className = 'card-outline';
    outline.style.cssText = `
      outline: ${params.cardOutlineWeight}mm solid ${params.cardOutlineColor};
      outline-offset: -${params.cardOutlineWeight / 2}mm;
      --outline-weight: ${params.cardOutlineWeight}mm;
      --outline-color: ${params.cardOutlineColor};
    `;
    el.appendChild(outline);
  }

  return el;
}

// ── Present slide ────────────────────────────────────────────
// Paints one slide's content into the fixed #present-view markup — title
// plus card.teacherOverview, nothing else (Present never renders a card's
// actual designed content/blocks, in the editor or the viewer alike). Both
// course-builder.js and the read-only viewer share this unchanged: each
// keeps its own tiny presentIndex/openPresentView()/closePresentView()
// wrapper (view state, not worth threading through hooks), but the actual
// DOM-painting was identical in both from the start, so it's the one piece
// of Present worth a real extraction rather than a second copy — see the
// plan's "Primary technical risk" section.
export function paintPresentSlide(card, { index, total, lessonTitle, courseCode, courseName }) {
  document.getElementById('present-lesson').textContent = lessonTitle;
  document.getElementById('present-title').textContent = card.title || `Card ${index + 1}`;
  document.getElementById('present-count').textContent = `${index + 1} of ${total}`;
  // #present-mark spans exactly as tall as the lesson name + title text
  // ends up being — measured now that both are actually in place, rather
  // than a CSS align-items:stretch (aspect-ratio alone didn't reliably
  // derive a width from a flex-stretched height — see the CSS).
  const syncPresentMarkHeight = () => {
    document.getElementById('present-mark').style.height =
      `${document.getElementById('present-header-text').getBoundingClientRect().height}px`;
  };
  syncPresentMarkHeight();
  // Present's webfont (Barlow) may still be downloading on first open — the
  // synchronous measurement above then reflects the fallback font's line
  // height, not Barlow's, and never gets corrected once the swap happens.
  // Re-measure once fonts actually finish loading; resolves instantly (and
  // this is a no-op re-measurement) on every render after the first.
  document.fonts.ready.then(syncPresentMarkHeight);

  const content = document.getElementById('present-content');
  if (card.teacherOverview) {
    content.classList.remove('is-empty');
    content.innerHTML = renderMarkdown(card.teacherOverview);
  } else {
    content.classList.add('is-empty');
    content.innerHTML = '';
  }

  // Same "code · name" join the card footer/whole-cover spine already use.
  document.getElementById('present-footer-text').textContent =
    [courseCode, courseName].filter(Boolean).join(' · ');

  document.getElementById('present-prev').disabled = index === 0;
  document.getElementById('present-next').disabled = index === total - 1;
}
