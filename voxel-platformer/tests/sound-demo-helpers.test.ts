import test from 'node:test'
import assert from 'node:assert/strict'
import { formatBytes, makeLocalAssetId } from '../src/sound-demo/local-assets'
import { ampToDb, computePeaks, formatDb, meterFromTimeDomain } from '../src/sound-demo/waveform'

test('makeLocalAssetId sanitizes names and avoids collisions', () => {
    const existing = new Set(['local.hit', 'local.hit-2'])

    assert.equal(makeLocalAssetId('Hit.wav', existing), 'local.hit-3')
    assert.equal(makeLocalAssetId('  Weird Clip!!.mp3', new Set()), 'local.weird-clip')
    assert.equal(makeLocalAssetId('...wav', new Set()), 'local.clip')
})

test('formatBytes uses compact binary units', () => {
    assert.equal(formatBytes(0), '0 B')
    assert.equal(formatBytes(512), '512 B')
    assert.equal(formatBytes(2048), '2.0 KB')
    assert.equal(formatBytes(2 * 1024 * 1024), '2.0 MB')
})

test('computePeaks downsamples min/max ranges deterministically', () => {
    const peaks = computePeaks(new Float32Array([-1, -0.5, 0.25, 1, 0, 0.5]), 3)

    assert.deepEqual([...peaks.min], [-1, 0.25, 0])
    assert.deepEqual([...peaks.max], [-0.5, 1, 0.5])
})

test('meterFromTimeDomain reports peak, rms and clipping', () => {
    const meter = meterFromTimeDomain(new Uint8Array([128, 255, 1, 128]))

    assert.ok(meter.peak > 0.98)
    assert.ok(meter.rms > 0.6)
    assert.equal(meter.clipping, true)
    assert.equal(formatDb(-Infinity), '-∞ dB')
    assert.equal(formatDb(ampToDb(1)), '0.0 dB')
})
