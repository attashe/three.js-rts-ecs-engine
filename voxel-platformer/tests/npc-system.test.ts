import test from 'node:test'
import assert from 'node:assert/strict'
import { Group, LineSegments, Scene, type Object3D } from 'three'
import { createGameWorld } from '../src/engine/ecs/world'
import { createNpcModel } from '../src/game/npcs/npc-models'
import { createNpcRenderSystem } from '../src/game/npcs/npc-render-system'
import { registerRuntimeNpcs } from '../src/game/npcs/npc-runtime'
import {
    NPC_MODEL_KINDS,
    NPC_MODEL_LABELS,
    NPC_DEFAULT_HP,
    SHIELD_SPEARMAN_DEFAULT_HP,
    TROLL_DEFAULT_HP,
    TROLL_OUTFIT_KINDS,
    TROLL_OUTFIT_LABELS,
    defaultNpcBeard,
    defaultNpcEquipment,
    defaultNpcVariant,
    damageNpc,
    normalizeNpcConfig,
    npcAttackClip,
    npcDefaultHp,
    npcInteractionZoneId,
    npcObstacleId,
    npcShieldGuardState,
    type NpcConfig,
    type TrollOutfitKind,
} from '../src/game/npcs/npc-types'
import { provokeFromPlayerAttack, setNpcFlee } from '../src/game/npcs/npc-ai'

function npc(id: string): NpcConfig {
    return normalizeNpcConfig({
        id,
        name: 'Keeper Arlen',
        model: 'keeper-arlen',
        position: { x: 2, y: 3, z: 4 },
        yaw: 0.25,
        scale: 1.1,
        interactionPrompt: 'Talk',
        scriptSource: `on('level-start', () => log(NPC_NAME))`,
    })
}

test('NPC model registry exposes humanoid, troll, and creature models', () => {
    assert.deepEqual([...NPC_MODEL_KINDS], ['keeper', 'keeper-arlen', 'player', 'large-troll', 'rabbit', 'archer', 'shield-warrior', 'shield-spearman'])
    assert.deepEqual([...TROLL_OUTFIT_KINDS], ['wise', 'guardian', 'king', 'princess', 'trader', 'child'])
    assert.equal(NPC_MODEL_LABELS.keeper, 'Dwarf')
    assert.equal(NPC_MODEL_LABELS['keeper-arlen'], 'Keeper Arlen')
    assert.equal(NPC_MODEL_LABELS.rabbit, 'Rabbit')
    assert.equal(NPC_MODEL_LABELS.archer, 'Archer')
    assert.equal(NPC_MODEL_LABELS['shield-warrior'], 'Shield Warrior')
    assert.equal(NPC_MODEL_LABELS['shield-spearman'], 'Shield Spearman')
    assert.equal(TROLL_OUTFIT_LABELS.king, 'Troll King')
    assert.equal(TROLL_OUTFIT_LABELS.princess, 'Troll Princess')
    for (const kind of NPC_MODEL_KINDS) {
        assert.ok(NPC_MODEL_LABELS[kind].length > 0)
        const model = createNpcModel(kind)
        assert.ok(model instanceof Group)
        assert.equal(model.name, `NpcModel:${kind}`)
        assert.ok(model.children.length > 0, `${kind} model should contain visible parts`)
    }
    assert.ok(findByName(createNpcModel('keeper'), 'CharacterBeardFull'), 'keeper defaults to a full beard')
    const arlen = createNpcModel('keeper-arlen')
    assert.ok(findByName(arlen, 'KeeperArlenHood'), 'Keeper Arlen has a distinct hood')
    assert.ok(findByName(arlen, 'KeeperArlenLongRobe'), 'Keeper Arlen keeps the long robe silhouette')
    assert.ok(findByName(arlen, 'KeeperArlenSleeveL'), 'Keeper Arlen has short sleeve arms')
    assert.equal(findByName(arlen, 'KeeperArlenLongRobe')?.parent?.name, 'Figure', 'long robe covers the leg rig')
    assert.equal(findByName(arlen, 'KeeperArlenLeftLens')?.parent?.name, 'Head', 'glasses ride the animated head')
    assert.equal(findByName(arlen, 'KeeperArlenRobeHem')?.parent?.name, 'Figure', 'robe hem rides the animated body')
    assert.ok(findByName(createNpcModel('player', { beard: 'pointed' }), 'CharacterBeardPointed'), 'player NPC can opt into a beard')
    const spearman = createNpcModel('shield-spearman')
    assert.ok(findByName(spearman, 'ShieldSpearmanBrigandine'), 'shield spearman has a mail coat')
    assert.ok(findByName(spearman, 'ShieldSpearmanVisor'), 'shield spearman has a guarded helm')
    const guardian = createNpcModel('large-troll', { variant: 'guardian' })
    assert.ok(findByName(guardian, 'LargeTrollGuardianBreastplate'), 'Guardian troll wears armor')
    assert.ok(findByName(guardian, 'CharacterBeardFull'), 'Guardian troll defaults to a full beard')
    assert.equal(findByName(guardian, 'LargeTrollLeftLens'), null, 'Guardian troll has no Wise Troll glasses')
    assert.equal(findByName(guardian, 'Cloak'), null, 'Guardian troll has no cloak')

    const markers: Record<TrollOutfitKind, string> = {
        wise: 'LargeTrollLeftLens',
        guardian: 'LargeTrollGuardianBreastplate',
        king: 'LargeTrollKingCrown',
        princess: 'LargeTrollPrincessTiaraBand',
        trader: 'LargeTrollTraderPack',
        child: 'LargeTrollChildCap',
    }
    for (const variant of TROLL_OUTFIT_KINDS) {
        const model = createNpcModel('large-troll', { variant })
        assert.ok(findByName(model, markers[variant]), `${variant} troll has a distinct marker mesh`)
    }
})

