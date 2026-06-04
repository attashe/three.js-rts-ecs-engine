import test from 'node:test'
import assert from 'node:assert/strict'
import { serializeLevel } from '../src/engine/voxel/level-serializer'
import { BLOCK } from '../src/engine/voxel/palette'
import { compileWorldSpec } from '../src/game/worldgen'
import type { WorldSpec } from '../src/game/worldgen'

const DUNGEON_SPEC: WorldSpec = {
    version: 1,
    world: { id: 'blackroot_depths', name: 'Blackroot Depths', type: 'underground', seed: 'demo/dungeon-001', size: [64, 40, 64] },
    volume: {
        initial: 'solid',
        default_material: 'dark_limestone',
        strata: [
            { y: '0..10', material: 'dark_stone' },
            { y: '11..31', material: 'dark_limestone' },
            { y: '32..39', material: 'rootbound_dirt' },
        ],
    },
    carvers: [
        { id: 'entrance_shaft', type: 'vertical_shaft', center_xz: [8, 52], y_range: [23, 38], radius: 3, stairs: 'spiral', roughness: 0.1 },
        { id: 'echo_cavern', type: 'chamber_ellipsoid', center: [18, 24, 48], radius: [8, 5, 8], floor_y: 21, roughness: 0.2, floor_flatten: { radius_x: 5, radius_z: 5 } },
        { id: 'mushroom_grove', type: 'chamber_ellipsoid', center: [30, 22, 38], radius: [10, 5, 8], floor_y: 20, roughness: 0.35, floor_flatten: { radius_x: 6, radius_z: 5 } },
        {
            id: 'deep_canyon',
            type: 'underground_canyon',
            spline: [[34, 20, 35], [42, 20, 27], [50, 19, 20]],
            width: [12, 16],
            depth: 10,
            ceiling_height: 10,
            ledges: { required_main_path: { width: 3 } },
            crossing: { id: 'broken_bridge_socket', at_t: 0.52 },
        },
        { id: 'crystal_vault', type: 'chamber_ellipsoid', center: [55, 21, 12], radius: [7, 5, 6], floor_y: 19, roughness: 0.15, floor_flatten: { radius_x: 5, radius_z: 4 } },
    ],
    connectors: [
        { id: 'entrance_to_echo', type: 'noise_tube', from: [8, 22, 52], to: [18, 21, 48], radius: [2.5, 3], vertical_wander: 1 },
        { id: 'echo_to_grove', type: 'noise_tube', from: [22, 21, 46], to: [30, 20, 38], radius: [3, 3.5], vertical_wander: 1 },
        { id: 'grove_to_canyon', type: 'noise_tube', from: [32, 20, 36], to: [34, 20, 35], radius: [3, 3.5] },
        { id: 'canyon_to_vault', type: 'noise_tube', from: [50, 19, 20], to: [55, 19, 14], radius: [3, 3.5] },
    ],
    main_paths: [
        { id: 'critical_path_route', width: 2, carve_radius: 3, floor_block: 'stone', waypoints: [[8, 22, 52], [18, 21, 48], [30, 20, 38], [34, 20, 35], [42, 20, 27], [50, 19, 20], [55, 19, 14]] },
    ],
    structures: [
        { id: 'spawn', asset: 'marker.spawn', place: { mode: 'surface_at_xz', x: 8, z: 52, kind: 'floor', y_range: [20, 26], search_radius: 5, require_air_above: 2 }, required: true },
        { id: 'broken_bridge', asset: 'fixed.bridge.broken_stone', place: { mode: 'canyon_crossing', feature: 'deep_canyon', at_t: 0.52 }, required: true },
        { id: 'moon_shrine', asset: 'fixed.shrine.moonstone', place_at_xz: [50, 20], auto_surface: { kind: 'floor', y_range: [17, 23], search_radius: 5, require_air_above: 3 }, required: false },
        { id: 'blue_portal', asset: 'fixed.portal.blue_stone', place: { mode: 'room_center', room: 'crystal_vault' }, required: true },
    ],
    scatter: [
        { id: 'glow_mushrooms', asset: 'proc.mushroom.glow_cluster', count: 6, surface: 'floor', feature: 'mushroom_grove', min_distance: 3 },
        { id: 'canyon_crystals', asset: 'proc.crystal.wall_cluster', count: 5, surface: 'wall', feature: 'deep_canyon', min_distance: 3 },
        { id: 'stalactites', asset: 'proc.stalactite', count: 5, surface: 'ceiling', feature: 'echo_cavern', min_distance: 3, max_length: 5 },
    ],
    validation: {
        require_paths: [
            { id: 'spawn_to_portal', from: 'spawn', to: 'blue_portal', actor: 'player_basic' },
            { id: 'spawn_to_shrine', from: 'spawn', to: 'moon_shrine', actor: 'player_basic', optional: true },
        ],
    },
}

