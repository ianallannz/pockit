// ── Parameters ──────────────────────────────────────────────
const params = {
  flavourId: 'gp',
  pageCount: 32,
  gridSize: 4,
  extraDetailPagesOn: false,
  pageWidth: 80,
  pageHeight: 160,
  binding: 'saddle-stitch',
  detailPages: true,
  header: true,
  headerLine: true,
  headerLineColor: '#dedede',
  headerLineWidth: 0.1,
  footer: true,
  footerLine: true,
  footerLineColor: '#dedede',
  footerLineWidth: 0.1,
  columnLine: true,
  columnLineSide: 'right',
  columnLineCols: 5,
  columnLineColor: '#999999',
  columnLineWidth: 0.1,
  rowNumbers: true,
  rowNumberColor: '#dedede',
  pageNumbers: true,
  quotes: true,
  quoteColor: '#999999',
  dotSize: 0.4,
  dotColor: '#aaaaaa',
  pageOutline: true,
  pageOutlineColor: '#dedede',
  pageOutlineWeight: 0.1,
};

// ── Read form into params ────────────────────────────────────
function readParams() {
  const raw = parseInt(document.getElementById('pageCount').value);
  document.getElementById('pageCountDisplay').textContent = raw;
  const valid = raw > 0 && raw % 4 === 0;
  document.getElementById('warning').style.display = valid ? 'none' : 'block';
  params.pageCount = valid ? raw : Math.max(4, Math.round(raw / 4) * 4);

  params.binding           = document.getElementById('binding').value;
  params.gridSize          = parseInt(document.getElementById('gridSize').value);
  document.getElementById('gridSizeDisplay').textContent = params.gridSize;
  updatePageSizeSliders(params.gridSize);
  params.pageWidth         = parseInt(document.getElementById('pageWidth').value);
  document.getElementById('pageWidthDisplay').textContent = params.pageWidth;
  params.pageHeight        = parseInt(document.getElementById('pageHeight').value);
  document.getElementById('pageHeightDisplay').textContent = params.pageHeight;
  document.querySelector('#sidebar-header p').textContent = `${params.pageWidth}mm × ${params.pageHeight}mm · ${params.gridSize}mm grid`;
  params.detailPages       = document.getElementById('detailPages').checked;
  params.extraDetailPagesOn = document.getElementById('extraDetailPagesOn').checked;
  params.header            = document.getElementById('header').checked;
  params.headerLine        = document.getElementById('headerLine').checked;
  params.headerLineColor   = document.getElementById('headerLineColor').value;
  params.headerLineWidth   = parseFloat(document.getElementById('headerLineWidth').value) || 0.1;
  params.footer            = document.getElementById('footer').checked;
  params.footerLine        = document.getElementById('footerLine').checked;
  params.footerLineColor   = document.getElementById('footerLineColor').value;
  params.footerLineWidth   = parseFloat(document.getElementById('footerLineWidth').value) || 0.1;
  params.columnLine        = document.getElementById('columnLine').checked;
  params.columnLineSide    = document.getElementById('columnLineSide').value;
  params.columnLineCols    = parseInt(document.getElementById('columnLineCols').value) || 5;
  params.columnLineColor   = document.getElementById('columnLineColor').value;
  params.columnLineWidth   = parseFloat(document.getElementById('columnLineWidth').value) || 0.1;
  params.rowNumbers        = document.getElementById('rowNumbers').checked;
  params.rowNumberColor    = document.getElementById('rowNumberColor').value;
  params.pageNumbers       = document.getElementById('pageNumbers').checked;
  params.quotes            = document.getElementById('quotes').checked;
  params.quoteColor        = document.getElementById('quoteColor').value;
  params.dotSize           = parseFloat(document.getElementById('dotSize').value) || 0.2;
  params.dotColor          = document.getElementById('dotColor').value;
  params.pageOutline       = document.getElementById('pageOutline').checked;
  params.pageOutlineColor  = document.getElementById('pageOutlineColor').value;
  params.pageOutlineWeight = parseFloat(document.getElementById('pageOutlineWeight').value) || 0.1;
}

// ── Detail page content ──────────────────────────────────────
// Standard 4 detail pages common to all flavours.
const detailPageContent = [
  {
    title: 'Pockit Intentions',
    footer: 'Yes, a fresh Pockit Note! Use this page to present important carryovers from your last Pockit Note and your intentions for this one.',
    pane: false,
    paneHeightMode: 'full',
    paneAlign: 'top',
    paneBorder: true,
  },
  {
    title: 'Pockit Finder',
    footer: 'Use this page to keep a page number index of good stuff you easily want to find again, like, Campaign ideas: pg 3, 7',
    pane: false,
    paneHeightMode: 'full',
    paneAlign: 'top',
    paneBorder: true,
  },
  {
    title: 'Pockit Reference',
    footer: 'Use this page for measurements, numbers, and codes that you often refer to. There are some handy note-taking symbols you can use too.',
    pane: true,
    paneHeightMode: 'content',
    paneAlign: 'bottom',
    paneBorder: true,
    blocks: [
      { type: 'h1',     height: 1, leftCols: 0, text: 'Note-taking Symbols' },
      { type: 'text',   height: 2, leftCols: 0, text: 'When making your list of things to do or creating notes, add these symbols to give clarity.', border: false, borderStyle: 'dashed' },
      { type: 'symbol', height: 1, leftCols: 1, icon: 'dot',    text: 'Do (actions you need to complete)', border: false },
      { type: 'symbol', height: 1, leftCols: 1, icon: 'arrow',    text: 'Go to (places you need to go)', border: false },
      { type: 'symbol', height: 1, leftCols: 1, icon: 'question',     text: 'Lookup (research you need to do)', border: false },
      { type: 'symbol', height: 1, leftCols: 1, icon: 'buy', text: 'Buy (things you need to buy)', border: false },
      { type: 'symbol', height: 1, leftCols: 1, icon: 'bang', text: 'Get in touch (people you need)', border: false },
      { type: 'symbol', height: 1, leftCols: 1, icon: 'star', text: 'Remember (something to come back to)', border: false },
    ]
  },
  {
    title: 'Pockit Future',
    footer: "Use this page to list the things you hold in the back of your mind, but you know you're not going to get to in the next little while.",
    pane: false,
    paneHeightMode: 'full',
    paneAlign: 'top',
    paneBorder: true,
  },
];

