"""Summarize vertex-connected components near the Meshy tent straps."""

import os
import sys
from collections import defaultdict, deque

import bpy


input_path = os.path.abspath(sys.argv[sys.argv.index("--") + 1])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=input_path)
obj = next(obj for obj in bpy.context.scene.objects if obj.type == "MESH")
mesh = obj.data

vertex_faces = defaultdict(list)
for face in mesh.polygons:
    for vertex in face.vertices:
        vertex_faces[vertex].append(face.index)

unseen = set(range(len(mesh.polygons)))
components = []
while unseen:
    seed = unseen.pop()
    queue = deque([seed])
    faces = [seed]
    while queue:
        face_index = queue.popleft()
        for vertex in mesh.polygons[face_index].vertices:
            for neighbour in vertex_faces[vertex]:
                if neighbour in unseen:
                    unseen.remove(neighbour)
                    queue.append(neighbour)
                    faces.append(neighbour)
    coordinates = [mesh.vertices[v].co for f in faces for v in mesh.polygons[f].vertices]
    mins = [min(co[axis] for co in coordinates) for axis in range(3)]
    maxs = [max(co[axis] for co in coordinates) for axis in range(3)]
    materials = defaultdict(int)
    for face_index in faces:
        materials[mesh.polygons[face_index].material_index] += 1
    components.append((len(faces), mins, maxs, dict(materials), min(faces), max(faces)))

components.sort(reverse=True)
for index, (count, mins, maxs, materials, first, last) in enumerate(components):
    near_straps = (
        mins[2] < -0.055 and maxs[2] > -0.15
        and (mins[0] < -0.1 or maxs[0] > 0.1)
        and mins[1] < -0.22
    )
    if near_straps or count > 100:
        print({
            "component": index,
            "faces": count,
            "min": [round(value, 5) for value in mins],
            "max": [round(value, 5) for value in maxs],
            "materials": materials,
            "face_range": [first, last],
        })
print({"components": len(components), "faces": len(mesh.polygons)})
