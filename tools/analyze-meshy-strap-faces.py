"""Print compact diagnostics for faces around the original Meshy tent straps."""

import os
import sys

import bpy


input_path = os.path.abspath(sys.argv[sys.argv.index("--") + 1])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=input_path)
obj = next(obj for obj in bpy.context.scene.objects if obj.type == "MESH")
mesh = obj.data

rows = []
for polygon in mesh.polygons:
    center = polygon.center
    absolute_x = abs(center.x)
    inner_beam_x = 0.207 - 0.70 * center.z
    if not (
        center.y < -0.22
        and -0.17 < center.z < -0.035
        and 0.08 < absolute_x < inner_beam_x + 0.09
    ):
        continue
    coordinates = [mesh.vertices[index].co for index in polygon.vertices]
    rows.append(
        (
            polygon.index,
            polygon.material_index,
            center.x,
            center.y,
            center.z,
            polygon.normal.x,
            polygon.normal.y,
            polygon.normal.z,
            min(co.x for co in coordinates),
            max(co.x for co in coordinates),
            min(co.y for co in coordinates),
            max(co.y for co in coordinates),
            min(co.z for co in coordinates),
            max(co.z for co in coordinates),
            polygon.area,
        )
    )

print("index mat cx cy cz nx ny nz minx maxx miny maxy minz maxz area")
for row in sorted(rows, key=lambda row: (row[4], abs(row[2]))):
    print(" ".join(f"{value:.5f}" if isinstance(value, float) else str(value) for value in row))
print({"faces": len(rows), "materials": [material.name for material in mesh.materials]})
