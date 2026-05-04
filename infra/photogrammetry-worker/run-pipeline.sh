#!/bin/bash
# Photogrammetry pipeline runner — COLMAP CPU-only.
#
# Args:
#   $1 = INPUT_VIDEO   — local path to the video file (mp4/mov/webm)
#   $2 = OUTPUT_GLB    — local path where the resulting .glb will be written
#
# Exit code is 0 on success, non-zero on any pipeline failure (set -e).
# Stage logs are emitted to stdout so Cloud Run captures them.
#
# Pipeline rationale:
#   - 1 fps frame extraction is enough for a static scene captured slowly.
#     For dynamic scenes the orchestrator should re-run with --fps 2.
#   - SIFT GPU is disabled (use_gpu 0) because the base image has no CUDA
#     runtime. patch_match_stereo with --PatchMatchStereo.gpu_index -1
#     forces CPU mode for the same reason.
#   - Poisson reconstruction (Open3D) gives a watertight mesh from the
#     fused point cloud. Depth=9 is a good trade-off; Depth>=11 produces
#     bigger files without much quality gain at this point density.
set -euo pipefail

INPUT_VIDEO=${1:?usage: run-pipeline.sh <input_video> <output_glb>}
OUTPUT_GLB=${2:?usage: run-pipeline.sh <input_video> <output_glb>}

WORK_DIR=$(mktemp -d -t colmap-XXXXXX)
FRAMES_DIR="$WORK_DIR/frames"
mkdir -p "$FRAMES_DIR"

cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

echo "[pipeline] WORK_DIR=$WORK_DIR"
echo "[pipeline] stage 1/9 — ffmpeg frame extraction (1 fps, 1280px)"
ffmpeg -hide_banner -loglevel warning -y \
  -i "$INPUT_VIDEO" \
  -vf "fps=1,scale=1280:-2" \
  "$FRAMES_DIR/frame_%04d.jpg"

FRAME_COUNT=$(ls "$FRAMES_DIR" | wc -l)
echo "[pipeline] extracted $FRAME_COUNT frames"
if [ "$FRAME_COUNT" -lt 5 ]; then
  echo "[pipeline] ERROR: need >= 5 frames for reconstruction, got $FRAME_COUNT" >&2
  exit 2
fi

echo "[pipeline] stage 2/9 — colmap feature_extractor (SIFT CPU)"
colmap feature_extractor \
  --database_path "$WORK_DIR/database.db" \
  --image_path "$FRAMES_DIR" \
  --SiftExtraction.use_gpu 0

echo "[pipeline] stage 3/9 — colmap exhaustive_matcher (CPU)"
colmap exhaustive_matcher \
  --database_path "$WORK_DIR/database.db" \
  --SiftMatching.use_gpu 0

echo "[pipeline] stage 4/9 — colmap mapper (sparse reconstruction)"
mkdir -p "$WORK_DIR/sparse"
colmap mapper \
  --database_path "$WORK_DIR/database.db" \
  --image_path "$FRAMES_DIR" \
  --output_path "$WORK_DIR/sparse"

# mapper writes 0/, 1/, ... — pick the first model.
if [ ! -d "$WORK_DIR/sparse/0" ]; then
  echo "[pipeline] ERROR: sparse reconstruction produced no model" >&2
  exit 3
fi

echo "[pipeline] stage 5/9 — colmap image_undistorter"
mkdir -p "$WORK_DIR/dense"
colmap image_undistorter \
  --image_path "$FRAMES_DIR" \
  --input_path "$WORK_DIR/sparse/0" \
  --output_path "$WORK_DIR/dense" \
  --output_type COLMAP

echo "[pipeline] stage 6/9 — colmap patch_match_stereo (CPU, slow)"
colmap patch_match_stereo \
  --workspace_path "$WORK_DIR/dense" \
  --PatchMatchStereo.gpu_index -1

echo "[pipeline] stage 7/9 — colmap stereo_fusion -> fused.ply"
colmap stereo_fusion \
  --workspace_path "$WORK_DIR/dense" \
  --output_path "$WORK_DIR/dense/fused.ply"

echo "[pipeline] stage 8/9 — Poisson meshing (Open3D)"
python3 /app/poisson-mesh.py "$WORK_DIR/dense/fused.ply" "$WORK_DIR/mesh.ply"

echo "[pipeline] stage 9/9 — PLY -> GLB"
python3 /app/ply-to-glb.py "$WORK_DIR/mesh.ply" "$OUTPUT_GLB"

echo "[pipeline] OK -> $OUTPUT_GLB"