// ── Flavours ─────────────────────────────────────────────────
// Each flavour defines its own defaults and any extra detail pages.
// extraDetailPages: array of {title, footer} objects — must be a multiple of 4.
// The first half go after GP detail pages 1–2 at the front;
// the second half go before GP detail pages 3–4 at the back.
const flavours = [
  {
    id: 'gp',
    name: 'Pockit Note GP',
    extraDetailPages: [],
    quotes: [
      { text: "The impediment to action advances action. What stands in the way becomes the way.", author: "Marcus Aurelius" },
      { text: "It is not that I'm so smart. But I stay with the questions much longer.", author: "Albert Einstein" },
      { text: "A small daily task, if it be really daily, will beat the labours of a spasmodic Hercules.", author: "Anthony Trollope" },
      { text: "Almost everything will work again if you unplug it for a few minutes, including you.", author: "Anne Lamott" },
      { text: "The first draft of anything is garbage.", author: "Ernest Hemingway" },
      { text: "Absorb what is useful, discard what is not, add what is uniquely your own.", author: "Bruce Lee" },
      { text: "Plans are useless, but planning is indispensable.", author: "Dwight D. Eisenhower" },
      { text: "Do the hard jobs first. The easy jobs will take care of themselves.", author: "Dale Carnegie" },
      { text: "The most difficult thing is the decision to act. The rest is merely tenacity.", author: "Amelia Earhart" },
      { text: "One must always maintain one's connection to the past and yet ceaselessly pull away from it.", author: "Gaston Bachelard" },
      { text: "Routine, in an intelligent man, is a sign of ambition.", author: "W.H. Auden" },
      { text: "What you do every day matters more than what you do once in a while.", author: "Gretchen Rubin" },
      { text: "The way to get started is to quit talking and begin doing.", author: "Walt Disney" },
      { text: "Creativity is just connecting things.", author: "Steve Jobs" },
      { text: "If you can't fly, then run. If you can't run, then walk. If you can't walk, then crawl. But whatever you do, keep moving.", author: "Martin Luther King Jr." },
      { text: "Write it. Shoot it. Publish it. Crochet it. Sauté it. Whatever. Make.", author: "Joss Whedon" },
      { text: "Limit your always and your nevers.", author: "Amy Poehler" },
      { text: "Nothing is particularly hard if you divide it into small jobs.", author: "Henry Ford" },
      { text: "Real generosity toward the future lies in giving all to the present.", author: "Albert Camus" },
      { text: "Energy and persistence conquer all things.", author: "Benjamin Franklin" },
    ],
    defaults: {
      pageCount: 12,
      pageWidth: 80,
      pageHeight: 160,
      gridSize: 4,
      detailPages: true,
      extraDetailPagesOn: false,
      header: true,
      headerLine: true,
      headerLineColor: '#dedede',
      headerLineWidth: 0.1,
      footer: true,
      footerLine: true,
      footerLineColor: '#dedede',
      footerLineWidth: 0.1,
      columnLine: true,
      columnLineSide: 'right',
      columnLineCols: 5,
      columnLineColor: '#999999',
      columnLineWidth: 0.1,
      rowNumbers: true,
      rowNumberColor: '#dedede',
      pageNumbers: true,
      quotes: true,
      quoteColor: '#999999',
      dotSize: 0.4,
      dotColor: '#aaaaaa',
      pageOutline: true,
      pageOutlineColor: '#dedede',
      pageOutlineWeight: 0.1,
    },
  },
  // Future flavours (e.g. Pockit Note HS) go here.
  {
    id: 'hs',
    name: 'Pockit Note HS',
    quotes: [],
    extraDetailPages: [
      {
        title: 'Pockit Tips',
        footer: "Pockit is all about helping you reach your potential, getting things out of the way, and getting things done. These tips will help you focus.",
        pane: true,
        paneHeightMode: 'full',
        paneAlign: 'top',
        paneBorder: true,
      },
      {
        title: 'Pockit Necessities',
        footer: "An opinionated little list of things you need to know to get by. It's not everything, that's why it's a little list.",
        pane: true,
        paneHeightMode: 'full',
        paneAlign: 'top',
        paneBorder: true,
        blocks: [
          { type: 'h1',     height: 1, leftCols: 0, text: 'Note-taking Symbols' },
          { type: 'text',   height: 2, leftCols: 0, text: 'Full width text example.', border: true, borderStyle: 'dashed' },
          { type: 'qr',     height: 4, leftCols: 4, url: 'https://pockitnote.com', text: 'Visit pockitnote.com for guides, tips, and printable extras.' },
        ]
      },
      {
        title: 'Pockit DMs',
        footer: "Rush of blood? Use this page to write your DM here before you send it; if you can't imagine saying it to their face, don't send it.",
        pane: false,
        paneHeightMode: 'full',
        paneAlign: 'top',
        paneBorder: true,
      },
      {
        title: 'Pockit Cool',
        footer: "An opinionated little list of things you should know about and be into to be universally, deeply, forever cool.",
        pane: true,
        paneHeightMode: 'full',
        paneAlign: 'top',
        paneBorder: true,
      },
    ],
    defaults: {
      pageCount: 40,
      pageWidth: 90,
      pageHeight: 180,
      gridSize: 5,
      detailPages: true,
      extraDetailPagesOn: true,
      header: true,
      headerLine: true,
      headerLineColor: '#dedede',
      headerLineWidth: 0.1,
      footer: true,
      footerLine: true,
      footerLineColor: '#dedede',
      footerLineWidth: 0.1,
      columnLine: true,
      columnLineSide: 'right',
      columnLineCols: 5,
      columnLineColor: '#999999',
      columnLineWidth: 0.1,
      rowNumbers: true,
      rowNumberColor: '#dedede',
      pageNumbers: true,
      quotes: true,
      quoteColor: '#999999',
      dotSize: 0.4,
      dotColor: '#aaaaaa',
      pageOutline: true,
      pageOutlineColor: '#dedede',
      pageOutlineWeight: 0.1,
    },
  },
];

