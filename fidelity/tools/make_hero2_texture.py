#!/usr/bin/env python3
"""Squad Character 2 (Ramirez body): ANP woodland repaint + the user's
photo transplanted onto the measured face island (u 172-340, v 360-579
@1024) + the approved shoulder patches. Photo: straight-on portrait,
cropped hairline->chin / cheek->cheek so eyes & mouth land on the
island's landmarks."""
import struct, json
from PIL import Image, ImageDraw, ImageFilter, ImageOps

GLB = '/home/user/black_decade/fidelity/models/heroes/Hero02_Ramirez.glb'
SRC = '/home/user/black_decade/fidelity/textures/Hero02_UK_01.png'
DST = '/home/user/black_decade/fidelity/textures/Hero02_DZ_01.png'
PHOTO = '/tmp/arena-coding-uploads/Gritty Soldier Head UV Texture.png'
S = 1024

d = open(GLB, 'rb').read()
cl = struct.unpack_from('<I', d, 12)[0]
g = json.loads(d[20:20 + cl])
o = 20 + cl
blen = struct.unpack_from('<I', d, o)[0]
binb = d[o + 8:o + 8 + blen]

def acc_raw(ai):
    a = g['accessors'][ai]
    bv = g['bufferViews'][a['bufferView']]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    comp = {5126: ('f', 4), 5123: ('H', 2), 5125: ('I', 4), 5121: ('B', 1)}[a['componentType']]
    n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
    return [struct.unpack_from('<%d%s' % (n, comp[0]), binb, off + i * n * comp[1]) for i in range(a['count'])]

joint_names = [g['nodes'][j].get('name', '') for j in g['skins'][0]['joints']]

def vclass(jn):
    if 'HEAD' in jn or 'NECK' in jn or 'HAND' in jn: return 'skin'
    if 'FOOT' in jn or 'TOE' in jn: return 'boots'
    return 'uniform'

CODE = {'skin': 1, 'boots': 2, 'uniform': 3}
mask = Image.new('L', (S, S), 0)
md = ImageDraw.Draw(mask)
counts = {}
for m in g['meshes']:
    if m.get('name') != 'NEWSKIN':
        continue
    for p in m['primitives']:
        uv = acc_raw(p['attributes']['TEXCOORD_0'])
        joints = acc_raw(p['attributes']['JOINTS_0'])
        weights = acc_raw(p['attributes']['WEIGHTS_0'])
        idx = [t[0] for t in acc_raw(p['indices'])]
        dom = []
        for i in range(len(uv)):
            w = weights[i]
            dom.append(vclass(joint_names[joints[i][max(range(4), key=lambda k: w[k])]].upper()))
        for i in range(0, len(idx), 3):
            vs = idx[i:i + 3]
            cs = [dom[v] for v in vs]
            c = max(set(cs), key=cs.count)
            counts[c] = counts.get(c, 0) + 1
            md.polygon([(uv[v][0] * S, uv[v][1] * S) for v in vs], fill=CODE[c])
print('tris:', counts)

# collect the face triangles (for the mesh bake) while masks are built
face_tris = []
for m in g['meshes']:
    if m.get('name') != 'NEWSKIN':
        continue
    for p in m['primitives']:
        uv = acc_raw(p['attributes']['TEXCOORD_0'])
        pos = acc_raw(p['attributes']['POSITION'])
        joints = acc_raw(p['attributes']['JOINTS_0'])
        weights = acc_raw(p['attributes']['WEIGHTS_0'])
        idx = [t[0] for t in acc_raw(p['indices'])]
        dom = []
        for i in range(len(uv)):
            w = weights[i]
            dom.append(vclass(joint_names[joints[i][max(range(4), key=lambda k: w[k])]].upper()))
        for i in range(0, len(idx), 3):
            vs = idx[i:i + 3]
            cs = [dom[v] for v in vs]
            c = max(set(cs), key=cs.count)
            if c != 'skin':
                continue
            cen = [sum(pos[v][k] for v in vs) / 3 for k in range(3)]
            if cen[2] > 0.005 and 1.46 < cen[1] < 1.77:
                face_tris.append(([(uv[v][0] * S, uv[v][1] * S) for v in vs],
                                   [pos[v] for v in vs]))
print('face tris for bake:', len(face_tris))

base = Image.open(SRC).convert('RGB').resize((S, S), Image.LANCZOS)
out = base.copy()
bp, op, mp = base.load(), out.load(), mask.load()

WOODLAND = [(55, (34, 40, 22)), (100, (55, 66, 34)), (145, (84, 94, 50)), (185, (106, 108, 62)), (256, (134, 134, 86))]

def pal_map(palette, r, g, b):
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    for limit, col in palette:
        if lum < limit:
            return tuple(int(col[i] * 0.85 + (r, g, b)[i] * 0.15) for i in range(3))
    return palette[-1][1]

for y in range(S):
    for x in range(S):
        m = mp[x, y]
        if m == 0: continue
        r, g, b = bp[x, y]
        if m == CODE['uniform']:
            op[x, y] = pal_map(WOODLAND, r, g, b)
        elif m == CODE['boots']:
            op[x, y] = (int(r * 0.32), int(g * 0.30), int(b * 0.28))
        elif m == CODE['skin']:
            op[x, y] = (int(r * 1.05), int(g * 0.99), int(b * 0.93))

# (photo face bake removed at user's request — Ramirez's own face stays)

# ---- shoulder patches (same approved treatment as Character 1) ----
dr = ImageDraw.Draw(out)
bx0, by0, bx1, by1 = 125 - 29, 758 - 22, 125 + 29, 758 + 22
dr.rectangle([bx0, by0, bx1, by1], fill=(52, 58, 40), outline=(24, 27, 19), width=2)
for sx in range(bx0 + 4, bx1 - 4, 6):
    dr.line([sx, by0 + 3, sx + 3, by0 + 3], fill=(205, 205, 190), width=1)
    dr.line([sx, by1 - 3, sx + 3, by1 - 3], fill=(205, 205, 190), width=1)
for sy in range(by0 + 4, by1 - 4, 6):
    dr.line([bx0 + 3, sy, bx0 + 3, sy + 3], fill=(205, 205, 190), width=1)
    dr.line([bx1 - 3, sy, bx1 - 3, sy + 3], fill=(205, 205, 190), width=1)
flag_img = Image.open('/home/user/black_decade/fidelity/textures/flag_patch.png').convert('RGB')
flag_img = ImageOps.mirror(ImageOps.fit(flag_img, (50, 36), Image.LANCZOS))
out.paste(flag_img, (125 - 25, 758 - 18))
gis_img = Image.open('/home/user/black_decade/fidelity/textures/gis_patch.png').convert('RGB')
gis_img = ImageOps.fit(gis_img, (50, 50), Image.LANCZOS)
gis_mask = Image.new('L', (50, 50), 0)
ImageDraw.Draw(gis_mask).ellipse([1, 1, 49, 49], fill=255)
out.paste(gis_img, (385 - 25, 758 - 25), gis_mask)

blur = out.filter(ImageFilter.GaussianBlur(8))
bl = blur.load()
for y in range(S):
    for x in range(S):
        if mp[x, y] == 0:
            op[x, y] = bl[x, y]

out = out.filter(ImageFilter.UnsharpMask(radius=2, percent=60, threshold=2))
out.save(DST)
print('wrote', DST)
