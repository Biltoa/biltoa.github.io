"""
Blender headless: Dreamscape Campsite FBX -> one GLB kit for the web.

    "C:\\Program Files\\Blender Foundation\\Blender 4.4\\blender.exe" ^
        --background --factory-startup ^
        --python tools/export-campsite.py -- <output.glb>

The FBX files carry LOD0..LOD3 and junk material names (lambert1.002,
Cylinder_003), so nothing can be inferred from them. Each entry below states
which LOD to keep and which texture set to wire up, by hand.

Everything lands in one GLB so shared maps (bark, leaves, grass) are stored
once instead of once per tree. Textures are full-size here; tools/optimize-kit.mjs
does the resizing, WebP conversion and Draco pass afterwards.
"""

import bpy
import bmesh
import os
import sys
from mathutils import Matrix

SRC = r"E:\Unity Workspaces\Gameplay Portfolio\Assets\Polyart\PolyartStudio\DreamscapeCampsite"
MESHES = os.path.join(SRC, "Meshes")

# Prefer the normalised, downscaled copies from tools/prep-textures.mjs. The raw
# pack has 16-bit and odd-colourspace PNGs that break the downstream toolchain,
# and 4K maps nobody needs on a web page.
_PREPPED = os.path.join(os.path.dirname(os.path.abspath(__file__)), "build", "tex")
TEX = _PREPPED if os.path.isdir(_PREPPED) else os.path.join(SRC, "Textures")
print("texture source:", TEX)


def tex(folder, name):
    return os.path.join(TEX, folder, name)


