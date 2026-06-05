export const DEMO_LEVEL_ID = 'demo'
export const TELEPORT_GARDEN_LEVEL_ID = 'demo-teleport-garden'
export const LARGE_TOWN_LEVEL_ID = 'demo-large-town'
export const COMBAT_ARENA_LEVEL_ID = 'demo-combat-arena'
export const FOREST_LIFT_VALLEY_LEVEL_ID = 'demo-forest-lift-valley'
export const WORLDGEN_PIPELINE_SAMPLE_LEVEL_ID = 'worldgen-pipeline-sample'
export const PHASE12_UNDERGROUND_MINE_STRESS_LEVEL_ID = 'phase12-underground-mine-stress'
export const STORMY_EAGLE_PEAK_LEVEL_ID = 'stormy-eagle-peak'

export const DEMO_FROM_GARDEN_ARRIVAL_ID = 'arrival.from-garden'
export const TELEPORT_GARDEN_FROM_DEMO_ARRIVAL_ID = 'arrival.from-demo'

// Large-town boulevard — a streaming stress/demo location reached from the
// demo plaza. Long enough (512 cells) to exceed the renderer's mesh window so
// chunks visibly stream in and out as the player walks it.
export const TOWN_FROM_DEMO_ARRIVAL_ID = 'arrival.town.from-demo'
export const DEMO_FROM_TOWN_ARRIVAL_ID = 'arrival.demo.from-town'

export const ARENA_FROM_DEMO_ARRIVAL_ID = 'arrival.arena.from-demo'
export const DEMO_FROM_ARENA_ARRIVAL_ID = 'arrival.demo.from-arena'

export const FOREST_LIFT_FROM_EDGE_ARRIVAL_ID = 'arrival.forest-lift.from-edge'
export const FOREST_LIFT_FROM_MINE_ARRIVAL_ID = 'arrival.forest-lift.from-mine'
export const FOREST_LIFT_MINE_PORTAL_ZONE_ID = 'zone.forest-lift.mine-entry'
export const MINE_FROM_FOREST_ARRIVAL_ID = 'arrival.mine.from-forest'
export const MINE_FOREST_RETURN_PORTAL_ZONE_ID = 'zone.mine.forest-return'
export const PEAK_FROM_MINE_ARRIVAL_ID = 'arrival.peak.from-mine'
export const MINE_FROM_PEAK_ARRIVAL_ID = 'arrival.mine.from-peak'
export const MINE_PEAK_PORTAL_ZONE_ID = 'zone.mine.peak-exit'
export const PEAK_RETURN_PORTAL_ZONE_ID = 'zone.peak.return-to-mine'
