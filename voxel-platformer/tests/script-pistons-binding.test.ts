import test from 'node:test'
import assert from 'node:assert/strict'
import { ChunkManager } from '../src/engine/voxel/chunk-manager'
import { BLOCK, DEFAULT_PALETTE } from '../src/engine/voxel/palette'
import { createGameWorld, type GameWorld } from '../src/engine/ecs/world'
import { createPistonSystem } from '../src/engine/ecs/systems/piston-system'
import { registerPistonMechanism } from '../src/game/mechanisms'
import { createScriptEngineSystem } from '../src/engine/script/script-engine-system'
import type {
    AudioFacade,
    ChunksFacade,
    LogFacade,
    PickupsFacade,
    PistonsFacade,
    PlayerFacade,
    ScriptEntry,
    ZoneFacade,
} from '../src/engine/script/types'
import { copyPlayerSettings, DEFAULT_PLAYER_SETTINGS } from '../src/game/player-settings'

// End-to-end: drive `pistons.*` from a compiled script string against a
// real GameWorld + piston-system. The production facade in
// script-system.ts is just glue around `world.pistonsById`; rather than
// pulling that file (and its WebGPU transitive deps) into the test
// build, we re-create the equivalent facade inline so the test still
// asserts the same contract.

function pistonsFacadeFor(world: GameWorld): PistonsFacade {
    return {
        setEnabled(id, enabled) {
            const piston = world.pistonsById.get(id)
            if (!piston) return false
            piston.enabled = !!enabled
            if (!piston.enabled) piston.pendingFlip = false
            return true
        },
        isEnabled(id) {
            const piston = world.pistonsById.get(id)
            return piston !== undefined && piston.enabled
        },
        flip(id) {
            const piston = world.pistonsById.get(id)
            if (!piston) return false
            if (!piston.enabled) return false
            if (piston.motion === 'physical' && piston.moving === 1) return false
            piston.pendingFlip = true
            return true
        },
        list() {
            return Array.from(world.pistonsById.keys())
        },
    }
}

function noopFacades() {
    const audio: AudioFacade = { play() { return null }, stop() {} }
    const chunks: ChunksFacade = {
        getBlock: () => 0,
        setBlock() {},
        fillBlocks() {},
    }
    const player: PlayerFacade = {
        getPosition: () => ({ x: 0, y: 0, z: 0 }),
        getGold: () => 0,
        getArrows: () => 0,
        getSettings: () => copyPlayerSettings(DEFAULT_PLAYER_SETTINGS),
        setSettings: () => copyPlayerSettings(DEFAULT_PLAYER_SETTINGS),
        setAbility() {},
        setGold() {},
        setArrows() {},
        teleport() {},
        kill() {},
        getCheckpoint: () => null,
        setCheckpoint() {},
        clearCheckpoint() {},
    }
    const pickups: PickupsFacade = {
        spawn() { return 'stub' },
        despawn() { return false },
        exists() { return false },
    }
    const zone: ZoneFacade = {
        contains: () => false,
        exists: () => false,
        isActive: () => false,
        setActive: () => false,
    }
    const log: LogFacade = { log() {} }
    return { audio, chunks, player, pickups, zone, log }
}

function runScript(world: GameWorld, source: string) {
    const entry: ScriptEntry = { id: 'unit', name: 'unit.js', source }
    const sys = createScriptEngineSystem({
        ...noopFacades(),
        pistons: pistonsFacadeFor(world),
        getScripts: () => [entry],
    })
    sys.init?.(world)
    return sys
}

test('pistons.list reflects id-bearing pistons registered in the world', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const world = createGameWorld()
    registerPistonMechanism(world, chunks, {
        id: 'piston.elevator',
        from: { x: 5, y: 1, z: 0 },
        to: { x: 5, y: 3, z: 0 },
        block: BLOCK.plank,
        delay: 1,
    })
    registerPistonMechanism(world, chunks, {
        from: { x: 8, y: 1, z: 0 },
        to: { x: 9, y: 1, z: 0 },
        block: BLOCK.brick,
        delay: 1,
    })
    registerPistonMechanism(world, chunks, {
        id: 'piston.trap',
        from: { x: 12, y: 1, z: 0 },
        to: { x: 13, y: 1, z: 0 },
        block: BLOCK.brick,
        delay: 1,
    })

    const sys = runScript(world, `
        on('level-start', () => {
            flags.set('ids', pistons.list().join(','))
        })
    `)
    const stored = (sys.flags.get('ids') ?? '') as string
    assert.deepEqual(stored.split(',').filter(Boolean).sort(), ['piston.elevator', 'piston.trap'])
})