# name -> how to build it
# fbx:      source file
# lod:      substring identifying the object to keep
# unit:     'cm' or 'm'. The pack mixes both â€” the tent arrives 978 units wide
#           and a tree arrives 24, so every asset states its own scale and the
#           exporter normalises everything to metres.
# mats:     per material slot: color / normal / rough / emissive / alpha maps
# alpha:    'CLIP' for cutout foliage, None for opaque
#
# Origins are also rebuilt: every mesh leaves here with its pivot at
# bottom-centre, so the scene can place things at y = 0 and be done.
KIT = [
    {
        "name": "Tent", "unit": "cm",
        "fbx": os.path.join(MESHES, "Structures", "SM_Tent_01_Unity.fbx"),
        "lod": "LOD1",
        "mats": [
            {
                "color": tex("Structures", "T_Tent_01_C.png"),
                "normal": tex("Structures", "T_Tent_01_N.png"),
                "rough": tex("Structures", "T_Tent_01_R.png"),
            },
            # Slot 1: the window sash, split out of the same mesh by
            # mark_faces_by_bbox below. Same texture set as slot 0 — this
            # exists to give the window its own material/primitive, not to
            # look different, so the runtime hover highlight can skip it.
            {
                "color": tex("Structures", "T_Tent_01_C.png"),
                "normal": tex("Structures", "T_Tent_01_N.png"),
                "rough": tex("Structures", "T_Tent_01_R.png"),
            },
        ],
    },
    {
        # Variation B: Structure_Tent_04_Variation_01 in the Unity project.
        "name": "Tent4", "unit": "cm",
        "fbx": os.path.join(MESHES, "Structures", "SM_Tent_04_Unity.fbx"),
        "lod": "LOD1",
        "mats": [
            {
                # T_Tent_04_Mask is a detail mask, not an alpha channel — wired
                # to opacity it cuts most of the canvas away and leaves poles.
                "color": tex("Structures", "T_Tent_04_C.png"),
                "normal": tex("Structures", "T_Tent_04_N.png"),
                "rough": tex("Structures", "T_Tent_04_R.png"),
                "double_sided": True,
            }
        ],
    },
    {
        "name": "SleepingBag", "unit": "cm",
        "fbx": os.path.join(MESHES, "Props", "SM_SleepingBag_02_Unity.fbx"),
        "lod": None,
        "mats": [
            {
                "color": tex("Props", "T_SleepingBag_02_C.png"),
                "normal": tex("Props", "T_SleepingBag_02_N.png"),
                "rough": tex("Props", "T_SleepingBag_02_R.png"),
            }
        ],
    },
    {
        "name": "TreeA", "unit": "m",
        "fbx": os.path.join(MESHES, "Trees", "SM_Tree_Campsite_01.fbx"),
        "lod": "LOD2",
        "mats": [
            {
                "color": tex("Trees", "T_Bark_Autumn_01_C.png"),
                "normal": tex("Trees", "T_Bark_Autumn_01_N.png"),
                "rough": tex("Trees", "T_Bark_Autumn_01_R.png"),
            },
            {
                "color": tex("Trees", "T_Campsite_Leaves_01.png"),
                "alpha_from_color": True,
                "alpha": "CLIP",
                "double_sided": True,
            },
        ],
    },
    {
        "name": "TreeB", "unit": "m",
        "fbx": os.path.join(MESHES, "Trees", "SM_Tree_Campsite_03.fbx"),
        "lod": "LOD2",
        "mats": [
            {
                "color": tex("Trees", "T_Bark_Autumn_01_C.png"),
                "normal": tex("Trees", "T_Bark_Autumn_01_N.png"),
                "rough": tex("Trees", "T_Bark_Autumn_01_R.png"),
            },
            {
                "color": tex("Trees", "T_Campsite_Leaves_02.png"),
                "alpha_from_color": True,
                "alpha": "CLIP",
                "double_sided": True,
            },
        ],
    },
    {
        "name": "TreeC", "unit": "m",
        "fbx": os.path.join(MESHES, "Trees", "SM_Tree_Campsite_05.fbx"),
        "lod": "LOD2",
        "mats": [
            {
                "color": tex("Trees", "T_Bark_Autumn_01_C.png"),
                "normal": tex("Trees", "T_Bark_Autumn_01_N.png"),
                "rough": tex("Trees", "T_Bark_Autumn_01_R.png"),
            },
            {
                "color": tex("Trees", "T_Campsite_Leaves_03.png"),
                "alpha_from_color": True,
                "alpha": "CLIP",
                "double_sided": True,
            },
        ],
    },
    {
        "name": "GrassA", "unit": "m",
        "fbx": os.path.join(MESHES, "Foliage", "SM_Grass_Campsite_01.fbx"),
        "lod": "LOD1",
        "mats": [
            {
                "color": tex("Foliage", "T_Grass_Medium_01.png"),
                "opacity": tex("Foliage", "T_Grass_Medium_01_O.png"),
                "alpha": "CLIP",
                "double_sided": True,
            }
        ],
    },
    {
        "name": "GrassB", "unit": "m",
        "fbx": os.path.join(MESHES, "Foliage", "SM_Grass_Campsite_03.fbx"),
        "lod": "LOD1",
        "mats": [
            {
                "color": tex("Foliage", "T_Grass_Medium_01.png"),
                "opacity": tex("Foliage", "T_Grass_Medium_01_O.png"),
                "alpha": "CLIP",
                "double_sided": True,
            }
        ],
    },
    {
        "name": "Flowers", "unit": "m",
        "fbx": os.path.join(MESHES, "Foliage", "SM_DCS_FlowersGroup_01.fbx"),
        "lod": None,
        "mats": [
            {
                "color": tex("Foliage", "T_Flowers_Campsite_C.png"),
                "opacity": tex("Foliage", "T_Flowers_Campsite_A.png"),
                "alpha": "CLIP",
                "double_sided": True,
            }
        ],
    },
    {
        "name": "Firewood", "unit": "cm",
        "fbx": os.path.join(MESHES, "Cooking", "SM_Campsite_Firewood_Unity.fbx"),
        "lod": None,
        "mats": [
            {
                "color": tex("Cooking", "T_Firewood_01_Burning_C.png"),
                "normal": tex("Cooking", "T_Firewood_01_Burning_N.png"),
                "rough": tex("Cooking", "T_Firewood_01_Burning_R.png"),
                "emissive": tex("Cooking", "T_Firewood_01_Burning_E.png"),
                "emissive_strength": 3.0,
            }
        ],
    },
    {
        "name": "FireRocks", "unit": "cm",
        "fbx": os.path.join(MESHES, "Cooking", "SM_Campsite_Rocks_Unity.fbx"),
        "lod": None,
        "mats": [
            {
                "color": tex("Cooking", "T_Campfire_Rocks_Lit_C.png"),
                "normal": tex("Cooking", "T_Campfire_Rocks_N.png"),
                "rough": tex("Cooking", "T_Campfire_Rocks_R.png"),
            }
        ],
    },
    {
        "name": "Lamp", "unit": "cm",
        "fbx": os.path.join(MESHES, "Props", "SM_Lamp_01_Unity.fbx"),
        "lod": None,
        "mats": [
            {
                "color": tex("Props", "T_Lamp_01_C.png"),
                "normal": tex("Props", "T_Lamp_01_N.png"),
                "rough": tex("Props", "T_Lamp_01_R.png"),
                "emissive": tex("Props", "T_Lamp_01_E.png"),
                "emissive_strength": 4.0,
            }
        ],
    },
    {
        "name": "Bench", "unit": "cm",
        "fbx": os.path.join(MESHES, "Props", "SM_Bench_01_Unity.fbx"),
        "lod": None,
        "mats": [
            {
                "color": tex("Props", "T_Bench_01_C.png"),
                "normal": tex("Props", "T_Bench_01_N.png"),
                "rough": tex("Props", "T_Bench_01_R.png"),
            }
        ],
    },
    {
        # Same mesh as Bench, wired to the higher-res texture copy from
        # prep-textures.mjs — the journal sits right on top of this one, a
        # hand's width from the lens, where the campfire benches' resolution
        # goes soft. Its own node so the outdoor benches stay untouched.
        "name": "BenchIndoor", "unit": "cm",
        "fbx": os.path.join(MESHES, "Props", "SM_Bench_01_Unity.fbx"),
        "lod": None,
        "mats": [
            {
                "color": tex("Props", "T_Bench_01_Indoor_C.png"),
                "normal": tex("Props", "T_Bench_01_Indoor_N.png"),
                "rough": tex("Props", "T_Bench_01_Indoor_R.png"),
            }
        ],
    },
    {
        "name": "Pumpkin", "unit": "cm",
        "fbx": os.path.join(MESHES, "Props", "SM_Pumpkin_01.fbx"),
        "lod": None,
        "mats": [
            {
                "color": tex("Props", "T_Pumpkin_01_C.png"),
                "normal": tex("Props", "T_Pumpkin_01_N.png"),
                "rough": tex("Props", "T_Pumpkin_01_R.png"),
            }
        ],
    },
    {
        "name": "Stone", "unit": "cm",
        "fbx": os.path.join(MESHES, "Stones", "SM_Stone_Small_01_Unity.fbx"),
        "lod": None,
        "mats": [
            {
                "color": tex("Stones", "T_Stones_Update_C.png"),
                "normal": tex("Stones", "T_Stones_Update_N.png"),
                "rough": tex("Stones", "T_Stones_Update_R.png"),
            }
        ],
    },
    {
        "name": "Plank", "unit": "cm",
        "fbx": os.path.join(MESHES, "Props", "SM_Wood_Plank_Unity.fbx"),
        "lod": None,
        "mats": [
            {
                "color": tex("Props", "T_WoodPlank_C.png"),
                "normal": tex("Props", "T_WoodPlank_N.png"),
                "rough": tex("Props", "T_WoodPlank_R.png"),
            }
        ],
    },
]