// ── getQuote — returns quote for a given page number ─────────
// Sequential, cycling back to start if more pages than quotes.
// Returns null if the flavour has no quotes defined.
function getQuote(pageNum) {
  const flavour = flavours.find(f => f.id === params.flavourId) || flavours[0];
  if (!flavour.quotes || flavour.quotes.length === 0) return null;
  return flavour.quotes[(pageNum - 1) % flavour.quotes.length];
}

// ── Apply flavour defaults to params and form ────────────────
function applyFlavour(flavourId) {
  const flavour = flavours.find(f => f.id === flavourId);
  if (!flavour) return;

  // Store current flavour reference for use in rendering
  params.flavourId = flavourId;

  const d = flavour.defaults;
  Object.assign(params, d);

  // Sync form controls
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = val;
    else el.value = val;
  };

  set('pageCount',        d.pageCount);
  set('gridSize',         d.gridSize);
  document.getElementById('gridSizeDisplay').textContent = d.gridSize;
  // Set constraints first, then values — otherwise browser clamps values to old min/max
  updatePageSizeSliders(d.gridSize);
  set('pageWidth',        d.pageWidth);
  set('pageHeight',       d.pageHeight);
  params.pageWidth  = d.pageWidth;
  params.pageHeight = d.pageHeight;
  document.getElementById('pageWidthDisplay').textContent  = d.pageWidth;
  document.getElementById('pageHeightDisplay').textContent = d.pageHeight;
  set('detailPages',      d.detailPages);
  // Extra detail pages checkbox: disabled if flavour has none defined
  const extraEl = document.getElementById('extraDetailPagesOn');
  const hasExtra = flavour.extraDetailPages.length > 0;
  extraEl.disabled = !hasExtra;
  extraEl.checked  = hasExtra ? d.extraDetailPagesOn : false;
  params.extraDetailPagesOn = extraEl.checked;
  set('header',           d.header);
  set('headerLine',       d.headerLine);
  set('headerLineColor',  d.headerLineColor);
  set('headerLineWidth',  d.headerLineWidth);
  set('footer',           d.footer);
  set('footerLine',       d.footerLine);
  set('footerLineColor',  d.footerLineColor);
  set('footerLineWidth',  d.footerLineWidth);
  set('columnLine',       d.columnLine);
  set('columnLineSide',   d.columnLineSide);
  set('columnLineCols',   d.columnLineCols);
  set('columnLineColor',  d.columnLineColor);
  set('columnLineWidth',  d.columnLineWidth);
  set('rowNumbers',       d.rowNumbers);
  set('rowNumberColor',   d.rowNumberColor);
  set('pageNumbers',      d.pageNumbers);
  set('quotes',           d.quotes);
  set('quoteColor',       d.quoteColor);
  set('dotSize',          d.dotSize);
  set('dotColor',         d.dotColor);
  set('pageOutline',      d.pageOutline);
  set('pageOutlineColor', d.pageOutlineColor);
  set('pageOutlineWeight',d.pageOutlineWeight);

  // Update display spans
  document.getElementById('pageCountDisplay').textContent  = d.pageCount;
  document.querySelector('#sidebar-header p').textContent  =
    `${d.pageWidth}mm × ${d.pageHeight}mm · ${d.gridSize}mm grid`;
}


