/**
 * NPC templates — one-click archetypes for the editor.
 *
 * Each template returns a partial `NpcConfig` (model, equipment hints, essential
 * flags, structured `behaviour`, and an optional custom `scriptSource` starter).
 * The tab merges it over the draft / selected NPC and runs it through
 * `normalizeNpcConfig`, so model-dependent defaults (beard / equipment / voice)
 * fill in automatically. Behaviour is compiled to a `level-start` script by
 * `npc-behaviour-script.ts`; the runtime stays script-driven.
 *
 * The interaction-script starters (dialogue / choice / quest / trade) live here
 * too so both the template registry and the tab's "Interaction template" buttons
 * share one source.
 */
import {
    DEFAULT_NPC_BEHAVIOUR,
    normalizeNpcConfig,
    type NpcBehaviourConfig,
    type NpcConfig,
} from './npc-types'

export interface NpcTemplate {
    id: string
    label: string
    emoji: string
    description: string
    /** The partial config this archetype produces (merged over the draft). */
    build(): Partial<NpcConfig>
}

function behaviour(over: Partial<NpcBehaviourConfig>): NpcBehaviourConfig {
    return { ...DEFAULT_NPC_BEHAVIOUR, ...over, waypoints: over.waypoints ?? [] }
}

export const NPC_TEMPLATES: readonly NpcTemplate[] = [
    {
        id: 'trader', label: 'Trader', emoji: '🪙',
        description: 'A shopkeeper who opens a buy/sell menu. Invulnerable & never provoked.',
        build: () => ({
            model: 'keeper',
            equipment: { handR: null, handL: 'book' }, // merchant's ledger, not a staff
            invulnerable: true,
            unprovokable: true,
            interactionEnabled: true,
            interactionPrompt: 'Trade',
            behaviour: behaviour({ mode: 'none' }),
            scriptSource: traderScriptTemplate('keeper'),
        }),
    },
    {
        id: 'quest-giver', label: 'Quest-giver', emoji: '❗',
        description: 'An essential character who hands out a collection quest. Cannot be harmed or provoked.',
        build: () => ({
            model: 'keeper-arlen',
            invulnerable: true,
            unprovokable: true,
            interactionEnabled: true,
            interactionPrompt: 'Talk',
            behaviour: behaviour({ mode: 'none' }),
            scriptSource: collectionQuestTemplate('keeper'),
        }),
    },
    {
        id: 'dialogue', label: 'Dialogue NPC', emoji: '💬',
        description: 'A talker with a branching conversation. Won’t start a fight if mishit.',
        build: () => ({
            model: 'keeper',
            unprovokable: true,
            interactionEnabled: true,
            interactionPrompt: 'Talk',
            behaviour: behaviour({ mode: 'none' }),
            scriptSource: choiceDialogueTemplate('keeper'),
        }),
    },
    {
        id: 'guard', label: 'Guard', emoji: '🛡️',
        description: 'Sword-and-shield enemy that holds a post and attacks the player on sight.',
        build: () => ({
            model: 'shield-warrior',
            interactionEnabled: false,
            behaviour: behaviour({ mode: 'guard', hostileToPlayer: true, perceptionRadius: 7 }),
        }),
    },
    {
        id: 'patrol', label: 'Patrol enemy', emoji: '⚔️',
        description: 'Spearman that walks a route and engages the player when it spots them.',
        build: () => ({
            model: 'shield-spearman',
            interactionEnabled: false,
            behaviour: behaviour({ mode: 'patrol', hostileToPlayer: true, perceptionRadius: 9 }),
        }),
    },
    {
        id: 'hunter', label: 'Hunter', emoji: '🏹',
        description: 'Archer that pursues your last-known spot — sniping won’t shake it.',
        build: () => ({
            model: 'archer',
            interactionEnabled: false,
            behaviour: behaviour({ mode: 'hunter', hostileToPlayer: true, perceptionRadius: 10, threatMemorySeconds: 8 }),
        }),
    },
    {
        id: 'animal', label: 'Animal / Prey', emoji: '🐇',
        description: 'A skittish critter that wanders and flees the player. Never fights.',
        build: () => ({
            model: 'rabbit',
            scale: 1.3,
            collisionEnabled: false,
            colliderRadius: 0.25,
            colliderHeight: 0.6,
            interactionEnabled: false,
            behaviour: behaviour({ mode: 'prey', flee: true, perceptionRadius: 8 }),
        }),
    },
    {
        id: 'blank', label: 'Blank', emoji: '⬜',
        description: 'A plain NPC with no behaviour — start from scratch.',
        build: () => ({
            interactionEnabled: true,
            behaviour: behaviour({ mode: 'none' }),
            scriptSource: '',
        }),
    },
]

export function npcTemplateById(id: string): NpcTemplate | undefined {
    return NPC_TEMPLATES.find((t) => t.id === id)
}

/**
 * Apply a template over a base config, preserving the author's id / position /
 * name, and resetting model-derived fields (equipment / voice / beard) to the
 * new model's defaults unless the template sets them. Returns a normalized
 * config ready to drop into the level.
 */
export function applyNpcTemplate(
    base: Pick<NpcConfig, 'id' | 'position'> & Partial<NpcConfig>,
    template: NpcTemplate,
): NpcConfig {
    const partial = template.build()
    return normalizeNpcConfig({
        ...base,
        ...partial,
        id: base.id,
        position: base.position,
        name: base.name || partial.name,
        // A model change must recompute these from the new model's defaults, so
        // pass the template's value (often undefined ⇒ normalize fills default).
        equipment: partial.equipment,
        voice: partial.voice,
        beard: partial.beard,
    })
}

