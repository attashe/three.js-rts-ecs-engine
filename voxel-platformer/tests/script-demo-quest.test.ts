import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createScriptEngineSystem } from '../src/engine/script/script-engine-system'
import type {
    AudioFacade,
    ChunksFacade,
    LogFacade,
    PickupsFacade,
    PlayerFacade,
    ScriptEntry,
    VoxelCoord,
    ZoneFacade,
} from '../src/engine/script/types'
import type { GameWorld } from '../src/engine/ecs/world'

/**
 * End-to-end test for the canonical demo quest at
 * `voxel-platformer/examples/scripts/demo-quest.js`. The script source is
 * loaded verbatim from disk (no inlining) so this test stays in sync
 * with whatever a level designer would actually paste into the editor's
 * Logic tab. The harness simulates the player walking the demo level:
 * standing on the staircase top, collecting a couple of coin piles to
 * cross the gold gate, and finally stepping onto the floating island.
 *
 * Polls happen on a 0.25 s timer per the script. To advance N seconds
 * of sim-time we call `update(world, dt)` repeatedly with small dts;
 * the engine drains microtasks between calls so handlers actually run.
 */

// Compiled test runner cwd is the project root (voxel-platformer/),
// matching `npm run test`'s expectations. import.meta isn't available
// under the CJS test build, so we use a project-relative path.
const QUEST_SOURCE_PATH = resolve(process.cwd(), 'examples', 'scripts', 'demo-quest.js')
const QUEST_SOURCE = readFileSync(QUEST_SOURCE_PATH, 'utf8')

interface Harness {
    sys: ReturnType<typeof createScriptEngineSystem>
    log: string[]
    audioPlays: string[]
    pickupSpawns: { kind: string; pos: VoxelCoord; opts?: { amount?: number } }[]
    setPlayerPos: (p: VoxelCoord | null) => void
    setGold: (g: number) => void
    tick: (seconds: number) => Promise<void>
}

function makeHarness(): Harness {
    let playerPos: VoxelCoord | null = { x: 12, y: 5, z: 12 }  // spawn centre
    let gold = 0
    const log: string[] = []
    const audioPlays: string[] = []
    const pickupSpawns: { kind: string; pos: VoxelCoord; opts?: { amount?: number } }[] = []

    const audio: AudioFacade = {
        play(id) { audioPlays.push(id); return { id } },
        stop() {},
    }
    const chunks: ChunksFacade = {
        getBlock: () => 0,
        setBlock() {},
        fillBlocks() {},
    }
    const player: PlayerFacade = {
        getPosition: () => playerPos,
        getGold: () => gold,
        teleport() {},
        kill() {},
    }
    const pickups: PickupsFacade = {
        spawn(kind, pos, opts) {
            pickupSpawns.push({ kind, pos, opts })
            return `id-${kind}-${pickupSpawns.length}`
        },
    }
    const zone: ZoneFacade = {
        contains: () => false,
    }
    const logFacade: LogFacade = {
        log(msg) { log.push(msg) },
    }

    const sys = createScriptEngineSystem({
        audio, chunks, player, pickups, zone, log: logFacade,
        getScripts: () => [{
            id: 'demo-quest',
            name: 'demo-quest.js',
            source: QUEST_SOURCE,
        } satisfies ScriptEntry],
        onScriptError: (entry, where, err) => {
            // Surface script errors as test failures — anything thrown
            // by the quest is a bug we want to see.
            throw new Error(`[${entry.id}@${where}] ${err instanceof Error ? err.message : String(err)}`)
        },
    })

    return {
        sys,
        log,
        audioPlays,
        pickupSpawns,
        setPlayerPos: (p) => { playerPos = p },
        setGold: (g) => { gold = g },
        async tick(seconds: number) {
            // Run in 0.05 s slices so microtasks (the script's async
            // handlers) drain between each step, the same way the
            // engine's real fixed loop does.
            const slice = 0.05
            const steps = Math.max(1, Math.round(seconds / slice))
            for (let i = 0; i < steps; i++) {
                sys.update(null as unknown as GameWorld, slice)
                await flushMicrotasks()
            }
        },
    }
}

function flushMicrotasks(): Promise<void> {
    return new Promise<void>((r) => setImmediate(r))
}

test('demo quest: compiles cleanly and fires the intro on level-start', async () => {
    const h = makeHarness()
    h.sys.init?.(null as unknown as GameWorld)
    await flushMicrotasks()
    assert.deepEqual(h.sys.broken.size, 0, 'demo quest must compile + run without errors')
    assert.ok(h.log[0]?.includes('Three Tokens of the Plaza'))
    assert.equal(h.audioPlays[0], 'sfx.quest.chime')
})

