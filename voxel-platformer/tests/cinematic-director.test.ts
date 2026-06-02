import test from 'node:test'
import assert from 'node:assert/strict'
import { CinematicDirector } from '../src/game/cinematics/cinematic-director'
import type { CinematicStage } from '../src/game/cinematics/cinematic-stage'
import type { CameraShot, Cinematic, Vec3 } from '../src/game/cinematics/cinematic-types'

interface RecordedEvent { at: number; kind: string; detail?: string }

interface Harness {
    stage: CinematicStage
    clock: { t: number }
    events: RecordedEvent[]
    lastShot: CameraShot
    /** Drives `update(dt)` + microtask flushes until `play()` resolves. */
    run(p: Promise<void>, opts?: { dt?: number; onTick?: () => void }): Promise<number>
}

function makeHarness(initial?: Partial<CameraShot>): Harness {
    const clock = { t: 0 }
    const events: RecordedEvent[] = []
    const state = {
        lastShot: {
            position: { x: 0, y: 0, z: 0 },
            target: { x: 0, y: 0, z: 0 },
            zoom: 1,
            ...initial,
        } as CameraShot,
    }
    const dist = new Map<string, () => number | null>()
    const stage: CinematicStage = {
        captureCamera: () => ({
            position: { ...state.lastShot.position },
            target: { ...state.lastShot.target },
            zoom: state.lastShot.zoom,
        }),
        applyCamera: (shot) => {
            state.lastShot = { position: { ...shot.position }, target: { ...shot.target }, zoom: shot.zoom }
            events.push({ at: clock.t, kind: 'camera', detail: String(shot.zoom) })
        },
        beginCameraOverride: () => events.push({ at: clock.t, kind: 'overrideOn' }),
        endCameraOverride: () => events.push({ at: clock.t, kind: 'overrideOff' }),
        setLetterbox: (on) => events.push({ at: clock.t, kind: on ? 'letterboxOn' : 'letterboxOff' }),
        showSubtitle: (text, speaker) => events.push({ at: clock.t, kind: 'subtitle', detail: speaker ? `${speaker}: ${text}` : text }),
        clearSubtitle: () => events.push({ at: clock.t, kind: 'subtitleClear' }),
        setFade: (a) => events.push({ at: clock.t, kind: 'fade', detail: a.toFixed(2) }),
        moveNpc: (id) => events.push({ at: clock.t, kind: 'move', detail: id }),
        npcDistanceTo: (id) => (dist.get(id)?.() ?? null),
        npcDisplayName: (id) => `Name(${id})`,
        playSound: (id) => events.push({ at: clock.t, kind: 'sound', detail: id }),
        freezePlayer: (on) => events.push({ at: clock.t, kind: on ? 'freezeOn' : 'freezeOff' }),
    }
    // Expose a way for tests to script NPC distances over time.
    ;(stage as unknown as { setDistance: (id: string, fn: () => number | null) => void }).setDistance = (id, fn) => dist.set(id, fn)

    return {
        stage,
        clock,
        events,
        get lastShot() { return state.lastShot },
        async run(p, opts = {}) {
            const dt = opts.dt ?? 1 / 60
            let finished = false
            void p.then(() => { finished = true })
            let iters = 0
            while (!finished && iters < 200_000) {
                clock.t += dt
                opts.onTick?.()
                director.update(dt)
                await new Promise((r) => setImmediate(r))
                iters++
            }
            await p
            return clock.t
        },
    } as Harness & { lastShot: CameraShot }
}

let director: CinematicDirector // assigned per test via the harness closure

function setup(initial?: Partial<CameraShot>): Harness {
    const h = makeHarness(initial)
    director = new CinematicDirector(h.stage)
    return h
}

const SHOT = (zoom: number, x = 0): CameraShot => ({ position: { x, y: 0, z: 0 }, target: { x, y: 0, z: 0 }, zoom })

test('sequential wait steps run in order and take the summed time', async () => {
    const h = setup()
    const c: Cinematic = { id: 'c', name: 'seq', letterbox: false, freezePlayer: false, steps: [
        { id: 'a', type: 'wait', wait: true, duration: 1 },
        { id: 'b', type: 'wait', wait: true, duration: 0.5 },
    ] }
    const end = await h.run(director.play(c))
    assert.ok(Math.abs(end - 1.5) < 0.1, `expected ~1.5s, got ${end}`)
    assert.equal(director.isPlaying, false)
})

