// demo-quest.js — "Three Tokens of the Plaza"
//
// A three-stage scavenger hunt for the platformer demo level. The
// player visits the staircase top, earns five gold, then climbs the
// floating island — each stage spawns a small reward + plays a chime,
// and the final stage drops a 50-gold pile + plays a fanfare.
//
// This script is hand-authored against the Slice 1 API. Several
// patterns here are obvious polling-style workarounds that will
// disappear when Slice 3 ships the real `zone-enter` and
// `pickup-taken` emitters:
//
//   - Stage 1 polls player.position every 0.25 s instead of waiting
//     on `on('zone-enter', { zoneId: 'quest.demo.stairs' }, ...)`.
//   - Stage 2 polls player.inventory.gold instead of reacting to a
//     `pickup-taken` event for the specific token.
//   - Stage 3 polls player.position against a hard-coded AABB instead
//     of `on('zone-enter', { zoneId: 'quest.demo.island' }, ...)`.
//
// All three would collapse to event handlers in Slice 3 — see
// docs/script-engine-slice-1-review.md for the verdict.

// Demo level coords (from src/game/level.ts):
//   - Grass plaza  : 24×24 at y = 4. Player stands on y = 5.
//   - Staircase top: x∈[16,20], z∈[12,14], y = 7 (player at y = 8)
//   - West wall    : x = 2, brick. There's a coin pile at (4, 5, 5).
//   - Floating island: x∈[7,9], z∈[20,22], top at y = 7. Player at y = 8.

const STAGE_FLAG = 'demo.quest.stage'

// Author-facing summary of where each token sits. Lifting the coords
// out of the handler bodies keeps the state machine readable.
const TOKEN_STAIRS  = { x: 18, y: 8,  z: 13 }
const TOKEN_WALL    = { x: 4,  y: 5,  z: 4  }
const REWARD_ISLAND = { x: 8,  y: 8,  z: 21 }

on('level-start', () => {
    const stage = flags.get(STAGE_FLAG) ?? 0
    if (stage >= 3) {
        log("Three Tokens of the Plaza — already complete.")
        return
    }
    log("Three Tokens of the Plaza — find what waits on the stairs.")
    audio.play('sfx.quest.chime')
    if (stage > 0) {
        log(`(Resuming at stage ${stage}/3.)`)
    }
})

// Polling tick. 0.25 s is a fine trade for a demo — at 60 Hz fixed
// step the engine fires this 4× per second.
on('timer', { periodSeconds: 0.25 }, () => {
    const pos = player.position
    if (!pos) return
    const stage = flags.get(STAGE_FLAG) ?? 0

    // Stage 1: walk to the staircase top.
    if (stage === 0 && onStaircaseTop(pos)) {
        advanceTo(1, "You're at the top of the stairs. A token glints.", TOKEN_STAIRS, 5)
        return
    }

    // Stage 2: accumulate five gold from anywhere in the plaza.
    // Without `pickup-taken` we can't see the specific pickup; the
    // "any 5 gold" check is the best we can do today.
    if (stage === 1 && player.inventory.gold >= 5) {
        advanceTo(2, "A second token reveals itself near the west wall.", TOKEN_WALL, 5)
        return
    }

    // Stage 3: reach the floating island. Final reward + fanfare.
    if (stage === 2 && onFloatingIsland(pos)) {
        flags.set(STAGE_FLAG, 3)
        log("The plaza is satisfied. You feel suddenly wealthy.")
        audio.play('sfx.quest.fanfare')
        pickups.spawn('coin', REWARD_ISLAND, { amount: 50 })
        emit('quest.demo.complete')
    }
})

// A second script (or, in Slice 2, a second ScriptEntry) would listen
// for the completion event. We co-locate the listener here for the
// demo so authoring + reacting live in one file.
on('quest.demo.complete', () => {
    log("[quest] Demo quest complete — score recorded.")
    flags.set('demo.quest.completedAt', time.now)
})

function advanceTo(nextStage, message, tokenPos, amount) {
    flags.set(STAGE_FLAG, nextStage)
    log(message)
    audio.play('sfx.quest.chime')
    pickups.spawn('coin', tokenPos, { amount })
}

// Player AABB is roughly 0.6 m wide. The staircase top is a 5-wide,
// 2-deep grass strip at y = 7, so the player standing on it has
// y ≈ 8 and lands inside the 5×2 footprint. We pad ±0.5 on x/z so
// the player AABB centre doesn't have to hit the cell edge exactly.
function onStaircaseTop(pos) {
    return pos.x >= 15.5 && pos.x <= 20.5
        && pos.z >= 11.5 && pos.z <= 14.5
        && pos.y >= 7.5
}

function onFloatingIsland(pos) {
    return pos.x >= 6.5 && pos.x <= 9.5
        && pos.z >= 19.5 && pos.z <= 22.5
        && pos.y >= 7.5
}