test('pistons.setEnabled disables a teleport piston end-to-end', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const world = createGameWorld()
    const piston = registerPistonMechanism(world, chunks, {
        id: 'piston.elevator',
        from: { x: 5, y: 1, z: 0 },
        to: { x: 6, y: 1, z: 0 },
        block: BLOCK.brick,
        delay: 1,
        characterPolicy: 'block',
    })

    const sys = runScript(world, `
        on('level-start', () => {
            flags.set('ok', pistons.setEnabled('piston.elevator', false))
            flags.set('isEnabled', pistons.isEnabled('piston.elevator'))
        })
    `)
    assert.equal(sys.flags.get('ok'), true)
    assert.equal(sys.flags.get('isEnabled'), false)
    assert.equal(piston.enabled, false)

    createPistonSystem(chunks).update(world, 5)
    assert.equal(chunks.getVoxel(6, 1, 0), BLOCK.air, 'disabled teleport piston did not flip')
})

test('pistons.flip queues a force-flip that the next piston-system tick consumes', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const world = createGameWorld()
    const piston = registerPistonMechanism(world, chunks, {
        id: 'piston.trap',
        from: { x: 5, y: 1, z: 0 },
        to: { x: 6, y: 1, z: 0 },
        block: BLOCK.brick,
        delay: 10,
        characterPolicy: 'block',
    })

    const sys = runScript(world, `
        on('level-start', () => { flags.set('ok', pistons.flip('piston.trap')) })
    `)
    assert.equal(sys.flags.get('ok'), true)
    assert.equal(piston.pendingFlip, true)

    createPistonSystem(chunks).update(world, 0.05)
    assert.equal(chunks.getVoxel(6, 1, 0), BLOCK.brick, 'forced flip executed early')
    assert.equal(piston.pendingFlip, false)
})

test('pistons.flip on a disabled piston returns false and queues nothing', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const world = createGameWorld()
    const piston = registerPistonMechanism(world, chunks, {
        id: 'piston.elevator',
        from: { x: 5, y: 1, z: 0 },
        to: { x: 6, y: 1, z: 0 },
        block: BLOCK.brick,
        delay: 5,
    })
    piston.enabled = false

    const sys = runScript(world, `
        on('level-start', () => { flags.set('ok', pistons.flip('piston.elevator')) })
    `)
    assert.equal(sys.flags.get('ok'), false)
    assert.equal(piston.pendingFlip, false)
})

test('pistons.flip on a physical piston mid-travel returns false (no state change)', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const world = createGameWorld()
    const piston = registerPistonMechanism(world, chunks, {
        id: 'piston.elevator',
        from: { x: 5, y: 1, z: 0 },
        to: { x: 5, y: 3, z: 0 },
        block: BLOCK.plank,
        delay: 0,
        travelTime: 1,
        motion: 'physical',
        characterPolicy: 'push',
    })
    createPistonSystem(chunks).update(world, 0.1)
    assert.equal(piston.moving, 1)

    const sys = runScript(world, `
        on('level-start', () => { flags.set('ok', pistons.flip('piston.elevator')) })
    `)
    assert.equal(sys.flags.get('ok'), false)
    assert.equal(piston.pendingFlip, false)
})

test('pistons unknown-id surface returns false everywhere', () => {
    const world = createGameWorld()
    const sys = runScript(world, `
        on('level-start', () => {
            flags.set('flip', pistons.flip('piston.nope'))
            flags.set('isEnabled', pistons.isEnabled('piston.nope'))
            flags.set('setEnabled', pistons.setEnabled('piston.nope', true))
        })
    `)
    assert.equal(sys.flags.get('flip'), false)
    assert.equal(sys.flags.get('isEnabled'), false)
    assert.equal(sys.flags.get('setEnabled'), false)
})
