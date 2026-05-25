import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const outDir = join(process.cwd(), 'public', 'audio', '8bit')
const sampleRate = 22050
mkdirSync(outDir, { recursive: true })

writeWav('pickup-gold.wav', noteSequence(0.32, [
    { start: 0.00, end: 0.08, hz: 880, amp: 0.55 },
    { start: 0.07, end: 0.18, hz: 1320, amp: 0.48 },
    { start: 0.16, end: 0.30, hz: 1760, amp: 0.34 },
]))

writeWav('pickup-arrow.wav', noteSequence(0.28, [
    { start: 0.00, end: 0.10, hz: 660, amp: 0.45 },
    { start: 0.08, end: 0.20, hz: 990, amp: 0.36 },
]))

writeWav('bow.wav', mix(0.38, [
    pluck(0.00, 0.22, 170, 0.58),
    noiseBurst(0.03, 0.17, 0.20, 17),
    chirp(0.07, 0.30, 520, 180, 0.22),
]))

writeWav('arrow-hit.wav', mix(0.34, [
    noiseBurst(0.00, 0.12, 0.45, 41),
    pluck(0.02, 0.20, 118, 0.42),
    pluck(0.05, 0.28, 74, 0.30),
]))

writeWav('death.wav', mix(0.86, [
    chirp(0.00, 0.70, 330, 92, 0.56),
    note(0.10, 0.80, 82, 0.32),
    noiseBurst(0.08, 0.62, 0.15, 71),
]))

writeWav('death-stinger.wav', noteSequence(1.35, [
    { start: 0.00, end: 0.28, hz: 392, amp: 0.54 },
    { start: 0.24, end: 0.58, hz: 330, amp: 0.50 },
    { start: 0.52, end: 1.22, hz: 196, amp: 0.48 },
]))

writeWav('background-loop.wav', loopMusic(5.2))

function writeWav(name, signal) {
    const samples = signalToU8(signal)
    const dataSize = samples.length
    const bytes = Buffer.alloc(44 + dataSize)
    bytes.write('RIFF', 0)
    bytes.writeUInt32LE(36 + dataSize, 4)
    bytes.write('WAVE', 8)
    bytes.write('fmt ', 12)
    bytes.writeUInt32LE(16, 16)
    bytes.writeUInt16LE(1, 20)
    bytes.writeUInt16LE(1, 22)
    bytes.writeUInt32LE(sampleRate, 24)
    bytes.writeUInt32LE(sampleRate, 28)
    bytes.writeUInt16LE(1, 32)
    bytes.writeUInt16LE(8, 34)
    bytes.write('data', 36)
    bytes.writeUInt32LE(dataSize, 40)
    Buffer.from(samples).copy(bytes, 44)
    writeFileSync(join(outDir, name), bytes)
}

function signalToU8(signal) {
    const out = new Uint8Array(signal.length)
    for (let i = 0; i < signal.length; i++) {
        const s = Math.max(-1, Math.min(1, signal[i]))
        out[i] = Math.round(128 + s * 100)
    }
    return out
}

function make(duration) {
    return new Float32Array(Math.max(1, Math.floor(duration * sampleRate)))
}

function noteSequence(duration, notes) {
    return mix(duration, notes.map((n) => note(n.start, n.end, n.hz, n.amp)))
}

function note(start, end, hz, amp) {
    return (signal) => {
        const a = Math.floor(start * sampleRate)
        const b = Math.min(signal.length, Math.floor(end * sampleRate))
        const len = Math.max(1, b - a)
        for (let i = a; i < b; i++) {
            const t = (i - a) / sampleRate
            const env = envelope((i - a) / len)
            signal[i] += square(hz, t) * amp * env
        }
    }
}

function pluck(start, end, hz, amp) {
    return (signal) => {
        const a = Math.floor(start * sampleRate)
        const b = Math.min(signal.length, Math.floor(end * sampleRate))
        const len = Math.max(1, b - a)
        for (let i = a; i < b; i++) {
            const t = (i - a) / sampleRate
            const p = (i - a) / len
            signal[i] += square(hz, t) * amp * Math.exp(-p * 7)
        }
    }
}

function chirp(start, end, fromHz, toHz, amp) {
    return (signal) => {
        const a = Math.floor(start * sampleRate)
        const b = Math.min(signal.length, Math.floor(end * sampleRate))
        const len = Math.max(1, b - a)
        let phase = 0
        for (let i = a; i < b; i++) {
            const p = (i - a) / len
            const hz = fromHz + (toHz - fromHz) * p
            phase += hz / sampleRate
            signal[i] += (phase % 1 < 0.5 ? 1 : -1) * amp * envelope(p)
        }
    }
}

function noiseBurst(start, end, amp, seed) {
    return (signal) => {
        const a = Math.floor(start * sampleRate)
        const b = Math.min(signal.length, Math.floor(end * sampleRate))
        const len = Math.max(1, b - a)
        let s = seed >>> 0
        for (let i = a; i < b; i++) {
            s = (Math.imul(s, 1664525) + 1013904223) >>> 0
            const noise = ((s / 0xffffffff) * 2 - 1)
            signal[i] += noise * amp * Math.exp(-((i - a) / len) * 8)
        }
    }
}

function mix(duration, layers) {
    const signal = make(duration)
    for (const layer of layers) layer(signal)
    return signal
}

function loopMusic(duration) {
    const signal = make(duration)
    const bass = [110, 110, 147, 98, 110, 165, 147, 98]
    const lead = [440, 554, 659, 554, 440, 392, 330, 392]
    const step = duration / 16
    for (let i = 0; i < 16; i++) {
        note(i * step, i * step + step * 0.82, bass[i % bass.length], 0.18)(signal)
        if (i % 2 === 0) note(i * step, i * step + step * 0.55, lead[(i / 2) % lead.length], 0.12)(signal)
        if (i % 4 === 2) noiseBurst(i * step, i * step + 0.04, 0.09, 100 + i)(signal)
    }
    return signal
}

function square(hz, t) {
    return (t * hz) % 1 < 0.5 ? 1 : -1
}

function envelope(p) {
    const attack = Math.min(1, p / 0.08)
    const release = Math.min(1, (1 - p) / 0.22)
    return Math.max(0, Math.min(attack, release))
}