test('demo quest: idle player never advances past stage 0', async () => {
    const h = makeHarness()
    h.sys.init?.(null as unknown as GameWorld)
    // Player stays at the spawn coords — outside the staircase footprint.
    await h.tick(5.0)
    assert.equal(h.sys.flags.get('demo.quest.stage') ?? 0, 0)
    assert.equal(h.pickupSpawns.length, 0)
})

test('demo quest: stage 1 fires when player stands on the staircase top', async () => {
    const h = makeHarness()
    h.sys.init?.(null as unknown as GameWorld)
    h.setPlayerPos({ x: 18, y: 8, z: 12 })  // staircase top
    await h.tick(0.6)
    assert.equal(h.sys.flags.get('demo.quest.stage'), 1)
    assert.equal(h.pickupSpawns.length, 1)
    assert.deepEqual(h.pickupSpawns[0]?.pos, { x: 18, y: 8, z: 13 })
    assert.equal(h.pickupSpawns[0]?.opts?.amount, 5)
})

test('demo quest: stage 2 fires once gold reaches 5', async () => {
    const h = makeHarness()
    h.sys.init?.(null as unknown as GameWorld)

    // Walk onto the staircase to trigger stage 1.
    h.setPlayerPos({ x: 18, y: 8, z: 12 })
    await h.tick(0.6)
    assert.equal(h.sys.flags.get('demo.quest.stage'), 1)

    // Step off the stairs (so the stage 1 condition stops being true)
    // and accumulate gold elsewhere.
    h.setPlayerPos({ x: 12, y: 5, z: 12 })
    h.setGold(4)
    await h.tick(0.6)
    assert.equal(h.sys.flags.get('demo.quest.stage'), 1, 'not yet — 4 < 5')
    h.setGold(5)
    await h.tick(0.5)
    assert.equal(h.sys.flags.get('demo.quest.stage'), 2)
    assert.equal(h.pickupSpawns.length, 2)
    assert.deepEqual(h.pickupSpawns[1]?.pos, { x: 4, y: 5, z: 4 })
})

test('demo quest: stage 3 reward + fanfare + custom emit on reaching the island', async () => {
    const h = makeHarness()
    h.sys.init?.(null as unknown as GameWorld)

    h.setPlayerPos({ x: 18, y: 8, z: 12 })
    await h.tick(0.6)
    h.setPlayerPos({ x: 12, y: 5, z: 12 })
    h.setGold(5)
    await h.tick(0.5)

    // Final stage: player on the floating island.
    h.setPlayerPos({ x: 8, y: 8, z: 21 })
    await h.tick(0.5)

    assert.equal(h.sys.flags.get('demo.quest.stage'), 3)
    assert.equal(h.pickupSpawns.length, 3)
    assert.equal(h.pickupSpawns[2]?.opts?.amount, 50)
    assert.ok(h.audioPlays.includes('sfx.quest.fanfare'))

    // The script also installs an `on('quest.demo.complete', ...)`
    // listener that stamps a timestamp into flags. Verify the chain
    // worked end-to-end.
    const stamp = h.sys.flags.get('demo.quest.completedAt')
    assert.equal(typeof stamp, 'number')
})

test('demo quest: re-entering level after completion announces "already complete"', async () => {
    const h = makeHarness()
    h.sys.flags as unknown as Map<string, unknown>  // (smoke-test the readonly view)

    // Pre-populate the flag the way a saved level binary would.
    // (`createScriptEngineSystem` exposes `flags` as ReadonlyMap, but
    // the underlying Map is the same instance — we cast to mutate.)
    const flagsMut = h.sys.flags as unknown as Map<string, unknown>
    flagsMut.set('demo.quest.stage', 3)

    h.sys.init?.(null as unknown as GameWorld)
    await flushMicrotasks()
    assert.ok(h.log.some((l) => l.includes('already complete')))
})

test('demo quest: stage progression survives apply()', async () => {
    const h = makeHarness()
    h.sys.init?.(null as unknown as GameWorld)
    h.setPlayerPos({ x: 18, y: 8, z: 12 })
    await h.tick(0.6)
    assert.equal(h.sys.flags.get('demo.quest.stage'), 1)

    // Editor presses Apply. Handlers torn down + re-registered, but
    // flags persist — same as in the editor's real flow.
    h.sys.apply()
    assert.equal(h.sys.flags.get('demo.quest.stage'), 1)

    // The player is still on the staircase; the new stage-1 check has
    // gold-gate semantics, so position alone shouldn't advance.
    await h.tick(0.5)
    assert.equal(h.sys.flags.get('demo.quest.stage'), 1)
})
