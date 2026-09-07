import os

import bpy


IMAGE_PATH = r"E:\Portfolio Project\public\models\tent-painting-blue\Tent_BaseColor_BluePaint.png"
BLEND_PATH = r"E:\Portfolio Project\public\models\tent-painting-blue.blend"
EXPORT_PATH = r"E:\Portfolio Project\public\models\tent-painted-blue-final.glb"

image = bpy.data.images.get("Tent_BaseColor_BluePaint")
obj = bpy.data.objects.get("Tent_Blue_Paint_Mesh")
if image is None or obj is None or not obj.data.materials:
    raise RuntimeError("The live blue painting image, mesh, or material is missing")

# Save the live Texture Paint pixels before touching export state.
image.filepath_raw = IMAGE_PATH
image.file_format = "PNG"
image.save()
bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)

material = obj.data.materials[0]
old_object_name = obj.name
old_mesh_name = obj.data.name
old_material_name = material.name
old_mode = obj.mode

if old_mode != "OBJECT":
    bpy.ops.object.mode_set(mode="OBJECT")
bpy.ops.object.select_all(action="DESELECT")
obj.select_set(True)
bpy.context.view_layer.objects.active = obj

obj.name = "Tent_Reference_BluePainted"
obj.data.name = "Tent_Reference_BluePainted_Mesh"
material.name = "Tent_Reference_Baked_Blue"

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

# Leave the user's open painting file exactly as it was, ready to keep painting.
obj.name = old_object_name
obj.data.name = old_mesh_name
material.name = old_material_name
if old_mode == "TEXTURE_PAINT":
    bpy.ops.object.mode_set(mode="TEXTURE_PAINT")

print(f"BLUE_TENT_EXPORT={EXPORT_PATH}")
print(f"BLUE_TENT_BYTES={os.path.getsize(EXPORT_PATH)}")
print(f"BLUE_IMAGE_DIRTY={image.is_dirty}")
