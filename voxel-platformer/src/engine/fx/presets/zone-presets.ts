import type { WeatherZoneParams, ZonePreset } from '../core/types'

/**
 * Hand-tuned defaults for every supported effect type. Use as a base
 * for `WeatherSystem.addZone(applyPreset('fire', { position: ... }))`.
 * Numbers come from the source demos' PRESETS table — they're starting
 * points, not laws.
 */
export const ZONE_PRESETS: Record<string, ZonePreset> = {
    rain: { id: 'rain', label: 'Rain',
        params: { type: 'rain', name: 'Rain', color: '#8fc7ff', count: 2200, particleSize: 0.06, opacity: 0.52, speed: 14, turbulence: 0.28, windX: 1.0, windZ: -0.25, gravity: 1.0, lifetime: 4.0, streaks: true, streakLength: 0.62, lightEnabled: false, lightColor: '#9ed5ff', lightIntensity: 0.8, lightDistance: 16, lightning: false, size: { x: 16, y: 9, z: 16 } },
    },
    storm: { id: 'storm', label: 'Storm',
        params: { type: 'rain', name: 'Storm', color: '#b3c7ff', count: 3600, particleSize: 0.07, opacity: 0.76, speed: 24, turbulence: 0.75, windX: 5.0, windZ: -2.0, gravity: 1.25, lifetime: 2.8, streaks: true, streakLength: 1.15, lightEnabled: true, lightColor: '#dce8ff', lightIntensity: 0.6, lightDistance: 32, lightning: true, size: { x: 22, y: 12, z: 22 } },
    },
    snow: { id: 'snow', label: 'Snow',
        params: { type: 'snow', name: 'Snow', color: '#f6fbff', count: 1800, particleSize: 0.13, opacity: 0.82, speed: 2.25, turbulence: 1.85, windX: 0.45, windZ: 0.1, gravity: 0.22, lifetime: 8.0, streaks: false, streakLength: 0.2, lightEnabled: false, lightColor: '#d9f0ff', lightIntensity: 0.4, lightDistance: 18, lightning: false, size: { x: 18, y: 10, z: 18 } },
    },
    fog: { id: 'fog', label: 'Fog',
        params: { type: 'fog', name: 'Fog', color: '#cbd6e8', count: 950, particleSize: 1.15, opacity: 0.16, speed: 0.42, turbulence: 0.95, windX: 0.16, windZ: 0.05, gravity: 0.0, lifetime: 14.0, streaks: false, streakLength: 0.1, lightEnabled: false, lightColor: '#cad8ff', lightIntensity: 0.25, lightDistance: 18, lightning: false, size: { x: 15, y: 4.5, z: 15 } },
    },
    sandstorm: { id: 'sandstorm', label: 'Sandstorm',
        params: { type: 'dust', name: 'Sandstorm', color: '#d6b16a', count: 2600, particleSize: 0.19, opacity: 0.55, speed: 5.2, turbulence: 2.2, windX: 6.8, windZ: 0.9, gravity: -0.08, lifetime: 5.0, streaks: true, streakLength: 0.42, lightEnabled: true, lightColor: '#ffb65a', lightIntensity: 0.65, lightDistance: 18, lightning: false, size: { x: 21, y: 7, z: 14 } },
    },
    embers: { id: 'embers', label: 'Embers',
        params: { type: 'embers', name: 'Embers', color: '#ff8a33', count: 950, particleSize: 0.14, opacity: 0.88, speed: 2.6, turbulence: 1.25, windX: 0.3, windZ: -0.1, gravity: -0.65, lifetime: 4.6, streaks: false, streakLength: 0.15, lightEnabled: true, lightColor: '#ff6d2e', lightIntensity: 1.4, lightDistance: 12, lightning: false, size: { x: 7, y: 6, z: 7 } },
    },
    magic: { id: 'magic', label: 'Magic Motes',
        params: { type: 'magic', name: 'Magic Motes', color: '#a78bfa', count: 1200, particleSize: 0.18, opacity: 0.86, speed: 1.4, turbulence: 1.65, windX: 0, windZ: 0, gravity: -0.08, lifetime: 7.0, streaks: false, streakLength: 0.25, lightEnabled: true, lightColor: '#a78bfa', lightIntensity: 1.15, lightDistance: 15, lightning: false, size: { x: 9, y: 8, z: 9 } },
    },
    fire: { id: 'fire', label: 'Bonfire',
        params: { type: 'fire', name: 'Bonfire', color: '#ff7a1a', count: 420, particleSize: 0.26, opacity: 0.96, speed: 1.25, turbulence: 0.65, windX: 0.08, windZ: -0.03, gravity: -0.25, lifetime: 0.95, streaks: false, streakLength: 0.12, lightEnabled: true, lightColor: '#ff7b2e', lightIntensity: 5.2, lightDistance: 12, lightning: false, size: { x: 3.2, y: 2.5, z: 3.2 } },
    },
    fireTornado: { id: 'fireTornado', label: 'Fire Tornado',
        params: { type: 'fireTornado', name: 'Fire Tornado', color: '#ff7a1a', count: 1100, particleSize: 0.36, opacity: 0.98, speed: 4.2, turbulence: 2.15, windX: 0.26, windZ: -0.10, gravity: -0.66, lifetime: 2.25, streaks: false, streakLength: 0.18, lightEnabled: true, lightColor: '#ff7b2e', lightIntensity: 17, lightDistance: 34, lightning: false, size: { x: 5.8, y: 9.4, z: 5.8 } },
    },
    explosion: { id: 'explosion', label: 'Explosion',
        params: { type: 'explosion', name: 'Explosion', color: '#ffb13b', count: 780, particleSize: 0.36, opacity: 0.98, speed: 10.5, turbulence: 0.65, windX: 0, windZ: 0, gravity: 0.72, lifetime: 2.15, streaks: false, streakLength: 0.35, lightEnabled: true, lightColor: '#ff9a2d', lightIntensity: 16, lightDistance: 36, lightning: false, size: { x: 10, y: 8.5, z: 10 } },
    },
    leaves: { id: 'leaves', label: 'Falling Leaves',
        params: { type: 'leaves', name: 'Falling Leaves', color: '#d9822b', count: 520, particleSize: 0.34, opacity: 0.96, speed: 1.25, turbulence: 1.35, windX: 1.65, windZ: 0.45, gravity: 0.30, lifetime: 10.0, streaks: false, streakLength: 0.12, lightEnabled: false, lightColor: '#f6b35f', lightIntensity: 0.45, lightDistance: 14, lightning: false, size: { x: 18, y: 10, z: 18 } },
    },
    lightning: { id: 'lightning', label: 'Lightning',
        params: { type: 'lightning', name: 'Lightning', color: '#dbe7ff', count: 180, particleSize: 0.18, opacity: 0.92, speed: 0.4, turbulence: 1.35, windX: 0.1, windZ: 0, gravity: 0, lifetime: 5.0, streaks: false, streakLength: 0.18, lightEnabled: true, lightColor: '#f0f6ff', lightIntensity: 8.5, lightDistance: 52, lightning: true, size: { x: 12, y: 10, z: 12 } },
    },
    boiling: { id: 'boiling', label: 'Boiling Water',
        params: { type: 'boiling', name: 'Boiling Water', color: '#d7f6ff', count: 520, particleSize: 0.16, opacity: 0.84, speed: 1.15, turbulence: 0.85, windX: 0.12, windZ: 0.08, gravity: -0.05, lifetime: 2.2, streaks: false, streakLength: 0.08, lightEnabled: false, lightColor: '#9ee5ff', lightIntensity: 0.35, lightDistance: 12, lightning: false, size: { x: 10, y: 4, z: 10 } },
    },
    firefly: { id: 'firefly', label: 'Fireflies',
        params: { type: 'firefly', name: 'Fireflies', color: '#d8ff73', count: 220, particleSize: 0.18, opacity: 0.94, speed: 0.48, turbulence: 1.15, windX: 0.20, windZ: 0.08, gravity: 0, lifetime: 6.0, streaks: false, streakLength: 0.08, lightEnabled: true, lightColor: '#cfff78', lightIntensity: 0.7, lightDistance: 16, lightning: false, size: { x: 14, y: 7, z: 14 } },
    },
    water: { id: 'water', label: 'Water Surface',
        params: { type: 'water', name: 'Water', color: '#5fb6ff', count: 24, particleSize: 0.08, opacity: 0.68, speed: 0.55, turbulence: 1.1, windX: 0.45, windZ: 0.18, gravity: 0, lifetime: 6.0, streaks: false, streakLength: 0.08, lightEnabled: false, lightColor: '#8ed8ff', lightIntensity: 0.5, lightDistance: 16, lightning: false, size: { x: 14, y: 5, z: 14 } },
    },
    lava: { id: 'lava', label: 'Lava Surface',
        params: { type: 'lava', name: 'Lava', color: '#ff6a24', count: 120, particleSize: 0.14, opacity: 0.92, speed: 1.2, turbulence: 1.0, windX: 0.12, windZ: 0.08, gravity: -0.2, lifetime: 2.1, streaks: false, streakLength: 0.08, lightEnabled: true, lightColor: '#ff7a24', lightIntensity: 6, lightDistance: 20, lightning: false, size: { x: 12, y: 4.5, z: 12 } },
    },
}

/** Merge a preset with overrides into a complete `WeatherZoneParams`. */
export function applyZonePreset(id: keyof typeof ZONE_PRESETS, overrides: Partial<WeatherZoneParams> = {}): WeatherZoneParams {
    const preset = ZONE_PRESETS[id]
    if (!preset) throw new Error(`Unknown zone preset: ${String(id)}`)
    return {
        ...(preset.params as WeatherZoneParams),
        ...overrides,
        position: { x: 0, y: 0, z: 0, ...(overrides.position ?? {}) } as WeatherZoneParams['position'],
        size: { ...(preset.params.size as WeatherZoneParams['size']), ...(overrides.size ?? {}) } as WeatherZoneParams['size'],
    }
}