test('NPC appearance and equipment normalize from model defaults and custom choices', () => {
    const dwarf = normalizeNpcConfig({
        id: 'dwarf',
        model: 'keeper',
        position: { x: 0, y: 0, z: 0 },
    })
    assert.equal(dwarf.beard, 'full')
    assert.deepEqual(dwarf.equipment, defaultNpcEquipment('keeper'))

    const arlen = normalizeNpcConfig({
        id: 'arlen',
        model: 'keeper-arlen',
        position: { x: 0, y: 0, z: 0 },
    })
    assert.equal(arlen.beard, 'full')
    assert.deepEqual(arlen.equipment, defaultNpcEquipment('keeper-arlen'))

    const troll = normalizeNpcConfig({
        id: 'troll',
        model: 'large-troll',
        position: { x: 0, y: 0, z: 0 },
    })
    assert.equal(troll.variant, defaultNpcVariant('large-troll'))
    assert.equal(troll.beard, 'pointed')
    assert.deepEqual(troll.equipment, { handR: null, handL: 'book' })
    assert.deepEqual(troll.equipment, defaultNpcEquipment('large-troll', 'wise'))
    assert.equal(npcAttackClip(troll), 'attack')

    const guardian = normalizeNpcConfig({
        id: 'guardian',
        model: 'large-troll',
        variant: 'guardian',
        position: { x: 0, y: 0, z: 0 },
    })
    assert.equal(guardian.beard, defaultNpcBeard('large-troll', 'guardian'))
    assert.deepEqual(guardian.equipment, { handR: 'battle-hammer', handL: null })
    assert.equal(npcAttackClip(guardian), 'hammerAttack')

    const king = normalizeNpcConfig({
        id: 'king',
        model: 'large-troll',
        variant: 'king',
        position: { x: 0, y: 0, z: 0 },
    })
    assert.equal(king.beard, 'full')
    assert.deepEqual(king.equipment, { handR: 'staff-crystal', handL: null })
    assert.equal(npcAttackClip(king), 'staffAttack')

    const princess = normalizeNpcConfig({
        id: 'princess',
        model: 'large-troll',
        variant: 'princess',
        position: { x: 0, y: 0, z: 0 },
    })
    assert.equal(princess.beard, 'none')
    assert.deepEqual(princess.equipment, { handR: null, handL: null })

    const trader = normalizeNpcConfig({
        id: 'trader',
        model: 'large-troll',
        variant: 'trader',
        position: { x: 0, y: 0, z: 0 },
    })
    assert.equal(trader.beard, 'full')
    assert.deepEqual(trader.equipment, { handR: null, handL: 'book' })

    const child = normalizeNpcConfig({
        id: 'child',
        model: 'large-troll',
        variant: 'child',
        position: { x: 0, y: 0, z: 0 },
    })
    assert.equal(child.beard, 'none')
    assert.deepEqual(child.equipment, { handR: null, handL: null })

    assert.equal(npcDefaultHp(dwarf), NPC_DEFAULT_HP)
    assert.equal(npcDefaultHp(troll), TROLL_DEFAULT_HP)
    assert.equal(npcDefaultHp(guardian), TROLL_DEFAULT_HP)

    const spearman = normalizeNpcConfig({
        id: 'spearman',
        model: 'shield-spearman',
        position: { x: 0, y: 0, z: 0 },
    })
    assert.equal(spearman.beard, 'short')
    assert.deepEqual(spearman.equipment, { handR: 'spear', handL: 'shield' })
    assert.equal(npcAttackClip(spearman), 'spearAttack')
    assert.equal(npcDefaultHp(spearman), SHIELD_SPEARMAN_DEFAULT_HP)
    assert.ok(npcShieldGuardState(spearman), 'shield spearman should use a raised front guard')

    // The sword-and-board warrior carries a shield too, so it must fight behind
    // a raised guard and advance defended (mirrors the player's block).
    const warrior = normalizeNpcConfig({
        id: 'warrior',
        model: 'shield-warrior',
        position: { x: 0, y: 0, z: 0 },
    })
    assert.deepEqual(warrior.equipment, { handR: 'sword', handL: 'shield' })
    assert.ok(npcShieldGuardState(warrior), 'shield warrior should use a raised front guard')

    // A shieldless humanoid never raises a guard.
    const swordsman = normalizeNpcConfig({
        id: 'swordsman',
        model: 'keeper',
        position: { x: 0, y: 0, z: 0 },
        equipment: { handR: 'sword', handL: null },
    })
    assert.equal(npcShieldGuardState(swordsman), undefined, 'no shield, no guard')

    const custom = normalizeNpcConfig({
        id: 'custom',
        model: 'keeper',
        position: { x: 0, y: 0, z: 0 },
        beard: 'short',
        equipment: { handR: 'sword', handL: 'bogus' } as never,
    })
    assert.equal(custom.beard, 'short')
    assert.deepEqual(custom.equipment, { handR: 'sword', handL: null })
})

