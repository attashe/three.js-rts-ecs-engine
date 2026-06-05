// The in-game CinematicStage: wires the director's abstract effects to the real
// engine — the isometric camera, the cinematic overlay DOM, NPC AI, player
// input, and audio. Created once and reused across locations; per-location data
// (the NPC list, the sound player) is read through callbacks so it stays fresh.

import { Vector3 } from 'three'
import type { IsometricCamera } from '../../engine/render/isometric-camera'
import type { GameWorld } from '../../engine/ecs/world'
import type { Input } from '../../engine/input/input'
import { npcGoTo } from '../npcs/npc-ai'
import type { NpcConfig } from '../npcs/npc-types'
import type { CinematicStage } from './cinematic-stage'
import type { CinematicOverlay } from './cinematic-overlay'
import type { CameraShot, Vec3 } from './cinematic-types'

export interface GameCinematicStageDeps {
    iso: IsometricCamera
    world: GameWorld
    input: Input
    overlay: CinematicOverlay
    /** Current location's NPCs (for resolving display names). */
    getNpcs: () => readonly NpcConfig[]
    /** Play a sound or music id (the caller decides bus/crossfade). */
    playSound: (soundId: string, opts: { volume?: number; fade?: number }) => void
}

export function createGameCinematicStage(deps: GameCinematicStageDeps): CinematicStage {
    const { iso, world, input, overlay } = deps
    const tmp = new Vector3()

    return {
        captureCamera: () => ({
            position: { x: iso.camera.position.x, y: iso.camera.position.y, z: iso.camera.position.z },
            target: { x: iso.target.x, y: iso.target.y, z: iso.target.z },
            zoom: iso.camera.zoom,
        }),
        applyCamera: (shot: CameraShot) => {
            iso.target.set(shot.target.x, shot.target.y, shot.target.z)
            iso.camera.position.set(shot.position.x, shot.position.y, shot.position.z)
            iso.camera.up.set(0, 1, 0)
            iso.camera.lookAt(iso.target)
            iso.camera.zoom = shot.zoom
            iso.camera.updateProjectionMatrix()
        },
        beginCameraOverride: () => { world.cinematicActive = true },
        endCameraOverride: () => {
            world.cinematicActive = false
            // Hand the iso rig back its fixed offset so the follow camera
            // resumes from a sane position rather than the cinematic's last one.
            iso.syncPosition()
        },

        setLetterbox: (on) => overlay.setLetterbox(on),
        showSubtitle: (text, speaker) => overlay.showSubtitle(text, speaker),
        clearSubtitle: () => overlay.clearSubtitle(),
        setFade: (alpha) => overlay.setFade(alpha),

        moveNpc: (npcId, to: Vec3) => { npcGoTo(world, npcId, to) },
        npcDistanceTo: (npcId, to: Vec3) => {
            const npc = world.npcRuntimeById.get(npcId)
            if (!npc) return null
            tmp.set(npc.position.x - to.x, npc.position.y - to.y, npc.position.z - to.z)
            // Horizontal distance — NPCs walk on the ground, so ignore Y.
            return Math.hypot(tmp.x, tmp.z)
        },
        npcDisplayName: (npcId) => deps.getNpcs().find((n) => n.id === npcId)?.name ?? 'NPC',

        playSound: (soundId, opts) => { if (soundId) deps.playSound(soundId, opts) },
        freezePlayer: (on) => {
            input.setEnabled(!on)
            if (!on) input.clear()
        },
    }
}
