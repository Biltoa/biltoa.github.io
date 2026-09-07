"""Convert the three Unity-authored bench layouts to one web-ready GLB.

The source OBJs are exported from the live Props scene with every mesh baked
into its Bench N parent space. Book3 placeholders are deliberately absent.
"""

import os

import bpy
from mathutils import Vector


ROOT = r"E:\Portfolio Project"
SOURCE = os.path.join(ROOT, "tools", "build", "bench-layouts")
OUTPUT = os.path.join(ROOT, "public", "models", "bench-setups.glb")
UNITY = r"E:\Unity Workspaces\Gameplay Portfolio\Assets"
SURVIVAL_TEXTURES = os.path.join(UNITY, "Supercyan", "Textures", "Survival")
CAMPSITE_TEXTURES = os.path.join(
    UNITY,
    "Polyart",
    "PolyartStudio",
    "DreamscapeCampsite",
    "Textures",
    "Props",
)

# Midpoint of the two Book3 placeholder origins in each Bench N parent.
# Moving this to the GLB origin lets the real generated book and the exported
# layout share one exact anchor in the Three scene.
BOOK_CENTER_UNITY = Vector((-0.1884079, 0.008629978, 0.171463012836))


def set_base_texture(material, path):
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    bsdf = next((node for node in nodes if node.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        return

    image = bpy.data.images.load(path, check_existing=True)
    texture = next((node for node in nodes if node.type == "TEX_IMAGE"), None)
    if texture is None:
        texture = nodes.new("ShaderNodeTexImage")
    texture.image = image
    links.new(texture.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.82


def repair_materials():
    overrides = {
        "M_Bench_01": os.path.join(CAMPSITE_TEXTURES, "T_Bench_01_C.png"),
        "M_WoodPlank": os.path.join(CAMPSITE_TEXTURES, "T_WoodPlank_C.png"),
    }

    for material in bpy.data.materials:
        # Blender suffixes duplicate OBJ materials with .001/.002. Match the
        # authored base name so Bench 2 and Bench 3 receive the same texture as
        # Bench 1 instead of exporting their fallback white material.
        override = next(
            (
                texture
                for name, texture in overrides.items()
                if material.name == name or material.name.startswith(f"{name}.")
            ),
            None,
        )
        if override:
            set_base_texture(material, override)
            continue

        if material.name.startswith("itempack_survival_"):
            texture_node = next(
                (node for node in material.node_tree.nodes if node.type == "TEX_IMAGE" and node.image),
                None,
            ) if material.use_nodes else None
            if texture_node:
                png = os.path.join(
                    SURVIVAL_TEXTURES,
                    os.path.splitext(os.path.basename(texture_node.image.filepath))[0] + ".png",
                )
                if os.path.isfile(png):
                    set_base_texture(material, png)

        if material.use_nodes:
            bsdf = next(
                (node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED"),
                None,
            )
            if bsdf:
                bsdf.inputs["Roughness"].default_value = 0.78

        if material.name == "Candle_Holder_Glass" or material.name.startswith(
            "Candle_Holder_Glass."
        ):
            material.diffuse_color[3] = 0.16
            material.surface_render_method = "DITHERED"

    for image in bpy.data.images:
        if image.size[0] > 1024 or image.size[1] > 1024:
            scale = min(1024 / image.size[0], 1024 / image.size[1])
            image.scale(round(image.size[0] * scale), round(image.size[1] * scale))


def import_layout(index):
    before = set(bpy.data.objects)
    bpy.ops.wm.obj_import(
        filepath=os.path.join(SOURCE, f"Bench{index}.obj"),
        forward_axis="NEGATIVE_Z",
        up_axis="Y",
        use_split_objects=True,
        use_split_groups=True,
    )
    imported = [obj for obj in bpy.data.objects if obj not in before]

    root = bpy.data.objects.new(f"BenchSetup{index}", None)
    bpy.context.scene.collection.objects.link(root)

    # OBJ Y-up -> Blender Z-up conversion is (x, -z, y). Apply the same
    # conversion to the anchor offset so the final glTF is centred exactly on
    # the source book footprint.
    anchor_offset = Vector(
        (-BOOK_CENTER_UNITY.x, BOOK_CENTER_UNITY.z, -BOOK_CENTER_UNITY.y)
    )
    for obj in imported:
        obj.location += anchor_offset
        obj.parent = root


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for index in range(1, 4):
        import_layout(index)

    repair_materials()

    bpy.ops.export_scene.gltf(
        filepath=OUTPUT,
        export_format="GLB",
        export_apply=True,
        export_yup=True,
        export_materials="EXPORT",
        export_image_format="WEBP",
        export_image_quality=82,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
        export_texcoords=True,
        export_normals=True,
        export_cameras=False,
        export_lights=False,
    )
    print("exported", OUTPUT)


if __name__ == "__main__":
    main()