const MINESHAFT_SPEC: WorldSpec = {
    version: 1,
    world: { id: 'emberdeep_mineshaft', name: 'Emberdeep Mineshaft', type: 'underground', seed: 'demo/mineshaft-dwarf-village-001', size: [72, 40, 72] },
    volume: {
        initial: 'solid',
        default_material: 'dark_limestone',
        strata: [
            { y: '0..10', material: 'dark_stone' },
            { y: '11..31', material: 'dark_limestone' },
            { y: '32..39', material: 'rootbound_dirt' },
        ],
    },
    carvers: [
        { id: 'entrance_lift', type: 'vertical_shaft', center_xz: [8, 62], y_range: [25, 38], radius: 3, stairs: 'spiral' },
        { id: 'entry_hub', type: 'rect_room', center: [16, 24, 56], size: [12, 6, 10], floor_material: 'platform', support_pillars: true },
        { id: 'glittering_cave', type: 'chamber_ellipsoid', center: [30, 23, 50], radius: [9, 5, 8], floor_y: 21, roughness: 0.3, floor_flatten: { radius_x: 6, radius_z: 5 } },
        { id: 'dwarf_village_hall', type: 'rect_room', center: [48, 21, 38], size: [18, 7, 14], floor_material: 'platform', support_pillars: true },
        { id: 'living_room_south', type: 'rect_room', center: [48, 21, 54], size: [10, 5, 8], floor_material: 'wood', support_pillars: true },
        { id: 'forge_room', type: 'rect_room', center: [38, 20, 40], size: [10, 6, 8], floor_material: 'stone', support_pillars: true },
        { id: 'storage_room', type: 'rect_room', center: [58, 20, 28], size: [10, 5, 8], floor_material: 'platform', support_pillars: true },
        { id: 'portal_vault', type: 'chamber_ellipsoid', center: [62, 20, 16], radius: [7, 5, 6], floor_y: 18, roughness: 0.15, floor_flatten: { radius_x: 5, radius_z: 4 } },
        {
            id: 'main_mine_corridors',
            type: 'mine_tunnel_network',
            half_width: 2,
            height: 4,
            supports_every: 6,
            lantern_every: 9,
            rails: true,
            floor_material: 'stone',
            corridors: [
                [[8, 24, 62], [16, 24, 56], [30, 21, 50], [44, 21, 40], [48, 21, 38], [56, 20, 28], [62, 18, 16]],
                [[48, 21, 38], [48, 21, 46], [48, 21, 54]],
                [[48, 21, 38], [43, 20, 39], [38, 20, 40]],
                [[48, 21, 38], [53, 20, 33], [58, 20, 28]],
            ],
        },
    ],
    main_paths: [
        { id: 'debug_player_walk_route', width: 2, carve_radius: 3, floor_block: 'stone', waypoints: [[8, 24, 62], [16, 24, 56], [30, 21, 50], [48, 21, 38], [56, 20, 28], [62, 18, 16]] },
    ],
    structures: [
        { id: 'spawn', asset: 'marker.spawn', place: { mode: 'surface_at_xz', x: 8, z: 62, kind: 'floor', y_range: [22, 28], search_radius: 5, require_air_above: 2 }, required: true },
        { id: 'village_shrine', asset: 'fixed.shrine.moonstone', place: { mode: 'room_center', room: 'dwarf_village_hall' }, required: true },
        { id: 'living_room_a', asset: 'fixed.room.dwarf_living', place: { mode: 'room_center', room: 'living_room_south' }, required: true },
        { id: 'forge_decor', asset: 'fixed.room.dwarf_forge', place: { mode: 'room_center', room: 'forge_room' }, required: true },
        { id: 'storage_decor', asset: 'fixed.room.dwarf_storage', place: { mode: 'room_center', room: 'storage_room' }, required: true },
        { id: 'blue_portal', asset: 'fixed.portal.blue_stone', place: { mode: 'room_center', room: 'portal_vault' }, required: true },
    ],
    scatter: [
        { id: 'glitter_crystals', asset: 'proc.crystal.wall_cluster', count: 6, surface: 'wall', feature: 'glittering_cave', min_distance: 3 },
        { id: 'mine_mushrooms', asset: 'proc.mushroom.glow_cluster', count: 6, surface: 'floor', feature: 'dwarf_village_hall', min_distance: 3 },
        { id: 'mine_stalactites', asset: 'proc.stalactite', count: 5, surface: 'ceiling', feature: 'glittering_cave', min_distance: 3, max_length: 5 },
    ],
    validation: {
        require_paths: [
            { id: 'spawn_to_portal', from: 'spawn', to: 'blue_portal', actor: 'player_basic' },
            { id: 'spawn_to_living', from: 'spawn', to: 'living_room_a', actor: 'player_basic' },
            { id: 'spawn_to_forge', from: 'spawn', to: 'forge_decor', actor: 'player_basic' },
            { id: 'spawn_to_storage', from: 'spawn', to: 'storage_decor', actor: 'player_basic' },
        ],
    },
}