test('a non-wait (‖) step overlaps the steps after it', async () => {
    const h = setup()
    const c: Cinematic = { id: 'c', name: 'par', letterbox: false, freezePlayer: false, steps: [
        { id: 'sub', type: 'subtitle', wait: false, duration: 3, text: 'long' },
        { id: 'w', type: 'wait', wait: true, duration: 1 },
    ] }
    const end = await h.run(director.play(c))
    // Subtitle (3s, concurrent) outlasts the 1s wait → total ≈ 3s.
    assert.ok(Math.abs(end - 3) < 0.15, `expected ~3s, got ${end}`)
    const shown = h.events.find((e) => e.kind === 'subtitle')
    const cleared = h.events.find((e) => e.kind === 'subtitleClear')
    assert.ok(shown && shown.at < 0.1, 'subtitle shown at the start')
    assert.ok(cleared && Math.abs(cleared.at - 3) < 0.15, 'subtitle cleared at ~3s')
})

test('camera step tweens to the exact target shot', async () => {
    const h = setup({ zoom: 1 })
    const c: Cinematic = { id: 'c', name: 'cam', letterbox: false, freezePlayer: false, steps: [
        { id: 'cam', type: 'camera', wait: true, duration: 1, ease: 'linear', shot: SHOT(3, 10) },
    ] }
    await h.run(director.play(c))
    // After completion the camera is restored to the captured start (zoom 1),
    // but the tween must have reached zoom 3 at its peak before restore.
    const peak = Math.max(...h.events.filter((e) => e.kind === 'camera').map((e) => Number(e.detail)))
    assert.equal(peak, 3)
})

test('a zero-duration camera step is an instant cut', async () => {
    const h = setup({ zoom: 1 })
    const c: Cinematic = { id: 'c', name: 'cut', letterbox: false, freezePlayer: false, steps: [
        { id: 'cut', type: 'camera', wait: true, duration: 0, ease: 'linear', shot: SHOT(4) },
        { id: 'hold', type: 'wait', wait: true, duration: 0.2 },
    ] }
    await h.run(director.play(c))
    assert.ok(h.events.some((e) => e.kind === 'camera' && e.detail === '4'), 'cut applied the shot')
})

test('letterbox + freeze wrap the whole cinematic and the camera is restored', async () => {
    const h = setup({ zoom: 2 })
    const c: Cinematic = { id: 'c', name: 'wrap', steps: [
        { id: 'cam', type: 'camera', wait: true, duration: 0.5, ease: 'linear', shot: SHOT(5) },
    ] }
    await h.run(director.play(c))
    const kinds = h.events.map((e) => e.kind)
    assert.ok(kinds.indexOf('freezeOn') < kinds.indexOf('freezeOff'), 'freeze on before off')
    assert.ok(kinds.indexOf('letterboxOn') < kinds.indexOf('letterboxOff'), 'letterbox on before off')
    assert.ok(kinds.includes('overrideOn') && kinds.includes('overrideOff'))
    // Final camera write restores the captured start zoom (2).
    assert.equal(h.lastShot.zoom, 2)
})

test('skip() completes a long cinematic immediately', async () => {
    const h = setup()
    const c: Cinematic = { id: 'c', name: 'long', letterbox: false, freezePlayer: false, steps: [
        { id: 'w', type: 'wait', wait: true, duration: 100 },
    ] }
    const p = director.play(c)
    director.update(1 / 60)
    await new Promise((r) => setImmediate(r))
    assert.equal(director.isPlaying, true)
    director.skip()
    await p
    assert.equal(director.isPlaying, false)
    assert.ok(h.clock.t < 1, 'skip resolved without spending the 100s')
})

test('a blocking move step waits until the NPC arrives', async () => {
    const h = setup()
    ;(h.stage as unknown as { setDistance: (id: string, fn: () => number | null) => void })
        .setDistance('troll', () => Math.max(0, 5 - h.clock.t)) // closes 1 unit/sec, arrives < epsilon at ~t≈4.4
    const c: Cinematic = { id: 'c', name: 'walk', letterbox: false, freezePlayer: false, steps: [
        { id: 'm', type: 'move', wait: true, npcId: 'troll', to: { x: 0, y: 0, z: 0 } as Vec3, timeoutSeconds: 20 },
    ] }
    const end = await h.run(director.play(c))
    assert.ok(end > 4 && end < 5, `arrived at ~4.4s, got ${end}`)
    assert.ok(h.events.some((e) => e.kind === 'move' && e.detail === 'troll'))
})

test('a blocking move step gives up at its timeout if the NPC never arrives', async () => {
    const h = setup()
    ;(h.stage as unknown as { setDistance: (id: string, fn: () => number | null) => void })
        .setDistance('stuck', () => 10) // never within epsilon
    const c: Cinematic = { id: 'c', name: 'stuck', letterbox: false, freezePlayer: false, steps: [
        { id: 'm', type: 'move', wait: true, npcId: 'stuck', to: { x: 0, y: 0, z: 0 } as Vec3, timeoutSeconds: 2 },
    ] }
    const end = await h.run(director.play(c))
    assert.ok(Math.abs(end - 2) < 0.1, `gave up at ~2s, got ${end}`)
})
