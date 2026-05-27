import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createScriptEngineSystem } from '../src/engine/script/script-engine-system'
import type {
    AudioFacade,
    ChunksFacade,
    DayCycleFacade,
    LogFacade,
    PickupSpawnOptions,
    PickupsFacade,
    PlayerFacade,
    ScriptEntry,
    VoxelCoord,
    WeatherFacade,
    ZoneFacade,
} from '../src/engine/script/types'
import {
    createGameWorld,
    pushScriptTriggerEvent,
    type GameWorld,
} from '../src/engine/ecs/world'

/**
 * End-to-end test for the Lantern Trial side quest, loaded verbatim
 * from `examples/scripts/lantern-trial.js`. The harness mirrors the
 * production flow: the quest sees pickup-taken / zone-enter / input
 * events through the real `world.scriptTriggerEvents` queue, while
 * audio / pickups / chunks / dayCycle / weather / zone calls land
 * in capture stubs.
 *
 * The test asserts every Slice 1.6 binding the quest exercises:
 *
 *   - `ui.say` populates popup messages
 *   - `pickups.spawn` with stable ids is idempotent
 *   - `dayCycle.setHour` + `setEnabled` shift the in-world clock
 *   - `weather.applyPreset` + `setRain` + `setLightning`
 *   - `zone.setActive` toggles the hidden vault zone
 *   - `flag.changed` fires from the script's own state writes
 *   - `pickup-taken` filtered by `{ kind: 'hour-stone' }` advances
 *   - `zone-enter` on the vault completes the quest
 */

const QUEST_SOURCE_PATH = resolve(process.cwd(), 'examples', 'scripts', 'lantern-trial.js')
const QUEST_SOURCE = readFileSync(QUEST_SOURCE_PATH, 'utf8')

const STATE_FLAG = 'trial.lantern.state'
const SUNDIAL_ZONE = 'zone.demo.sundial'
const VAULT_ZONE = 'zone.demo.vault'

interface DayCycleCall { method: string; args: unknown[] }
interface WeatherCall  { method: string; args: unknown[] }
interface ZoneToggleCall { id: string; active: boolean }

interface Harness {
    sys: ReturnType<typeof createScriptEngineSystem>
    world: GameWorld
    log: string[]
    audioPlays: string[]
    pickupSpawns: { kind: string; pos: VoxelCoord; opts?: PickupSpawnOptions }[]
    popupMessages: { targetId: string; message: string; seconds?: number }[]
    dayCycleCalls: DayCycleCall[]
    weatherCalls: WeatherCall[]
    zoneToggleCalls: ZoneToggleCall[]
    interact: (targetId: string) => void
    takeStone: (id: string) => void
    enterVault: () => void
    tick: (seconds: number) => Promise<void>
}

