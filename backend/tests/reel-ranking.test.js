import test from 'node:test';
import assert from 'node:assert/strict';
import { cosine, interestVector, rankReels } from '../services/reelRanking.js';

const now = Date.parse('2026-10-31T12:00:00Z');
const day = 86400000;
const reel = (id, overrides = {}) => ({ _id: id, doctorId: `doctor-${id}`, title: id, topics: [], duration: 20, embedding: [1, 0, 0], publishedAt: new Date(now), counts: {}, ...overrides });
const ids = rows => rows.map(row => row._id);
const ranked = (rows, options = {}) => rankReels(rows, { now, ...options });

test('cosine handles scale, opposite vectors and unusable vector data safely', () => {
  assert.equal(cosine([1, 0], [7, 0]), 1);
  assert.equal(cosine([1, 0], [-1, 0]), -1);
  assert.equal(cosine([1, 0], [0, 1]), 0);
  for (const [a, b] of [[[], []], [[0, 0], [1, 2]], [[1], [1, 2]], [[NaN], [1]], [[1], [Infinity]]]) assert.equal(cosine(a, b), 0);
});

test('synthetic multilingual semantic vectors rank related Hindi content above unrelated English content', () => {
  // These hand-authored vectors exercise ranking only; they do not validate an HF model.
  const history = [{ reel: reel('english-history', { title: 'Heart health', embedding: [1, 0, 0] }), liked: true }];
  const vector = interestVector(history, now);
  const hindi = reel('hindi', { title: 'हृदय स्वास्थ्य', language: 'hi', embedding: [0.98, 0.02, 0] });
  const unrelated = reel('english', { title: 'Skin care', language: 'en', embedding: [0, 1, 0] });
  assert.deepEqual(ids(ranked([unrelated, hindi], { vector })), ['hindi', 'english']);
});

test('watched, liked and saved public reels build a normalized interest vector', () => {
  const a = reel('a', { embedding: [1, 0, 0] }); const b = reel('b', { embedding: [0, 1, 0] });
  const vector = interestVector([{ reel: a, signal: { watchMs: 20000, lastSeenAt: new Date(now) }, liked: true, saved: true }, { reel: b, signal: { watchMs: 20000, lastSeenAt: new Date(now) } }], now);
  assert.ok(Math.abs(Math.hypot(...vector) - 1) < 1e-12);
  assert.ok(cosine(vector, a.embedding) > cosine(vector, b.embedding));
  assert.deepEqual(interestVector([], now), []);
  assert.deepEqual(interestVector([{ reel: {} }], now), []);
});

test('recent engagement outweighs equal stale engagement', () => {
  const vector = interestVector([
    { reel: reel('recent', { embedding: [1, 0, 0] }), liked: true, signal: { lastSeenAt: new Date(now) } },
    { reel: reel('old', { embedding: [0, 1, 0] }), liked: true, signal: { lastSeenAt: new Date(now - 60 * day) } },
  ], now);
  assert.ok(vector[0] > vector[1]);
});

test('follow and selected topic preferences influence otherwise equal candidates', () => {
  assert.equal(ranked([reel('a'), reel('z', { doctorId: 'followed' })], { followed: ['followed'] })[0]._id, 'z');
  assert.equal(ranked([reel('a'), reel('z', { topics: ['prevention'] })], { topics: ['prevention'] })[0]._id, 'z');
});

test('cold start uses recency and smoothed public quality without an interest vector', () => {
  assert.equal(ranked([reel('a', { publishedAt: new Date(now - 60 * day) }), reel('z')])[0]._id, 'z');
  assert.equal(ranked([reel('a'), reel('z', { counts: { views: 200, likes: 60, saves: 30 } })])[0]._id, 'z');
  assert.equal(ranked([reel('a', { counts: { views: 1, likes: 1 } }), reel('z', { counts: { views: 200, likes: 60, saves: 30 } })])[0]._id, 'z');
});

test('repeated skips and previous exposure lower the same candidate', () => {
  const rows = [reel('a'), reel('z')];
  assert.equal(ranked(rows)[0]._id, 'a');
  assert.equal(ranked(rows, { signals: new Map([['a', { skips: 3 }]]) })[0]._id, 'z');
  assert.equal(ranked(rows, { signals: new Map([['a', { lastSeenAt: new Date(now) }]]) })[0]._id, 'z');
});

test('skip-only feedback moves interest away from the skipped semantic direction', () => {
  const vector = interestVector([{ reel: reel('skipped'), signal: { skips: 2, watchMs: 0, lastSeenAt: new Date(now) } }], now);
  assert.ok(cosine(vector, [1, 0, 0]) < 0);
  assert.equal(ranked([reel('a'), reel('z', { embedding: [0, 1, 0] })], { vector })[0]._id, 'z');
});

test('equally relevant creators and topics diversify without losing candidates', () => {
  const candidates = [reel('a', { doctorId: 'same', topics: ['heart'] }), reel('b', { doctorId: 'same', topics: ['heart'] }), reel('c', { doctorId: 'other', topics: ['skin'] }), reel('d', { doctorId: 'third', topics: ['sleep'] })];
  const result = ranked(candidates);
  assert.equal(result[0]._id, 'a');
  assert.notEqual(result[1].doctorId, result[0].doctorId);
  assert.notDeepEqual(result[1].topics, result[0].topics);
  assert.deepEqual(ids(result).sort(), ids(candidates).sort());
});

test('ranking is deterministic across input order and preserves input records', () => {
  const candidates = [reel('d'), reel('b'), reel('c'), reel('a'), reel('f'), reel('e')];
  const snapshot = structuredClone(candidates);
  const result = ids(ranked(candidates));
  assert.deepEqual(ids(ranked([...candidates].reverse())), result);
  assert.deepEqual(ids(ranked(candidates)), result);
  assert.deepEqual(candidates, snapshot);
});