// ── Symbol icons ─────────────────────────────────────────────
// Maps icon names to unicode glyphs used by the 'symbol' block type.
const ICONS = {
  check:    '✓',
  cross:    '✗',
  arrow:    '→',
  star:     '★',
  circle:   '○',
  dot:      '●',
  question: '?',
  bang:     '!',
  dash:     '–',
  buy:      '$',
};

// ── Column builder helper ─────────────────────────────────────
// Creates a left or right column div. widthStyle is e.g. 'width:8mm' or 'flex:1'.
function makeCol(widthStyle, padding) {
  const col = document.createElement('div');
  col.style.cssText = `
    ${widthStyle};
    flex-shrink: 0;
    height: 100%;
    box-sizing: border-box;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    justify-content: center;
    ${padding ? `padding: ${padding}mm;` : ''}
  `;
  return col;
}

// ── Build a content block inside a content pane ──────────────────────────────
// All blocks share: type, height, leftCols, and optional margin / border / borderStyle / borderColor / color.
// leftCols=0 means full-width (no left column).

function buildBlock(block, layout) {
  const { GRID, HALF } = layout;
  const pad    = GRID / 4;  // inner padding
  const gap    = GRID / 4;  // margin-top when block.margin is true

  const blockHeight = block.height * GRID;
  const leftWidth   = (block.leftCols || 0) * GRID;

  // Shared wrapper
  const el = document.createElement('div');
  el.style.cssText = `
    width: 100%;
    flex-shrink: 0;
    height: ${blockHeight}mm;
    box-sizing: border-box;
    overflow: hidden;
    display: flex;
    ${block.margin ? `margin-top: ${gap}mm;` : ''}
    ${block.border ? `border: 0.1mm ${block.borderStyle || 'solid'} ${block.borderColor || '#CCCCCC'};` : ''}
  `;

  // ── h1 ──────────────────────────────────────────────────────
  // Full-width heading. Properties: text, color.
  if (block.type === 'h1') {
    el.style.alignItems = 'center';
    el.style.padding = `0 ${pad}mm`;
    const heading = document.createElement('div');
    heading.style.cssText = `
      font-family: 'JetBrains Mono', monospace;
      font-size: 2.5mm;
      font-weight: 700;
      letter-spacing: 0.15em;
      text-transform: uppercase;
      color: ${block.color || '#666666'};
      line-height: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    `;
    heading.textContent = block.text || '';
    el.appendChild(heading);
    return el;
  }

  // ── text ─────────────────────────────────────────────────────
  // Body text, full-width (leftCols ignored). Properties: text, color.
  if (block.type === 'text') {
    const col = makeCol('flex: 1', pad);
    const t = document.createElement('div');
    t.style.cssText = `
      font-family: 'Inter', system-ui, sans-serif;
      font-size: 2mm;
      line-height: 2.6mm;
      color: ${block.color || '#333333'};
    `;
    t.textContent = block.text || '';
    col.appendChild(t);
    el.appendChild(col);
    return el;
  }

  // ── symbol ───────────────────────────────────────────────────
  // Icon glyph in left column, descriptive text in right column.
  // Properties: icon (key into ICONS), text, color.
  if (block.type === 'symbol') {
    if (leftWidth > 0) {
      const left = makeCol(`width: ${leftWidth}mm`, pad);
      left.style.alignItems = 'center';
      const glyph = document.createElement('div');
      glyph.style.cssText = `
        font-family: 'JetBrains Mono', monospace;
        font-size: 3mm;
        font-weight: 700;
        color: ${block.color || '#333333'};
        line-height: 1;
      `;
      glyph.textContent = ICONS[block.icon] || block.icon || '·';
      left.appendChild(glyph);
      el.appendChild(left);
    }
    const right = makeCol('flex: 1', pad);
    const t = document.createElement('div');
    t.style.cssText = `
      font-family: 'Inter', system-ui, sans-serif;
      font-size: 2mm;
      line-height: 2.6mm;
      color: ${block.color || '#555555'};
    `;
    t.textContent = block.text || '';
    right.appendChild(t);
    el.appendChild(right);
    return el;
  }

  // ── qr ───────────────────────────────────────────────────────
  // QR code in left column, descriptive text in right column.
  // Properties: url, text, color (dot colour, defaults to black).
  // leftCols controls the column width — make it tall enough to fit a square QR
  // (block.height * GRID >= leftCols * GRID, i.e. height >= leftCols).
  if (block.type === 'qr') {
    if (leftWidth > 0) {
      const left = makeCol(`width: ${leftWidth}mm`, 0);
      left.style.alignItems = 'center';
      left.style.justifyContent = 'center';

      // QR is square — fit inside the smaller of column width or block height,
      // with a small inset so it doesn't touch the border.
      const qrSizeMm = Math.min(leftWidth, blockHeight) - pad;

      // Generate at 128px — small enough that the browser won't fight us on
      // scaling, large enough for QRCode.js to encode cleanly.
      const qrSizePx = 128;

      const qrWrap = document.createElement('div');
      qrWrap.style.cssText = `
        width: ${qrSizeMm}mm;
        height: ${qrSizeMm}mm;
        flex-shrink: 0;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
      `;

      if (typeof QRCode !== 'undefined' && block.url) {
        new QRCode(qrWrap, {
          text:         block.url,
          width:        qrSizePx,
          height:       qrSizePx,
          colorDark:    block.color || '#000000',
          colorLight:   '#ffffff',
          correctLevel: QRCode.CorrectLevel.M,
        });
        // QRCode.js generates a hidden <canvas> AND a visible <img>.
        // Target both so whichever is displayed gets the correct mm dimensions.
        qrWrap.querySelectorAll('canvas, img').forEach(el => {
          el.style.width   = `${qrSizeMm}mm`;
          el.style.height  = `${qrSizeMm}mm`;
        });
      } else {
        // Fallback if library not loaded or no URL provided
        qrWrap.style.border     = '0.2mm dashed #CCCCCC';
        qrWrap.style.fontFamily = "'JetBrains Mono', monospace";
        qrWrap.style.fontSize   = '1.8mm';
        qrWrap.style.color      = '#AAAAAA';
        qrWrap.textContent      = block.url ? 'QR' : '(no url)';
      }

      left.appendChild(qrWrap);
      el.appendChild(left);
    }

    const right = makeCol('flex: 1', pad);
    const t = document.createElement('div');
    t.style.cssText = `
      font-family: 'Inter', system-ui, sans-serif;
      font-size: 2mm;
      line-height: 2.6mm;
      color: ${block.textColor || '#555555'};
    `;
    t.textContent = block.text || '';
    right.appendChild(t);
    el.appendChild(right);
    return el;
  }

  // Unknown type — return empty wrapper
  return el;
}