function makeHarness(): Harness {
    const world = createGameWorld()
    const log: string[] = []
    const audioPlays: string[] = []
    const pickupSpawns: { kind: string; pos: VoxelCoord; opts?: PickupSpawnOptions }[] = []
    const popupMessages: { targetId: string; message: string; seconds?: number }[] = []
    const dayCycleCalls: DayCycleCall[] = []
    const weatherCalls: WeatherCall[] = []
    const zoneToggleCalls: ZoneToggleCall[] = []
    const livePickupIds = new Set<string>()
    const zoneActiveMap = new Map<string, boolean>([
        [SUNDIAL_ZONE, true],
        [VAULT_ZONE, false],
    ])

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
        getPosition: () => ({ x: 12, y: 5, z: 12 }),
        getGold: () => 0,
        teleport() {},
        kill() {},
    }
    const pickups: PickupsFacade = {
        spawn(kind, pos, opts) {
            // Mirror the production behaviour: when `id` is already
            // live, return the existing handle instead of double-spawning.
            if (opts?.id && livePickupIds.has(opts.id)) return opts.id
            pickupSpawns.push({ kind, pos, opts })
            if (opts?.id) livePickupIds.add(opts.id)
            return opts?.id ?? `id-${kind}-${pickupSpawns.length}`
        },
    }
    const zone: ZoneFacade = {
        contains: () => false,
        exists: (id) => zoneActiveMap.has(id),
        isActive: (id) => zoneActiveMap.get(id) === true,
        setActive(id, active) {
            if (!zoneActiveMap.has(id)) return false
            zoneActiveMap.set(id, active)
            zoneToggleCalls.push({ id, active })
            return true
        },
    }
    const logFacade: LogFacade = {
        log(msg) { log.push(msg) },
    }
    const dayCycle: DayCycleFacade = {
        getHour() { return 8 },
        setHour(h) { dayCycleCalls.push({ method: 'setHour', args: [h] }) },
        isEnabled() { return true },
        setEnabled(on) { dayCycleCalls.push({ method: 'setEnabled', args: [on] }) },
        setSpeed(s) { dayCycleCalls.push({ method: 'setSpeed', args: [s] }) },
    }
    const weather: WeatherFacade = {
        setRain(on) { weatherCalls.push({ method: 'setRain', args: [on] }) },
        setSnow(on) { weatherCalls.push({ method: 'setSnow', args: [on] }) },
        setLightning(on) { weatherCalls.push({ method: 'setLightning', args: [on] }) },
        applyPreset(id) {
            weatherCalls.push({ method: 'applyPreset', args: [id] })
            return true
        },
        setZoneEnabled() { return false },
        isZoneEnabled() { return false },
    }

    const sys = createScriptEngineSystem({
        audio, chunks, player, pickups, zone, log: logFacade,
        ui: {
            say(targetId, message, opts) {
                popupMessages.push({ targetId, message, seconds: opts?.seconds })
            },
        },
        dayCycle,
        weather,
        getScripts: () => [{
            id: 'lantern-trial',
            name: 'lantern-trial.js',
            source: QUEST_SOURCE,
        } satisfies ScriptEntry],
        onScriptError: (entry, where, err) => {
            throw new Error(`[${entry.id}@${where}] ${err instanceof Error ? err.message : String(err)}`)
        },
    })

    return {
        sys,
        world,
        log,
        audioPlays,
        pickupSpawns,
        popupMessages,
        dayCycleCalls,
        weatherCalls,
        zoneToggleCalls,
        interact(targetId) {
            pushScriptTriggerEvent(world, {
                kind: 'input',
                action: 'interact',
                edge: 'pressed',
                targetId,
                zoneId: targetId,
                point: { x: 0, y: 0, z: 0 },
                entityId: 1,
            })
        },
        takeStone(id) {
            livePickupIds.delete(id)
            pushScriptTriggerEvent(world, {
                kind: 'pickup-taken',
                pickupKind: 'hour-stone',
                pickupId: id,
                amount: 1,
                position: { x: 0, y: 0, z: 0 },
                entityId: 2,
            })
        },
        enterVault() {
            pushScriptTriggerEvent(world, {
                kind: 'zone-enter',
                zoneId: VAULT_ZONE,
                source: 'player',
                point: { x: 5, y: 5, z: 5 },
                entityId: 1,
            })
        },
        async tick(seconds: number) {
            const slice = 0.05
            const steps = Math.max(1, Math.round(seconds / slice))
            for (let i = 0; i < steps; i++) {
                sys.update(world, slice)
                await flushMicrotasks()
            }
        },
    }
}

const flushMicrotasks = () => new Promise<void>((r) => setImmediate(r))

const STONE_IDS = [
    'trial.stone.dawn',
    'trial.stone.noon',
    'trial.stone.dusk',
    'trial.stone.night',
] as const

// ─── Tests ─────────────────────────────────────────────────────────────

test('lantern trial: compiles cleanly and stays idle before the Sundial is touched', async () => {
    const h = makeHarness()
    h.sys.init?.(h.world)
    await flushMicrotasks()
    assert.equal(h.sys.broken.size, 0, 'must compile + run without errors')
    // Nothing spawns until the player approaches the Sundial.
    assert.equal(h.pickupSpawns.length, 0)
    assert.equal(h.sys.flags.get(STATE_FLAG) ?? 'unknown', 'unknown')
    // Vault must be deactivated at level-start since state is 'unknown'.
    const toggle = h.zoneToggleCalls.find((c) => c.id === VAULT_ZONE)
    assert.equal(toggle?.active, false, 'level-start must set the vault inactive')
})