def simple(name, folder, fbx, tex_folder, base, unit="cm", lod=None, emissive=None, strength=2.0):
    """One mesh, one material, `<base>_C/_N/_R` maps. Most props fit this."""
    entry = {
        "name": name,
        "unit": unit,
        "fbx": os.path.join(MESHES, folder, fbx),
        "lod": lod,
        "mats": [
            {
                "color": tex(tex_folder, f"{base}_C.png"),
                "normal": tex(tex_folder, f"{base}_N.png"),
                "rough": tex(tex_folder, f"{base}_R.png"),
            }
        ],
    }
    if emissive:
        entry["mats"][0]["emissive"] = tex(tex_folder, emissive)
        entry["mats"][0]["emissive_strength"] = strength
    return entry


# Camp dressing: props that make the clearing read as somewhere people live
# rather than three tents on a lawn.
KIT += [
    simple("Torch", "Props", "SM_Torch_01_Unity.fbx", "Props", "T_Torch_01"),
    simple("Table", "Props", "SM_Table_01_Unity.fbx", "Props", "T_Table_01"),
    simple("Shelf", "Props", "SM_Support_01.fbx", "Props", "T_Support_01"),
    # Candles for the tent bench, lit by the same shader flame as the torches.
    simple("Candle1", "Props", "SM_Candle_01_Unity.fbx", "Props", "T_Candle_01"),
    simple("Candle2", "Props", "SM_Candle_02_Unity.fbx", "Props", "T_Candle_02"),
    simple("Pillow5", "Props", "SM_Pillow_05_Unity.fbx", "Props", "T_Pillow_05"),
    simple("Pillow6", "Props", "SM_Pillow_06.fbx", "Props", "T_Pillow_06"),
    simple("Pillow7", "Props", "SM_Pillow_07.fbx", "Props", "T_Pillow_07"),
    simple("SleepingBag1", "Props", "SM_SleepingBag_01_Unity.fbx", "Props", "T_SleepingBag_Open"),
    simple("Backpack", "Containers", "SM_BackPack_02_Unity.fbx", "Containers", "T_Backpack_02_Base"),
    simple("Tripod", "Cooking", "SM_Stick_Tripod_Unity.fbx", "Cooking", "T_Sticks_Combined"),
    simple("Pot", "Cooking", "SM_Pot_01_Unity.fbx", "Cooking", "T_Pots_Combined"),
    simple("SpitRoast", "Cooking", "SM_SpitRoast_01_Unity.fbx", "Cooking", "T_SpitRoast"),
    simple("Roast", "Cooking", "SM_RoastChicken_01_Unity.fbx", "Cooking", "T_Roast_Combined"),
    simple("Stall", "Structures", "SM_Stall_01_Unity.fbx", "Structures", "T_Stall_01", lod=None),
    # Glassware for the shelf — the emissive map is what makes them glow.
    simple(
        "Jar",
        "Containers",
        "SM_Jar_02_Unity.fbx",
        "Containers",
        "T_Jar_02_Purple",
        emissive="T_Jar_02_Purple_E.png",
        strength=2.5,
    ),
    simple(
        "Potion",
        "Containers",
        "SM_Potion_03_Unity.fbx",
        "Containers",
        "T_Potion_03_Green",
        emissive="T_Potion_03_Green_E.png",
        strength=2.5,
    ),
]

