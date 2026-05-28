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
    ZoneFacade,
} from '../src/engine/script/types'
import {
    createGameWorld,
    pushScriptTriggerEvent,
    type GameWorld,
} from '../src/engine/ecs/world'
import {
    applyPlayerSettingsPatch,
    copyPlayerSettings,
    DEFAULT_PLAYER_SETTINGS,
    type PlayerSettings,
    type PlayerSettingsPatch,
} from '../src/game/player-settings'

const SCRIPT_SOURCE_PATH = resolve(process.cwd(), 'examples', 'scripts', 'haste-shrine.js')
const SCRIPT_SOURCE = readFileSync(SCRIPT_SOURCE_PATH, 'utf8')
const SHRINE_ZONE = 'zone.demo.haste-shrine'

interface Harness {
    sys: ReturnType<typeof createScriptEngineSystem>
    world: GameWorld
    getSettings: () => PlayerSettings
    audioPlays: string[]
    messages: { targetId: string; message: string; seconds?: number }[]
    interact: () => void
    tick: (seconds: number) => Promise<void>
}

function makeHarness(): Harness {
    const world = createGameWorld()
    let settings = copyPlayerSettings(DEFAULT_PLAYER_SETTINGS)
    const audioPlays: string[] = []
    const messages: { targetId: string; message: string; seconds?: number }[] = []

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
        getPosition: () => ({ x: 14.5, y: 5, z: 9.5 }),
        getGold: () => settings.inventory.gold,
        getArrows: () => settings.inventory.arrows,
        getSettings: () => copyPlayerSettings(settings),
        setSettings(patch: PlayerSettingsPatch) {
            settings = applyPlayerSettingsPatch(settings, patch)
            return copyPlayerSettings(settings)
        },
        setAbility(ability, enabled) { settings.abilities[ability] = enabled },
        setGold(amount) { settings.inventory.gold = amount },
        setArrows(amount) { settings.inventory.arrows = amount },
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
        exists: (id) => id === SHRINE_ZONE,
        isActive: (id) => id === SHRINE_ZONE,
        setActive: () => false,
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
        log,
        ui,
        getScripts: () => [{
            id: 'haste-shrine',
            name: 'haste-shrine.js',
            source: SCRIPT_SOURCE,
        } satisfies ScriptEntry],
        onScriptError: (entry, where, err) => {
            throw new Error(`[${entry.id}@${where}] ${err instanceof Error ? err.message : String(err)}`)
        },
    })

    return {
        sys,
        world,
        getSettings: () => copyPlayerSettings(settings),
        audioPlays,
        messages,
        interact() {
            pushScriptTriggerEvent(world, {
                kind: 'input',
                action: 'interact',
                edge: 'pressed',
                targetId: SHRINE_ZONE,
                zoneId: SHRINE_ZONE,
                point: { x: 14.5, y: 5, z: 9.5 },
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

test('haste shrine script temporarily boosts player moveSpeed', async () => {
    const h = makeHarness()
    h.sys.init?.(h.world)
    await flushMicrotasks()
    assert.equal(h.sys.broken.size, 0)

    h.interact()
    await h.tick(0.1)

    assert.equal(h.getSettings().moveSpeed, 8.25)
    assert.ok(h.audioPlays.includes('sfx.quest.chime'))
    assert.ok(h.messages.some((m) => m.targetId === SHRINE_ZONE && m.message.includes('10 seconds')))

    await h.tick(10.1)

    assert.equal(h.getSettings().moveSpeed, DEFAULT_PLAYER_SETTINGS.moveSpeed)
    assert.ok(h.messages.some((m) => m.targetId === SHRINE_ZONE && m.message.includes('fades')))
})

test('haste shrine refreshes duration without stacking speed', async () => {
    const h = makeHarness()
    h.sys.init?.(h.world)

    h.interact()
    await h.tick(0.1)
    assert.equal(h.getSettings().moveSpeed, 8.25)

    await h.tick(5)
    h.interact()
    await h.tick(0.1)
    assert.equal(h.getSettings().moveSpeed, 8.25)

    await h.tick(5.2)
    assert.equal(h.getSettings().moveSpeed, 8.25, 'first timer should not clear a refreshed haste effect')

    await h.tick(5.1)
    assert.equal(h.getSettings().moveSpeed, DEFAULT_PLAYER_SETTINGS.moveSpeed)
})

test('haste shrine restores speed when scripts are reapplied mid-effect', async () => {
    const h = makeHarness()
    h.sys.init?.(h.world)

    h.interact()
    await h.tick(0.1)
    assert.equal(h.getSettings().moveSpeed, 8.25)

    h.sys.apply()
    await flushMicrotasks()

    assert.equal(h.getSettings().moveSpeed, DEFAULT_PLAYER_SETTINGS.moveSpeed)
    assert.equal(h.sys.broken.size, 0)
})