test('lantern trial: interacting with the Sundial starts the trial + spawns four stones', async () => {
    const h = makeHarness()
    h.sys.init?.(h.world)
    h.interact(SUNDIAL_ZONE)
    await h.tick(0.1)

    assert.equal(h.sys.flags.get(STATE_FLAG), 'active')
    assert.equal(h.pickupSpawns.length, 4, 'four hour stones')
    assert.deepEqual(h.pickupSpawns.map((p) => p.opts?.id), [...STONE_IDS])
    assert.ok(h.pickupSpawns.every((p) => p.kind === 'hour-stone'))
    assert.ok(h.audioPlays.includes('sfx.quest.chime'))
    assert.ok(h.popupMessages.some((m) => m.targetId === SUNDIAL_ZONE && m.message.includes('four hours')))
})

test('lantern trial: picking up a stone shifts dayCycle + weather and pauses the cycle', async () => {
    const h = makeHarness()
    h.sys.init?.(h.world)
    h.interact(SUNDIAL_ZONE)
    await h.tick(0.1)

    h.takeStone('trial.stone.noon')
    await h.tick(0.1)

    assert.ok(h.dayCycleCalls.some((c) => c.method === 'setHour' && c.args[0] === 12),
        'noon stone should call setHour(12)')
    assert.ok(h.dayCycleCalls.some((c) => c.method === 'setEnabled' && c.args[0] === false),
        'each stone should pause the cycle')
    assert.ok(h.weatherCalls.some((c) => c.method === 'applyPreset' && c.args[0] === 'clear'),
        'noon stone applies the "clear" preset')
    assert.equal(h.sys.flags.get('trial.stone.noon.collected'), true)
    // Still active; only the first stone collected.
    assert.equal(h.sys.flags.get(STATE_FLAG), 'active')
})

test('lantern trial: collecting all four stones unlocks the vault + triggers storm finale', async () => {
    const h = makeHarness()
    h.sys.init?.(h.world)
    h.interact(SUNDIAL_ZONE)
    await h.tick(0.1)

    for (const stoneId of STONE_IDS) h.takeStone(stoneId)
    await h.tick(0.1)

    assert.equal(h.sys.flags.get(STATE_FLAG), 'ready')
    // Final atmospheric stack: storm preset + rain + lightning + midnight.
    const presets = h.weatherCalls.filter((c) => c.method === 'applyPreset').map((c) => c.args[0])
    assert.ok(presets.includes('storm'), 'finale should apply storm preset')
    assert.ok(h.weatherCalls.some((c) => c.method === 'setRain' && c.args[0] === true))
    assert.ok(h.weatherCalls.some((c) => c.method === 'setLightning' && c.args[0] === true))
    assert.ok(h.dayCycleCalls.some((c) => c.method === 'setHour' && c.args[0] === 0),
        'finale should set the hour to midnight')
    // Vault is now active.
    const vaultToggles = h.zoneToggleCalls.filter((c) => c.id === VAULT_ZONE)
    assert.equal(vaultToggles[vaultToggles.length - 1]?.active, true)
})

test('lantern trial: entering the vault rewards + resets the atmosphere + closes the vault', async () => {
    const h = makeHarness()
    h.sys.init?.(h.world)
    h.interact(SUNDIAL_ZONE)
    await h.tick(0.1)
    for (const stoneId of STONE_IDS) h.takeStone(stoneId)
    await h.tick(0.1)

    h.enterVault()
    await h.tick(0.1)

    assert.equal(h.sys.flags.get(STATE_FLAG), 'done')

    // Reward dropped at the vault interior.
    const reward = h.pickupSpawns.find((p) => p.opts?.id === 'trial.reward.gold')
    assert.equal(reward?.kind, 'coin')
    assert.equal(reward?.opts?.amount, 35)

    // Atmosphere reset: morning + clear + cycle resumed.
    assert.ok(h.dayCycleCalls.some((c) => c.method === 'setHour' && c.args[0] === 7.5))
    assert.ok(h.dayCycleCalls.some((c) => c.method === 'setEnabled' && c.args[0] === true))
    assert.ok(h.weatherCalls.some((c) => c.method === 'setRain' && c.args[0] === false))
    assert.ok(h.weatherCalls.some((c) => c.method === 'applyPreset' && c.args[0] === 'clear'))

    // Vault deactivated again on completion.
    const finalVaultToggle = h.zoneToggleCalls.filter((c) => c.id === VAULT_ZONE).at(-1)
    assert.equal(finalVaultToggle?.active, false)
})

