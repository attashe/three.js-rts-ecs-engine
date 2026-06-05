import test from 'node:test'
import assert from 'node:assert/strict'
import { EngineMetrics } from '../src/engine/metrics'

test('EngineMetrics snapshot exposes structured values without sharing maps', () => {
    let now = 0
    const metrics = new EngineMetrics(() => now)

    metrics.setGauge('render.calls', 12)
    metrics.incrementCounter('events', 2)
    metrics.recordRenderFrame(0.25)
    metrics.recordFixedStep()
    metrics.recordRenderFrame(0.25)
    metrics.timeSystem('render', 'renderSync', () => {
        now += 4
    })

    const snapshot = metrics.snapshot()

    assert.equal(snapshot.fps, 4)
    assert.equal(snapshot.fixedHz, 2)
    assert.equal(snapshot.lastRenderMs, 250)
    assert.deepEqual(snapshot.gauges, [['render.calls', 12]])
    assert.deepEqual(snapshot.counters, [['events', 2]])
    assert.equal(snapshot.timings.length, 1)
    assert.equal(snapshot.timings[0]?.name, 'renderSync')
    assert.equal(snapshot.timings[0]?.avgMs, 4)
})
