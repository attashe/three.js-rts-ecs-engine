import type { AmbientWeatherPreset } from '../core/types'

/**
 * Ambient weather presets distilled from the voxel-weather.html demo.
 * Apply via `weatherSystem.setAmbient(WEATHER_PRESETS.storm.apply)`.
 */
export const WEATHER_PRESETS: Record<string, AmbientWeatherPreset> = {
    clear: { id: 'clear', label: 'Clear', icon: '☀',
        apply: { skyTop: '#5a90c8', skyBottom: '#cfe2f0', fogColor: '#cfe2f0', fogDensity: 0.005, sunIntensity: 1.3, ambientIntensity: 0.6, cloudCoverage: 0.05, rainOn: false, snowOn: false, lightningOn: false, windX: 0.2, windZ: 0 },
    },
    cloudy: { id: 'cloudy', label: 'Cloudy', icon: '☁',
        apply: { skyTop: '#88929f', skyBottom: '#c5cbd5', fogColor: '#c5cbd5', fogDensity: 0.014, sunIntensity: 0.6, ambientIntensity: 0.5, cloudCoverage: 0.6, rainOn: false, snowOn: false, lightningOn: false, windX: 1.5, windZ: 0.4 },
    },
    rain: { id: 'rain', label: 'Rain', icon: '☂',
        apply: { skyTop: '#4a5560', skyBottom: '#7b8694', fogColor: '#7b8694', fogDensity: 0.024, sunIntensity: 0.45, ambientIntensity: 0.42, cloudCoverage: 0.85, rainOn: true, rainCount: 5000, rainSpeed: 24, snowOn: false, lightningOn: false, windX: 2.5, windZ: 0.6 },
    },
    storm: { id: 'storm', label: 'Storm', icon: '⚡',
        apply: { skyTop: '#222731', skyBottom: '#454a55', fogColor: '#454a55', fogDensity: 0.035, sunIntensity: 0.25, ambientIntensity: 0.32, cloudCoverage: 1.0, rainOn: true, rainCount: 7000, rainSpeed: 32, snowOn: false, lightningOn: true, lightningRate: 0.5, lightningIntensity: 40, windX: 5.0, windZ: 1.4, windGusts: 0.6 },
    },
    snow: { id: 'snow', label: 'Snow', icon: '❄',
        apply: { skyTop: '#a8b0bc', skyBottom: '#d8dde6', fogColor: '#d8dde6', fogDensity: 0.018, sunIntensity: 0.7, ambientIntensity: 0.55, cloudCoverage: 0.7, rainOn: false, snowOn: true, snowCount: 3000, snowSpeed: 1.6, snowSway: 1.5, lightningOn: false, windX: 0.8, windZ: 0.2 },
    },
    dawn: { id: 'dawn', label: 'Dawn', icon: '◐',
        apply: { skyTop: '#3a4a6e', skyBottom: '#f0a878', fogColor: '#f0a878', fogDensity: 0.014, sunIntensity: 0.9, ambientIntensity: 0.55, cloudCoverage: 0.2, timeOfDay: 6.5, rainOn: false, snowOn: false, lightningOn: false, windX: 0.4, windZ: 0.2 },
    },
}