test('lantern trial: zone-enter on the vault is ignored before the quest is ready', async () => {
    const h = makeHarness()
    h.sys.init?.(h.world)
    h.interact(SUNDIAL_ZONE)
    await h.tick(0.1)
    // Only one stone collected — quest still 'active', not 'ready'.
    h.takeStone('trial.stone.dawn')
    await h.tick(0.1)

    const rewardsBefore = h.pickupSpawns.filter((p) => p.opts?.id === 'trial.reward.gold').length
    h.enterVault()
    await h.tick(0.1)
    const rewardsAfter = h.pickupSpawns.filter((p) => p.opts?.id === 'trial.reward.gold').length

    assert.equal(rewardsAfter - rewardsBefore, 0, 'no reward spawn until quest is ready')
    assert.equal(h.sys.flags.get(STATE_FLAG), 'active', 'state stays active')
})

test('lantern trial: flag.changed listener logs each state transition', async () => {
    const h = makeHarness()
    h.sys.init?.(h.world)
    h.interact(SUNDIAL_ZONE)
    await h.tick(0.1)
    for (const stoneId of STONE_IDS) h.takeStone(stoneId)
    await h.tick(0.1)
    h.enterVault()
    await h.tick(0.1)

    // Each state set fires flag.changed → the inline listener logs.
    assert.ok(h.log.some((l) => l.includes('state → active')),
        'flag.changed should trip on unknown → active')
    assert.ok(h.log.some((l) => l.includes('state → ready')),
        'flag.changed should trip on active → ready')
    assert.ok(h.log.some((l) => l.includes('state → done')),
        'flag.changed should trip on ready → done')
})

test('lantern trial: stable pickup ids are idempotent across re-spawn attempts', async () => {
    const h = makeHarness()
    h.sys.init?.(h.world)

    // First interact spawns four stones.
    h.interact(SUNDIAL_ZONE)
    await h.tick(0.1)
    assert.equal(h.pickupSpawns.length, 4)

    // Re-interacting in 'active' state calls ensureStonesSpawned()
    // again — but the harness's pickup stub honours `id` and refuses
    // to double-add live ids.
    h.interact(SUNDIAL_ZONE)
    await h.tick(0.1)
    assert.equal(h.pickupSpawns.length, 4, 'no duplicate spawns despite repeated requests')
})

test('lantern trial: completion state survives apply()', async () => {
    const h = makeHarness()
    h.sys.init?.(h.world)
    h.interact(SUNDIAL_ZONE)
    await h.tick(0.1)
    h.takeStone('trial.stone.dawn')
    await h.tick(0.1)

    h.sys.apply()
    assert.equal(h.sys.flags.get(STATE_FLAG), 'active', 'flags survive Apply')
    assert.equal(h.sys.flags.get('trial.stone.dawn.collected'), true)

    // Finishing the remaining stones after Apply still works.
    for (const stoneId of STONE_IDS.slice(1)) h.takeStone(stoneId)
    await h.tick(0.1)
    assert.equal(h.sys.flags.get(STATE_FLAG), 'ready')
})

test('lantern trial: re-loading after completion announces the done state + keeps vault closed', async () => {
    const h = makeHarness()
    // Pre-load a completed flag state, the way a saved level would.
    const flagsMut = h.sys.flags as unknown as Map<string, unknown>
    flagsMut.set(STATE_FLAG, 'done')
    h.sys.init?.(h.world)
    await flushMicrotasks()

    assert.ok(h.log.some((l) => l.includes('already complete')))
    const lastVaultToggle = h.zoneToggleCalls.filter((c) => c.id === VAULT_ZONE).at(-1)
    assert.equal(lastVaultToggle?.active, false, 'completed trial keeps the vault closed')
})
