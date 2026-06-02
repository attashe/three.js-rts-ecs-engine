// The CinematicStage is the seam between the (pure) cinematic sequencing logic
// in CinematicDirector and the actual side effects — camera, overlay, NPCs,
// input, audio. The game and the editor each provide their own implementation,
// so the very same director drives an in-game cutscene and an in-editor
// preview. Keeping every effect behind this interface is what makes the
// director unit-testable with a fake stage.

import type { CameraShot, Vec3 } from './cinematic-types'

export interface CinematicStage {
    // ── camera ──────────────────────────────────────────────────────
    /** Current camera framing — used as the `from` of the next tween and as
     *  the shot to restore to when the cinematic ends. */
    captureCamera(): CameraShot
    /** Apply a framing this frame (set position, look-at, zoom). */
    applyCamera(shot: CameraShot): void
    /** Begin/end camera authority — implementations make their follow / orbit
     *  camera systems yield while a cinematic owns the camera. */
    beginCameraOverride(): void
    endCameraOverride(): void

    // ── overlay ─────────────────────────────────────────────────────
    setLetterbox(on: boolean): void
    showSubtitle(text: string, speaker?: string): void
    clearSubtitle(): void
    /** Black fade overlay opacity, 0 (clear) … 1 (black). */
    setFade(alpha: number): void

    // ── characters ──────────────────────────────────────────────────
    moveNpc(npcId: string, to: Vec3): void
    /** Distance from the NPC to `to`, or null if the NPC isn't present (used
     *  to poll arrival for blocking `move` steps). */
    npcDistanceTo(npcId: string, to: Vec3): number | null
    npcDisplayName(npcId: string): string
    /** Optional voice cue for a speaking NPC. */
    playNpcVoice?(npcId: string, text: string): void

    // ── io ──────────────────────────────────────────────────────────
    playSound(soundId: string, opts: { volume?: number; fade?: number }): void
    freezePlayer(on: boolean): void
}

/** A do-nothing stage — a safe default/fallback and a base for tests. */
export const NOOP_STAGE: CinematicStage = {
    captureCamera: () => ({ position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 }, zoom: 1 }),
    applyCamera: () => {},
    beginCameraOverride: () => {},
    endCameraOverride: () => {},
    setLetterbox: () => {},
    showSubtitle: () => {},
    clearSubtitle: () => {},
    setFade: () => {},
    moveNpc: () => {},
    npcDistanceTo: () => null,
    npcDisplayName: () => 'NPC',
    playSound: () => {},
    freezePlayer: () => {},
}