test('underground dungeon-style spec compiles with carvers, structures, scatter, and validation', () => {
    const result = compileWorldSpec(DUNGEON_SPEC)

    assert.equal(result.report.status, 'ok', diagnosticSummary(result.report.errors, result.report.warnings))
    assert.equal(result.meta.name, 'Blackroot Depths')
    assert.equal(result.meta.size, 64)
    assert.ok(result.report.worldHash)
    assert.ok(result.chunks.chunkCount() > 0)
    assert.deepEqual(result.meta.spawn, result.report.resolvedAnchors.spawn)
    assert.ok(result.report.resolvedObjects.blue_portal)
    assert.ok(result.report.resolvedObjects.broken_bridge_socket)
    assert.ok(result.report.resolvedObjects.broken_bridge)
    assert.ok(result.report.resolvedObjects.moon_shrine)
    assert.ok(result.report.placements.some((placement) => placement.id === 'deep_canyon' && placement.kind === 'carver'))
    assert.ok(result.report.placements.some((placement) => placement.id === 'critical_path_route' && placement.kind === 'guaranteed_path'))
    assert.equal(result.report.validation.length, 2)
    assert.ok(result.report.validation.every((entry) => entry.ok))
    assert.equal(result.meta.zones.some((zone) => zone.id === 'worldgen:blue_portal:portal-zone' && zone.active === false), true)

    const mushrooms = result.report.placements.find((placement) => placement.id === 'glow_mushrooms' && placement.kind === 'scatter_summary')
    assert.equal(mushrooms?.placed, 6)
    assert.equal(result.chunks.getVoxel(1, 1, 1), BLOCK.darkStone)
})

test('underground mineshaft-style spec compiles rooms, mine tunnels, and required paths', () => {
    const result = compileWorldSpec(MINESHAFT_SPEC)

    assert.equal(result.report.status, 'ok', diagnosticSummary(result.report.errors, result.report.warnings))
    assert.equal(result.meta.name, 'Emberdeep Mineshaft')
    for (const id of ['living_room_a', 'forge_decor', 'storage_decor', 'blue_portal', 'village_shrine']) {
        assert.ok(result.report.resolvedObjects[id], `${id} should resolve`)
    }
    assert.ok(result.report.placements.some((placement) => placement.id === 'main_mine_corridors' && placement.kind === 'carver'))
    assert.equal(result.report.validation.length, 4)
    assert.ok(result.report.validation.every((entry) => entry.ok), diagnosticSummary(result.report.errors, result.report.warnings))
    assert.ok(result.report.metrics.carverCount >= 9)
    assert.equal(result.report.metrics.pathCount, 1)
})

