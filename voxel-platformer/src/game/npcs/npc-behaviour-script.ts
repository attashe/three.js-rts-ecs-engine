/**
 * Behaviour → script compiler.
 *
 * The NPC editor authors behaviour as a structured `NpcBehaviourConfig` (so the
 * waypoint tool has draggable data), but the RUNTIME only runs `scriptSource`.
 * This module bridges the two: it compiles the behaviour into a clearly-marked
 * `on('level-start')` region of `scriptSource`, using the same `npc.*` script
 * API authors already use by hand. The region is regenerated whenever behaviour
 * changes; any custom interaction script (dialogue / quest / shop) outside the
 * markers is preserved.
 *
 * It reuses the public script verbs verbatim: `npc.setPerceptionRadius`,
 * `setHostile`, `setFlee`, `setThreatMemory`, `setWaypoints` (see
 * `src/game/npcs/npc-ai.ts` / `src/engine/script/types.ts`).
 */
import type { NpcBehaviourConfig, Vec3Like } from './npc-types'

const BEGIN_MARK = '// === behaviour (auto-generated — edit via the Behaviour panel) ==='
const END_MARK = '// === end behaviour ==='

/** Matches the whole managed region (markers inclusive) plus trailing blank lines. */
const REGION_RE = /\/\/ === behaviour \(auto-generated[^\n]*\n[\s\S]*?\/\/ === end behaviour ===\n*/

/** Trim float noise from raycast-derived coordinates (e.g. cell centres x+0.5). */
function num(n: number): string {
    const r = Math.round(n * 1000) / 1000
    return Object.is(r, -0) ? '0' : String(r)
}

function waypointList(points: readonly Vec3Like[]): string {
    return `[${points.map((p) => `{ x: ${num(p.x)}, y: ${num(p.y)}, z: ${num(p.z)} }`).join(', ')}]`
}

/**
 * Compile a behaviour block into a `level-start` script region (markers
 * included). Returns `''` for `mode: 'none'` (no behaviour to emit).
 */
export function generateBehaviourScript(b: NpcBehaviourConfig): string {
    if (b.mode === 'none') return ''
    const lines: string[] = []
    lines.push(`  npc.setPerceptionRadius(NPC_ID, ${num(b.perceptionRadius)})`)
    if (b.hostileToPlayer) lines.push(`  npc.setHostile(NPC_ID, 'player', true)`)
    if (b.flee) lines.push(`  npc.setFlee(NPC_ID, true)`)
    if (b.threatMemorySeconds > 0) lines.push(`  npc.setThreatMemory(NPC_ID, ${num(b.threatMemorySeconds)})`)
    // `idle` exists purely to register a neutral brain; the movement modes carry
    // a route ([] = hold the spawn post, which is the desired "stand guard").
    if (b.mode !== 'idle') lines.push(`  npc.setWaypoints(NPC_ID, ${waypointList(b.waypoints)})`)
    return [
        BEGIN_MARK,
        `on('level-start', () => {`,
        ...lines,
        `})`,
        END_MARK,
    ].join('\n')
}

/**
 * Strip the managed behaviour region from a script, returning the custom-only
 * remainder (trimmed). Scripts without the region are returned unchanged. Used
 * on load to repopulate the raw-script textarea with just the author's code.
 */
export function stripBehaviourRegion(scriptSource: string): string {
    return scriptSource.replace(REGION_RE, '').trim()
}

/**
 * Insert / replace the managed behaviour region in `scriptSource` from `b`,
 * preserving any custom script outside it. If the region is missing it's
 * prepended; if `b` is absent or `mode: 'none'` the region is removed.
 *
 * Robust to hand-edits: it only ever rewrites the marked span and never touches
 * code outside it, so a custom interaction script below the markers is safe.
 */
export function mergeBehaviourIntoScript(scriptSource: string, b: NpcBehaviourConfig | undefined): string {
    const region = b ? generateBehaviourScript(b) : ''
    const custom = stripBehaviourRegion(scriptSource)
    if (!region) return custom
    return custom ? `${region}\n\n${custom}` : region
}
