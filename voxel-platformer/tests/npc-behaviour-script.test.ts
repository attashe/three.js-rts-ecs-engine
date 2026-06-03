import test from 'node:test'
import assert from 'node:assert/strict'
import {
    generateBehaviourScript,
    mergeBehaviourIntoScript,
    stripBehaviourRegion,
} from '../src/game/npcs/npc-behaviour-script'
import {
    DEFAULT_NPC_BEHAVIOUR,
    copyNpcConfig,
    normalizeNpcConfig,
    type NpcBehaviourConfig,
} from '../src/game/npcs/npc-types'

function behaviour(over: Partial<NpcBehaviourConfig>): NpcBehaviourConfig {
    return { ...DEFAULT_NPC_BEHAVIOUR, ...over, waypoints: over.waypoints ?? [] }
}

/** Run a generated behaviour script with stubs, capturing the npc.* calls. */
function runScript(script: string): { fn: string; args: unknown[] }[] {
    const calls: { fn: string; args: unknown[] }[] = []
    const npc = new Proxy({}, { get: (_t, key) => (...args: unknown[]) => calls.push({ fn: String(key), args }) })
    const on = (event: string, cb: () => void) => { if (event === 'level-start') cb() }
    // eslint-disable-next-line no-new-func
    const fn = new Function('npc', 'on', 'NPC_ID', script) as (npc: unknown, on: unknown, id: string) => void
    fn(npc, on, 'guard-1')
    return calls
}

test('mode none generates no script region', () => {
    assert.equal(generateBehaviourScript(behaviour({ mode: 'none' })), '')
    assert.equal(mergeBehaviourIntoScript('custom code', behaviour({ mode: 'none' })), 'custom code')
})

test('guard behaviour emits perception + hostile + a (held-post) route', () => {
    const calls = runScript(generateBehaviourScript(behaviour({
        mode: 'guard', hostileToPlayer: true, perceptionRadius: 7,
    })))
    assert.deepEqual(calls, [
        { fn: 'setPerceptionRadius', args: ['guard-1', 7] },
        { fn: 'setHostile', args: ['guard-1', 'player', true] },
        { fn: 'setWaypoints', args: ['guard-1', []] },
    ])
})

test('hunter behaviour emits threat memory; prey emits flee', () => {
    const hunter = runScript(generateBehaviourScript(behaviour({
        mode: 'hunter', hostileToPlayer: true, perceptionRadius: 10, threatMemorySeconds: 8,
        waypoints: [{ x: 4.5, y: 5, z: 4.5 }],
    })))
    assert.ok(hunter.some((c) => c.fn === 'setThreatMemory' && c.args[1] === 8))
    assert.ok(hunter.some((c) => c.fn === 'setWaypoints' && Array.isArray(c.args[1]) && (c.args[1] as unknown[]).length === 1))

    const prey = runScript(generateBehaviourScript(behaviour({ mode: 'prey', flee: true, perceptionRadius: 8 })))
    assert.ok(prey.some((c) => c.fn === 'setFlee' && c.args[1] === true))
    assert.ok(!prey.some((c) => c.fn === 'setHostile'))
})

test('idle mode emits perception but no route', () => {
    const calls = runScript(generateBehaviourScript(behaviour({ mode: 'idle', perceptionRadius: 6 })))
    assert.ok(calls.some((c) => c.fn === 'setPerceptionRadius'))
    assert.ok(!calls.some((c) => c.fn === 'setWaypoints'))
})

test('merge keeps custom script outside the region; strip recovers it', () => {
    const custom = `on('input', { action: 'interact', targetId: NPC_INTERACTION }, () => ui.say(NPC_INTERACTION, 'hi'))`
    const b = behaviour({ mode: 'patrol', hostileToPlayer: true, perceptionRadius: 9, waypoints: [{ x: 1, y: 5, z: 1 }, { x: 3, y: 5, z: 1 }] })
    const merged = mergeBehaviourIntoScript(custom, b)
    assert.ok(merged.includes('=== behaviour'))
    assert.ok(merged.includes(custom))
    // The custom remainder round-trips out cleanly.
    assert.equal(stripBehaviourRegion(merged), custom)
    // Re-merging replaces only the region, not the custom tail.
    const reMerged = mergeBehaviourIntoScript(merged, behaviour({ ...b, perceptionRadius: 12 }))
    assert.ok(reMerged.includes('setPerceptionRadius(NPC_ID, 12)'))
    assert.equal(stripBehaviourRegion(reMerged), custom)
    // The generated region runs to the right calls.
    const calls = runScript(stripGeneratedRegionRunner(reMerged))
    assert.ok(calls.some((c) => c.fn === 'setWaypoints'))
})

/** Extract just the generated region so it can be run by `runScript`. */
function stripGeneratedRegionRunner(merged: string): string {
    const begin = merged.indexOf('// === behaviour')
    const end = merged.indexOf('// === end behaviour ===')
    return merged.slice(begin, end + '// === end behaviour ==='.length)
}

test('behaviour survives copyNpcConfig → normalizeNpcConfig round-trip', () => {
    const cfg = normalizeNpcConfig({
        id: 'patrol-1',
        position: { x: 0, y: 0, z: 0 },
        model: 'shield-spearman',
        behaviour: behaviour({ mode: 'patrol', hostileToPlayer: true, perceptionRadius: 9, waypoints: [{ x: 2, y: 5, z: 2 }, { x: 8, y: 5, z: 2 }] }),
    })
    const round = normalizeNpcConfig(copyNpcConfig(cfg))
    assert.deepEqual(round.behaviour, cfg.behaviour)
    // Deep copy: mutating the copy's waypoints doesn't touch the original.
    const copy = copyNpcConfig(cfg)
    copy.behaviour!.waypoints[0]!.x = 999
    assert.equal(cfg.behaviour!.waypoints[0]!.x, 2)
    // JSON serializer safety (level metadata travels as JSON).
    assert.deepEqual(JSON.parse(JSON.stringify(cfg.behaviour)), cfg.behaviour)
})

test('normalizeNpcConfig leaves behaviour undefined when absent (legacy stable)', () => {
    const cfg = normalizeNpcConfig({ id: 'legacy', position: { x: 0, y: 0, z: 0 }, model: 'keeper' })
    assert.equal(cfg.behaviour, undefined)
})

test('normalizeNpcConfig sanitizes a present behaviour block', () => {
    const cfg = normalizeNpcConfig({
        id: 'b', position: { x: 0, y: 0, z: 0 },
        behaviour: { mode: 'bogus' as never, hostileToPlayer: true, perceptionRadius: -5, threatMemorySeconds: -2, flee: false, waypoints: [{ x: 1, y: 2, z: 3 }, { x: NaN, y: 0, z: 0 }] },
    })
    assert.equal(cfg.behaviour!.mode, 'none') // invalid mode → default
    assert.equal(cfg.behaviour!.perceptionRadius, 0) // clamped
    assert.equal(cfg.behaviour!.threatMemorySeconds, 0)
    assert.equal(cfg.behaviour!.waypoints.length, 1) // NaN point dropped
})