test('underground compilation is deterministic across chunks, metadata, and reports', () => {
    const a = compileWorldSpec(DUNGEON_SPEC)
    const b = compileWorldSpec(DUNGEON_SPEC)

    assert.equal(a.report.status, 'ok')
    assert.equal(b.report.status, 'ok')
    assert.equal(a.report.specHash, b.report.specHash)
    assert.equal(a.report.worldHash, b.report.worldHash)
    assert.deepEqual(a.report.resolvedObjects, b.report.resolvedObjects)
    assert.deepEqual(a.report.validation, b.report.validation)
    assert.ok(Buffer.from(serializeLevel(a.chunks, a.meta)).equals(Buffer.from(serializeLevel(b.chunks, b.meta))))
})

test('underground compiler reports unsupported types explicitly', () => {
    const badCarver = compileWorldSpec({
        version: 1,
        world: { id: 'bad_underground', name: 'Bad Underground', type: 'underground', seed: 'bad-u', size: [32, 24, 32] },
        volume: { initial: 'solid', default_material: 'stone' },
        carvers: [{ id: 'mist', type: 'fog_room' }],
    })

    assert.equal(badCarver.report.status, 'failed')
    assert.ok(badCarver.report.errors.some((error) => error.code === 'unsupported_feature' && error.path === '$.carvers[0].type'))

    const badConnector = compileWorldSpec({
        version: 1,
        world: { id: 'bad_connector', name: 'Bad Connector', type: 'underground', seed: 'bad-c', size: [32, 24, 32] },
        volume: { initial: 'solid', default_material: 'stone' },
        connectors: [{ id: 'gate', type: 'teleport_tube' }],
    })

    assert.equal(badConnector.report.status, 'failed')
    assert.ok(badConnector.report.errors.some((error) => error.code === 'unsupported_feature' && error.path === '$.connectors[0].type'))
})

// ── Per-carver isolation tests ─────────────────────────────────────────────
// Each carver compiled alone in a solid block, asserting the carve actually
// happened (air where it should be, solid where it should not, floors stamped
// one cell below `floor_y` per stampFloorCell). These exercise the split
// underground modules directly and act as behaviour-preserving guards against
// future refactors of carvers/stamping. Default material is dark_limestone so a
// stamped `stone`/`rail` floor is distinguishable from un-carved rock.

test('vertical_shaft carves a hollow column through solid rock', () => {
    const r = compileWorldSpec({
        version: 1,
        world: { id: 'shaft_only', name: 'Shaft', type: 'underground', seed: 'shaft', size: [32, 40, 32] },
        volume: { initial: 'solid', default_material: 'dark_limestone' },
        carvers: [{ id: 'shaft', type: 'vertical_shaft', center_xz: [16, 16], y_range: [10, 30], radius: 3, roughness: 0 }],
    })
    assert.notEqual(r.report.status, 'failed', diagnosticSummary(r.report.errors, r.report.warnings))
    assert.equal(r.chunks.getVoxel(16, 12, 16), BLOCK.air, 'shaft centre carved near the bottom')
    assert.equal(r.chunks.getVoxel(16, 28, 16), BLOCK.air, 'shaft centre carved near the top')
    assert.notEqual(r.chunks.getVoxel(3, 20, 3), BLOCK.air, 'rock outside the shaft stays solid')
    assert.ok(r.report.placements.some((p) => p.id === 'shaft' && p.kind === 'carver'))
})

