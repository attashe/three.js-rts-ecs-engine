// Editor-side cinematic preview: the same CinematicDirector the game uses,
// driving the editor's camera + a letterbox/subtitle overlay so authors can
// watch a cinematic and fine-tune points of view without leaving the editor.
//
// What the preview does NOT do is walk NPCs — editor NPCs are static
// placements, so `move` steps resolve instantly (npcDistanceTo → null). Camera,
// subtitles, fades and timing are all live; character movement is validated in
// playtest. The controller is handed to the Cinematics tab so its Play / Stop /
// Capture / Jump buttons can drive the preview.

import type { IsometricCamera } from '../engine/render/isometric-camera'
import type { System } from '../engine/ecs/systems/system'
import type { EditorState } from './editor-state'
import { CinematicDirector } from '../game/cinematics/cinematic-director'
import { createCinematicSystem } from '../game/cinematics/cinematic-system'
import { createCinematicOverlay, type CinematicOverlay } from '../game/cinematics/cinematic-overlay'
import type { CinematicStage } from '../game/cinematics/cinematic-stage'
import { cloneShot, type CameraShot, type Cinematic, type Vec3 } from '../game/cinematics/cinematic-types'

export interface CinematicPreviewController {
    /** Start previewing a cinematic (fire-and-forget). */
    play(cinematic: Cinematic): void
    /** Stop / skip the current preview. */
    stop(): void
    isPlaying(): boolean
    /** The editor camera's current framing — for "Capture view". */
    captureShot(): CameraShot
    /** Move the editor camera to a shot — for "Jump to shot". */
    jumpTo(shot: CameraShot): void
}

export interface CinematicPreview {
    controller: CinematicPreviewController
    /** Render-step system that advances the preview director; add to the engine. */
    system: System
    dispose(): void
}

export function createCinematicPreview(iso: IsometricCamera, editorState: EditorState): CinematicPreview {
    const overlay = createCinematicOverlay()
    const stage = createEditorStage(iso, editorState, overlay)
    const director = new CinematicDirector(stage)
    overlay.onSkip(() => director.skip())

    const controller: CinematicPreviewController = {
        play(cinematic) {
            if (director.isPlaying) return
            void director.play(cinematic)
        },
        stop() { director.skip() },
        isPlaying: () => director.isPlaying,
        captureShot: () => stage.captureCamera(),
        jumpTo(shot) {
            editorState.viewMode = 'orbit'
            editorState.cameraJumpRequest = cloneShot(shot)
        },
    }

    return {
        controller,
        system: createCinematicSystem(director),
        dispose() {
            director.skip()
            overlay.dispose()
        },
    }
}

function createEditorStage(iso: IsometricCamera, editorState: EditorState, overlay: CinematicOverlay): CinematicStage {
    return {
        captureCamera: () => ({
            position: { x: iso.camera.position.x, y: iso.camera.position.y, z: iso.camera.position.z },
            target: { x: iso.target.x, y: iso.target.y, z: iso.target.z },
            zoom: iso.camera.zoom,
        }),
        applyCamera: (shot) => {
            iso.target.set(shot.target.x, shot.target.y, shot.target.z)
            iso.camera.position.set(shot.position.x, shot.position.y, shot.position.z)
            iso.camera.up.set(0, 1, 0)
            iso.camera.lookAt(iso.target)
            iso.camera.zoom = shot.zoom
            iso.camera.updateProjectionMatrix()
        },
        beginCameraOverride: () => { editorState.cinematicPreviewActive = true },
        endCameraOverride: () => { editorState.cinematicPreviewActive = false },

        setLetterbox: (on) => overlay.setLetterbox(on),
        showSubtitle: (text, speaker) => overlay.showSubtitle(text, speaker),
        clearSubtitle: () => overlay.clearSubtitle(),
        setFade: (alpha) => overlay.setFade(alpha),

        // Editor NPCs are static placements: move steps resolve instantly
        // (null distance) so the preview never blocks on character walking.
        moveNpc: () => {},
        npcDistanceTo: (): number | null => null,
        npcDisplayName: (npcId) => editorState.npcs.find((n) => n.id === npcId)?.name ?? 'NPC',

        playSound: () => {},
        // The camera systems are gated on `cinematicPreviewActive`, so there's
        // nothing to freeze in the editor.
        freezePlayer: () => {},
    }
}

// Re-export so the tab can build move targets from the cursor without reaching
// into the types module separately.
export type { Vec3 }