// ── Build a pane for extra detail pages ──────────────────────────────

function buildPane(page, paneConfig, layout) {
  const { PAGE_W, PAGE_H, GRID, HALF, headerHeight, footerHeight } = layout;

  // Geometry
  const left   = GRID;
  const right  = GRID;
  const topFull = headerHeight + GRID;
  const bottomFull = footerHeight + GRID;

  const fullHeight = PAGE_H - headerHeight - footerHeight - 2 * GRID;

  // Height mode
  let paneHeight = fullHeight;

  if (paneConfig.paneHeightMode === 'content') {
    // Placeholder for now — will later depend on content blocks
    paneHeight = fullHeight * 0.5;
  }

  // Vertical alignment (only matters for content mode)
  let paneTop = topFull;

  if (paneConfig.paneHeightMode === 'content' && paneConfig.paneAlign === 'bottom') {
    paneTop = PAGE_H - footerHeight - GRID - paneHeight;
  }

  // Build element
  const pane = document.createElement('div');
  pane.style.cssText = `
    position: absolute;
    left: ${left}mm;
    right: ${right}mm;
    top: ${paneTop}mm;
    height: ${paneHeight}mm;
    padding: ${HALF}mm;
    background: #FFFFFF;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    ${paneConfig.paneBorder ? `border: 0.1mm solid #DEDEDE;` : ''}
  `;

  // ── Content blocks ─────────────────────────────
  if (paneConfig.blocks && paneConfig.blocks.length > 0) {
    paneConfig.blocks.forEach(block => {
      pane.appendChild(buildBlock(block, { GRID, HALF }));
    });
  }
  
  return pane;
}




// ── Build a single page element ──────────────────────────────
// descriptor: { type: 'content', num: N } or { type: 'detail', slot: N, detailIndex: N }
function buildPage(descriptor, side) {
  const PAGE_W   = params.pageWidth;
  const PAGE_H   = params.pageHeight;
  const GRID     = params.gridSize;
  const HALF     = GRID / 2;
  const isDetail = descriptor.type === 'detail';
  const pageNum  = descriptor.num || descriptor.slot;
  let content = null;

  if (isDetail) {
  const flavour = flavours.find(f => f.id === params.flavourId) || flavours[0];
  content = descriptor.source === 'extra'
      ? flavour.extraDetailPages[descriptor.detailIndex]
      : detailPageContent[descriptor.detailIndex - 1];
  }
  const page = document.createElement('div');
  page.className = `page ${side}`;
  page.style.width  = `${PAGE_W}mm`;
  page.style.height = `${PAGE_H}mm`;

  if (params.pageOutline) {
    page.style.outline = `${params.pageOutlineWeight}mm solid ${params.pageOutlineColor}`;
  }

  // Detail page content — header and footer zones
  if (isDetail && (params.header || params.footer)) {
    const flavour = flavours.find(f => f.id === params.flavourId) || flavours[0];
    const content = descriptor.source === 'extra'
      ? flavour.extraDetailPages[descriptor.detailIndex]
      : detailPageContent[descriptor.detailIndex - 1];

    if (content?.title && params.header) {
      const title = document.createElement('div');
      title.style.cssText = `
        position: absolute;
        top: ${HALF}mm;
        left: ${GRID}mm;
        right: ${GRID}mm;
        height: ${GRID}mm;
        display: flex;
        align-items: center;
        justify-content: flex-start;
        font-family: 'JetBrains Mono', monospace;
        font-size: 2.5mm;
        line-height: 1;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: #555555;
      `;
      title.textContent = content.title;
      page.appendChild(title);
    }
  }

  // Detail page content — footer zone
  if (isDetail && params.footer) {
    const flavour = flavours.find(f => f.id === params.flavourId) || flavours[0];
    const content = descriptor.source === 'extra'
      ? flavour.extraDetailPages[descriptor.detailIndex]
      : detailPageContent[descriptor.detailIndex - 1];
    if (content?.footer) {
      const ftr = document.createElement('div');
      ftr.style.cssText = `
        position: absolute;
        bottom: 0;
        left: ${GRID}mm;
        right: ${GRID}mm;
        height: ${GRID * 3}mm;
        display: flex;
        align-items: center;
        overflow: hidden;
        font-family: 'Inter', system-ui, sans-serif;
        font-style: normal;
        font-size: 2mm;
        line-height: 2.6mm;
        color: ${params.quoteColor};
      `;
      ftr.textContent = content.footer;
      page.appendChild(ftr);
    }
  }

  // Dot area — sits between header (if on) and footer
  const headerHeight  = params.header ? GRID * 2 : 0;   // mm
  const footerHeight  = params.footer ? GRID * 3 : 0;  // mm
  const dotAreaTop    = headerHeight;
  const dotAreaHeight = PAGE_H - headerHeight - footerHeight;
  const dotRadius     = params.dotSize / 2;

  // Dot grid — individual circles for reliable screen and print rendering.
  // cx=2, cy=2 in a 4mm tile means dots at x=2,6,10… and y=2,6,10… mm.
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${PAGE_W} ${dotAreaHeight}`);
  svg.style.cssText = `
    position: absolute;
    top: ${dotAreaTop}mm;
    left: 0;
    width: ${PAGE_W}mm;
    height: ${dotAreaHeight}mm;
    display: block;
  `;

  const cols = Math.floor((PAGE_W - HALF) / GRID) + 1;
  const rows = Math.floor((dotAreaHeight - HALF) / GRID) + 1;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const circle = document.createElementNS(svgNS, 'circle');
      circle.setAttribute('cx', String(HALF + col * GRID));
      circle.setAttribute('cy', String(HALF + row * GRID));
      circle.setAttribute('r',  String(dotRadius));
      circle.setAttribute('fill', params.dotColor);
      svg.appendChild(circle);
    }
  }

  page.appendChild(svg);

  // ── Content pane ─────────────────────────────
  if (isDetail && content?.pane) {
    const pane = buildPane(page, content, {
      PAGE_W,
      PAGE_H,
      GRID,
      HALF,
      headerHeight,
      footerHeight
    });

    page.appendChild(pane);
  }


  // Row numbers — suppressed on detail pages
  if (params.rowNumbers && !isDetail) {
    const rowCount = Math.floor(dotAreaHeight / GRID) - 1;
    for (let r = 0; r < rowCount; r++) {
      const rn = document.createElement('div');
      rn.style.cssText = `
        position: absolute;
        top: ${dotAreaTop + HALF + r * GRID}mm;
        left: ${HALF}mm;
        width: ${GRID}mm;
        height: ${GRID}mm;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 2.5mm;
        line-height: 1;
        color: ${params.rowNumberColor};
        font-family: 'JetBrains Mono', monospace;
      `;
      rn.textContent = String(r + 1);
      page.appendChild(rn);
    }
  }

  // Header line — drawn at the bottom edge of the header zone
  if (params.header && params.headerLine) {
    const hl = document.createElement('div');
    hl.style.cssText = `
      position: absolute;
      top: ${headerHeight}mm;
      left: 0;
      width: ${PAGE_W}mm;
      height: 0;
      border-top: ${params.headerLineWidth}mm solid ${params.headerLineColor};
    `;
    page.appendChild(hl);
  }

  // Footer line — drawn at the top edge of the footer zone
  if (params.footer && params.footerLine) {
    const fl = document.createElement('div');
    fl.style.cssText = `
      position: absolute;
      top: ${PAGE_H - footerHeight}mm;
      left: 0;
      width: ${PAGE_W}mm;
      height: 0;
      border-top: ${params.footerLineWidth}mm solid ${params.footerLineColor};
    `;
    page.appendChild(fl);
  }

  // Column line — individual circles every 2mm, aligned with grid dots.
  // Dots at y=2, 4, 6… mm (on grid dot rows and between them).
  if (params.columnLine && !isDetail && (params.columnLineSide === 'both' || side === 'right')) {
    const xPos  = PAGE_W - (params.columnLineCols * GRID) - HALF;
    const clSvg = document.createElementNS(svgNS, 'svg');
    clSvg.setAttribute('viewBox', `0 0 1 ${dotAreaHeight}`);
    clSvg.style.cssText = `
      position: absolute;
      top: ${dotAreaTop}mm;
      left: ${xPos}mm;
      width: 1mm;
      height: ${dotAreaHeight}mm;
      overflow: visible;
    `;

    const clDotCount = Math.floor((dotAreaHeight - GRID) / GRID) + 1;
    for (let i = 0; i < clDotCount; i++) {
      const clCircle = document.createElementNS(svgNS, 'circle');
      clCircle.setAttribute('cx', '0');
      clCircle.setAttribute('cy', String(GRID + i * GRID));
      clCircle.setAttribute('r',  String(dotRadius));
      clCircle.setAttribute('fill', params.columnLineColor);
      clSvg.appendChild(clCircle);
    }

    page.appendChild(clSvg);
  }

  // Quote — suppressed on detail pages and when flavour has no quotes
  if (params.footer && params.quotes && !isDetail) {
    const q = getQuote(pageNum);
    if (q) {
      const isLeft  = side === 'left';
      const qLeft   = isLeft ? GRID * 3 : GRID;
      const qRight  = isLeft ? GRID      : GRID * 3;
      const qDiv = document.createElement('div');
      qDiv.style.cssText = `
        position: absolute;
        top: ${PAGE_H - footerHeight}mm;
        left: ${qLeft}mm;
        right: ${qRight}mm;
        height: ${footerHeight}mm;
        display: flex;
        align-items: center;
        overflow: hidden;
        font-family: 'Lora', Georgia, serif;
        font-style: italic;
        font-size: 2mm;
        line-height: 2.6mm;
        color: ${params.quoteColor};
      `;
      qDiv.textContent = `${q.text} — ${q.author}`;
      page.appendChild(qDiv);
    }
  }

  // Page number — suppressed on detail pages
  if (params.footer && params.pageNumbers && !isDetail) {
    const pn = document.createElement('div');
    const isLeft = side === 'left';
    pn.style.cssText = `
      position: absolute;
      bottom: ${GRID}mm;
      ${isLeft ? `left: ${GRID}mm;` : `right: ${GRID}mm;`}
      width: ${GRID}mm;
      height: ${GRID}mm;
      display: flex;
      align-items: center;
      justify-content: ${isLeft ? 'flex-start' : 'flex-end'};
      font-size: 2.5mm;
      line-height: 1;
      color: #999999;
      font-family: 'JetBrains Mono', monospace;
    `;
    pn.textContent = String(pageNum);
    page.appendChild(pn);
  }

  return page;
}

