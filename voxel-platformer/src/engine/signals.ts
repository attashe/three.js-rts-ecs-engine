import SignalsEvent from './signals-event'

export type SignalSubscriber = (data: unknown, event: SignalsEvent) => void

// Lightweight synchronous pub/sub bus for UI / cross-module events. Hot-path
// per-frame traffic now lives inside ECS systems — do NOT pipe simulation
// state through here.
export default class Signals {
    private subscribers: Map<string, SignalSubscriber[]> = new Map()

    on(event: string, subscriber: SignalSubscriber): void {
        const subscribers = this.subscribers.get(event) ?? []
        if (subscribers.indexOf(subscriber) >= 0) {
            console.warn('Signals on: subscriber already added')
        } else {
            subscribers.push(subscriber)
        }
        this.subscribers.set(event, subscribers)
    }

    off(event: string, subscriber: SignalSubscriber): void {
        const subscribers = this.subscribers.get(event)
        if (!subscribers) return
        const index = subscribers.indexOf(subscriber)
        if (index >= 0) subscribers.splice(index, 1)
    }

    send(event: string, data: unknown = null): void {
        const subscribers = this.subscribers.get(event)
        if (!subscribers) return
        const sigEvent = new SignalsEvent()
        for (const subscriber of [...subscribers]) {
            if (sigEvent.stop) break
            subscriber(data, sigEvent)
        }
    }
}
