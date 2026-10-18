#!/usr/bin/env python3
"""Same black-attire insurgent, different faces from the game's own models.
For each donor (IraqOfficer / IraqMechanic / IraqTorturer), the donor's
face-front UV island is measured from its GLB (HEAD-dominant triangles,
front of head), cropped from its atlas, and pasted onto the identical
measured island of the IraqInfantry body used by every enemy spawn."""
import struct, json
from PIL import Image, ImageFilter

S = 1024
BASE = '/home/user/black_decade/fidelity/textures/Insurgent01.png'
TARGET_GLB = '/home/user/black_decade/fidelity/models/enemy/IraqInfantry01_Sandy.glb'
DONORS = [
    ('Officer', '/tmp/faces/IraqOfficer01_Sandy.glb'),
    ('Mechanic', '/tmp/faces/IraqMechanic.glb'),
    ('Torturer', '/tmp/faces/IraqTorturer.glb'),
]

def load_glb(path):
    d = open(path, 'rb').read()
    cl = struct.unpack_from('<I', d, 12)[0]
    g = json.loads(d[20:20 + cl])
    o = 20 + cl
    blen = struct.unpack_from('<I', d, o)[0]
    return g, d[o + 8:o + 8 + blen]

def acc_raw(g, binb, ai):
    a = g['accessors'][ai]
    bv = g['bufferViews'][a['bufferView']]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    comp = {5126: ('f', 4), 5123: ('H', 2), 5125: ('I', 4), 5121: ('B', 1)}[a['componentType']]
    n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
    return [struct.unpack_from('<%d%s' % (n, comp[0]), binb, off + i * n * comp[1]) for i in range(a['count'])]

def face_bbox(glb_path):
    """UV bbox (px @1024) of face-front triangles + the atlas image."""
    g, binb = load_glb(glb_path)
    joint_names = [g['nodes'][j].get('name', '') for j in g['skins'][0]['joints']]
    pts = []
    for m in g['meshes']:
        if m.get('name') != 'NEWSKIN':
            continue
        for p in m['primitives']:
            uv = acc_raw(g, binb, p['attributes']['TEXCOORD_0'])
            pos = acc_raw(g, binb, p['attributes']['POSITION'])
            joints = acc_raw(g, binb, p['attributes']['JOINTS_0'])
            weights = acc_raw(g, binb, p['attributes']['WEIGHTS_0'])
            idx = [t[0] for t in acc_raw(g, binb, p['indices'])]
            dom = []
            for i in range(len(uv)):
                w = weights[i]
                dom.append(joint_names[joints[i][max(range(4), key=lambda k: w[k])]].upper())
            for i in range(0, len(idx), 3):
                vs = idx[i:i + 3]
                if not any('HEAD' in dom[v] for v in vs):
                    continue
                cz = sum(pos[v][2] for v in vs) / 3
                cy = sum(pos[v][1] for v in vs) / 3
                if cz > 0.02 and 1.46 < cy < 1.75:
                    pts += [(uv[v][0] * S, uv[v][1] * S) for v in vs]
    us = [p[0] for p in pts]; vs_ = [p[1] for p in pts]
    bbox = (int(min(us)), int(min(vs_)), int(max(us)), int(max(vs_)))
    # atlas: first embedded image
    img = g['images'][0]
    bv = g['bufferViews'][img['bufferView']]
    off = bv.get('byteOffset', 0)
    import io
    atlas = Image.open(io.BytesIO(binb[off:off + bv['byteLength']])).convert('RGB')
    return bbox, atlas

target_bbox, _ = face_bbox(TARGET_GLB)
print('target face island:', target_bbox)
base = Image.open(BASE).convert('RGB')
tw = target_bbox[2] - target_bbox[0]
th = target_bbox[3] - target_bbox[1]

# variant 1: the original infantry face (already in the base texture)
base.save('/home/user/black_decade/fidelity/textures/Insurgent_F1.png')
print('wrote Insurgent_F1.png (infantry face)')

for name, path in DONORS:
    bbox, atlas = face_bbox(path)
    atlas = atlas.resize((S, S), Image.LANCZOS)
    crop = atlas.crop(bbox).resize((tw, th), Image.LANCZOS)
    out = base.copy()
    # feathered paste so the island edge blends
    m = Image.new('L', (tw, th), 0)
    from PIL import ImageDraw
    dr = ImageDraw.Draw(m)
    dr.rectangle([6, 6, tw - 6, th - 6], fill=255)
    m = m.filter(ImageFilter.GaussianBlur(6))
    out.paste(crop, (target_bbox[0], target_bbox[1]), m)
    dst = f'/home/user/black_decade/fidelity/textures/Insurgent_{name}.png'
    out.save(dst)
    print('wrote', dst, 'donor island', bbox)
