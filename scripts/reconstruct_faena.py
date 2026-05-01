#!/usr/bin/env python3
"""
Reconstrucción 3D de faena a partir de video — Guardian Praeventio
Pipeline: ffmpeg (frames) → COLMAP SfM (sparse) → export .ply
100% CPU, sin GPU ni servicios de pago.

Uso:
  python3 reconstruct_faena.py --video_path /tmp/video.mp4 --output_dir /tmp/output --max_frames 150
"""

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
import time

# Progreso impreso para que server.ts pueda parsear "Frame X/Y"
def progress(current: int, total: int, label: str = ""):
    pct = int(current / total * 100)
    print(f"Frame {current}/{total}  [{pct}%] {label}", flush=True)


def extract_frames(video_path: str, frames_dir: str, max_frames: int) -> int:
    """Extrae hasta max_frames fotogramas del video con ffmpeg, selección uniforme."""
    os.makedirs(frames_dir, exist_ok=True)
    # Calcular fps objetivo para obtener aprox. max_frames fotogramas
    probe = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_streams", video_path],
        capture_output=True, text=True,
    )
    duration = 30.0  # fallback
    try:
        import json
        info = json.loads(probe.stdout)
        for s in info.get("streams", []):
            if s.get("codec_type") == "video":
                duration = float(s.get("duration", 30))
                break
    except Exception:
        pass

    fps_target = max(0.5, min(2.0, max_frames / duration))
    cmd = [
        "ffmpeg", "-i", video_path,
        "-vf", f"fps={fps_target:.3f}",
        "-q:v", "2",
        os.path.join(frames_dir, "frame_%06d.jpg"),
        "-y", "-loglevel", "error",
    ]
    subprocess.run(cmd, check=True)
    frames = sorted(f for f in os.listdir(frames_dir) if f.endswith(".jpg"))
    return len(frames)


def run_colmap_sfm(frames_dir: str, colmap_dir: str) -> str:
    """Ejecuta pipeline COLMAP sparse: feature extraction → matching → mapping."""
    db_path = os.path.join(colmap_dir, "database.db")
    sparse_dir = os.path.join(colmap_dir, "sparse")
    os.makedirs(sparse_dir, exist_ok=True)

    print("Frame 1/4  [25%] Extrayendo features SIFT...", flush=True)
    subprocess.run([
        "colmap", "feature_extractor",
        "--database_path", db_path,
        "--image_path", frames_dir,
        "--ImageReader.single_camera", "1",
        "--SiftExtraction.use_gpu", "0",
        "--SiftExtraction.max_num_features", "4096",
        "--SiftExtraction.first_octave", "-1",
    ], check=True, capture_output=True)

    print("Frame 2/4  [50%] Matching exhaustivo...", flush=True)
    subprocess.run([
        "colmap", "sequential_matcher",
        "--database_path", db_path,
        "--SiftMatching.use_gpu", "0",
        "--SequentialMatching.overlap", "10",
    ], check=True, capture_output=True)

    print("Frame 3/4  [75%] Reconstrucción sparse (Structure from Motion)...", flush=True)
    subprocess.run([
        "colmap", "mapper",
        "--database_path", db_path,
        "--image_path", frames_dir,
        "--output_path", sparse_dir,
        "--Mapper.num_threads", str(max(1, os.cpu_count() or 2)),
        "--Mapper.min_num_matches", "10",
    ], check=True, capture_output=True)

    # Encuentra el modelo reconstruido (subdirectorio 0, 1, ...)
    models = sorted(os.listdir(sparse_dir))
    if not models:
        raise RuntimeError("COLMAP no pudo reconstruir ningún modelo. Revisa que el video tenga suficiente textura y movimiento.")
    return os.path.join(sparse_dir, models[0])


def export_ply(model_dir: str, output_ply: str) -> int:
    """Convierte el modelo COLMAP a .ply con posiciones de cámaras + puntos 3D."""
    print("Frame 4/4  [90%] Exportando nube de puntos .ply...", flush=True)

    import numpy as np
    import pycolmap

    rec = pycolmap.Reconstruction(model_dir)
    points = rec.points3D

    if not points:
        raise RuntimeError("Reconstrucción vacía — no hay puntos 3D.")

    coords = []
    colors = []
    for pt in points.values():
        coords.append(pt.xyz)
        colors.append(pt.color)  # RGB uint8

    coords_arr = np.array(coords, dtype=np.float32)
    colors_arr = np.array(colors, dtype=np.uint8)

    # Escribir PLY ASCII (compatible con Three.js PLYLoader)
    n = len(coords_arr)
    with open(output_ply, "w") as f:
        f.write("ply\nformat ascii 1.0\n")
        f.write(f"element vertex {n}\n")
        f.write("property float x\nproperty float y\nproperty float z\n")
        f.write("property uchar red\nproperty uchar green\nproperty uchar blue\n")
        f.write("end_header\n")
        for i in range(n):
            x, y, z = coords_arr[i]
            r, g, b = colors_arr[i]
            f.write(f"{x:.6f} {y:.6f} {z:.6f} {int(r)} {int(g)} {int(b)}\n")

    return n


def main():
    parser = argparse.ArgumentParser(description="Reconstrucción 3D faena — COLMAP CPU")
    parser.add_argument("--video_path", required=True)
    parser.add_argument("--output_dir", required=True)
    parser.add_argument("--max_frames", type=int, default=120,
                        help="Máximo de fotogramas a extraer (más = mejor calidad, más tiempo)")
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    colmap_dir = os.path.join(args.output_dir, "colmap_workspace")
    frames_dir = os.path.join(colmap_dir, "frames")
    output_ply = os.path.join(args.output_dir, "faena.ply")

    t0 = time.time()
    print(f"Frame 0/4  [0%] Iniciando reconstrucción 3D (CPU, sin GPU)...", flush=True)

    n_frames = extract_frames(args.video_path, frames_dir, args.max_frames)
    print(f"  → {n_frames} fotogramas extraídos", flush=True)
    if n_frames < 10:
        print("ERROR: Video demasiado corto o pocos fotogramas extraídos. Se necesitan ≥10.", flush=True)
        sys.exit(1)

    model_dir = run_colmap_sfm(frames_dir, colmap_dir)
    point_count = export_ply(model_dir, output_ply)

    elapsed = int(time.time() - t0)
    print(f"Frame 4/4  [100%] Completado en {elapsed}s — {point_count:,} puntos 3D → {output_ply}", flush=True)


if __name__ == "__main__":
    main()
