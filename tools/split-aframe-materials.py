"""Split Meshy's single-material A-frame into cloth and wood primitives.

Run with Blender 4.4:
  blender -b --python tools/split-aframe-materials.py -- INPUT.glb OUTPUT.glb

Meshy bakes both materials into one atlas.  The canvas is neutral gray and the
frame is saturated orange, so sampling several points inside every triangle is
enough to classify the *face* while ignoring the stray orange bake fragments
that appeared as cuts and dots on otherwise gray cloth islands.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy


def args() -> tuple[Path, Path]:
    raw = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(raw) != 2:
        raise SystemExit("Expected INPUT.glb OUTPUT.glb after --")
    return Path(raw[0]).resolve(), Path(raw[1]).resolve()


def base_color_image(material: bpy.types.Material) -> bpy.types.Image:
    if not material.use_nodes or not material.node_tree:
        raise RuntimeError("The source material has no node tree")
    for node in material.node_tree.nodes:
        if node.type == "TEX_IMAGE" and node.image and "base" in node.image.name.lower():
            return node.image
    for node in material.node_tree.nodes:
        if node.type == "TEX_IMAGE" and node.image:
            return node.image
    raise RuntimeError("No base-colour image found")


def add_canvas_seam_patches(cloth_mat: bpy.types.Material) -> bpy.types.Object:
    """Underlap the jagged generated canvas edge without hiding the A-frame.

    Meshy's front canvas stops short of the inner edge of both diagonal poles.
    At runtime that exposes a row of little pole-coloured notches near the apex
    and a longer open seam down the left side.  These two narrow triangles sit
    just in front of that broken boundary.  Their outside edge starts inside the
    visible pole, so the wooden structure and overall tent silhouette remain.

    Blender imports glTF Y-up as Z-up: x is horizontal, y is depth (negative is
    the entrance/front), and z is height.
    """
    # Between the authored front canvas (~-0.37) and pole surface (~-0.40):
    # existing wood stays in front, while the repair shows only through gaps.
    seam_depth = -0.385
    base = -0.40039
    seam_top = 0.310
    vertices = [
        (-0.430, seam_depth, base),
        (-0.340, seam_depth, base),
        (0.000, seam_depth, seam_top),
        (0.000, seam_depth, seam_top),
        (0.340, seam_depth, base),
        (0.430, seam_depth, base),
    ]
    faces = [(0, 1, 2), (3, 4, 5)]

    mesh = bpy.data.meshes.new("AFrame_CanvasSeamRepair")
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(cloth_mat)

    # The runtime cloth is triplanar and does not read these UVs, but keeping a
    # complete UV layer makes the repaired GLB valid in ordinary viewers too.
    uv = mesh.uv_layers.new(name="UVMap")
    triangle_uvs = (
        ((0.0, 0.0), (1.0, 0.0), (0.5, 1.0)),
        ((0.5, 1.0), (0.0, 0.0), (1.0, 0.0)),
    )
    for polygon, values in zip(mesh.polygons, triangle_uvs):
        for loop_index, value in zip(polygon.loop_indices, values):
            uv.data[loop_index].uv = value

    patch = bpy.data.objects.new("AFrame_CanvasSeamRepair", mesh)
    bpy.context.collection.objects.link(patch)
    patch.select_set(True)
    return patch


# Four long, skinny inner-pole faces visibly intrude into the canvas boundary.
# They are identified geometrically rather than by polygon index so the repair
# survives Blender/glTF re-indexing. Coordinates are Blender-space, rounded to
# the source mesh's millimetre-scale precision.
FORCE_CLOTH_SIGNATURES = {
    tuple(sorted(((-0.071, -0.400, 0.369), (0.488, -0.404, -0.391), (-0.067, -0.402, 0.375)))),
    tuple(sorted(((-0.062, -0.400, 0.381), (-0.067, -0.402, 0.375), (0.496, -0.406, -0.389)))),
    tuple(sorted(((-0.482, -0.402, -0.393), (-0.482, -0.395, -0.396), (0.075, -0.391, 0.367)))),
    tuple(sorted(((0.075, -0.387, 0.367), (0.075, -0.391, 0.367), (-0.482, -0.395, -0.396)))),
}


def face_signature(mesh: bpy.types.Mesh, polygon: bpy.types.MeshPolygon):
    return tuple(
        sorted(tuple(round(value, 3) for value in mesh.vertices[index].co) for index in polygon.vertices)
    )


def main() -> None:
    source, output = args()
    if not source.is_file():
        raise FileNotFoundError(source)
    output.parent.mkdir(parents=True, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(source))
    objects = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if len(objects) != 1:
        raise RuntimeError(f"Expected one mesh object, found {len(objects)}")

    obj = objects[0]
    mesh = obj.data
    if not mesh.materials or not mesh.uv_layers.active:
        raise RuntimeError("Source mesh needs one material and an active UV map")

    source_mat = mesh.materials[0]
    image = base_color_image(source_mat)
    width, height = image.size
    channels = image.channels
    pixels = list(image.pixels)

    cloth_mat = source_mat.copy()
    cloth_mat.name = "AFrame_Cloth"
    wood_mat = source_mat.copy()
    wood_mat.name = "AFrame_Wood"
    mesh.materials.clear()
    mesh.materials.append(cloth_mat)
    mesh.materials.append(wood_mat)

    uv_data = mesh.uv_layers.active.data
    # Interior barycentric probes avoid atlas padding at triangle edges.  A
    # median vote ignores isolated bad pixels without blurring real wood faces.
    weights = (
        (1 / 3, 1 / 3, 1 / 3),
        (0.60, 0.20, 0.20),
        (0.20, 0.60, 0.20),
        (0.20, 0.20, 0.60),
        (0.45, 0.45, 0.10),
        (0.45, 0.10, 0.45),
        (0.10, 0.45, 0.45),
    )

    def sample(u: float, v: float) -> tuple[float, float, float]:
        x = min(width - 1, max(0, int((u % 1.0) * width)))
        y = min(height - 1, max(0, int((v % 1.0) * height)))
        i = (y * width + x) * channels
        return pixels[i], pixels[i + 1], pixels[i + 2]

    cloth_faces = 0
    wood_faces = 0
    forced_cloth_faces = 0
    for polygon in mesh.polygons:
        if len(polygon.loop_indices) != 3:
            raise RuntimeError("Expected the imported glTF mesh to be triangulated")
        uvs = [uv_data[i].uv.copy() for i in polygon.loop_indices]
        votes = 0
        for a, b, c in weights:
            rgb = sample(
                uvs[0].x * a + uvs[1].x * b + uvs[2].x * c,
                uvs[0].y * a + uvs[1].y * b + uvs[2].y * c,
            )
            hi = max(rgb)
            lo = min(rgb)
            sat = (hi - lo) / max(hi, 1e-5)
            orange = rgb[0] > rgb[1] * 1.08 and rgb[0] > rgb[2] * 1.24
            votes += int(sat > 0.18 and orange)
        is_wood = votes >= math.ceil(len(weights) / 2)
        if is_wood and face_signature(mesh, polygon) in FORCE_CLOTH_SIGNATURES:
            is_wood = False
            forced_cloth_faces += 1
        polygon.material_index = 1 if is_wood else 0
        if is_wood:
            wood_faces += 1
        else:
            cloth_faces += 1

    add_canvas_seam_patches(cloth_mat)

    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=str(output),
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=False,
    )
    print(
        f"AFrame split: cloth={cloth_faces} faces, wood={wood_faces} faces, "
        f"forced-cloth={forced_cloth_faces} -> {output}"
    )


if __name__ == "__main__":
    main()