_image_cache = {}


def load_image(path):
    if path in _image_cache:
        return _image_cache[path]
    if not os.path.exists(path):
        print("  !! missing texture:", path)
        return None
    img = bpy.data.images.load(path, check_existing=True)
    _image_cache[path] = img
    return img


def build_material(name, spec):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.use_backface_culling = not spec.get("double_sided", False)
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes["Principled BSDF"]
    bsdf.inputs["Metallic"].default_value = 0.0

    def add_tex(path, colorspace="sRGB", location=(-600, 0)):
        img = load_image(path)
        if img is None:
            return None
        img.colorspace_settings.name = colorspace
        node = nodes.new("ShaderNodeTexImage")
        node.image = img
        node.location = location
        return node

    color_node = None
    if spec.get("color"):
        color_node = add_tex(spec["color"], "sRGB", (-700, 300))
        if color_node:
            links.new(color_node.outputs["Color"], bsdf.inputs["Base Color"])

    if spec.get("rough"):
        node = add_tex(spec["rough"], "Non-Color", (-700, 0))
        if node:
            links.new(node.outputs["Color"], bsdf.inputs["Roughness"])
    else:
        bsdf.inputs["Roughness"].default_value = 0.85

    if spec.get("normal"):
        node = add_tex(spec["normal"], "Non-Color", (-900, -300))
        if node:
            nrm = nodes.new("ShaderNodeNormalMap")
            nrm.location = (-500, -300)
            links.new(node.outputs["Color"], nrm.inputs["Color"])
            links.new(nrm.outputs["Normal"], bsdf.inputs["Normal"])

    if spec.get("emissive"):
        node = add_tex(spec["emissive"], "sRGB", (-700, -600))
        if node:
            links.new(node.outputs["Color"], bsdf.inputs["Emission Color"])
            bsdf.inputs["Emission Strength"].default_value = spec.get("emissive_strength", 1.0)

    # Cutout foliage: alpha either rides in the colour map or comes from a
    # separate opacity map.
    if spec.get("opacity"):
        node = add_tex(spec["opacity"], "Non-Color", (-700, -900))
        if node:
            links.new(node.outputs["Color"], bsdf.inputs["Alpha"])
    elif spec.get("alpha_from_color") and color_node:
        links.new(color_node.outputs["Alpha"], bsdf.inputs["Alpha"])

    if spec.get("alpha"):
        mat.blend_method = "CLIP" if spec["alpha"] == "CLIP" else "BLEND"
        try:
            mat.alpha_threshold = 0.5
        except AttributeError:
            pass

    return mat


