import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createScriptEngineSystem } from '../src/engine/script/script-engine-system'
import type {
    AudioFacade,
    ChunksFacade,
    LogFacade,
    PickupSpawnOptions,
    PickupsFacade,
    PistonsFacade,
    PlayerFacade,
    ScriptEntry,
    UiFacade,
    VoxelCoord,
    WeatherFacade,
    ZoneFacade,
} from '../src/engine/script/types'
import {
    createGameWorld,
    pushScriptTriggerEvent,
    type GameWorld,
} from '../src/engine/ecs/world'
import { copyPlayerSettings, DEFAULT_PLAYER_SETTINGS } from '../src/game/player-settings'

const SCRIPT_SOURCE_PATH = resolve(process.cwd(), 'examples', 'scripts', 'paid-portal-shrine.js')
const SCRIPT_SOURCE = readFileSync(SCRIPT_SOURCE_PATH, 'utf8')
const SHRINE_ZONE = 'zone.demo.portal-shrine'
const PORTAL_ZONE = 'zone.demo.portal.teleport-garden'
const MAGIC_ZONE = 'fx.demo.portal.magic'

interface Harness {
    sys: ReturnType<typeof createScriptEngineSystem>
    world: GameWorld
    getGold: () => number
    audioPlays: string[]
    messages: { targetId: string; message: string; seconds?: number }[]
    zoneToggles: { id: string; active: boolean }[]
    fxToggles: { id: string; enabled: boolean }[]
    interact: () => void
    tick: (seconds: number) => Promise<void>
}

function makeHarness(initialGold: number): Harness {
    const world = createGameWorld()
    let gold = initialGold
    const audioPlays: string[] = []
    const messages: { targetId: string; message: string; seconds?: number }[] = []
    const zoneToggles: { id: string; active: boolean }[] = []
    const fxToggles: { id: string; enabled: boolean }[] = []
    const activeZones = new Map<string, boolean>([
        [SHRINE_ZONE, true],
        [PORTAL_ZONE, false],
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
        getPosition: () => ({ x: 4.3, y: 5, z: 19.8 }),
        getGold: () => gold,
        getArrows: () => 0,
        getSettings: () => copyPlayerSettings({ ...DEFAULT_PLAYER_SETTINGS, inventory: { gold, arrows: 0, items: {} } }),
        setSettings: () => copyPlayerSettings(DEFAULT_PLAYER_SETTINGS),
        setAbility() {},
        setGold(amount) { gold = amount },
        setArrows() {},
        teleport() {},
        kill() {},
        getCheckpoint: () => null,
        setCheckpoint() {},
        clearCheckpoint() {},
    }
    const pickups: PickupsFacade = {
        spawn(kind, _pos, opts?: PickupSpawnOptions) { return opts?.id ?? `pickup:${kind}` },
        despawn() { return false },
        exists() { return false },
    }
    const pistons: PistonsFacade = {
        setEnabled() { return false },
        isEnabled() { return false },
        flip() { return false },
        list() { return [] },
    }
    const zone: ZoneFacade = {
        contains: () => false,
        exists: (id) => activeZones.has(id),
        isActive: (id) => activeZones.get(id) === true,
        setActive(id, active) {
            if (!activeZones.has(id)) return false
            activeZones.set(id, active)
            zoneToggles.push({ id, active })
            return true
        },
    }
    const weather: WeatherFacade = {
        setRain() {},
        setSnow() {},
        setLightning() {},
        applyPreset() { return false },
        setZoneEnabled(id, enabled) {
            if (id !== MAGIC_ZONE) return false
            fxToggles.push({ id, enabled })
            return true
        },
        isZoneEnabled() { return false },
        setZonePreset() { return false },
    }
    const log: LogFacade = {
        log() {},
    }
    const ui: UiFacade = {
        say(targetId, message, opts) {
            messages.push({ targetId, message, seconds: opts?.seconds })
        },
    }

    const sys = createScriptEngineSystem({
        audio,
        chunks,
        player,
        pickups,
        pistons,
        zone,
        weather,
        log,
        ui,
        getScripts: () => [{
            id: 'paid-portal-shrine',
            name: 'paid-portal-shrine.js',
            source: SCRIPT_SOURCE,
        } satisfies ScriptEntry],
        onScriptError: (entry, where, err) => {
            throw new Error(`[${entry.id}@${where}] ${err instanceof Error ? err.message : String(err)}`)
        },
    })

    return {
        sys,
        world,
        getGold: () => gold,
        audioPlays,
        messages,
        zoneToggles,
        fxToggles,
        interact() {
            pushScriptTriggerEvent(world, {
                kind: 'input',
                action: 'interact',
                edge: 'pressed',
                targetId: SHRINE_ZONE,
                zoneId: SHRINE_ZONE,
                point: { x: 4.3, y: 5, z: 19.8 } satisfies VoxelCoord,
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

const flushMicrotasks = () => new Promise<void>((resolveFlush) => setImmediate(resolveFlush))

test('paid portal shrine refuses activation when the player has no coin', async () => {
    const h = makeHarness(0)
    h.sys.init?.(h.world)
    await flushMicrotasks()
    assert.equal(h.sys.broken.size, 0)

    h.interact()
    await h.tick(0.1)

    assert.equal(h.getGold(), 0)
    assert.ok(h.messages.some((m) => m.targetId === SHRINE_ZONE && m.message.includes('Not enough money')))
    assert.equal(h.audioPlays.length, 0)
    assert.equal(h.zoneToggles.some((t) => t.id === PORTAL_ZONE && t.active), false)
    assert.equal(h.fxToggles.some((t) => t.id === MAGIC_ZONE && t.enabled), false)
})

test('paid portal shrine spends one coin and opens portal plus magic FX for ten seconds', async () => {
    const h = makeHarness(1)
    h.sys.init?.(h.world)
    await flushMicrotasks()

    h.interact()
    await h.tick(0.1)

    assert.equal(h.getGold(), 0)
    assert.ok(h.audioPlays.includes('sfx.quest.chime'))
    assert.ok(h.messages.some((m) => m.targetId === SHRINE_ZONE && m.message.includes('Portal activated')))
    assert.ok(h.zoneToggles.some((t) => t.id === PORTAL_ZONE && t.active === true))
    assert.ok(h.fxToggles.some((t) => t.id === MAGIC_ZONE && t.enabled === true))
    assert.equal(h.sys.flags.get('demo.portalShrine.state'), 'active')

    await h.tick(10.1)

    assert.ok(h.zoneToggles.some((t) => t.id === PORTAL_ZONE && t.active === false))
    assert.ok(h.fxToggles.some((t) => t.id === MAGIC_ZONE && t.enabled === false))
    assert.equal(h.sys.flags.get('demo.portalShrine.state'), 'idle')
    assert.ok(h.messages.some((m) => m.targetId === SHRINE_ZONE && m.message.includes('Portal closed')))
})
