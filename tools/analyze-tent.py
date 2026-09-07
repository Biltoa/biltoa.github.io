"""Print loose-island bounds for the source tent FBX.

Run with Blender in background mode. This is a diagnostic companion to
``export-campsite.py``; it never writes the source asset.
"""

import bpy
import os
from mathutils import Vector


SOURCE = (
    r"E:\Unity Workspaces\Gameplay Portfolio\Assets\Polyart\PolyartStudio"
    r"\DreamscapeCampsite\Meshes\Structures\SM_Tent_01_Unity.fbx"
)


def world_bounds(obj):
    corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    mins = Vector((min(v.x for v in corners), min(v.y for v in corners), min(v.z for v in corners)))
    maxs = Vector((max(v.x for v in corners), max(v.y for v in corners), max(v.z for v in corners)))
    return mins, maxs, maxs - mins, (mins + maxs) * 0.5


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=SOURCE)

lods = [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and "LOD1" in obj.name]
if not lods:
    raise RuntimeError("No LOD1 mesh found")

for source in lods:
    bpy.ops.object.select_all(action="DESELECT")
    source.select_set(True)
    bpy.context.view_layer.objects.active = source
    bpy.ops.object.duplicate()
    probe = bpy.context.active_object
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.separate(type="LOOSE")
    bpy.ops.object.mode_set(mode="OBJECT")

    pieces = [obj for obj in bpy.context.selected_objects if obj.type == "MESH"]
    rows = []
    for index, obj in enumerate(pieces):
        mins, maxs, dims, center = world_bounds(obj)
        rows.append(
            (
                max(dims),
                index,
                len(obj.data.vertices),
                len(obj.data.polygons),
                tuple(round(v, 4) for v in dims),
                tuple(round(v, 4) for v in center),
                tuple(round(v, 4) for v in mins),
                tuple(round(v, 4) for v in maxs),
            )
        )

    print(f"SOURCE {source.name}: {len(rows)} loose islands")
    for row in sorted(rows, reverse=True):
        print(
            "ISLAND",
            f"index={row[1]:03d}",
            f"verts={row[2]:4d}",
            f"faces={row[3]:4d}",
            f"dims={row[4]}",
            f"center={row[5]}",
            f"min={row[6]}",
            f"max={row[7]}",
        )
