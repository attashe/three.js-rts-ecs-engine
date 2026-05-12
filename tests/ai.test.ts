import test from 'node:test'
import assert from 'node:assert/strict'
import { addEntity } from 'bitecs'
import {
    advanceScheduleStep,
    assignAiSchedule,
    defineAiSchedule,
    defineAiZone,
    isPointInZone,
    sampleZonePoint,
    tickAiSchedule,
    type AiScheduleAssignment,
} from '../src/client/engine/ecs/ai'
import { createGameWorld } from '../src/client/engine/ecs/world'

test('AI zones support circular and rectangular containment', () => {
    assert.equal(isPointInZone({
        id: 'home',
        center: { x: 10, y: 1, z: 10 },
        radius: 3,
    }, { x: 12, y: 1, z: 11 }), true)

    assert.equal(isPointInZone({
        id: 'yard',
        center: { x: 0, y: 1, z: 0 },
        rect: { minX: -2, minZ: -3, maxX: 2, maxZ: 3 },
    }, { x: 2.5, y: 1, z: 0 }), false)
})

test('AI zone sampling is deterministic and stays inside the zone', () => {
    const zone = {
        id: 'work',
        center: { x: 20, y: 5, z: 12 },
        rect: { minX: 18, minZ: 10, maxX: 24, maxZ: 16 },
    }
    const a = sampleZonePoint(zone, 42)
    const b = sampleZonePoint(zone, 42)

    assert.deepEqual(a, b)
    assert.equal(isPointInZone(zone, a), true)
    assert.equal(a.y, 5)
})

test('AI schedule assignment ticks and loops through steps', () => {
    const world = createGameWorld()
    defineAiSchedule(world, {
        id: 'worker',
        steps: [
            { id: 'home', kind: 'idle', duration: 1 },
            { id: 'work', kind: 'travelZone', zoneId: 'work', duration: 1 },
        ],
    })
    const eid = addEntity(world)
    const assignment = assignAiSchedule(world, eid, 'worker')

    assert.equal(tickAiSchedule(world, eid, 0.5)?.step.id, 'home')
    assert.equal(tickAiSchedule(world, eid, 0.6)?.step.id, 'work')
    assert.equal(assignment.stepIndex, 1)
    assert.equal(tickAiSchedule(world, eid, 1.1)?.step.id, 'home')
    assert.equal(assignment.stepIndex, 0)
})

test('AI non-looping schedule holds on final step', () => {
    const world = createGameWorld()
    defineAiSchedule(world, {
        id: 'one-shot',
        loop: false,
        steps: [
            { id: 'move', kind: 'travelZone', zoneId: 'target', duration: 0.1 },
            { id: 'hold', kind: 'idle' },
        ],
    })
    const eid = addEntity(world)
    const assignment: AiScheduleAssignment = assignAiSchedule(world, eid, 'one-shot')
    const schedule = world.aiSchedules.get('one-shot')!

    advanceScheduleStep(assignment, schedule)
    advanceScheduleStep(assignment, schedule)

    assert.equal(assignment.stepIndex, 1)
})

test('AI world stores named zones and schedules', () => {
    const world = createGameWorld()
    defineAiZone(world, {
        id: 'village',
        center: { x: 30, y: 5, z: 30 },
        radius: 6,
    })
    defineAiSchedule(world, {
        id: 'guard-patrol',
        steps: [{ id: 'patrol', kind: 'patrolRoute', points: [{ x: 1, y: 1, z: 1 }] }],
    })

    assert.equal(world.aiZones.has('village'), true)
    assert.equal(world.aiSchedules.has('guard-patrol'), true)
})
