import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  blockType,
  parseTableBody,
  serializeTableBody,
  tableRowCount,
  tableColCount,
  tableColWidths,
  tableColAligns,
  nextTableAlign,
  setTableSize,
  insertTableRowAt,
  removeTableRowAt,
  insertTableColAt,
  removeTableColAt,
} from '../src/course-builder/js/block-types.js';
import { parse as parseCard, serialize as serializeCard } from '../src/_lib/card-format.js';

describe('parseTableBody', () => {
  it('reads header, delimiter and rows', () => {
    assert.deepEqual(parseTableBody('| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |'), {
      header: ['A', 'B'],
      rows: [['1', '2'], ['3', '4']],
    });
  });

  it('returns a blank 3x3 grid for an empty body', () => {
    assert.deepEqual(parseTableBody(''), {
      header: ['', '', ''],
      rows: [['', '', ''], ['', '', ''], ['', '', '']],
    });
  });

  it('treats a delimiter-less body as headerless rows', () => {
    assert.deepEqual(parseTableBody('| a | b |\n| c | d |'), {
      header: ['', ''],
      rows: [['a', 'b'], ['c', 'd']],
    });
  });

  it('pads uneven rows out to the widest row', () => {
    assert.deepEqual(parseTableBody('| A |\n| --- |\n| 1 | 2 | 3 |'), {
      header: ['A', '', ''],
      rows: [['1', '2', '3']],
    });
  });
});

describe('serializeTableBody', () => {
  it('writes canonical markdown table syntax', () => {
    assert.equal(
      serializeTableBody({ header: ['A', 'B', 'C'], rows: [['1', '2', '3']] }),
      '| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |'
    );
  });

  it('round-trips parse output', () => {
    const body = '| A | B |\n| --- | --- |\n| 1 | 2 |';
    assert.equal(serializeTableBody(parseTableBody(body)), body);
  });

  it('keeps multi-line cell content on one body line', () => {
    const grid = { header: ['H'], rows: [['- a\n- b']] };
    const body = serializeTableBody(grid);
    assert.equal(body, '| H |\n| --- |\n| - a\\n- b |');
    assert.deepEqual(parseTableBody(body), grid);
  });

  it('tells an escaped backslash apart from an escaped newline', () => {
    const grid = { header: ['H', ''], rows: [['a\\nb', 'c\\d']] };
    assert.deepEqual(parseTableBody(serializeTableBody(grid)), grid);
  });
});

describe('positional edits', () => {
  const twoByTwo = () => ({ body: '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |' });

  it('inserts a blank row at the index, shifting the rest down', () => {
    const block = twoByTwo();
    insertTableRowAt(block, 1);
    assert.equal(block.body, '| A | B |\n| --- | --- |\n| 1 | 2 |\n|  |  |\n| 3 | 4 |');
  });

  it('removes exactly the indexed row', () => {
    const block = twoByTwo();
    removeTableRowAt(block, 0);
    assert.equal(block.body, '| A | B |\n| --- | --- |\n| 3 | 4 |');
  });

  it('ignores out-of-range removes', () => {
    const block = twoByTwo();
    removeTableRowAt(block, 9);
    assert.equal(block.body, twoByTwo().body);
  });

  it('inserts a blank column at the index, shifting the rest right', () => {
    const block = twoByTwo();
    insertTableColAt(block, 1);
    assert.equal(block.body, '| A |  | B |\n| --- | --- | --- |\n| 1 |  | 2 |\n| 3 |  | 4 |');
  });

  it('removes exactly the indexed column, header cell included', () => {
    const block = twoByTwo();
    removeTableColAt(block, 0);
    assert.equal(block.body, '| B |\n| --- |\n| 2 |\n| 4 |');
  });
});

