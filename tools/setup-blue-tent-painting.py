import os

import bpy


PROJECT_ROOT = r"E:\Portfolio Project"
TEXTURE_PATH = os.path.join(
    PROJECT_ROOT,
    "public",
    "models",
    "tent-painting-blue",
    "Tent_BaseColor_BluePaint.png",
)
BLEND_PATH = os.path.join(PROJECT_ROOT, "public", "models", "tent-painting-blue.blend")

scene = bpy.data.scenes.get("Tent_Painting") or bpy.context.scene
obj = bpy.data.objects.get("Tent_Paint_Mesh") or bpy.data.objects.get("Tent_Reference_15k")
if obj is None or not obj.data.materials:
    raise RuntimeError("The dedicated tent painting mesh or material is missing")

material = obj.data.materials[0]
node = material.node_tree.nodes.get("PAINT_ME_BaseColor")
if node is None or node.type != "TEX_IMAGE":
    raise RuntimeError("PAINT_ME_BaseColor image node is missing")

image = bpy.data.images.load(TEXTURE_PATH, check_existing=False)
image.name = "Tent_BaseColor_BluePaint"
image.colorspace_settings.name = "sRGB"
image.filepath_raw = TEXTURE_PATH
node.image = image
node.select = True
material.node_tree.nodes.active = node

obj.name = "Tent_Blue_Paint_Mesh"
obj.data.name = "Tent_Blue_Paint_MeshData"
bpy.context.window.scene = scene
if bpy.context.object and bpy.context.object.mode != "OBJECT":
    bpy.ops.object.mode_set(mode="OBJECT")
bpy.ops.object.select_all(action="DESELECT")
obj.select_set(True)
bpy.context.view_layer.objects.active = obj

# Put both the UV editor and 3D viewport on the new blue target image.
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type == "IMAGE_EDITOR":
            area.spaces.active.image = image
        elif area.type == "VIEW_3D":
            area.spaces.active.shading.type = "MATERIAL"

workspace = bpy.data.workspaces.get("Texture Paint")
if workspace is not None:
    bpy.context.window.workspace = workspace

bpy.ops.object.mode_set(mode="TEXTURE_PAINT")
bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH, compress=True)
print(f"BLUE_PAINT_BLEND={BLEND_PATH}")
print(f"BLUE_PAINT_IMAGE={TEXTURE_PATH}")
