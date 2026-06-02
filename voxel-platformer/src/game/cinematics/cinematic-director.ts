// CinematicDirector — plays a Cinematic by walking its steps and driving a
// CinematicStage. It owns no DOM and no engine handles: all effects go through
// the stage, and all time passes through `update(dt)` (never wall-clock), so it
// runs identically in the game, the editor preview, and unit tests.
//
// Execution model (see cinematic-types for the data): steps run in order;
// `wait` steps are awaited before the next step starts, while non-`wait` steps
// fire and let the sequence continue — their completions are awaited at the end.
// Every time-based effect is a small Task advanced by `update(dt)`; `play()` is
// a plain async function that `await`s the promises those tasks resolve.

import {
    cloneShot,
    estimateSpeechSeconds,
    stepWaits,
    DEFAULT_MOVE_TIMEOUT_SECONDS,
    MOVE_ARRIVAL_EPSILON,
    type CameraShot,
    type Cinematic,
    type CinematicStep,
    type Vec3,
} from './cinematic-types'
import { ease, lerp } from './ease'
import type { CinematicStage } from './cinematic-stage'

interface Task {
    elapsed: number
    done: boolean
    /** Advance by `dt`; resolves the backing promise when complete. */
    step(dt: number): void
    /** Force-complete immediately (used by skip): jump to the end state. */
    finish(): void
}

export class CinematicDirector {
    private readonly stage: CinematicStage
    private readonly tasks = new Set<Task>()
    private active: Cinematic | null = null
    private playing: Promise<void> | null = null
    private skipping = false
    private fadeAlpha = 0
    private subtitleToken = 0

    constructor(stage: CinematicStage) {
        this.stage = stage
    }

    get isPlaying(): boolean {
        return this.active !== null
    }

    /** Play a cinematic. If one is already playing, returns the in-flight
     *  promise (a cinematic is exclusive). */
    play(cinematic: Cinematic): Promise<void> {
        if (this.playing) return this.playing
        this.playing = this.run(cinematic)
        return this.playing
    }

    /** Skip the active cinematic: complete every running effect at once and
     *  stop starting new steps. Resolves the `play()` promise normally. */
    skip(): void {
        if (!this.active) return
        this.skipping = true
        for (const task of Array.from(this.tasks)) task.finish()
    }

    /** Advance all active timed effects. Call once per render frame. */
    update(dt: number): void {
        if (this.tasks.size === 0) return
        const step = Math.max(0, dt)
        for (const task of Array.from(this.tasks)) task.step(step)
    }

    private async run(cinematic: Cinematic): Promise<void> {
        this.active = cinematic
        this.skipping = false
        this.fadeAlpha = 0
        const restore = this.stage.captureCamera()
        const freeze = cinematic.freezePlayer ?? true

        if (freeze) this.stage.freezePlayer(true)
        this.stage.beginCameraOverride()
        this.stage.setLetterbox(cinematic.letterbox ?? true)

        const pending: Promise<void>[] = []
        try {
            for (const step of cinematic.steps) {
                if (this.skipping) break
                const promise = this.startStep(step)
                if (stepWaits(step)) await promise
                else pending.push(promise)
            }
            await Promise.all(pending)
        } finally {
            this.cleanup(restore, freeze)
        }
    }

    private cleanup(restore: CameraShot, freeze: boolean): void {
        for (const task of Array.from(this.tasks)) task.finish()
        this.tasks.clear()
        this.stage.clearSubtitle()
        this.stage.setLetterbox(false)
        this.stage.setFade(0)
        this.fadeAlpha = 0
        // Snap the camera back to where gameplay left it, then release authority
        // so the follow camera resumes from a sane spot.
        this.stage.applyCamera(restore)
        this.stage.endCameraOverride()
        if (freeze) this.stage.freezePlayer(false)
        this.active = null
        this.playing = null
        this.skipping = false
    }

    // ── step dispatch ───────────────────────────────────────────────

