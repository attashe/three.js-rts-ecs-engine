export interface WaveformPeaks {
    min: Float32Array
    max: Float32Array
}

export interface MeterReading {
    peak: number
    rms: number
    db: number
    clipping: boolean
}

export function computePeaks(samples: Float32Array, buckets: number): WaveformPeaks {
    const count = Math.max(1, Math.floor(buckets))
    const min = new Float32Array(count)
    const max = new Float32Array(count)
    if (samples.length === 0) return { min, max }
    const step = samples.length / count
    for (let i = 0; i < count; i++) {
        const start = Math.floor(i * step)
        const end = Math.max(start + 1, Math.min(samples.length, Math.floor((i + 1) * step)))
        let lo = 1
        let hi = -1
        for (let j = start; j < end; j++) {
            const v = samples[j] ?? 0
            if (v < lo) lo = v
            if (v > hi) hi = v
        }
        min[i] = lo === 1 ? 0 : lo
        max[i] = hi === -1 ? 0 : hi
    }
    return { min, max }
}

export function meterFromTimeDomain(bytes: Uint8Array): MeterReading {
    if (bytes.length === 0) return { peak: 0, rms: 0, db: -Infinity, clipping: false }
    let peak = 0
    let sumSq = 0
    for (let i = 0; i < bytes.length; i++) {
        const v = ((bytes[i] ?? 128) - 128) / 128
        const abs = Math.abs(v)
        if (abs > peak) peak = abs
        sumSq += v * v
    }
    const rms = Math.sqrt(sumSq / bytes.length)
    return {
        peak,
        rms,
        db: ampToDb(rms),
        clipping: peak >= 0.96,
    }
}

export function ampToDb(amp: number): number {
    if (!Number.isFinite(amp) || amp <= 0) return -Infinity
    return 20 * Math.log10(amp)
}

export function formatDb(db: number): string {
    if (!Number.isFinite(db)) return '-∞ dB'
    return `${db.toFixed(1)} dB`
}

export async function decodeAudioPeaksFromArrayBuffer(bytes: ArrayBuffer, buckets: number): Promise<WaveformPeaks> {
    const AudioContextCtor = window.AudioContext ?? window.webkitAudioContext
    if (!AudioContextCtor) throw new Error('Web Audio is not available in this browser')
    const context = new AudioContextCtor()
    try {
        const buffer = await context.decodeAudioData(bytes.slice(0))
        const samples = buffer.getChannelData(0)
        return computePeaks(samples, buckets)
    } finally {
        await context.close()
    }
}

declare global {
    interface Window {
        webkitAudioContext?: typeof AudioContext
    }
}
