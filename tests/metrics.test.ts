import test from 'node:test'
import assert from 'node:assert/strict'
import { EngineMetrics } from '../src/client/engine/metrics'

test('EngineMetrics records system timing without swallowing return values', () => {
    let now = 10
    const metrics = new EngineMetrics(() => now)

    const value = metrics.timeSystem('fixed', 'physics', () => {
        now += 4
        return 42
    })

    assert.equal(value, 42)
    assert.deepEqual(metrics.timingSnapshot(), [
        {
            phase: 'fixed',
            name: 'physics',
            calls: 1,
            lastMs: 4,
            avgMs: 4,
            maxMs: 4,
        },
    ])
})

test('EngineMetrics reports render and fixed sample rates', () => {
    const metrics = new EngineMetrics(() => 0)

    for (let i = 0; i < 31; i++) {
        metrics.recordFixedStep()
        metrics.recordRenderFrame(1 / 60)
    }

    const lines = metrics.summaryLines({ systemCount: 0 })
    assert.match(lines[0]!, /fps:60/)
    assert.match(lines[0]!, /fixed:60/)
})

test('EngineMetrics exposes gauges and counters in summary lines', () => {
    const metrics = new EngineMetrics(() => 0)

    metrics.setGauge('debug.labels', 5)
    metrics.incrementCounter('path.requests', 2)
    metrics.incrementCounter('path.requests')

    const lines = metrics.summaryLines({ systemCount: 0 })
    assert.ok(lines.some((line) => line.includes('debug.labels:5.00')))
    assert.ok(lines.some((line) => line.includes('path.requests:3.00')))
})
