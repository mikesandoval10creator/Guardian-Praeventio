"""GLB -> USDZ conversion using Pixar OpenUSD.

Sprint 23 Bucket EE.3.

Apple AR Quick Look on iOS only accepts `.usdz` (Apple's binary USD package
format). Our 17 AR markers are authored as `.glb` (glTF binary) via
`scripts/generate-ar-models.mjs`; this script bridges the two.

Pipeline:
    1. Use OpenUSD's `usdGltf` plugin (built into v24.05+) to read the
       glTF asset directly into a USD stage. The plugin handles meshes,
       PBR materials, transforms, hierarchy and primitive types we use
       in the placeholder cylinders.
    2. Save the stage as a `.usda` (ASCII) sidecar so the package step
       has a deterministic anchor.
    3. Pack the stage + textures into a single `.usdz` via
       `UsdUtils.CreateNewARKitUsdzPackage` — this is the function Apple
       documents as the canonical ARKit-compliant packager (it enforces
       the 64-byte alignment, asset-relative paths, and texture format
       constraints ARKit Quick Look requires).

Invoked from the Flask wrapper (`server.py`) as:

    python3 /app/glb_to_usdz.py <input.glb> <output.usdz>

Exit code 0 on success, non-zero with stderr message on failure.
"""

import os
import sys
import tempfile
from pathlib import Path

from pxr import Usd, UsdUtils  # type: ignore[import-not-found]


def glb_to_usdz(input_glb: str, output_usdz: str) -> None:
    """Convert a glTF .glb file to ARKit-compliant .usdz.

    Raises RuntimeError on any USD-side failure so the wrapper can
    surface a 502 to the API caller.
    """
    if not os.path.isfile(input_glb):
        raise RuntimeError(f"input not found: {input_glb}")

    if not output_usdz.endswith(".usdz"):
        raise RuntimeError("output path must end with .usdz")

    # Step 1: open the glTF directly. OpenUSD's UsdGltf file format plugin
    # registers `.glb` and `.gltf` extensions and produces a transient
    # USD stage on read. Stage::Open does NOT load textures eagerly; the
    # packager step below pulls them in.
    stage = Usd.Stage.Open(input_glb)
    if stage is None:
        raise RuntimeError(f"OpenUSD could not open {input_glb}")

    # Step 2: flatten the stage to a temp .usdc (binary crate) sitting next
    # to the .glb, so the packager has every reference resolvable. Using
    # .usdc instead of .usda keeps the step fast for the 17-asset batch.
    with tempfile.TemporaryDirectory(prefix="usdzconv-") as tmp:
        flat_path = os.path.join(tmp, Path(input_glb).stem + ".usdc")
        # Export takes a flattened snapshot — embedded textures from the
        # glb stay intact because the file format plugin keeps them as
        # in-memory assets at this point.
        stage.Export(flat_path)

        # Step 3: pack to ARKit USDZ. CreateNewARKitUsdzPackage is the
        # canonical Apple-blessed entrypoint; it:
        #   - aligns asset offsets to 64 bytes (ARKit requirement)
        #   - converts non-supported texture formats to JPG/PNG
        #   - rewrites references to package-local paths
        # Returns True on success.
        ok = UsdUtils.CreateNewARKitUsdzPackage(flat_path, output_usdz)
        if not ok:
            raise RuntimeError(
                f"CreateNewARKitUsdzPackage failed for {input_glb}"
            )


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: glb_to_usdz.py <input.glb> <output.usdz>", file=sys.stderr)
        return 2
    try:
        glb_to_usdz(sys.argv[1], sys.argv[2])
    except RuntimeError as e:
        print(f"glb_to_usdz_error: {e}", file=sys.stderr)
        return 1
    except Exception as e:  # pragma: no cover - defensive last-resort
        print(f"glb_to_usdz_unexpected: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
