"""Poisson surface reconstruction from a fused COLMAP point cloud.

Reads a PLY point cloud (output of `colmap stereo_fusion`), estimates
normals (required by Poisson), runs Poisson reconstruction at depth 9,
crops low-density triangles to remove balloon artifacts, and writes the
result as a PLY mesh.

Usage:
    python3 poisson-mesh.py <input.ply> <output.ply>

Choices:
    - depth=9 is a sweet spot for 30s-video reconstructions: enough
      detail without exploding mesh size. Bump to 10 for higher fidelity
      at ~3x file size.
    - density quantile 0.05: drop the bottom 5% of vertices ranked by
      Poisson density. Removes the "balloon" artifacts where the mesh
      extends past the actual point cloud.
"""

from __future__ import annotations

import sys

import numpy as np
import open3d as o3d


def main(input_path: str, output_path: str) -> None:
    print(f"[poisson] loading {input_path}", flush=True)
    pcd = o3d.io.read_point_cloud(input_path)
    if len(pcd.points) == 0:
        raise SystemExit(f"poisson-mesh: empty point cloud at {input_path}")

    print(f"[poisson] estimating normals (n={len(pcd.points)})", flush=True)
    pcd.estimate_normals(
        search_param=o3d.geometry.KDTreeSearchParamHybrid(radius=0.1, max_nn=30)
    )
    pcd.orient_normals_consistent_tangent_plane(k=20)

    print("[poisson] running Poisson reconstruction (depth=9)", flush=True)
    mesh, densities = o3d.geometry.TriangleMesh.create_from_point_cloud_poisson(
        pcd, depth=9, width=0, scale=1.1, linear_fit=False
    )

    densities_np = np.asarray(densities)
    threshold = np.quantile(densities_np, 0.05)
    keep = densities_np > threshold
    print(
        f"[poisson] cropping {(~keep).sum()} / {len(densities_np)} low-density verts",
        flush=True,
    )
    mesh.remove_vertices_by_mask(~keep)

    mesh.compute_vertex_normals()
    print(
        f"[poisson] writing {output_path} (V={len(mesh.vertices)}, F={len(mesh.triangles)})",
        flush=True,
    )
    o3d.io.write_triangle_mesh(output_path, mesh, write_ascii=False)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: poisson-mesh.py <input.ply> <output.ply>")
    main(sys.argv[1], sys.argv[2])