    private startStep(step: CinematicStep): Promise<void> {
        switch (step.type) {
            case 'camera': {
                const from = this.stage.captureCamera()
                return this.timed(step.duration, (t) => {
                    this.stage.applyCamera(lerpShot(from, step.shot, ease(step.ease, t)))
                }, () => this.stage.applyCamera(step.shot))
            }
            case 'subtitle': {
                const token = ++this.subtitleToken
                this.stage.showSubtitle(step.text, step.speaker)
                return this.timed(step.duration, undefined, () => this.clearSubtitleIf(token))
            }
            case 'speech': {
                const token = ++this.subtitleToken
                const seconds = step.seconds ?? estimateSpeechSeconds(step.text)
                this.stage.showSubtitle(step.text, this.stage.npcDisplayName(step.npcId))
                this.stage.playNpcVoice?.(step.npcId, step.text)
                return this.timed(seconds, undefined, () => this.clearSubtitleIf(token))
            }
            case 'move': {
                this.stage.moveNpc(step.npcId, step.to)
                if (!step.wait) return Promise.resolve()
                return this.untilArrival(step.npcId, step.to, step.timeoutSeconds ?? DEFAULT_MOVE_TIMEOUT_SECONDS)
            }
            case 'wait':
                return this.timed(step.duration)
            case 'fade': {
                const from = this.fadeAlpha
                const to = step.to === 'black' ? 1 : 0
                return this.timed(step.duration, (t) => this.applyFade(lerp(from, to, t)), () => this.applyFade(to))
            }
            case 'sound':
                this.stage.playSound(step.soundId, { volume: step.volume, fade: step.fade })
                return Promise.resolve()
        }
    }

    private clearSubtitleIf(token: number): void {
        if (token === this.subtitleToken) this.stage.clearSubtitle()
    }

    private applyFade(alpha: number): void {
        this.fadeAlpha = alpha
        this.stage.setFade(alpha)
    }

    // ── tasks ───────────────────────────────────────────────────────

    /** A duration-bounded task. `onTick(t)` runs each frame with t∈[0,1];
     *  `onDone` runs once at completion. Duration 0 completes immediately. */
    private timed(duration: number, onTick?: (t: number) => void, onDone?: () => void): Promise<void> {
        return new Promise<void>((resolve) => {
            const total = Math.max(0, duration)
            const task: Task = {
                elapsed: 0,
                done: false,
                step: (dt) => {
                    if (task.done) return
                    task.elapsed += dt
                    const t = total <= 0 ? 1 : Math.min(1, task.elapsed / total)
                    onTick?.(t)
                    if (t >= 1) {
                        task.done = true
                        onDone?.()
                        this.tasks.delete(task)
                        resolve()
                    }
                },
                finish: () => {
                    if (task.done) return
                    task.done = true
                    onTick?.(1)
                    onDone?.()
                    this.tasks.delete(task)
                    resolve()
                },
            }
            this.tasks.add(task)
            if (total <= 0) task.finish()
        })
    }

    /** Resolves when the NPC reaches `to`, the timeout elapses, or the NPC
     *  disappears. */
    private untilArrival(npcId: string, to: Vec3, timeout: number): Promise<void> {
        return new Promise<void>((resolve) => {
            const task: Task = {
                elapsed: 0,
                done: false,
                step: (dt) => {
                    if (task.done) return
                    task.elapsed += dt
                    const dist = this.stage.npcDistanceTo(npcId, to)
                    const arrived = dist !== null && dist <= MOVE_ARRIVAL_EPSILON
                    if (arrived || dist === null || task.elapsed >= timeout) {
                        task.done = true
                        this.tasks.delete(task)
                        resolve()
                    }
                },
                finish: () => {
                    if (task.done) return
                    task.done = true
                    this.tasks.delete(task)
                    resolve()
                },
            }
            this.tasks.add(task)
        })
    }
}

function lerpVec(a: Vec3, b: Vec3, t: number): Vec3 {
    return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) }
}

function lerpShot(a: CameraShot, b: CameraShot, t: number): CameraShot {
    return { position: lerpVec(a.position, b.position, t), target: lerpVec(a.target, b.target, t), zoom: lerp(a.zoom, b.zoom, t) }
}

/** Re-exported for callers that need a defensive copy of a shot. */
export { cloneShot }