test('registerRuntimeNpcs adds interaction zones, collision obstacles, and scripts', () => {
    const world = createGameWorld()
    const config = npc('arlen')
    const runtime = registerRuntimeNpcs(world, [config])

    const zoneId = npcInteractionZoneId(config)
    const zone = world.zones.get(zoneId)
    assert.ok(zone, 'interaction zone should be defined')
    assert.equal(zone!.kind, 'interact')
    assert.equal(zone!.interaction?.prompt, 'Talk')

    const obstacleId = npcObstacleId(config, 0)
    assert.equal(world.obstacles.has(obstacleId), true)
    assert.equal(world.obstacles.intersects({
        minX: 1.9,
        minY: 3.1,
        minZ: 3.9,
        maxX: 2.1,
        maxY: 3.5,
        maxZ: 4.1,
    }), true)

    assert.equal(runtime.scripts.length, 1)
    assert.equal(runtime.scripts[0]?.id, 'npc-script:arlen')
    assert.match(runtime.scripts[0]!.source, /const NPC_NAME = "Keeper Arlen"/)
    assert.match(runtime.scripts[0]!.source, /npc\.arlen\.interact/)

    runtime.dispose()
    assert.equal(world.zones.has(zoneId), false)
    assert.equal(world.obstacles.has(obstacleId), false)
})

