import type { EffectType, EmitterStrategy } from '../core/types'
import { RainEmitter } from './rain-emitter'
import { SnowEmitter } from './snow-emitter'
import { FogEmitter } from './fog-emitter'
import { DustEmitter } from './dust-emitter'
import { EmbersEmitter } from './embers-emitter'
import { MagicEmitter } from './magic-emitter'
import { FireEmitter } from './fire-emitter'
import { FireTornadoEmitter } from './fire-tornado-emitter'
import { ExplosionEmitter } from './explosion-emitter'
import { LeavesEmitter } from './leaves-emitter'
import { LightningEmitter } from './lightning-emitter'
import { BoilingEmitter } from './boiling-emitter'
import { FireflyEmitter } from './firefly-emitter'
import { WaterEmitter } from './water-emitter'
import { LavaEmitter } from './lava-emitter'

/**
 * Maps `EffectType` → emitter implementation. Custom effects plug in
 * via `registerEmitter('myKind', new MyEmitter())` before the system
 * builds a zone of that type.
 */
const REGISTRY = new Map<EffectType, EmitterStrategy>()

function add(strategy: EmitterStrategy): void {
    REGISTRY.set(strategy.type, strategy)
}

add(new RainEmitter())
add(new SnowEmitter())
add(new FogEmitter())
add(new DustEmitter())
add(new EmbersEmitter())
add(new MagicEmitter())
add(new FireEmitter())
add(new FireTornadoEmitter())
add(new ExplosionEmitter())
add(new LeavesEmitter())
add(new LightningEmitter())
add(new BoilingEmitter())
add(new FireflyEmitter())
add(new WaterEmitter())
add(new LavaEmitter())

export function getEmitter(type: EffectType): EmitterStrategy {
    const e = REGISTRY.get(type)
    if (!e) throw new Error(`No FX emitter registered for type "${type}"`)
    return e
}

export function registerEmitter(strategy: EmitterStrategy): void {
    REGISTRY.set(strategy.type, strategy)
}

export function availableEmitterTypes(): EffectType[] {
    return [...REGISTRY.keys()]
}
