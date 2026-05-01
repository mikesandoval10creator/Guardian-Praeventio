#!/usr/bin/env python3
"""
Convierte nube de puntos .ply (COLMAP output) a .glb limpio para Three.js.
Usa bpy (Blender Python) — sin GPU, sin interfaz gráfica.

Uso: python3 ply_to_glb.py --input faena.ply --output faena.glb [--decimate 0.1]
"""
import argparse, sys, os

def convert(input_ply: str, output_glb: str, decimate_ratio: float = 0.15) -> int:
    import bpy

    # Limpiar escena
    bpy.ops.wm.read_factory_settings(use_empty=True)

    # Importar PLY
    bpy.ops.wm.ply_import(filepath=input_ply)
    obj = bpy.context.selected_objects[0] if bpy.context.selected_objects else None
    if not obj:
        raise RuntimeError("No object imported from PLY")

    bpy.context.view_layer.objects.active = obj
    original_verts = len(obj.data.vertices)
    print(f"Importado: {original_verts:,} vértices", flush=True)

    # Decimate para reducir tamaño (mantener forma)
    if decimate_ratio < 1.0:
        mod = obj.modifiers.new(name="Decimate", type='DECIMATE')
        mod.ratio = decimate_ratio
        bpy.ops.object.modifier_apply(modifier="Decimate")
        final_verts = len(obj.data.vertices)
        print(f"Después de decimate ({decimate_ratio:.0%}): {final_verts:,} vértices", flush=True)

    # Centrar y escalar a unidades de metro
    bpy.ops.object.origin_set(type='ORIGIN_GEOMETRY', center='BOUNDS')
    obj.location = (0, 0, 0)

    # Exportar GLB (Three.js compatible)
    bpy.ops.export_scene.gltf(
        filepath=output_glb,
        export_format='GLB',
        export_apply=True,
        export_colors=True,
        export_normals=False,
    )
    size_kb = os.path.getsize(output_glb) // 1024
    print(f"Exportado: {output_glb} ({size_kb} KB)", flush=True)
    return size_kb

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="PLY → GLB via Blender Python")
    parser.add_argument("--input", required=True, help="Input .ply file")
    parser.add_argument("--output", required=True, help="Output .glb file")
    parser.add_argument("--decimate", type=float, default=0.15,
                        help="Decimate ratio 0–1 (default 0.15 = keep 15%% of vertices)")
    args = parser.parse_args()
    convert(args.input, args.output, args.decimate)
