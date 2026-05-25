import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const expected = {
    'arrow-hit.wav': {
        bytes: 7541,
        sha256: 'b02a77abfd70d5b50c53febb7a4c6d5c40bd518d7fdf6c9eed08e7f1a172de94',
    },
    'background-loop.wav': {
        bytes: 114704,
        sha256: '707a9a69c03516c8c5ad2bec34e57b3548578b723eadd4ce06f9485d350903f6',
    },
    'bow.wav': {
        bytes: 8423,
        sha256: 'c01fc102fe950bf1fe59a84bb34efc122f92365e247084a3239baece0a194998',
    },
    'death-stinger.wav': {
        bytes: 29811,
        sha256: '5925e4366e6312d91f6e1f3e5f0ae2011ba20e20ab113844dd2ab902c297a35f',
    },
    'death.wav': {
        bytes: 19007,
        sha256: '2771ec4b0148c567312ce37336417046338a58cbc131354e9c07365936f841bf',
    },
    'pickup-arrow.wav': {
        bytes: 6218,
        sha256: 'b7d2ea345abb0dcae38a055f07594bb2736e08470c9b9916bfd3048d9fb64d22',
    },
    'pickup-gold.wav': {
        bytes: 7100,
        sha256: '514fbe1852b5d56b1025d5ba8fa0198da55ead3e52ec9c173fb33cedecf1949a',
    },
} as const

test('generated audio samples are deterministic 8-bit WAV files', () => {
    for (const [name, meta] of Object.entries(expected)) {
        const bytes = readFileSync(join(process.cwd(), 'public', 'audio', '8bit', name))
        assert.equal(bytes.byteLength, meta.bytes, `${name} byte size changed`)
        assert.equal(bytes.toString('ascii', 0, 4), 'RIFF', `${name} missing RIFF header`)
        assert.equal(bytes.toString('ascii', 8, 12), 'WAVE', `${name} missing WAVE header`)
        assert.equal(bytes.toString('ascii', 12, 16), 'fmt ', `${name} missing fmt chunk`)
        assert.equal(bytes.readUInt16LE(20), 1, `${name} should be PCM`)
        assert.equal(bytes.readUInt16LE(22), 1, `${name} should be mono`)
        assert.equal(bytes.readUInt16LE(34), 8, `${name} should be 8-bit`)
        assert.equal(bytes.toString('ascii', 36, 40), 'data', `${name} missing data chunk`)
        assert.equal(createHash('sha256').update(bytes).digest('hex'), meta.sha256, `${name} hash changed`)
    }
})
