import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Locked byte sizes + SHA-256s for the procedurally generated WAV
// assets. Adding a new asset or modifying an existing one should
// require running `node scripts/generate-audio-samples.mjs` and
// updating the entry below — that's the contract: anyone touching
// the synth has to opt into the bytes shipping with the build.

const expected = {
    // ── Game one-shots ────────────────────────────────────────────
    'arrow-hit.wav': {
        bytes: 8423,
        sha256: '9891172b04d2d37a236f4c3c600f6a03ed217fcc2456cd15926bd622ebdcbbdc',
    },
    'bow.wav': {
        bytes: 8864,
        sha256: '7fa9440a464bfc2b5167f6dd97ede27d7a668e8f1821d6b1c6988cedc6349054',
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
        bytes: 7982,
        sha256: 'c4113915a90992c66ece1074c3243a50e0dbcaf1e5fe9503f5cd3615ff24a9d1',
    },

    // ── Melee combat ──────────────────────────────────────────────
    'sword-swing.wav':     { bytes: 6218, sha256: 'f7757e6574030755fb6defc662b2816fec5d8cbc9fae6ecd6dafcd6368409c76' },
    'heavy-swing.wav':     { bytes: 8423, sha256: 'c3a2194815a1f1ebbb43403abae969b79681a09133cf80fe3e3c0575b3bef78a' },
    'melee-hit.wav':       { bytes: 6659, sha256: '96cec2d338ebcef602af71895403d22e89a71cf82e3d7f0392a3f6c8240ec5c2' },
    'melee-hit-heavy.wav': { bytes: 8864, sha256: 'fed9ad1e4b3ef39ebbf1a7c2899e9b1bd74520230f56813a80396fc3ba43738c' },
    'shield-block.wav':    { bytes: 7541, sha256: '4bc5067315aa0fb38daea57af12eff09cb1d1340dd2114f18c834b737e24f005' },
    'player-hurt.wav':     { bytes: 5777, sha256: '725ec7249fa3d3f84645dd481e66ba9863f029e21298fd004563e234acd5bdf1' },
    'npc-hurt.wav':        { bytes: 4895, sha256: '3ca8fd63bc357837ab0f5a8efc60b6cc3efadb32ede334402cb60431f00a21d5' },

    // ── Spells (cast + impact per spell) ──────────────────────────
    'bolt-cast.wav': { bytes: 6659,  sha256: '5b1c7bace6ecbba2b787f01906e215f5d490f29e451a702c25b7261cab27c055' },
    'bolt-hit.wav':  { bytes: 5777,  sha256: '0c988e8931e40c67b7a99627926b6ec5e926ad214fcdd0f48c5e8073a8f08d74' },
    'nova-cast.wav': { bytes: 11069, sha256: 'd8d2a85fdc2ba1de6c0b673128784b6c90ddf8d6b56cb665a7038b68f39bd4e1' },
    'nova-hit.wav':  { bytes: 5336,  sha256: 'e280bf3f303160e06d36f3bd68e7cb9ade0a26c0847a1bebd56afa46092489dc' },
    'orb-cast.wav':  { bytes: 7541,  sha256: '2ff3f619df00123a928c075e99b7b53c5220652beae8dbf6fd778c304de6c5cf' },
    'orb-zap.wav':   { bytes: 4454,  sha256: '45154902dc69f5a723c19132d3f0381deb519247440595e36f1883c85da3fa72' },

    // ── Player locomotion ─────────────────────────────────────────
    // Surface-aware footsteps: 5 families × 2 variants. Volumes vary
    // per family (see GAME_AUDIO_MANIFEST).
    'footstep-grass-1.wav': { bytes: 2249, sha256: '058b42232ca56d8189374c8d932737a9cbda18d5339c655e9030b5fe1a37ddbf' },
    'footstep-grass-2.wav': { bytes: 2469, sha256: '24df097ff78d30207616d3466caa923fade12ec2efc3c6f5213de5a2f8aaf9d9' },
    'footstep-dirt-1.wav':  { bytes: 2249, sha256: 'ab0e098201b4b5c8aee29ba74cd8cd9c72856de9ae218bc445621fc11a21bf65' },
    'footstep-dirt-2.wav':  { bytes: 2469, sha256: '33d347a662fa04efd6b4c7395b65d10ac7b7bdbfb39fe87ccceddd8c09fe3595' },
    'footstep-stone-1.wav': { bytes: 2249, sha256: '12f809b2c8b927ed988f07b65fe5fb45dd32df0ad213cdfe1637e61bf3acbd7f' },
    'footstep-stone-2.wav': { bytes: 2249, sha256: '1c930f08720f7e88001346d498039a4f6bc447d5b8ddf43b4eb1ba64e57c2685' },
    'footstep-wood-1.wav':  { bytes: 2469, sha256: '97f840864521dfd18f905f96516879b94ebcf2175e47fc8da3e06748f0adac1d' },
    'footstep-wood-2.wav':  { bytes: 2690, sha256: '72df83b6b4c5d6ee3ca102abd6e3c536f0747be3f91f6ae19704ef30475fc8d7' },
    'footstep-water-1.wav': { bytes: 4013, sha256: '87e1cc8e2e7bc1e10e4c756b3eb7caa675abde485c87ccc8c5213089f797f476' },
    'footstep-water-2.wav': { bytes: 4454, sha256: 'dafb2b6e2af2d7d8e0d98cada0864616f97fbbe8bf81016affd0840bc3f9cfc0' },
    'jump.wav': {
        bytes: 5336,
        sha256: '6a362bc34e7eb04e29935fc9a600e94f06a3b54516ebd63eff6381cb72da27b0',
    },
    'land.wav': {
        bytes: 4895,
        sha256: 'e26ee157b2c9fc0ad2304cf522c132b98e6317a8699ed9c1f246cdd9406e274c',
    },
    'high-jump.wav': {
        bytes: 14156,
        sha256: '05f69126a89b281c6a49b1a1792c58fc07f2080039ba0f7ef4db3f0ac721098b',
    },
    'air-push.wav': {
        bytes: 14597,
        sha256: '95fdf0c524998b1455f7fea6b791fd3aa72f488fcab40a173860ea162ddcf34b',
    },

    // ── Music loops ───────────────────────────────────────────────
    'background-loop.wav': {
        bytes: 114704,
        sha256: '5bb0a6d488c873e5c63a1fcab2975cb54b6adc00cef275255676794ed558df83',
    },
    'background-calm-loop.wav': {
        bytes: 141164,
        sha256: 'f63bb61ca98491b39dc78c5cfa4bb8656fd5f702d28bc20c6e18e8237b897681',
    },
    'background-action-loop.wav': {
        bytes: 105884,
        sha256: 'e36a441c9b2365ec48eac86d4a80991d1288c009641cf4644a761c09a9cff358',
    },
    'background-cave-loop.wav': {
        bytes: 158804,
        sha256: '5f245a89b923027d8e84e19c3e85928a2dd2540ff5bea0333343d9532c7fa9f9',
    },
    'piano-ambient-quiet.wav': {
        bytes: 176444,
        sha256: 'd304479133aacc9b946270389b1e0017366476010fd214c819fa1cede7580cb5',
    },
    'piano-ambient-night.wav': {
        bytes: 211724,
        sha256: '013e312c690681bf95d69d3f23f53a328afb0d167157f5f141070cd821e5f5fe',
    },
    'piano-ambient-drift.wav': {
        bytes: 194084,
        sha256: '91e2430ca83750d5a4fa37599a6a8903aae8068801e602ce9f60a869206d385a',
    },

    // ── Ambient location set (calm / intriguing, C418-style) ──────
    'amb-start-loop.wav':   { bytes: 264644, sha256: '7775fbe3854d10eb014ed45cb922a55b2dfcc2fc6e9950bb50e59c2cb740313b' },
    'amb-garden-loop.wav':  { bytes: 286694, sha256: '698fd893141383dd9bbe63e56d853d92005a53c6bae9fd1ee610ad6c962781ca' },
    'amb-town-loop.wav':    { bytes: 308744, sha256: '9d50543c9081afb4b8e81868f4cdd674c01cd4352496c2e7703d842b00d9e6d7' },
    'amb-tension-loop.wav': { bytes: 220544, sha256: 'a7eb748191f2e480ec97fc8c4a396c6c0167948e59632c64e863999f8a1fc216' },
    'amb-cave-loop.wav':    { bytes: 352844, sha256: '5778625c4a604784fb089c8fab08aa08bc67f17f6cf5c91b4230efd9bab8be5d' },

    // ── Weather ───────────────────────────────────────────────────
    'rain-loop.wav': {
        bytes: 79424,
        sha256: 'b48f2abc0b6719167fa79ea81783f29a9ce8d2b007d0f16f61858829bf961a2d',
    },
    'storm-loop.wav': {
        bytes: 99269,
        sha256: 'b56c1859fe279af3c9b987ef54a69fdd5ac630abb15f685e068964158698fd92',
    },
    'wind-loop.wav': {
        bytes: 88244,
        sha256: 'c99140962c58ee86512e71fe4b6f56ca6b84081ab2f90a7501e64d07068e977f',
    },
    'thunder.wav': {
        bytes: 40836,
        sha256: '7b8d33ff9e2ce425cc721f86dce455b5a1641515888fc09b86724b18d9577702',
    },

    // ── Fire ──────────────────────────────────────────────────────
    'fire-loop.wav': {
        bytes: 75014,
        sha256: 'ffcf69c90620171694e7248dc658bdba3f1001fe8fafb720e21cb92e64ddf795',
    },
    'fire-whoosh.wav': {
        bytes: 13715,
        sha256: '55fb1c4d5fc656706fb85eb5f42382c96a3604490830178fa3ba90fbaa9c403d',
    },
    'torch-loop.wav': {
        bytes: 52964,
        sha256: '5eb90163770540f01edfd75dd0117a8049a1f89e2f872e0a5de8c8b694136f37',
    },

    // ── Explosion ─────────────────────────────────────────────────
    'explosion.wav': {
        bytes: 30913,
        sha256: 'b4d338df61b31381274a4af87da3d1a6a7eaa285d3cd62ae36bbf00008d38cf3',
    },
    'explosion-small.wav': {
        bytes: 18786,
        sha256: 'ea49d9ff6e90e8b5ce103bea6edc75f0e4f24f51c71f83840452acb377add3fc',
    },
    'stone-impact.wav': {
        bytes: 7541,
        sha256: '2ff139b14d1757b58edb81d188e533bac978c81b25675e2205e28e6490741639',
    },

    // ── Liquids ───────────────────────────────────────────────────
    'water-loop.wav': {
        bytes: 66194,
        sha256: '071d659f8e5275bea8c092b285fa626237a21397f1dc6ea76856b734c664edbb',
    },
    'lava-loop.wav': {
        bytes: 70604,
        sha256: '4273eeec1c66c8dd53eefa5baf4b76d109c081000c70531ebcddef7a6da9232b',
    },
    'bubble.wav': {
        bytes: 6659,
        sha256: '3b8907de5ffb776607372cb32fc99d9e0b225f7eb82a9e332fb3e5f6742eef7c',
    },

    // ── Magic ─────────────────────────────────────────────────────
    'magic-loop.wav': {
        bytes: 83834,
        sha256: '6943001fa1950baa408883a1c517e004bc4d3491c7944151c812322f0aa8e546',
    },
    'magic-chime.wav': {
        bytes: 16361,
        sha256: '195b8a62aa61267dbbaa34af48e58ffde04a80301b8e6a182268aa2bed002c5e',
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
