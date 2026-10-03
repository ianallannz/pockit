import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isReservedSlug,
  collectShortlinks,
  findLocalDuplicates,
  publishShortlinks,
  claimShortlink,
} from '../src/course-builder/js/storage/shortlinks.js';

const linkBlock = (slug, url) => ({ id: 1, type: 'qr', slug, url });
const stateWith = (blocks) => ({
  courses: [{ id: 1, params: {}, lessons: [{ id: 1, cards: [{ id: 1, blocks }] }] }],
});

// Minimal chainable PostgREST mock: from() ignores the table, each terminal
// method returns its queued { data } in call order.
function mockClient(queued) {
  const calls = [];
  const queue = [...queued];
  const builder = {
    select() { return builder; },
    eq() { return builder; },
    in() { return builder; },
    maybeSingle() { calls.push('maybeSingle'); return Promise.resolve(queue.shift()); },
    upsert() { calls.push('upsert'); return Promise.resolve(queue.shift() ?? { data: null }); },
    delete() { return builder; },
    then(resolve) { return Promise.resolve(queue.shift()).then(resolve); },
  };
  return { client: { from: () => builder }, calls };
}

describe('isReservedSlug', () => {
  it('blocks real site paths', () => {
    assert.equal(isReservedSlug('course-builder'), true);
    assert.equal(isReservedSlug('example'), true);
    assert.equal(isReservedSlug('sh35'), false);
  });
});

describe('collectShortlinks', () => {
  it('collects slug+url pairs, first occurrence wins, skips incomplete', () => {
    const entries = collectShortlinks(stateWith([
      linkBlock('sh35', 'https://a.example/'),
      linkBlock('sh35', 'https://b.example/'),
      linkBlock('noslug', ''),
      linkBlock('', 'https://c.example/'),
      linkBlock('  Spaced Name ', 'https://d.example/'),
    ]));
    assert.deepEqual(entries, [
      { slug: 'sh35', url: 'https://a.example/' },
      { slug: 'spaced-name', url: 'https://d.example/' },
    ]);
  });
});

describe('findLocalDuplicates', () => {
  it('reports slugs pointing at two URLs', () => {
    const dupes = findLocalDuplicates(stateWith([
      linkBlock('sh35', 'https://a.example/'),
      linkBlock('sh35', 'https://b.example/'),
      linkBlock('fine', 'https://a.example/'),
    ]));
    assert.deepEqual(dupes, [{ slug: 'sh35', urls: ['https://a.example/', 'https://b.example/'] }]);
  });
});

describe('publishShortlinks', () => {
  it('upserts mine, prunes stale owned rows, reports others-claimed', async () => {
    const { client, calls } = mockClient([
      { data: [{ slug: 'taken', owner_id: 'someone-else' }] }, // existing
      { data: [{ slug: 'mine' }, { slug: 'old' }] },           // owned
      { data: null },                                          // upsert
      { data: null },                                          // delete
    ]);
    const result = await publishShortlinks(client, 'me', [
      { slug: 'mine', url: 'https://mine.example/' },
      { slug: 'taken', url: 'https://taken.example/' },
    ]);
    assert.deepEqual(result, { published: 1, removed: 1, conflicts: ['taken'] });
    assert.ok(calls.includes('upsert'));
  });

  it('prunes everything when no entries remain', async () => {
    const { client } = mockClient([
      { data: [{ slug: 'old' }] }, // owned
      { data: null },              // delete
    ]);
    const result = await publishShortlinks(client, 'me', []);
    assert.deepEqual(result, { published: 0, removed: 1, conflicts: [] });
  });
});

describe('claimShortlink', () => {
  it('claims free slugs and refuses taken/reserved ones', async () => {
    const free = mockClient([{ data: null }, { data: null }]);
    assert.deepEqual(
      await claimShortlink(free.client, 'me', 'sh35', 'https://a.example/'),
      { ok: true }
    );

    const taken = mockClient([{ data: { slug: 'sh35', owner_id: 'someone-else' } }]);
    assert.deepEqual(
      await claimShortlink(taken.client, 'me', 'sh35', 'https://a.example/'),
      { ok: false, reason: 'claimed' }
    );

    assert.deepEqual(
      await claimShortlink(free.client, 'me', 'course-builder', 'https://a.example/'),
      { ok: false, reason: 'reserved' }
    );
    assert.deepEqual(
      await claimShortlink(free.client, 'me', 'sh35', ''),
      { ok: false, reason: 'no-url' }
    );
  });
});