test('registerRuntimeNpcs gives large trolls the troll default HP pool', () => {
    const world = createGameWorld()
    const config = normalizeNpcConfig({
        id: 'guardian',
        model: 'large-troll',
        variant: 'guardian',
        position: { x: 0, y: 0, z: 0 },
    })
    const runtime = registerRuntimeNpcs(world, [config])
    const npc = world.npcRuntimeById.get('guardian')

    assert.equal(npc?.hp, TROLL_DEFAULT_HP)
    assert.equal(npc?.maxHp, TROLL_DEFAULT_HP)

    runtime.dispose()
})

test('registerRuntimeNpcs enables shield guard state for spear and shield enemies', () => {
    const world = createGameWorld()
    const config = normalizeNpcConfig({
        id: 'spearman',
        model: 'shield-spearman',
        position: { x: 0, y: 0, z: 0 },
    })
    const runtime = registerRuntimeNpcs(world, [config])
    const npc = world.npcRuntimeById.get('spearman')

    assert.equal(npc?.attackClip, 'spearAttack')
    assert.equal(npc?.shieldGuard?.raised, false)
    assert.ok((npc?.shieldGuard?.arcCos ?? 1) < 0.5, 'front guard should cover a broad forward arc')

    runtime.dispose()
})

test('damageNpc records a player provocation only on a surviving hit', () => {
    const world = createGameWorld()
    const runtime = registerRuntimeNpcs(world, [
        normalizeNpcConfig({ id: 'grunt', model: 'keeper', position: { x: 0, y: 0, z: 0 } }),
        normalizeNpcConfig({ id: 'arlen', model: 'keeper-arlen', position: { x: 0, y: 0, z: 0 }, unprovokable: true }),
    ])
    const grunt = world.npcRuntimeById.get('grunt')!
    const arlen = world.npcRuntimeById.get('arlen')!
    assert.equal(grunt.unprovokable, false, 'a normal NPC is provokable')
    assert.equal(arlen.unprovokable, true, 'the config flag mirrors to runtime')

    // damageNpc only *records* the hit — it never touches the brain (that's the
    // behaviour system's job), so no `ai` is allocated here.
    damageNpc(grunt, 1, { byPlayer: true })
    assert.equal(grunt.provoked, true, 'a surviving player hit is recorded')
    assert.equal(grunt.ai, null, 'damageNpc never allocates a brain')

    // A lethal player hit kills outright and never flags a corpse for combat.
    grunt.provoked = false
    damageNpc(grunt, grunt.hp, { byPlayer: true })
    assert.equal(grunt.dying, true)
    assert.equal(grunt.provoked, false, 'a killing blow does not provoke a corpse')

    // Non-player damage never provokes.
    damageNpc(arlen, 1)
    assert.equal(arlen.provoked, undefined, 'environmental/NPC damage does not provoke')

    runtime.dispose()
})

test('provokeFromPlayerAttack turns the struck NPC hostile, sparing prey and the unprovokable', () => {
    const world = createGameWorld()
    const runtime = registerRuntimeNpcs(world, [
        normalizeNpcConfig({ id: 'grunt', model: 'keeper', position: { x: 0, y: 0, z: 0 } }),
        normalizeNpcConfig({ id: 'arlen', model: 'keeper-arlen', position: { x: 0, y: 0, z: 0 }, unprovokable: true }),
        normalizeNpcConfig({ id: 'bunny', model: 'rabbit', position: { x: 0, y: 0, z: 0 } }),
    ])
    const grunt = world.npcRuntimeById.get('grunt')!
    const arlen = world.npcRuntimeById.get('arlen')!
    const bunny = world.npcRuntimeById.get('bunny')!

    // A normal NPC gains a brain on the spot and treats the player as an enemy.
    provokeFromPlayerAttack(grunt)
    assert.equal(grunt.ai?.hostileToPlayer, true, 'a struck NPC fights back')

    // The unprovokable NPC stays brain-less and neutral.
    provokeFromPlayerAttack(arlen)
    assert.equal(arlen.ai, null, 'an unprovokable NPC is never provoked')

    // Prey keeps fleeing rather than turning to fight.
    setNpcFlee(world, 'bunny', true)
    provokeFromPlayerAttack(bunny)
    assert.equal(bunny.ai?.hostileToPlayer, false, 'a struck rabbit flees, it does not engage')
    assert.equal(bunny.ai?.flee, true)

    runtime.dispose()
})

