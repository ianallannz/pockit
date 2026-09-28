import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasUserData,
  summarizeStateCounts,
  summarizeStateDetail,
  decideStorageSwitch,
  buildStorageConflictMessage,
  isRemoteNewer,
  buildCloudRefreshMessage,
} from '../src/course-builder/js/storage/storage-switch-guard.js';

const empty = { courses: [] };
const local = { courses: [{ id: 1, params: { courseCode: 'TST', courseName: 'Test course' }, lessons: [{ id: 1, cards: [{ id: 1 }] }] }] };
const cloud = { courses: [{ id: 9, params: { courseCode: 'BIO', courseName: 'Bio 101' }, lessons: [{ id: 1, cards: [{}, {}, {}, {}, {}] }] }] };

describe('hasUserData', () => {
  it('treats any saved course as data', () => {
    assert.equal(hasUserData(empty), false);
    assert.equal(hasUserData(null), false);
    assert.equal(hasUserData({}), false);
    assert.equal(hasUserData(local), true);
  });
});

describe('summarize', () => {
  it('counts courses, lessons and cards', () => {
    assert.equal(summarizeStateCounts(cloud), '1 course · 1 lesson · 5 cards');
  });
  it('names courses in the detail line', () => {
    assert.ok(summarizeStateDetail(cloud).includes('BIO · Bio 101'));
  });
});

describe('decideStorageSwitch', () => {
  it('routes the four combinations without ever overwriting remote', () => {
    assert.equal(decideStorageSwitch(empty, empty), 'nothing');
    assert.equal(decideStorageSwitch(empty, null), 'nothing');
    assert.equal(decideStorageSwitch(local, empty), 'seed-remote');
    assert.equal(decideStorageSwitch(local, null), 'seed-remote');
    assert.equal(decideStorageSwitch(empty, cloud), 'adopt-remote');
    assert.equal(decideStorageSwitch(local, cloud), 'confirm');
  });
});

describe('isRemoteNewer', () => {
  it('compares ISO stamps and fails closed', () => {
    assert.equal(isRemoteNewer(null, '2026-09-28T10:00:00.000Z'), true);
    assert.equal(isRemoteNewer('2026-09-28T10:00:00.000Z', '2026-09-28T11:00:00.000Z'), true);
    assert.equal(isRemoteNewer('2026-09-28T11:00:00.000Z', '2026-09-28T11:00:00.000Z'), false);
    assert.equal(isRemoteNewer('2026-09-28T11:00:00.000Z', '2026-09-28T10:00:00.000Z'), false);
    assert.equal(isRemoteNewer('2026-09-28T11:00:00.000Z', null), false);
    assert.equal(isRemoteNewer('2026-09-28T11:00:00.000Z', 'not-a-date'), false);
  });
});

describe('messages', () => {
  it('names both sides of a switch conflict', () => {
    const msg = buildStorageConflictMessage({ remoteKind: 'cloud', remoteState: cloud, localState: local });
    assert.ok(msg.includes('cloud account already has'));
    assert.ok(msg.includes('replace what is shown'));
  });
  it('says refresh discards local edits and never pushes', () => {
    const msg = buildCloudRefreshMessage({ remoteState: cloud, localState: local });
    assert.ok(msg.includes('newer changes'));
    assert.ok(msg.includes('unsaved edits'));
  });
});
