import { BufferGeometry, Material, Mesh, type Object3D } from 'three'

function disposeMaterial(material: Material | Material[]): void {
    if (Array.isArray(material)) {
        for (const m of material) m.dispose()
    } else {
        material.dispose()
    }
}

/** Dispose geometry/material resources owned by an Object3D tree. */
export function disposeObject3D(root: Object3D): void {
    root.traverse((obj) => {
        if (obj instanceof Mesh) {
            if (obj.geometry instanceof BufferGeometry) obj.geometry.dispose()
            disposeMaterial(obj.material)
        }
    })
}
