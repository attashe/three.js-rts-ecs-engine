import { BufferGeometry, Group, Matrix4, Mesh, Object3D, type Material } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export interface MergeGroupOptions {
    /** Keep the original tree if it has this object name anywhere below root. */
    preserveObjectNames?: readonly string[]
}

/**
 * Reduces a low-poly asset Group to one mesh per material. The entity remains a
 * normal Object3D for ECS/debug systems; only internal decorative part meshes
 * are merged. Avoid using this for models whose named child nodes are animated
 * or queried by gameplay systems.
 */
export function mergeGroupByMaterial<T extends Object3D>(root: T, opts: MergeGroupOptions = {}): T {
    if (!(root instanceof Group)) return root
    if (shouldPreserveTree(root, opts.preserveObjectNames ?? [])) return root

    root.updateMatrixWorld(true)
    const rootInverse = new Matrix4().copy(root.matrixWorld).invert()
    const byMaterial = new Map<Material, BufferGeometry[]>()

    root.traverse((object) => {
        if (!(object instanceof Mesh)) return
        if (Array.isArray(object.material)) return
        if (!(object.geometry instanceof BufferGeometry)) return

        object.updateMatrixWorld(true)
        const matrix = new Matrix4().multiplyMatrices(rootInverse, object.matrixWorld)
        const geometry = object.geometry.clone()
        geometry.applyMatrix4(matrix)
        const bucket = byMaterial.get(object.material)
        if (bucket) bucket.push(geometry)
        else byMaterial.set(object.material, [geometry])
    })

    if (byMaterial.size === 0) return root

    root.clear()
    let index = 0
    for (const [material, geometries] of byMaterial) {
        const merged = mergeGeometries(geometries, false)
        for (const geometry of geometries) geometry.dispose()
        if (!merged) continue

        const mesh = new Mesh(merged, material)
        mesh.name = `${root.name || 'MergedAsset'}Part${index++}`
        mesh.castShadow = true
        mesh.receiveShadow = true
        root.add(mesh)
    }
    return root
}

function shouldPreserveTree(root: Group, names: readonly string[]): boolean {
    if (names.length === 0) return false
    let preserve = false
    root.traverse((object) => {
        if (preserve) return
        if (names.includes(object.name)) preserve = true
    })
    return preserve
}
