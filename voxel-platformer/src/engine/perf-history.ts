export interface MetricHistoryStats {
    latest: number | null
    count: number
    validCount: number
    avg: number | null
    min: number | null
    max: number | null
}

export class MetricHistory {
    private readonly values: Float64Array
    private cursor = 0
    private count = 0

    constructor(readonly capacity: number) {
        if (!Number.isInteger(capacity) || capacity <= 0) {
            throw new Error(`MetricHistory capacity must be a positive integer, got ${capacity}`)
        }
        this.values = new Float64Array(capacity)
        this.values.fill(Number.NaN)
    }

    push(value: number | null | undefined): void {
        this.values[this.cursor] = typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN
        this.cursor = (this.cursor + 1) % this.capacity
        this.count = Math.min(this.count + 1, this.capacity)
    }

    clear(): void {
        this.values.fill(Number.NaN)
        this.cursor = 0
        this.count = 0
    }

    stats(): MetricHistoryStats {
        let latest: number | null = null
        let validCount = 0
        let sum = 0
        let min = Number.POSITIVE_INFINITY
        let max = Number.NEGATIVE_INFINITY

        for (let i = 0; i < this.count; i++) {
            const value = this.values[this.physicalIndex(i)]!
            if (!Number.isFinite(value)) continue
            validCount++
            sum += value
            min = Math.min(min, value)
            max = Math.max(max, value)
        }

        if (this.count > 0) {
            const value = this.values[this.physicalIndex(this.count - 1)]!
            latest = Number.isFinite(value) ? value : null
        }

        return {
            latest,
            count: this.count,
            validCount,
            avg: validCount > 0 ? sum / validCount : null,
            min: validCount > 0 ? min : null,
            max: validCount > 0 ? max : null,
        }
    }

    forEachSample(fn: (value: number | null, index: number, count: number) => void): void {
        for (let i = 0; i < this.count; i++) {
            const value = this.values[this.physicalIndex(i)]!
            fn(Number.isFinite(value) ? value : null, i, this.count)
        }
    }

    private physicalIndex(logicalIndex: number): number {
        const start = this.count < this.capacity ? 0 : this.cursor
        return (start + logicalIndex) % this.capacity
    }
}
