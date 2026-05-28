# Engine-system skills

Project skills that make recurring edits to this engine's subsystems
fast and safe. Each skill captures the *map* of one subsystem — where its
code lives, the contract it exposes, the gotchas that aren't obvious from
reading one file, and the end-to-end recipe for extending it — so a fresh
session doesn't have to re-derive all of that from scratch.

Claude Code auto-discovers any `.claude/skills/<name>/SKILL.md` and offers
it by the `name:` in its frontmatter. A skill is invoked when the user
types `/<name>` or when the task matches the skill's `description:`.

## Skills

| Skill | Subsystem | Use when |
| ----- | --------- | -------- |
| [`voxel-script-authoring`](./voxel-script-authoring/SKILL.md) | In-game script engine (`voxel-platformer/src/engine/script/`) | Writing/editing level `.js` scripts (quests, cinematics, triggers, NPC dialogue) or changing the script API surface |

## Anatomy of an engine-system skill

```
voxel-script-authoring/
  SKILL.md              # router + the 90%-case playbook (kept short)
  reference/
    api-cheatsheet.md   # the full contract, condensed for lookup
    gotchas.md          # the non-obvious traps, each with the why
    extending.md        # the end-to-end recipe for adding to the subsystem
```

`SKILL.md` stays lean — it loads into context on invocation, so it holds
the decision tree and the common path, and points to `reference/*` for
detail Claude reads only when the task needs it (progressive disclosure).

## Adding a skill for another subsystem

Pick a subsystem with a stable contract and recurring edits — good
candidates here: **rendering/FX** (`src/engine/fx/`, weather + day-cycle +
particle zones), **voxel/chunks** (`src/engine/voxel/`), **audio**
(`src/engine/audio/`), **ECS systems** (`src/engine/ecs/systems/`), or the
**editor tabs** (`src/editor/ui/`). Then:

1. `mkdir .claude/skills/<subsystem>/` with a `SKILL.md` + `reference/`.
2. Frontmatter: a unique `name:` and a `description:` that names the
   trigger files/keywords (this is what routing matches on — be concrete).
3. In the body: the file map (what lives where), the contract, the
   gotchas (each with *why*, not just *what*), and the
   types→glue→docs→test recipe for extending it.
4. Add a row to the table above.
5. Verify edits with that subsystem's test command, and say so.

Keep each skill scoped to one subsystem. A skill that tries to cover the
whole engine routes poorly and loads too much into context.
