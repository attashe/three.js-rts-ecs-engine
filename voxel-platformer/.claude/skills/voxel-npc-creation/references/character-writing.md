# Character writing reference

## Identity Block

Before coding, write this compact block and let it guide the implementation:

```text
Name:
Role:
One-line description:
Visual hooks:
Voice: generated voice preset/seed plus speech style
Interaction prompt:
Gameplay function:
Quest/shop/script hooks:
```

## Naming

- Match the level culture and function: `Keeper Arlen`, `Floating Sundial`,
  `Large Troll Curator`.
- Use title + name for quest givers when status matters; use descriptive names
  for object-like NPCs.
- Avoid joke names, modern slang, or random fantasy syllables unless the level
  already uses that tone.

## Description

Write descriptions that map to modelable features:

- Good: "A tall, careful archivist with brass spectacles, a heavy brow, and a
  red ledger tucked under one arm."
- Weak: "A mysterious troll who seems interesting."

Every description should imply at least two visible model decisions and one
dialogue behavior.

## Dialogue

- Give each NPC one useful thing to do in the level.
- Keep lines short enough for the modal dialogue panel.
- Use choices for player agency: ask for context, accept/refuse a quest, trade,
  return later.
- Use floating `ui.say` only for quick feedback after interactions,
  purchases, item pickup hints, or quest state changes. Floating messages are
  intentionally silent.
- Use `ui.dialogue` for lines that should speak. Put `voice` on the NPC/player
  speaker for a stable generated fantasy-babble tone, and override per line
  only for special effects.

Dialogue helper shape:

```js
async function npcDialogue(lines) {
  return ui.dialogue({
    title: NPC_NAME,
    npc: { id: NPC_ID, name: NPC_NAME, avatar: 'npc', voice: NPC_VOICE },
    player: { id: 'player', name: 'You', avatar: 'player', voice: { preset: 'player' } },
    lines,
  })
}
```

For shops, add a dialogue choice and call `trade.open(...)` after the modal
resolves. Do not mix transaction math into dialogue text.