// ── Map a slot number to a page descriptor ───────────────────
// Standard and extra detail pages are each independently togglable.
// Slot layout (each section only present if its toggle is on):
//   standard front (2) → extra front (n/2) → content → extra back (n/2) → standard back (2)
function slotDescriptor(slot, totalSlots) {
  const flavour       = flavours.find(f => f.id === params.flavourId) || flavours[0];
  const standardFront = params.detailPages ? 2 : 0;
  const extraFront    = params.extraDetailPagesOn ? flavour.extraDetailPages.length / 2 : 0;
  const standardBack  = params.detailPages ? 2 : 0;
  const extraBack     = params.extraDetailPagesOn ? flavour.extraDetailPages.length / 2 : 0;
  const contentStart  = standardFront + extraFront + 1;
  const contentEnd    = totalSlots - extraBack - standardBack;

  // Standard front: slots 1–standardFront
  if (params.detailPages && slot <= standardFront) {
    return { type: 'detail', source: 'standard', detailIndex: slot };
  }

  // Extra front: slots standardFront+1 to standardFront+extraFront
  if (params.extraDetailPagesOn && slot > standardFront && slot <= standardFront + extraFront) {
    return { type: 'detail', source: 'extra', detailIndex: slot - standardFront - 1 };
  }

  // Extra back: slots contentEnd+1 to contentEnd+extraBack
  if (params.extraDetailPagesOn && slot > contentEnd && slot <= contentEnd + extraBack) {
    return { type: 'detail', source: 'extra', detailIndex: extraFront + (slot - contentEnd - 1) };
  }

  // Standard back: slots contentEnd+extraBack+1 to totalSlots
  if (params.detailPages && slot > contentEnd + extraBack) {
    const backIndex = slot - (contentEnd + extraBack);  // 1 or 2
    return { type: 'detail', source: 'standard', detailIndex: backIndex === 1 ? 3 : 4 };
  }

  // Content pages
  return { type: 'content', num: slot - standardFront - extraFront };
}

