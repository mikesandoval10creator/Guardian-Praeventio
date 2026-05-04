"""Convert a PLY mesh into a binary GLB suitable for Three.js / R3F.

Uses trimesh for the heavy lifting (loads PLY -> Trimesh, exports as GLB
with embedded geometry). Vertex colors are preserved when present.

Usage:
    python3 ply-to-glb.py <input.ply> <output.glb>

Why GLB and not GLTF:
    - Single binary file (easier signed-URL transfer).
    - Works out of the box with @react-three/drei <useGLTF /> and
      Three.js GLTFLoader without extra .bin/.gltf coordination.
"""

from __future__ import annotations

import sys

import trimesh


def main(input_path: str, output_path: str) -> None:
    print(f"[ply->glb] loading {input_path}", flush=True)
    mesh = trimesh.load(input_path, force="mesh")

    if mesh.is_empty:
        raise SystemExit(f"ply-to-glb: empty mesh at {input_path}")

    # trimesh exports GLB when the extension is .glb. Wrap in a Scene
    # so vertex colors / textures attach correctly.
    scene = trimesh.Scene(mesh)
    print(
        f"[ply->glb] writing {output_path} (V={len(mesh.vertices)}, F={len(mesh.faces)})",
        flush=True,
    )
    scene.export(output_path)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: ply-to-glb.py <input.ply> <output.glb>")
    main(sys.argv[1], sys.argv[2])
