# Melee Combat Notes And Improvement Proposal

This document records the current lightweight combat surface and the next
proposal for turning the current "instant" melee into readable, committal,
production-feeling combat with telegraphed attacks and player mobility
(dashes).

## Current state (grounded in code)

- **Player attack** (`src/engine/ecs/systems/melee-attack-system.ts`): on the
  Attack press, damage is applied **immediately** in the same tick (`applyMeleeHit`),
  while the swing animation is merely triggered. It alternates thrust/swing and
  locks re-attack for `0.44`/`0.56s`. There is no wind-up — the hit lands on
  frame 0, before the visible swing.
- **NPC attack** (`src/engine/ecs/systems/npc-behaviour-system.ts`, `tryAttack`):
  damage is applied **instantly** on an attack cooldown; `requestAttack` plays the
  swing but the hit isn't synced to it, and there is **no telegraph** for the
  player to react to.
- **No animation notify/event system** yet — though `docs/animation-system-review.md`
  (§1) already proposes adding clip notifies and moving melee damage onto them.
- **No dash / dodge**; the player has HighJump + AirPush only.
- **Shield block** exists but is a passive auto-guard (raised while stationary in
  melee stance — `src/game/player-shield-system.ts`).
- **Scripted NPC hostility/pathing** exists through `npc.setHostile`,
  `npc.setPerceptionRadius`, `npc.setWaypoints`, `npc.goTo`, and `npc.stop`.
  There is no faction table: a script decides who is hostile to whom.

## Current player-facing behavior

- `V` triggers melee attack when grounded and not already in attack/shoot.
- Attacks alternate thrust and wide swing:
  - thrust has longer reach, a tighter forward wedge, and hits the nearest NPC;
  - wide swing has a broad front-hemisphere arc and can cleave multiple NPCs.
- `F` shoots the bow when grounded and in a valid combat state.
- The shield raises automatically only while the player is grounded, in melee
  stance, and nearly stationary. Moving, jumping, or switching stance lowers it.
- Hostile NPCs can patrol/guard, spot targets inside perception radius, path to
  attack range, and apply a simple 1 HP hit if the shield arc does not block it.

This is intentionally lean: it gives scripts enough hooks for guards and small
encounters while keeping the deeper combat-feel work below as a separate,
tunable upgrade.

## Goals

1. **Readable, committal attacks** — anticipation → strike → recovery, so swings
   are deliberate, not spam.
2. **Telegraphed enemy attacks** — a clear preparation stage that signals the
   player to block or dodge.
3. **Player mobility** — a dash to close distance and dodge, rewarding timing.
4. **Production game feel** — hitstop, knockback, hit flash, audio, camera shake.

---

## Proposal

### 1. Phase every attack: wind-up → active → recovery (the core)

Model an attack as a timeline, not an instant:

| Phase | Player (thrust / swing) | Enemy | What happens |
| --- | --- | --- | --- |
| **Wind-up** (anticipation) | ~0.12s / ~0.20s | ~0.35–0.50s (longer, readable) | swing rears back; **no hitbox**. This *is* the telegraph. |
| **Active** (strike) | ~0.06–0.10s | ~0.08s | hitbox live; **damage applies here, once per target**. |
| **Recovery** (follow-through) | ~0.20s / ~0.32s | ~0.3s | locked out of a new attack; movement damped, so the swing is committal. |

Thrust = short wind-up, long reach, tight arc; swing = longer wind-up, wide arc,
more recovery. Keep all timings as named constants for playtest tuning.

Implementation: replace the instant `applyMeleeHit` with a tiny per-attacker
attack-state (phase + timer). Damage fires at the **start of the active window**,
recording struck targets so each is hit at most once per swing.

### 2. Sync the hit to the animation (notifies)

Build on the already-planned notify system (`animation-system-review.md` §1):
add named clip events (`melee-hit-start` / `melee-hit-end`) to the attack clips;
`AnimationController.update()` emits them as clip time crosses the timestamp;
melee damage moves into the `melee-hit-start` handler. The hitbox then lands
exactly on the visible swing — the single biggest "feels professional" win, and
it's already on the animation roadmap.

*Fallback until notifies land:* the timer-based active window from #1 is a clean
drop-in and can be swapped for notifies later without changing the feel.