// ── Build a spread wrapper ───────────────────────────────────
function buildSpread(leftSlot, rightSlot, totalSlots, wrapClass, labelText) {
  const wrap = document.createElement('div');
  wrap.className = wrapClass;

  const spread = document.createElement('div');
  spread.className = 'spread';
  spread.appendChild(buildPage(slotDescriptor(leftSlot,  totalSlots), 'left'));
  spread.appendChild(buildPage(slotDescriptor(rightSlot, totalSlots), 'right'));

  wrap.appendChild(spread);

  if (labelText) {
    const label = document.createElement('div');
    label.className = 'spread-label';
    label.textContent = labelText;
    wrap.appendChild(label);
  }

  return wrap;
}

// ── Update page size slider constraints based on grid size ───
// Reference targets (mm): width 72–96, height 148–192.
// Min/max are snapped to nearest multiple of gridSize.
// Current values are also snapped if they fall outside new bounds.
const PAGE_WIDTH_REF  = { min: 72,  max: 96,  default: 80  };
const PAGE_HEIGHT_REF = { min: 148, max: 192, default: 160 };

function snapToGrid(value, gridSize) {
  return Math.round(value / gridSize) * gridSize;
}

function updatePageSizeSliders(gridSize) {
  const wMin = snapToGrid(PAGE_WIDTH_REF.min,  gridSize);
  const wMax = snapToGrid(PAGE_WIDTH_REF.max,  gridSize);
  const hMin = snapToGrid(PAGE_HEIGHT_REF.min, gridSize);
  const hMax = snapToGrid(PAGE_HEIGHT_REF.max, gridSize);

  const wEl = document.getElementById('pageWidth');
  const hEl = document.getElementById('pageHeight');

  wEl.min  = wMin;  wEl.max  = wMax;  wEl.step = gridSize;
  hEl.min  = hMin;  hEl.max  = hMax;  hEl.step = gridSize;

  // Snap current values into new bounds
  const wVal = Math.min(wMax, Math.max(wMin, snapToGrid(parseInt(wEl.value), gridSize)));
  const hVal = Math.min(hMax, Math.max(hMin, snapToGrid(parseInt(hEl.value), gridSize)));
  wEl.value = wVal;
  hEl.value = hVal;

  document.getElementById('pageWidthDisplay').textContent  = wVal;
  document.getElementById('pageHeightDisplay').textContent = hVal;
  params.pageWidth  = wVal;
  params.pageHeight = hVal;
}

