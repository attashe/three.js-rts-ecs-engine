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
    PistonsFacade,
    PlayerFacade,
    PropsFacade,
    ScriptEntry,
    UiFacade,
    VoxelCoord,
    ZoneFacade,
} from '../src/engine/script/types'
import { copyPlayerSettings, DEFAULT_PLAYER_SETTINGS } from '../src/game/player-settings'
import { createGameWorld, pushScriptTriggerEvent } from '../src/engine/ecs/world'

const SOURCE = readFileSync(resolve(process.cwd(), 'examples/scripts/cliff-lift-repair.js'), 'utf8')
const LIFT_FLAG = 'demo.cliffLift.repaired'
const MATERIAL_ID = 'lift-repair-materials'
const MATERIAL_PICKUP_ID = 'demo.cliff-lift.materials'
const LIFT_PISTON = 'piston.cliff-lift'
const BROKEN_PROP = 'demo:cliff-lift-broken'
const BOTTOM_ZONE = 'zone.demo.cliff-lift.bottom'

function makeHarness(opts: { materials?: number; repaired?: boolean } = {}) {
    const world = createGameWorld()
    let materials = opts.materials ?? 0
    const livePickups = new Set<string>()
    const propVisible = new Map<string, boolean>([[BROKEN_PROP, true]])
    const pistonEnabled = new Map<string, boolean>([[LIFT_PISTON, true]])
    const pistonDeployed = new Map<string, boolean>([[LIFT_PISTON, true]])
    const flips: string[] = []
    const audioPlays: string[] = []
    const popupMessages: { targetId: string; message: string; seconds?: number }[] = []
    const pickupSpawns: { kind: string; pos: VoxelCoord; opts?: unknown }[] = []

    const audio: AudioFacade = { play(id) { audioPlays.push(id); return { id } }, stop() {} }
    const chunks: ChunksFacade = { getBlock: () => 0, setBlock() {}, fillBlocks() {} }
    const player: PlayerFacade = {
        getPosition: () => ({ x: 21.5, y: 5, z: 5.5 }),
        getGold: () => 0,
        getArrows: () => 0,
        getInventoryItemCount: (itemId) => itemId === MATERIAL_ID ? materials : 0,
        getSettings: () => copyPlayerSettings(DEFAULT_PLAYER_SETTINGS),
        setSettings: () => copyPlayerSettings(DEFAULT_PLAYER_SETTINGS),
        setAbility() {},
        setGold() {},
        setArrows() {},
        removeInventoryItem(itemId, quantity = 1) {
            if (itemId !== MATERIAL_ID || materials < quantity) return false
            materials -= quantity
            return true
        },
        teleport() {},
        kill() {},
        getCheckpoint: () => null,
        setCheckpoint() {},
        clearCheckpoint() {},
    }
    const pickups: PickupsFacade = {
        spawn(kind, pos, spawnOpts) {
            pickupSpawns.push({ kind, pos, opts: spawnOpts })
            const id = spawnOpts?.id ?? kind
            livePickups.add(id)
            return id
        },
        despawn(id) { return livePickups.delete(id) },
        exists(id) { return livePickups.has(id) },
    }
    const pistons: PistonsFacade = {
        setEnabled(id, enabled) {
            if (id !== LIFT_PISTON) return false
            pistonEnabled.set(id, enabled)
            return true
        },
        isEnabled(id) { return pistonEnabled.get(id) === true },
        flip(id) {
            if (id !== LIFT_PISTON || pistonEnabled.get(id) !== true || pistonDeployed.get(id) !== true) return false
            flips.push(id)
            return true
        },
        setDeployed(id, deployed) {
            if (id !== LIFT_PISTON) return false
            pistonDeployed.set(id, deployed)
            return true
        },
        list() { return [LIFT_PISTON] },
    }
    const props: PropsFacade = {
        exists: (id) => propVisible.has(id),
        isVisible: (id) => propVisible.get(id) === true,
        setVisible(id, visible) {
            if (!propVisible.has(id)) return false
            propVisible.set(id, visible)
            return true
        },
        setKind: () => false,
        list: () => [...propVisible.keys()],
    }
    const zone: ZoneFacade = { contains: () => false, exists: () => true, isActive: () => true, setActive: () => true }
    const log: LogFacade = { log() {} }
    const ui: UiFacade = {
        say(targetId, message, sayOpts) {
            popupMessages.push({ targetId, message, seconds: sayOpts?.seconds })
        },
    }

    const sys = createScriptEngineSystem({
        audio, chunks, player, pickups, pistons, props, zone, log, ui,
        initialFlags: opts.repaired ? new Map([[LIFT_FLAG, true]]) : undefined,
        getScripts: () => [{ id: 'cliff-lift-repair', name: 'cliff-lift-repair.js', source: SOURCE } satisfies ScriptEntry],
        onScriptError: (entry, where, err) => {
            throw new Error(`[${entry.id}@${where}] ${err instanceof Error ? err.message : String(err)}`)
        },
    })

    return {
        sys,
        world,
        audioPlays,
        popupMessages,
        pickupSpawns,
        flips,
        livePickups,
        propVisible,
        pistonEnabled,
        pistonDeployed,
        get materials() { return materials },
        interact(targetId = BOTTOM_ZONE) {
            pushScriptTriggerEvent(world, {
                kind: 'input',
                action: 'interact',
                edge: 'pressed',
                targetId,
                zoneId: targetId,
                point: { x: 21.5, y: 5, z: 5.5 },
                entityId: 1,
            })
            sys.update(world, 0.016)
        },
    }
}

test('cliff lift script starts unrepaired: broken prop visible, repaired lift undeployed, materials spawned', () => {
    const h = makeHarness()
    h.sys.init?.(h.world)

    assert.equal(h.propVisible.get(BROKEN_PROP), true)
    assert.equal(h.pistonEnabled.get(LIFT_PISTON), false)
    assert.equal(h.pistonDeployed.get(LIFT_PISTON), false)
    assert.equal(h.pickupSpawns.length, 1)
    assert.equal(h.pickupSpawns[0]!.kind, MATERIAL_ID)
    assert.equal(h.livePickups.has(MATERIAL_PICKUP_ID), true)
})

test('cliff lift script refuses repair until materials are held', () => {
    const h = makeHarness()
    h.sys.init?.(h.world)
    h.interact()

    assert.equal(h.flips.length, 0)
    assert.equal(h.propVisible.get(BROKEN_PROP), true)
    assert.equal(h.popupMessages.at(-1)?.message, 'Find repair materials first.')
})

test('cliff lift script consumes materials, deploys repaired cabin, then flips on next interact', () => {
    const h = makeHarness({ materials: 1 })
    h.sys.init?.(h.world)

    h.interact()
    assert.equal(h.materials, 0)
    assert.equal(h.sys.flags.get(LIFT_FLAG), true)
    assert.equal(h.propVisible.get(BROKEN_PROP), false)
    assert.equal(h.pistonEnabled.get(LIFT_PISTON), true)
    assert.equal(h.pistonDeployed.get(LIFT_PISTON), true)
    assert.deepEqual(h.audioPlays, ['sfx.quest.chime'])
    assert.equal(h.flips.length, 0, 'repair press should not also move the lift')

    h.interact()
    assert.deepEqual(h.flips, [LIFT_PISTON])
})
