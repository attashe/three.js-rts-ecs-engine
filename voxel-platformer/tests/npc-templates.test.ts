import test from 'node:test'
import assert from 'node:assert/strict'
import { NPC_TEMPLATES, applyNpcTemplate, npcTemplateById } from '../src/game/npcs/npc-templates'
import { NPC_MODEL_KINDS } from '../src/game/npcs/npc-types'

const BASE = { id: 'tpl-1', position: { x: 3, y: 5, z: 7 } } as const

test('every template applies to a valid normalized config', () => {
    for (const tpl of NPC_TEMPLATES) {
        const cfg = applyNpcTemplate({ ...BASE }, tpl)
        assert.ok((NPC_MODEL_KINDS as readonly string[]).includes(cfg.model), `${tpl.id}: model ${cfg.model}`)
        assert.equal(cfg.id, 'tpl-1', `${tpl.id}: keeps id`)
        assert.deepEqual(cfg.position, { x: 3, y: 5, z: 7 }, `${tpl.id}: keeps position`)
        // A behaviour block (when present) is internally consistent.
        if (cfg.behaviour) assert.ok(cfg.behaviour.perceptionRadius >= 0)
    }
})

test('template ids are unique and look-up-able', () => {
    const ids = NPC_TEMPLATES.map((t) => t.id)
    assert.equal(new Set(ids).size, ids.length)
    assert.equal(npcTemplateById('hunter')?.label, 'Hunter')
    assert.equal(npcTemplateById('nope'), undefined)
})

test('trader is an invulnerable, unprovokable shopkeeper with a Trade prompt', () => {
    const cfg = applyNpcTemplate({ ...BASE }, npcTemplateById('trader')!)
    assert.equal(cfg.invulnerable, true)
    assert.equal(cfg.unprovokable, true)
    assert.equal(cfg.interactionEnabled, true)
    assert.equal(cfg.interactionPrompt, 'Trade')
    assert.match(cfg.scriptSource, /trade\.open/)
})

test('quest-giver is the essential Arlen archetype', () => {
    const cfg = applyNpcTemplate({ ...BASE }, npcTemplateById('quest-giver')!)
    assert.equal(cfg.model, 'keeper-arlen')
    assert.equal(cfg.invulnerable, true)
    assert.equal(cfg.unprovokable, true)
})

test('guard / patrol / hunter are hostile combatants with the right modes', () => {
    const guard = applyNpcTemplate({ ...BASE }, npcTemplateById('guard')!)
    assert.equal(guard.behaviour?.mode, 'guard')
    assert.equal(guard.behaviour?.hostileToPlayer, true)
    assert.equal(guard.interactionEnabled, false)

    const patrol = applyNpcTemplate({ ...BASE }, npcTemplateById('patrol')!)
    assert.equal(patrol.behaviour?.mode, 'patrol')

    const hunter = applyNpcTemplate({ ...BASE }, npcTemplateById('hunter')!)
    assert.equal(hunter.behaviour?.mode, 'hunter')
    assert.equal(hunter.behaviour?.threatMemorySeconds, 8)
})

test('animal is a non-colliding, fleeing rabbit', () => {
    const cfg = applyNpcTemplate({ ...BASE }, npcTemplateById('animal')!)
    assert.equal(cfg.model, 'rabbit')
    assert.equal(cfg.collisionEnabled, false)
    assert.equal(cfg.behaviour?.mode, 'prey')
    assert.equal(cfg.behaviour?.flee, true)
})

test('hostile spider is a small colliding hunter', () => {
    const cfg = applyNpcTemplate({ ...BASE }, npcTemplateById('hostile-spider')!)
    assert.equal(cfg.model, 'spider')
    assert.equal(cfg.collisionEnabled, true)
    assert.equal(cfg.interactionEnabled, false)
    assert.equal(cfg.colliderRadius, 0.32)
    assert.equal(cfg.colliderHeight, 0.42)
    assert.equal(cfg.behaviour?.mode, 'hunter')
    assert.equal(cfg.behaviour?.hostileToPlayer, true)
})

test('applying a template resets model-derived equipment to the new model default', () => {
    // Start from a keeper draft carrying a staff, switch to the rabbit template.
    const cfg = applyNpcTemplate({ ...BASE, model: 'keeper', equipment: { handR: 'staff', handL: null } }, npcTemplateById('animal')!)
    assert.equal(cfg.model, 'rabbit')
    assert.deepEqual(cfg.equipment, { handR: null, handL: null }) // rabbit default, not the stale staff
})