### 3. Telegraphed enemy attacks (so the player can react)

Give NPC attacks the same wind-up → active → recovery, with the wind-up made
**deliberately readable**:

- On entering wind-up: hold the rear-back pose, and add a telegraph — a brief
  emissive tint on the NPC (the chunk/material emissive path already exists), a
  small "!" indicator, and/or a ground attack-arc decal — plus a wind-up SFX.
- Apply damage only on the active frame, gated by the existing shield-arc check.
- Tune the enemy wind-up longer than the player's so it's reliably reactable.

In `npc-behaviour-system.ts`, replace the instant `tryAttack` with: enter a
`winding-up` state (timer) → on expiry run the arc/shield check and apply damage
→ enter a recovery cooldown. `requestAttack` still drives the swing animation;
the damage now lands mid-swing.

### 4. Player dash (mobility)

New `player-dash-system` + a `Dash` action (dedicated key, or double-tap a
movement direction):

- Short, strong horizontal impulse along the input/facing direction (~0.15s).
- Brief **i-frames** (~0.10–0.12s) — a well-timed dash dodges a telegraphed
  attack (ties into #3). Model as an `Invulnerable` window that `applyDamage`
  honours.
- A cooldown (~0.5–0.8s) so it stays deliberate.
- Optional **dash-attack**: Attack during/just after a dash becomes a lunging
  strike (extra reach, trims recovery) — rewards aggressive play.

Reuses the existing fixed-step + physics-velocity pattern (mirrors AirPush /
HighJump).

### 5. Game feel (the production polish)

- **Hitstop** — on a connecting hit, freeze the involved actors ~40–70ms (scale
  their dt to ~0 for a couple of ticks; **do not** pause the scheduler — keep the
  fixed-step sim intact).
- **Knockback** — push the struck target a short distance along the hit normal
  (rigid-body impulse).
- **Hit flash** — briefly tint the struck mesh (emissive pulse).
- **Camera shake** — tiny iso-camera offset on hit / parry.
- **Audio layering** — distinct wind-up whoosh, impact thud, block clang, miss
  whiff (the audio engine + `player-audio` already exist).
- **Parry** — if the player raises the shield within a small window of the
  enemy's active frame, negate the hit **and** stagger the attacker, opening a
  punish window. Turns blocking from passive into a skill.

### 6. Inputs to add (`src/game/actions.ts`)

- `Dash` — the dodge/close-distance burst.
- Optionally a dedicated **hold-to-Block** to replace the stationary auto-guard
  with intentional blocking (cleaner, and a prerequisite for the parry window).

---

## Suggested phasing

1. **Phase 1 — feel foundation (no anim-engine work):** timer-based
   wind-up→active→recovery for the *player* attack + hitstop + hit flash.
2. **Phase 2 — reactive combat:** enemy attack telegraph (wind-up pose +
   indicator + delayed damage).
3. **Phase 3 — mobility:** player dash + i-frames + dash-attack.
4. **Phase 4 — frame accuracy + impact:** animation notifies (replace timers),
   knockback, camera shake, layered audio.
5. **Phase 5 — depth:** intentional block + parry window.

## Files this touches

- `src/engine/ecs/systems/melee-attack-system.ts` — phase the player attack.
- `src/engine/ecs/systems/npc-behaviour-system.ts` — telegraphed enemy attack.
- `src/engine/anim/runtime/animation-controller.ts` + clip defs — notifies.
- `src/game/anim/graph-defaults.ts` — attack/wind-up states.
- new `src/game/player-dash-system.ts`; `src/game/actions.ts` — Dash/Block.
- `src/engine/ecs/combat.ts` — i-frames + hitstop hooks.
- physics/rigid-body (knockback), iso-camera (shake), audio (layers).

## Risks / notes

- Phasing changes timing/feel — tune in playtest; keep timings as named constants.
- Hitstop must not desync the fixed step — scale per-actor dt or skip their
  integration briefly; never pause the scheduler.
- With 1–3 HP combat, keep i-frame windows short so a dash isn't a free escape.
- Notifies give frame-perfect hits but are **not** required for the first feel
  win — the timer approach ships Phase 1 immediately.
