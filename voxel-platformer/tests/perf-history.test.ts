import test from 'node:test'
import assert from 'node:assert/strict'
import { MetricHistory } from '../src/engine/perf-history'

test('MetricHistory stores latest value and aggregate stats', () => {
    const history = new MetricHistory(4)
    history.push(10)
    history.push(20)
    history.push(30)

    assert.deepEqual(history.stats(), {
        latest: 30,
        count: 3,
        validCount: 3,
        avg: 20,
        min: 10,
        max: 30,
    })
})

test('MetricHistory wraps in chronological order', () => {
    const history = new MetricHistory(3)
    history.push(1)
    history.push(2)
    history.push(3)
    history.push(4)

    const values: Array<number | null> = []
    history.forEachSample((value) => values.push(value))

    assert.deepEqual(values, [2, 3, 4])
    assert.deepEqual(history.stats(), {
        latest: 4,
        count: 3,
        validCount: 3,
        avg: 3,
        min: 2,
        max: 4,
    })
})

test('MetricHistory tolerates missing samples', () => {
    const history = new MetricHistory(3)
    history.push(10)
    history.push(undefined)
    history.push(Number.NaN)

    const values: Array<number | null> = []
    history.forEachSample((value) => values.push(value))

    assert.deepEqual(values, [10, null, null])
    assert.deepEqual(history.stats(), {
        latest: null,
        count: 3,
        validCount: 1,
        avg: 10,
        min: 10,
        max: 10,
    })
})
