import json
import os

import bpy


PROJECT_ROOT = r"E:\Portfolio Project"
MODEL_DIR = os.path.join(PROJECT_ROOT, "public", "models")
EXPORT_PATH = os.path.join(MODEL_DIR, "tent-painted-final.glb")
BLEND_COPY_PATH = os.path.join(MODEL_DIR, "tent-painted-final.blend")
TEXTURE_DIR = os.path.join(MODEL_DIR, "tent-painted-final")
TEXTURE_PATH = os.path.join(TEXTURE_DIR, "Tent_BaseColor_Painted.png")


scene = bpy.data.scenes.get("Tent_Painting")
obj = bpy.data.objects.get("Tent_Paint_Mesh")

if scene is None or obj is None:
    raise RuntimeError("The saved painting scene or mesh is missing")

bpy.context.window.scene = scene
os.makedirs(TEXTURE_DIR, exist_ok=True)

if not obj.data.materials:
    raise RuntimeError("The tent mesh has no material")

material = obj.data.materials[0]

# The user's Texture Paint edits are saved externally. Explicitly reconnect that
# file before export so Blender cannot fall back to the older packed image.
if not os.path.exists(TEXTURE_PATH):
    raise RuntimeError(f"Painted texture does not exist: {TEXTURE_PATH}")
painted_image = bpy.data.images.load(TEXTURE_PATH, check_existing=False)
painted_image.name = "Tent_BaseColor_Painted"
painted_image.colorspace_settings.name = "sRGB"
base_color_node = material.node_tree.nodes.get("PAINT_ME_BaseColor")
if base_color_node is None or base_color_node.type != "TEX_IMAGE":
    raise RuntimeError("PAINT_ME_BaseColor image node is missing")
base_color_node.image = painted_image

material.name = "Tent_Reference_Baked"
obj.name = "Tent_Reference_15k"
obj.data.name = "Tent_Reference_15k_Mesh"

if bpy.context.object and bpy.context.object.mode != "OBJECT":
    bpy.ops.object.mode_set(mode="OBJECT")
bpy.ops.object.select_all(action="DESELECT")
obj.select_set(True)
bpy.context.view_layer.objects.active = obj

bpy.ops.export_scene.gltf(
    filepath=EXPORT_PATH,
    export_format="GLB",
    use_selection=True,
    export_texcoords=True,
    export_normals=True,
    export_materials="EXPORT",
    export_cameras=False,
    export_lights=False,
    export_animations=False,
    export_yup=True,
    export_apply=False,
)

# Keep a dedicated Blender copy matching the exported asset.
bpy.ops.wm.save_as_mainfile(filepath=BLEND_COPY_PATH, copy=True, compress=True)

triangle_count = sum(len(poly.vertices) - 2 for poly in obj.data.polygons)
print(
    "PAINTED_TENT_EXPORT="
    + json.dumps(
        {
            "glb": EXPORT_PATH,
            "blend": BLEND_COPY_PATH,
            "texture": TEXTURE_PATH,
            "triangles": triangle_count,
            "vertices": len(obj.data.vertices),
            "dimensions": list(obj.dimensions),
            "location": list(obj.location),
            "rotation": list(obj.rotation_euler),
            "scale": list(obj.scale),
            "material": material.name,
        }
    )
)