describe('column widths', () => {
  it('defaults to uniform and repairs short, long and garbage arrays', () => {
    assert.deepEqual(tableColWidths({}, 3), [1, 1, 1]);
    assert.deepEqual(tableColWidths({ widths: [2] }, 3), [2, 2, 2]);
    assert.deepEqual(tableColWidths({ widths: [2, 1, 1, 1] }, 2), [2, 1]);
    assert.deepEqual(tableColWidths({ widths: ['x', -1, 0] }, 2), [1, 1]);
  });

  it('follows column insert/remove', () => {
    const block = { body: '| A | B |\n| --- | --- |\n| 1 | 2 |', widths: [2, 1] };
    insertTableColAt(block, 1);
    assert.deepEqual(block.widths, [2, 1.5, 1]);
    removeTableColAt(block, 0);
    assert.deepEqual(block.widths, [1.5, 1]);
  });

  it('omits uniform widths from the fence line', () => {
    const format = blockType('table').format;
    assert.deepEqual(format.toAttrs({ widths: [1, 1] }), []);
    assert.deepEqual(format.toAttrs({}), []);
    assert.deepEqual(format.toAttrs({ widths: [2, 1] }), [['widths', '2|1']]);
  });

  it('reads widths back, ignoring garbage', () => {
    const format = blockType('table').format;
    const block = {};
    assert.deepEqual(format.fromAttrs({ widths: '2|1' }, block), ['widths']);
    assert.deepEqual(block.widths, [2, 1]);
    const bare = {};
    assert.deepEqual(format.fromAttrs({}, bare), []);
    assert.equal(bare.widths, undefined);
  });

  it('round-trips body and widths through card markdown', () => {
    const block = {
      type: 'table', h: 4,
      body: '| A | B |\n| --- | --- |\n| 1 | 2 |',
      widths: [2, 1],
    };
    const text = serializeCard({ frontmatter: {}, blocks: [block] });
    assert.ok(text.includes('widths=2|1'));
    const back = parseCard(text).blocks[0];
    assert.equal(back.body, block.body);
    assert.deepEqual(back.widths, [2, 1]);
  });

  it('leaves untouched tables with a bare fence', () => {
    const text = serializeCard({ frontmatter: {}, blocks: [{ type: 'table', h: 4, body: '| A |\n| --- |\n| 1 |' }] });
    assert.ok(!text.includes('widths='));
  });
});

describe('column alignment', () => {
  it('defaults to left and repairs short, long and garbage arrays', () => {
    assert.deepEqual(tableColAligns({}, 2), ['left', 'left']);
    assert.deepEqual(tableColAligns({ align: ['center'] }, 2), ['center', 'left']);
    assert.deepEqual(tableColAligns({ align: ['center', 'right', 'left'] }, 2), ['center', 'right']);
    assert.deepEqual(tableColAligns({ align: ['bogus', null] }, 2), ['left', 'left']);
  });

  it('cycles left -> center -> right -> left', () => {
    assert.equal(nextTableAlign('left'), 'center');
    assert.equal(nextTableAlign('center'), 'right');
    assert.equal(nextTableAlign('right'), 'left');
    assert.equal(nextTableAlign('bogus'), 'left');
  });

  it('follows column insert/remove', () => {
    const block = { body: '| A | B |\n| --- | --- |\n| 1 | 2 |', align: ['center', 'left'] };
    insertTableColAt(block, 1);
    assert.deepEqual(block.align, ['center', 'left', 'left']);
    removeTableColAt(block, 0);
    assert.deepEqual(block.align, ['left', 'left']);
  });

  it('omits all-left alignment from the fence line', () => {
    const format = blockType('table').format;
    assert.deepEqual(format.toAttrs({ align: ['left', 'left'] }), []);
    assert.deepEqual(format.toAttrs({ align: ['center', 'left'] }), [['align', 'center|left']]);
    assert.deepEqual(
      format.toAttrs({ widths: [2, 1], align: ['left', 'right'] }),
      [['widths', '2|1'], ['align', 'left|right']]
    );
  });

  it('reads alignment back, mapping garbage to left in place', () => {
    const format = blockType('table').format;
    const block = {};
    assert.deepEqual(format.fromAttrs({ align: 'center|bogus' }, block), ['align']);
    assert.deepEqual(block.align, ['center', 'left']);
  });

  it('round-trips widths and alignment through card markdown', () => {
    const block = {
      type: 'table', h: 4,
      body: '| A | B |\n| --- | --- |\n| 1 | 2 |',
      widths: [2, 1], align: ['left', 'right'],
    };
    const text = serializeCard({ frontmatter: {}, blocks: [block] });
    assert.ok(text.includes('widths=2|1'));
    assert.ok(text.includes('align=left|right'));
    const back = parseCard(text).blocks[0];
    assert.deepEqual(back.widths, [2, 1]);
    assert.deepEqual(back.align, ['left', 'right']);
  });
});

describe('counts', () => {
  it('reads rows and columns off the body', () => {
    const block = { body: '| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |' };
    assert.equal(tableRowCount(block), 2);
    assert.equal(tableColCount(block), 3);
  });

  it('defaults an empty block to 3 rows', () => {
    assert.equal(tableRowCount({}), 3);
    assert.equal(tableColCount({}), 3);
  });
});

describe('setTableSize', () => {
  it('grows with blanks and trims off the end, keeping content', () => {
    const block = { body: '| A |\n| --- |\n| 1 |' };
    setTableSize(block, 2, 2);
    assert.equal(block.body, '| A |  |\n| --- | --- |\n| 1 |  |\n|  |  |');
    setTableSize(block, 1, 1);
    assert.equal(block.body, '| A |\n| --- |\n| 1 |');
  });
});