test('NPC renderer tracks add, move, and remove changes', () => {
    const scene = new Scene()
    const npcs = [npc('arlen')]
    const system = createNpcRenderSystem(scene, { getNpcs: () => npcs })

    system.init?.(createGameWorld())
    const group = scene.children.find((child) => child.name === 'NPCs') as Group | undefined
    assert.ok(group, 'renderer should add an NPC root group')
    assert.equal(group!.children.length, 1)
    assert.equal(group!.children[0]!.name, 'NPC:arlen')

    const firstRoot = group!.children[0]!
    npcs[0]!.position.x = 5
    system.update(createGameWorld(), 1 / 60)
    assert.equal(group!.children[0], firstRoot, 'moving an NPC should not rebuild its model')
    assert.equal(group!.children[0]!.position.x, 5)

    npcs.length = 0
    system.update(createGameWorld(), 1 / 60)
    assert.equal(group!.children.length, 0)

    system.dispose?.()
    assert.equal(scene.children.includes(group!), false)
})

test('NPC renderer rebuilds visuals when hand equipment changes', () => {
    const scene = new Scene()
    const config = npc('equipped')
    const npcs = [config]
    const system = createNpcRenderSystem(scene, { getNpcs: () => npcs })
    const world = createGameWorld()

    system.init?.(world)
    const group = scene.children.find((child) => child.name === 'NPCs') as Group | undefined
    assert.ok(group)
    assert.ok(findByName(group!, 'equip:staff'), 'Keeper Arlen starts with staff equipment')
    const firstRoot = group!.children[0]!

    config.equipment = { handR: null, handL: 'book' }
    system.update(world, 1 / 60)

    assert.notEqual(group!.children[0], firstRoot, 'equipment change rebuilds socket attachments')
    assert.equal(findByName(group!, 'equip:staff'), null)
    assert.ok(findByName(group!, 'equip:book'))

    const secondRoot = group!.children[0]!
    config.beard = 'short'
    system.update(world, 1 / 60)

    assert.notEqual(group!.children[0], secondRoot, 'appearance change rebuilds the procedural model')
    assert.ok(findByName(group!, 'CharacterBeardShort'))

    const thirdRoot = group!.children[0]!
    config.model = 'large-troll'
    config.variant = 'guardian'
    config.beard = 'full'
    config.equipment = { handR: 'battle-hammer', handL: null }
    system.update(world, 1 / 60)

    assert.notEqual(group!.children[0], thirdRoot, 'variant change rebuilds the procedural model')
    assert.ok(findByName(group!, 'LargeTrollGuardianBreastplate'))
    assert.ok(findByName(group!, 'equip:battle-hammer'))

    system.dispose?.()
})

test('NPC renderer draws static collision boxes and live runtime hitboxes', () => {
    const scene = new Scene()
    const collidable = npc('solid')
    const passable = { ...npc('passable'), id: 'passable', collisionEnabled: false }
    const system = createNpcRenderSystem(scene, { getNpcs: () => [collidable, passable] })
    const world = createGameWorld()

    system.init?.(world)
    system.update(world, 1 / 60)

    const lines = scene.children.find((child) => child.name === 'NPCColliderDebug') as LineSegments | undefined
    assert.ok(lines, 'renderer should add an NPC collider debug batch')
    assert.equal(lines!.visible, true)
    assert.equal(lines!.geometry.drawRange.count, 24, 'one collidable NPC emits one wire box')

    const runtime = registerRuntimeNpcs(world, [collidable, passable])
    system.update(world, 1 / 60)
    assert.equal(lines!.geometry.drawRange.count, 48, 'live NPCs expose damage hitboxes even when non-blocking')

    runtime.dispose()
    system.dispose?.()
    assert.equal(scene.children.includes(lines!), false)
})

function findByName(root: Object3D, name: string): Object3D | null {
    let found: Object3D | null = null
    root.traverse((obj) => {
        if (!found && obj.name === name) found = obj
    })
    return found
}