// ── Total slot count helper ──────────────────────────────────
function totalSlots() {
  const flavour       = flavours.find(f => f.id === params.flavourId) || flavours[0];
  const standardCount = params.detailPages ? 4 : 0;
  const extraCount    = params.extraDetailPagesOn ? flavour.extraDetailPages.length : 0;
  return params.pageCount + standardCount + extraCount;
}

// ── Render screen preview (reading order) ───────────────────
function renderScreen() {
  const preview = document.getElementById('preview');
  preview.innerHTML = '';
  const T = totalSlots();
  const spreadCount = T / 2;
  for (let s = 0; s < spreadCount; s++) {
    const l = s * 2 + 1;
    const r = s * 2 + 2;
    const ld = slotDescriptor(l, T);
    const rd = slotDescriptor(r, T);
    const label = ld.type === 'detail' && rd.type === 'detail'
      ? 'Detail spread'
      : `pp. ${ld.type === 'content' ? ld.num : '–'}–${rd.type === 'content' ? rd.num : '–'}`;
    preview.appendChild(buildSpread(l, r, T, 'spread-wrap', label));
  }
}

// ── Render print layout (saddle-stitch imposition order) ────
// For total T slots, sheet i (1-indexed):
//   Front spread: left = T+2−2i,  right = 2i−1
//   Back spread:  left = 2i,      right = T+1−2i
function renderPrint() {
  const pl = document.getElementById('print-layout');
  pl.innerHTML = '';
  const T = totalSlots();
  const sheetCount = T / 4;
  for (let i = 1; i <= sheetCount; i++) {
    const frontLeft  = T + 2 - 2 * i;
    const frontRight = 2 * i - 1;
    const backLeft   = 2 * i;
    const backRight  = T + 1 - 2 * i;
    pl.appendChild(buildSpread(frontLeft, frontRight, T, 'print-spread-wrap', null));
    pl.appendChild(buildSpread(backLeft,  backRight,  T, 'print-spread-wrap', null));
  }
}

// ── Render both ──────────────────────────────────────────────
function render() {
  readParams();
  renderScreen();
  renderPrint();
}

// ── Quote list — drag to reorder ─────────────────────────────
function renderQuoteList() {
  const container = document.getElementById('quoteList');
  if (!container) return;
  container.innerHTML = '';

  const flavour = flavours.find(f => f.id === params.flavourId) || flavours[0];
  if (!flavour.quotes || flavour.quotes.length === 0) {
    container.style.display = 'none';
    return;
  }
  container.style.display = 'flex';

  let dragSrcIndex = null;

  flavour.quotes.forEach((q, index) => {
    const item = document.createElement('div');
    item.className = 'quote-item';
    item.textContent = `${index + 1}. ${q.text} — ${q.author}`;
    item.draggable = true;
    item.dataset.index = index;

    item.addEventListener('dragstart', () => {
      dragSrcIndex = index;
      item.style.opacity = '0.5';
    });

    item.addEventListener('dragend', () => {
      item.style.opacity = '';
      container.querySelectorAll('.quote-item').forEach(el => el.classList.remove('drag-over'));
    });

    item.addEventListener('dragover', e => {
      e.preventDefault();
      container.querySelectorAll('.quote-item').forEach(el => el.classList.remove('drag-over'));
      item.classList.add('drag-over');
    });

    item.addEventListener('drop', e => {
      e.preventDefault();
      const targetIndex = parseInt(item.dataset.index);
      if (dragSrcIndex === null || dragSrcIndex === targetIndex) return;

      // Reorder the quotes array in place
      const moved = flavour.quotes.splice(dragSrcIndex, 1)[0];
      flavour.quotes.splice(targetIndex, 0, moved);

      renderQuoteList();
      render();
    });

    container.appendChild(item);
  });
}

// ── Collapsible sidebar sections ─────────────────────────────
document.querySelectorAll('.param-group h2').forEach(h2 => {
  h2.addEventListener('click', () => {
    h2.closest('.param-group').classList.toggle('collapsed');
  });
});

// ── Wire up all inputs ───────────────────────────────────────
document.querySelectorAll('#sidebar input, #sidebar select').forEach(el => {
  if (el.id === 'flavour') return; // handled separately
  el.addEventListener('input', render);
  el.addEventListener('change', render);
});

document.getElementById('flavour').addEventListener('change', function () {
  applyFlavour(this.value);
  renderQuoteList();
  render();
});

// ── Initial render ───────────────────────────────────────────
applyFlavour('gp');
updatePageSizeSliders(params.gridSize);
renderQuoteList();
render();