// ─── Interaction-script starters (shared with the tab's template buttons) ──────
// All use the runtime prelude constants (NPC_ID / NPC_NAME / NPC_VOICE /
// NPC_INTERACTION) so the title/name track the NPC's real name with no rebake.

export function simpleDialogueTemplate(avatar: string): string {
    return `on('input', { action: 'interact', targetId: NPC_INTERACTION }, async () => {
  await ui.dialogue({
    title: NPC_NAME,
    npc: { id: NPC_ID, name: NPC_NAME, avatar: ${JSON.stringify(avatar)}, voice: NPC_VOICE },
    player: { id: 'player', name: 'You', avatar: 'player', voice: { preset: 'player' } },
    lines: [
      { speaker: NPC_ID, text: 'Hello, traveler.' },
    ],
  })
})`
}

export function choiceDialogueTemplate(avatar: string): string {
    return `on('input', { action: 'interact', targetId: NPC_INTERACTION }, async () => {
  const result = await ui.dialogue({
    title: NPC_NAME,
    npc: { id: NPC_ID, name: NPC_NAME, avatar: ${JSON.stringify(avatar)}, voice: NPC_VOICE },
    player: { id: 'player', name: 'You', avatar: 'player', voice: { preset: 'player' } },
    lines: [
      { speaker: NPC_ID, text: 'What do you need?' },
      {
        speaker: NPC_ID,
        text: 'Choose your question.',
        choices: [
          { id: 'quest', text: 'Do you have work?' },
          { id: 'bye', text: 'Goodbye.' },
        ],
      },
    ],
  })
  if (result.choiceId === 'quest') {
    log(\`\${NPC_NAME}: maybe later.\`)
  }
})`
}

export function collectionQuestTemplate(avatar: string): string {
    return `const QUEST_STATE = \`npc.\${NPC_ID}.quest.state\`
const ITEM_KIND = \`npc-\${NPC_ID}-item\`
const ITEM_ID = \`npc.\${NPC_ID}.quest.item\`

on('input', { action: 'interact', targetId: NPC_INTERACTION }, async () => {
  const state = flags.get(QUEST_STATE) ?? 'unknown'
  if (state === 'unknown') {
    const result = await ui.dialogue({
      title: NPC_NAME,
      npc: { id: NPC_ID, name: NPC_NAME, avatar: ${JSON.stringify(avatar)}, voice: NPC_VOICE },
      player: { id: 'player', name: 'You', avatar: 'player', voice: { preset: 'player' } },
      lines: [{
        speaker: NPC_ID,
        text: 'I lost something nearby. Can you bring it back?',
        choices: [
          { id: 'accept', text: 'I will find it.' },
          { id: 'later', text: 'Not now.' },
        ],
      }],
    })
    if (result.choiceId !== 'accept') return
    flags.set(QUEST_STATE, 'active')
    const p = player.getPosition()
    pickups.spawn(ITEM_KIND, { x: p.x + 2, y: p.y, z: p.z }, { id: ITEM_ID, label: 'Quest Item' })
    audio.play('sfx.quest.chime')
    return
  }
  if (state === 'ready') {
    flags.set(QUEST_STATE, 'done')
    pickups.spawn('coin', player.getPosition(), { amount: 25, label: \`\${NPC_NAME}'s reward\` })
    audio.play('sfx.quest.fanfare')
    await ui.dialogue({
      title: NPC_NAME,
      npc: { id: NPC_ID, name: NPC_NAME, avatar: ${JSON.stringify(avatar)}, voice: NPC_VOICE },
      player: { id: 'player', name: 'You', avatar: 'player', voice: { preset: 'player' } },
      lines: [{ speaker: NPC_ID, text: 'Thank you. Take this.' }],
    })
  }
})

on('pickup-taken', { kind: ITEM_KIND }, (event) => {
  if (event.pickupId !== ITEM_ID || flags.get(QUEST_STATE) !== 'active') return
  flags.set(QUEST_STATE, 'ready')
  log(\`Return to \${NPC_NAME}.\`)
})`
}

export function traderScriptTemplate(avatar: string): string {
    return `const SHOP = {
  id: \`shop.\${NPC_ID}\`,
  title: NPC_NAME,
  npc: { id: NPC_ID, name: NPC_NAME, avatar: ${JSON.stringify(avatar)}, side: 'left', voice: NPC_VOICE },
  currency: 'gold',
  items: [
    {
      id: 'arrows.bundle', name: 'Arrow bundle',
      description: 'Five arrows on straight shafts.',
      resource: 'arrows', unitSize: 5, buyPrice: 3, sellPrice: 1, stock: 20,
    },
    {
      id: 'heal-potion', name: 'Healing potion',
      description: 'Restores a chunk of health.',
      resource: 'heal-potion', unitSize: 1, buyPrice: 8, sellPrice: 3, stock: 5,
    },
  ],
}

on('input', { action: 'interact', targetId: NPC_INTERACTION }, () => {
  void openShop()
})

async function openShop() {
  const result = await trade.open(SHOP)
  if (result.status === 'bought') {
    ui.say(NPC_INTERACTION, \`A fine choice — \${result.itemName}.\`, { seconds: 3 })
  } else if (result.status === 'sold') {
    ui.say(NPC_INTERACTION, \`Fair price for \${result.itemName}.\`, { seconds: 3 })
  } else if (result.status === 'unavailable' && result.reason) {
    ui.say(NPC_INTERACTION, result.reason, { seconds: 3 })
  }
}`
}
