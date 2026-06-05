import test from 'node:test'
import assert from 'node:assert/strict'
import { BLOCK } from '../src/engine/voxel/palette'
import { surfaceForBlock } from '../src/game/player-audio'

test('surfaceForBlock maps each palette block to a footstep family', () => {
    // Grass family — soft, muffled.
    assert.equal(surfaceForBlock(BLOCK.grass), 'grass')
    assert.equal(surfaceForBlock(BLOCK.leaf), 'grass')

    // Dirt family — heavy thud.
    assert.equal(surfaceForBlock(BLOCK.dirt), 'dirt')
    assert.equal(surfaceForBlock(BLOCK.sand), 'dirt')

    // Stone family — clean click. Brick / glow / invisible borders all
    // sound the same so a brick wall and a path of stone walk alike.
    assert.equal(surfaceForBlock(BLOCK.stone), 'stone')
    assert.equal(surfaceForBlock(BLOCK.brick), 'stone')
    assert.equal(surfaceForBlock(BLOCK.glow), 'stone')
    assert.equal(surfaceForBlock(BLOCK.noWalk), 'stone')
    assert.equal(surfaceForBlock(BLOCK.stairs), 'stone')
    assert.equal(surfaceForBlock(BLOCK.oreIron), 'stone')
    assert.equal(surfaceForBlock(BLOCK.oreCopper), 'stone')
    assert.equal(surfaceForBlock(BLOCK.oreCrystal), 'stone')

    // Wood family — hollow creak.
    assert.equal(surfaceForBlock(BLOCK.wood), 'wood')
    assert.equal(surfaceForBlock(BLOCK.plank), 'wood')
    assert.equal(surfaceForBlock(BLOCK.door), 'wood')
    assert.equal(surfaceForBlock(BLOCK.chest), 'wood')
    assert.equal(surfaceForBlock(BLOCK.openChest), 'wood')
    assert.equal(surfaceForBlock(BLOCK.goodsShelf), 'wood')
    assert.equal(surfaceForBlock(BLOCK.toolPanel), 'wood')
    assert.equal(surfaceForBlock(BLOCK.recordShelf), 'wood')
    assert.equal(surfaceForBlock(BLOCK.oreShelf), 'stone')

    // Water — splash.
    assert.equal(surfaceForBlock(BLOCK.water), 'water')

    // Unknown / air falls through to dirt so steps stay audible.
    assert.equal(surfaceForBlock(BLOCK.air), 'dirt')
    assert.equal(surfaceForBlock(BLOCK.cloud), 'dirt')
    assert.equal(surfaceForBlock(255), 'dirt')
})
