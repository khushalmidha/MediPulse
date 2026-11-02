import test from 'node:test'
import assert from 'node:assert/strict'
import { watchedDelta } from './reelsPlayback.js'
const visible = { active: true, hidden: false, paused: false, seeking: false }
test('watch accounting uses actual media progress and rejects missing or jumping positions', () => {
  assert.equal(watchedDelta(1, 1.25, visible), 250)
  for (const current of [1, 0, 50, Infinity, NaN]) assert.equal(watchedDelta(1, current, visible), 0)
})
test('hidden, offscreen, paused and seeking playback never accumulates watch time', () => {
  for (const state of [{ active: false }, { hidden: true }, { paused: true }, { seeking: true }]) {
    assert.equal(watchedDelta(1, 1.25, { ...visible, ...state }), 0)
  }
})
