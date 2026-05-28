import test from 'node:test'
import assert from 'node:assert/strict'
import { nextStoneEditorId, normalizeStoneEditorId } from '../src/editor/stone-ids'

test('stone editor ids stay unique and recover blank ids', () => {
    assert.equal(nextStoneEditorId(['stone-1', 'stone-2'], 'stone'), 'stone-3')
    assert.equal(nextStoneEditorId(['stone-spawner-1'], 'stone-spawner'), 'stone-spawner-2')

    assert.equal(normalizeStoneEditorId('stone.A', undefined, ['stone.A'], 'stone'), 'stone.A-2')
    assert.equal(normalizeStoneEditorId('stone.A', 'stone.A', ['stone.A'], 'stone'), 'stone.A')
    assert.equal(normalizeStoneEditorId('', 'stone-5', ['stone-1', 'stone-5'], 'stone'), 'stone-2')
})
