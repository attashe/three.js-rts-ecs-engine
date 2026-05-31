import {
    DIALOGUE_VOICE_PRESET_CONFIGS,
    DIALOGUE_VOICE_PRESETS,
    synthDialogueVoiceLine,
    type DialogueVoicePreset,
    type DialogueVoiceRenderResult,
} from './game/dialogue-voice'

let audioContext: AudioContext | null = null
let current: DialogueVoiceRenderResult | null = null

const ui = {
    preset: byId<HTMLSelectElement>('preset'),
    seed: byId<HTMLInputElement>('seed'),
    volume: byId<HTMLInputElement>('volume'),
    volumeValue: byId<HTMLElement>('volumeValue'),
    rate: byId<HTMLInputElement>('rate'),
    rateValue: byId<HTMLElement>('rateValue'),
    pitch: byId<HTMLInputElement>('pitch'),
    pitchValue: byId<HTMLElement>('pitchValue'),
    text: byId<HTMLTextAreaElement>('text'),
    fantasy: byId<HTMLElement>('fantasy'),
    wave: byId<HTMLCanvasElement>('wave'),
    duration: byId<HTMLElement>('duration'),
    samples: byId<HTMLElement>('samples'),
    words: byId<HTMLElement>('words'),
    render: byId<HTMLButtonElement>('render'),
    play: byId<HTMLButtonElement>('play'),
    download: byId<HTMLButtonElement>('download'),
}

for (const preset of DIALOGUE_VOICE_PRESETS) {
    const opt = document.createElement('option')
    opt.value = preset
    opt.textContent = DIALOGUE_VOICE_PRESET_CONFIGS[preset].name
    ui.preset.appendChild(opt)
}
ui.preset.value = 'dwarf'

ui.render.onclick = () => render()
ui.play.onclick = () => { void play() }
ui.download.onclick = () => download()
for (const el of [ui.preset, ui.seed, ui.volume, ui.rate, ui.pitch, ui.text]) {
    el.addEventListener('input', () => render())
}

render()

function render(): void {
    syncLabels()
    current = synthDialogueVoiceLine(ui.text.value, {
        preset: ui.preset.value as DialogueVoicePreset,
        seed: ui.seed.value,
        volume: Number(ui.volume.value),
        rate: Number(ui.rate.value),
        pitchOffset: Number(ui.pitch.value),
    })
    ui.fantasy.textContent = current.fantasyText
    ui.duration.textContent = `${current.duration.toFixed(2)}s`
    ui.samples.textContent = String(current.samples.length)
    ui.words.textContent = String((current.fantasyText.match(/[A-Za-z]+/g) ?? []).length)
    drawWave(current.samples)
}

async function play(): Promise<void> {
    if (!current || current.samples.length === 0) render()
    if (!current) return
    const Ctor = window.AudioContext ?? window.webkitAudioContext
    if (!Ctor) return
    const ctx = audioContext ?? new Ctor()
    audioContext = ctx
    if (ctx.state === 'suspended') await ctx.resume()
    const buffer = ctx.createBuffer(1, current.samples.length, current.sampleRate)
    buffer.copyToChannel(new Float32Array(current.samples), 0)
    const source = ctx.createBufferSource()
    const gain = ctx.createGain()
    source.buffer = buffer
    gain.gain.value = Number(ui.volume.value)
    source.connect(gain)
    gain.connect(ctx.destination)
    source.start()
}

function download(): void {
    if (!current) render()
    if (!current) return
    const blob = wavBlob(current.samples, current.sampleRate)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `dialogue-voice-${ui.preset.value}.wav`
    a.click()
    URL.revokeObjectURL(a.href)
}

function syncLabels(): void {
    ui.volumeValue.textContent = Number(ui.volume.value).toFixed(2)
    ui.rateValue.textContent = Number(ui.rate.value).toFixed(2)
    ui.pitchValue.textContent = ui.pitch.value
}

function drawWave(samples: Float32Array): void {
    const canvas = ui.wave
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.035)'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.strokeStyle = 'rgba(255, 209, 102, 0.95)'
    ctx.lineWidth = 2
    ctx.beginPath()
    const mid = canvas.height / 2
    const step = Math.max(1, Math.floor(samples.length / canvas.width))
    for (let x = 0; x < canvas.width; x++) {
        let peak = 0
        const start = x * step
        for (let i = 0; i < step && start + i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[start + i]!))
        const y = mid - peak * (canvas.height * 0.42)
        if (x === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
    }
    for (let x = canvas.width - 1; x >= 0; x--) {
        let peak = 0
        const start = x * step
        for (let i = 0; i < step && start + i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[start + i]!))
        ctx.lineTo(x, mid + peak * (canvas.height * 0.42))
    }
    ctx.closePath()
    ctx.stroke()
}

function wavBlob(samples: Float32Array, sampleRate: number): Blob {
    const buffer = new ArrayBuffer(44 + samples.length * 2)
    const view = new DataView(buffer)
    writeText(view, 0, 'RIFF')
    view.setUint32(4, 36 + samples.length * 2, true)
    writeText(view, 8, 'WAVE')
    writeText(view, 12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, 1, true)
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, sampleRate * 2, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true)
    writeText(view, 36, 'data')
    view.setUint32(40, samples.length * 2, true)
    let offset = 44
    for (const sample of samples) {
        const x = Math.max(-1, Math.min(1, sample))
        view.setInt16(offset, x < 0 ? x * 0x8000 : x * 0x7fff, true)
        offset += 2
    }
    return new Blob([buffer], { type: 'audio/wav' })
}

function writeText(view: DataView, offset: number, text: string): void {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
}

function byId<T extends HTMLElement>(id: string): T {
    const el = document.getElementById(id)
    if (!el) throw new Error(`Missing #${id}`)
    return el as T
}
