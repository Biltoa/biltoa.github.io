"""Repair Meshy tent material seams without changing its geometry.

Run with Blender 4.4+ in background mode. The input is never overwritten.
"""

import os
import sys

import bpy


def args_after_separator():
    return sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []


args = args_after_separator()
if len(args) != 3:
    raise SystemExit(
        "Usage: blender -b --python repair-meshy-tent-seams.py -- "
        "<input.glb> <output.glb> <working.blend>"
    )

input_path, output_path, blend_path = map(os.path.abspath, args)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=input_path)

meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
if len(meshes) != 1:
    raise RuntimeError(f"Expected one imported mesh, found {len(meshes)}")

tent = meshes[0]
tent.name = "Tent_Meshy_Optimized"
mesh = tent.data

canvas_index = next(
    index for index, material in enumerate(mesh.materials) if "Tent_Canvas" in material.name
)
detail_index = next(
    index
    for index, material in enumerate(mesh.materials)
    if "Tent_Baked_Details" in material.name
)
mesh.materials[canvas_index].name = "Tent_Canvas"
mesh.materials[detail_index].name = "Tent_Baked_Details"

# The front A-frame is nearly planar. Meshy's decimator fragmented both sides
# of the wood/canvas boundary, causing alternating material triangles along the
# diagonal poles. Rebuild that ownership from the clean inner beam line.
changed_to_canvas = 0
changed_to_detail = 0
for polygon in mesh.polygons:
    center = polygon.center
    absolute_x = abs(center.x)
    inner_beam_x = 0.207 - 0.70 * center.z
    on_front = center.y < -0.22
    in_front_triangle = on_front and -0.39 < center.z < 0.33
    if not in_front_triangle:
        continue

    in_beam = inner_beam_x - 0.004 <= absolute_x <= inner_beam_x + 0.070

    # Only return clearly misplaced canvas faces to the wood/detail primitive.
    # The original strap and every detail face stay exactly as authored. Their
    # cross-boundary pixels are resolved continuously in the Three.js shader,
    # avoiding any triangle-level change to the visible strap silhouette.
    desired = detail_index if in_beam and polygon.material_index == canvas_index else None
    if desired is not None and polygon.material_index != desired:
        if desired == canvas_index:
            changed_to_canvas += 1
        else:
            changed_to_detail += 1
        polygon.material_index = desired

# Keep a dedicated, reproducible Blender source without touching the user's
# currently open file; this script runs in its own background Blender process.
os.makedirs(os.path.dirname(blend_path), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=blend_path)

bpy.ops.object.select_all(action="DESELECT")
tent.select_set(True)
bpy.context.view_layer.objects.active = tent

os.makedirs(os.path.dirname(output_path), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=output_path,
    export_format="GLB",
    use_selection=True,
    export_materials="EXPORT",
    export_image_format="AUTO",
    export_yup=True,
    export_cameras=False,
    export_lights=False,
)

print(
    {
        "output": output_path,
        "working_blend": blend_path,
        "changed_to_canvas": changed_to_canvas,
        "changed_to_detail": changed_to_detail,
        "triangles": len(mesh.loop_triangles),
        "geometry_added": False,
        "original_straps_preserved": True,
    }
)
