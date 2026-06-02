import type { Object3D } from 'three'
import type { NpcAttackClip } from './npc-types'

/**
 * The seam the NPC render system drives an NPC's pose through. The default
 * humanoid path wraps an `AnimationController` (clip set + combat graph); models
 * that opt out of the shared rig (see `npcModelUsesDefaultRig`) provide a
 * bespoke animator instead — e.g. the quadruped rabbit's procedural hop. Keeping
 * both behind this interface is what lets the render loop stay rig-agnostic.
 */
export interface NpcAnimator {
    readonly root: Object3D
    /** Per-frame ground speed (world units/s) → walk / run / hop cadence. */
    setLocomotion(speedXZ: number): void
    /** Play a one-shot attack clip (critters with no attack may ignore it). */
    triggerAttack(clip: NpcAttackClip): void
    /** Begin the death animation. */
    triggerDie(): void
    /** Raise / lower a held shield guard (humanoid only). */
    setShieldGuard(raised: boolean): void
    update(dt: number): void
    /** True once the death animation has settled enough to despawn the body. */
    deadSettled(): boolean
    dispose(): void
}

const HOP_REF_SPEED = 3.4 // ~flee speed; the rabbit hops at full cadence here
const DIE_SECONDS = 0.7

/**
 * Procedural rabbit animator: a hop whose height + cadence scale with movement
 * speed (a gentle idle breathe at rest), hind legs that tuck at the apex, ears
 * that flop out of phase, and a tip-over death. Drives the named pivots built by
 * `createRabbitNpcModel` (`RabbitBob`, `RabbitHindL/R`, `RabbitEarL/R`).
 */
export function createCritterAnimator(root: Object3D): NpcAnimator {
    const bob = root.getObjectByName('RabbitBob') ?? root
    const hindL = root.getObjectByName('RabbitHindL')
    const hindR = root.getObjectByName('RabbitHindR')
    const earL = root.getObjectByName('RabbitEarL')
    const earR = root.getObjectByName('RabbitEarR')

    let phase = 0
    let speed = 0
    let targetSpeed = 0
    let elapsed = 0
    let dying = false
    let dieElapsed = 0

    /** Pose the rabbit from the current `phase` / `speed` (no state advance). */
    function applyHop(): void {
        const norm = Math.min(1.3, speed / HOP_REF_SPEED)
        const hopHeight = 0.13 * norm
        const arc = Math.max(0, Math.sin(phase))
        const breathe = Math.sin(elapsed * 2.4) * 0.006
        bob.position.y = arc * hopHeight + breathe
        bob.rotation.x = Math.cos(phase) * 0.22 * norm
        const tuck = -0.12 - arc * 0.7 * norm
        if (hindL) hindL.rotation.x = tuck
        if (hindR) hindR.rotation.x = tuck
        const earSwing = -0.12 + Math.sin(phase + Math.PI) * 0.18 * norm
        if (earL) earL.rotation.x = earSwing
        if (earR) earR.rotation.x = earSwing
    }

    return {
        root,
        setLocomotion(s) { targetSpeed = s },
        triggerAttack() { /* prey doesn't attack */ },
        triggerDie() { dying = true },
        setShieldGuard() { /* no shield */ },
        update(dt) {
            if (dying) {
                dieElapsed += dt
                const t = Math.min(1, dieElapsed / DIE_SECONDS)
                root.rotation.z = -t * (Math.PI / 2) // tip onto its side
                bob.position.y = -t * 0.05
                return
            }
            elapsed += dt
            speed += (targetSpeed - speed) * Math.min(1, dt * 10)
            // Cadence: a slow idle sway accelerating to ~2 hops/s at flee speed.
            const norm = Math.min(1.3, speed / HOP_REF_SPEED)
            phase += (1.6 + norm * 11) * dt
            applyHop()
        },
        deadSettled() { return dying && dieElapsed >= DIE_SECONDS + 0.4 },
        dispose() { /* the render system disposes the root Object3D */ },
    }
}