def mark_faces_by_bbox(ob, bounds, slot_index):
    """
    Reassigns every face whose centre falls inside `bounds` — (xmin, xmax,
    ymin, ymax, zmin, zmax), in the mesh's own raw import-space coordinates —
    to material slot `slot_index`.

    Exists because the tent's window is baked into the same single mesh and
    material as the rest of the canvas, with no material or object boundary
    of its own: `bpy.ops.mesh.separate(type='LOOSE')` on a scratch copy is
    what found it in the first place (the pack's poles, ropes and canvas
    panels are all topologically disconnected from each other despite
    sharing one mesh datablock) — the loose window piece's own bounding box
    is what `bounds` below is measured from. Reassigning material_index by
    position, rather than keeping that split, means the geometry stays one
    mesh object with two material slots; glTF splits a multi-material mesh
    into one primitive per slot on export, which is all the runtime hover
    highlight (campsite/outline.ts) needs to treat the window differently
    from the roofline and poles.
    """
    xmin, xmax, ymin, ymax, zmin, zmax = bounds
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    bm = bmesh.from_edit_mesh(ob.data)
    matched = 0
    mw = ob.matrix_world
    for f in bm.faces:
        c = mw @ f.calc_center_median()
        if xmin <= c.x <= xmax and ymin <= c.y <= ymax and zmin <= c.z <= zmax:
            f.material_index = slot_index
            matched += 1
    bmesh.update_edit_mesh(ob.data)
    bpy.ops.object.mode_set(mode="OBJECT")
    print(f"  {ob.name}: marked {matched} faces to material slot {slot_index}")


