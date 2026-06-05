import { synthDialogueVoiceLine } from './synth'
import type { DialogueVoiceRef } from './types'

interface DialogueVoiceWorkerRequest {
    id: number
    text: string
    voice: DialogueVoiceRef
}

self.onmessage = (event: MessageEvent<DialogueVoiceWorkerRequest>) => {
    const { id, text, voice } = event.data
    try {
        const result = synthDialogueVoiceLine(text, voice)
        self.postMessage({
            id,
            ok: true,
            result: {
                samples: result.samples,
                sampleRate: result.sampleRate,
                fantasyText: result.fantasyText,
                duration: result.duration,
                cacheKey: result.cacheKey,
            },
        }, [result.samples.buffer])
    } catch (err) {
        self.postMessage({
            id,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
        })
    }
}
