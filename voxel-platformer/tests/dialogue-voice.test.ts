import test from 'node:test'
import assert from 'node:assert/strict'
import { generateDialogueVoiceLine } from '../src/game/dialogue-voice/text'
import { normalizeDialogueVoice } from '../src/game/dialogue-voice/presets'
import { synthDialogueVoiceLine } from '../src/game/dialogue-voice/synth'

test('dialogue voice text mapping is deterministic by text, preset, and seed', () => {
    const voice = { preset: 'dwarf' as const, seed: 'keeper-arlen' }
    const a = generateDialogueVoiceLine('Welcome, traveler.', voice)
    const b = generateDialogueVoiceLine('Welcome, traveler.', voice)

    assert.equal(a.fantasyText, b.fantasyText)
    assert.equal(a.sequence.length, b.sequence.length)
    assert.ok(a.sequence.length > 0)
})

test('dialogue voice presets affect generated fantasy line', () => {
    const text = 'The bridge is older than the rain.'
    const dwarf = generateDialogueVoiceLine(text, { preset: 'dwarf', seed: 'same' })
    const elf = generateDialogueVoiceLine(text, { preset: 'elf', seed: 'same' })

    assert.notEqual(dwarf.fantasyText, elf.fantasyText)
})

test('dialogue voice synthesis returns finite normalized PCM', () => {
    const result = synthDialogueVoiceLine('Hold the bridge!', {
        preset: 'troll',
        seed: 'test-troll',
        volume: 0.5,
    })

    assert.equal(result.sampleRate, 32000)
    assert.ok(result.samples.length > 1000)
    assert.ok(result.duration > 0)
    let peak = 0
    for (const sample of result.samples) {
        assert.ok(Number.isFinite(sample))
        peak = Math.max(peak, Math.abs(sample))
    }
    assert.ok(peak <= 1)
    assert.ok(peak > 0.01)
})

test('dialogue voice normalization clamps author controls', () => {
    const voice = normalizeDialogueVoice({
        preset: 'player',
        volume: 5,
        rate: 10,
        pitchOffset: -100,
    })

    assert.equal(voice.preset, 'player')
    assert.equal(voice.volume, 1)
    assert.equal(voice.rate, 4)
    assert.equal(voice.pitchOffset, -36)
})