def import_entry(entry):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=entry["fbx"])
    imported = [o for o in bpy.data.objects if o not in before]

    meshes = [o for o in imported if o.type == "MESH"]
    if entry["lod"]:
        keep = [o for o in meshes if entry["lod"] in o.name]
        if not keep:
            keep = meshes[:1]
    else:
        # No LOD naming: keep everything that came in.
        keep = meshes

    for o in imported:
        if o not in keep:
            bpy.data.objects.remove(o, do_unlink=True)

    # The window sash sits at a known spot in the tent's own raw import-space
    # world coordinates — see mark_faces_by_bbox. Has to run before the
    # transform_apply below, which bakes the importer's axis/unit conversion
    # into the mesh and would invalidate these numbers.
    if entry["name"] == "Tent":
        for ob in keep:
            mark_faces_by_bbox(ob, (-0.65, 0.65, 1.45, 2.2, 2.0, 2.6), 1)

    mats = [build_material(f"{entry['name']}_{i}", spec) for i, spec in enumerate(entry["mats"])]

    result = []
    for i, ob in enumerate(keep):
        ob.name = entry["name"] if len(keep) == 1 else f"{entry['name']}_{i}"
        ob.data.name = ob.name

        # Bake the importer's axis-correction rotation into the mesh. Zeroing
        # the rotation instead leaves Y-up geometry in a Z-up scene, which the
        # glTF exporter then rotates a second time — benches end up on their end.
        bpy.ops.object.select_all(action="DESELECT")
        ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

        # Applying the transform above also bakes the importer's unit scale, so
        # the centimetre assets are already metres by this point. All that is
        # left is moving the pivot to bottom-centre, in mesh data rather than on
        # the object, so the site can instance the geometry with no wrapper.
        ob.scale = (1.0, 1.0, 1.0)

        # Extra UV sets (blend_ao, lightmap) are Unity-only and pure payload.
        while len(ob.data.uv_layers) > 1:
            ob.data.uv_layers.remove(ob.data.uv_layers[-1])

        # Assign in place. materials.clear() also flattens every polygon's
        # material_index to 0, which silently merged each tree's trunk and leaf
        # slots into one — hence leaves rendering as opaque bark-textured cards.
        for slot_i, m in enumerate(mats):
            if slot_i < len(ob.data.materials):
                ob.data.materials[slot_i] = m
            else:
                ob.data.materials.append(m)
        # If the mesh has more slots than we configured, pad with the last one.
        while len(ob.data.materials) < len(ob.material_slots):
            ob.data.materials.append(mats[-1])

        result.append(ob)

    # Recentre the whole entry as one unit. Doing this per object silently
    # destroys the relative layout of multi-part props — the flower clump's two
    # halves both snapped to the origin, which is why one of them floated.
    coords = [v.co for ob in result for v in ob.data.vertices]
    if coords:
        offset = Matrix.Translation(
            (
                -(min(c.x for c in coords) + max(c.x for c in coords)) / 2.0,
                -(min(c.y for c in coords) + max(c.y for c in coords)) / 2.0,
                -min(c.z for c in coords),
            )
        )
        # A shared mesh datablock would otherwise be transformed twice.
        for mesh in {ob.data.name: ob.data for ob in result}.values():
            mesh.transform(offset)

    print(f"  {entry['name']}: kept {[o.name for o in result]}")
    return result


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    out = argv[0] if argv else os.path.join(os.getcwd(), "campsite-kit.glb")

    bpy.ops.wm.read_factory_settings(use_empty=True)

    total_tris = 0
    for entry in KIT:
        if not os.path.exists(entry["fbx"]):
            print("  !! missing fbx:", entry["fbx"])
            continue
        print("importing", entry["name"])
        for ob in import_entry(entry):
            total_tris += sum(len(p.vertices) - 2 for p in ob.data.polygons)

    # Lay the kit out in a row so nothing overlaps if anyone opens the GLB by
    # hand. The site positions everything itself, so world transforms here are
    # cosmetic only.
    x = 0.0
    for ob in sorted(bpy.data.objects, key=lambda o: o.name):
        if ob.type != "MESH":
            continue
        ob.location.x = x
        x += max(2.0, ob.dimensions.x * 1.15)

    print(f"total tris: {total_tris}")

    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format="GLB",
        export_apply=True,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_skins=False,
        export_morph=False,
        export_image_format="WEBP",
        export_image_quality=82,
    )
    print("wrote", out, os.path.getsize(out) // 1024, "KB")


if __name__ == "__main__":
    main()