test('chamber_ellipsoid carves a hollow cavern over a stamped floor', () => {
    const r = compileWorldSpec({
        version: 1,
        world: { id: 'cave_only', name: 'Cave', type: 'underground', seed: 'cave', size: [40, 40, 40] },
        volume: { initial: 'solid', default_material: 'dark_limestone' },
        carvers: [{ id: 'cave', type: 'chamber_ellipsoid', center: [20, 22, 20], radius: [8, 5, 8], floor_y: 18, roughness: 0, floor_flatten: { radius_x: 5, radius_z: 5 } }],
    })
    assert.notEqual(r.report.status, 'failed', diagnosticSummary(r.report.errors, r.report.warnings))
    assert.equal(r.chunks.getVoxel(20, 22, 20), BLOCK.air, 'cavern interior carved at the centre')
    assert.equal(r.chunks.getVoxel(20, 17, 20), BLOCK.stone, 'floor stamped one cell below floor_y')
    assert.notEqual(r.chunks.getVoxel(2, 22, 2), BLOCK.air, 'rock outside the cavern stays solid')
})

test('rect_room carves an interior above a stamped floor', () => {
    const r = compileWorldSpec({
        version: 1,
        world: { id: 'room_only', name: 'Room', type: 'underground', seed: 'room', size: [32, 40, 32] },
        volume: { initial: 'solid', default_material: 'dark_limestone' },
        carvers: [{ id: 'hall', type: 'rect_room', center: [16, 16, 16], size: [10, 6, 8], floor_material: 'stone', support_pillars: false, lanterns: false }],
    })
    assert.notEqual(r.report.status, 'failed', diagnosticSummary(r.report.errors, r.report.warnings))
    assert.equal(r.chunks.getVoxel(16, 15, 16), BLOCK.stone, 'room floor stamped one cell below floor_y')
    assert.equal(r.chunks.getVoxel(16, 17, 16), BLOCK.air, 'room interior carved above the floor')
    assert.notEqual(r.chunks.getVoxel(2, 17, 2), BLOCK.air, 'rock outside the room stays solid')
})

test('mine_tunnel_network carves rail-laid corridors', () => {
    const r = compileWorldSpec({
        version: 1,
        world: { id: 'mine_only', name: 'Mine', type: 'underground', seed: 'mine', size: [40, 40, 40] },
        volume: { initial: 'solid', default_material: 'dark_limestone' },
        carvers: [{ id: 'mine', type: 'mine_tunnel_network', half_width: 2, height: 4, rails: true, floor_material: 'stone', supports_every: 0, lantern_every: 0, corridors: [[[8, 16, 20], [32, 16, 20]]] }],
    })
    assert.notEqual(r.report.status, 'failed', diagnosticSummary(r.report.errors, r.report.warnings))
    assert.equal(r.chunks.getVoxel(20, 17, 20), BLOCK.air, 'corridor headroom carved above the walkway')
    assert.equal(r.chunks.getVoxel(20, 15, 20), BLOCK.stone, 'corridor floor stamped below the walkway')
    let railFound = false
    for (let x = 8; x <= 32 && !railFound; x += 1) {
        if (r.chunks.getVoxel(x, 16, 20) === BLOCK.rail) railFound = true
    }
    assert.ok(railFound, 'rails laid along the corridor floor')
    assert.ok(r.report.placements.some((p) => p.id === 'mine' && p.kind === 'carver'))
})

test('noise_tube connector carves a void linking two points', () => {
    const r = compileWorldSpec({
        version: 1,
        world: { id: 'tube_only', name: 'Tube', type: 'underground', seed: 'tube', size: [40, 40, 40] },
        volume: { initial: 'solid', default_material: 'dark_limestone' },
        connectors: [{ id: 'tube', type: 'noise_tube', from: [8, 18, 20], to: [32, 18, 20], radius: [3, 3] }],
    })
    assert.notEqual(r.report.status, 'failed', diagnosticSummary(r.report.errors, r.report.warnings))
    assert.equal(r.chunks.getVoxel(20, 19, 20), BLOCK.air, 'tube carves a connecting void at its midpoint')
    assert.ok(r.report.placements.some((p) => p.id === 'tube' && p.kind === 'connector'))
})

function diagnosticSummary(
    errors: readonly { code: string; message: string }[],
    warnings: readonly { code: string; message: string }[] = [],
): string {
    return [...errors, ...warnings].map((entry) => `${entry.code}: ${entry.message}`).join('\n')
}
