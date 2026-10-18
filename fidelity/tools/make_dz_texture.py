#!/usr/bin/env python3
"""ANP woodland reskin v3 — bone-classified.
Each NEWSKIN triangle is classified by its vertices' dominant skin joint:
HEAD/NECK/HAND bones -> skin (keep), FOOT/TOE -> boots (darken), everything
else -> uniform (woodland repaint). This is exact where position-based
guessing failed (collar, shoulder tops, forearm cuffs are cloth, not skin).
Patch placed at the measured upper-chest UV centre."""
import struct, json
from PIL import Image, ImageDraw, ImageFilter

GLB = '/home/user/black_decade/fidelity/models/play/Hero01_Armstrong.glb'
SRC = '/home/user/black_decade/fidelity/textures/Hero01_UK_01.png'
DST = '/home/user/black_decade/fidelity/textures/Hero01_DZ_01.png'
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
    fmt = '<%d%s' % (n, comp[0])
    return [struct.unpack_from(fmt, binb, off + i * n * comp[1]) for i in range(a['count'])]

joint_names = [g['nodes'][j].get('name', '') for j in g['skins'][0]['joints']]

def vclass(jname):
    if 'HEAD' in jname or 'NECK' in jname: return 'skin'
    if 'HAND' in jname: return 'skin'
    if 'FOOT' in jname or 'TOE' in jname: return 'boots'
    return 'uniform'

tris = []
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
            j = joints[i][max(range(4), key=lambda k: w[k])]
            dom.append(vclass(joint_names[j]))
        for i in range(0, len(idx), 3):
            vs = idx[i:i + 3]
            cs = [dom[v] for v in vs]
            c = 'skin' if cs.count('skin') >= 2 else ('boots' if cs.count('boots') >= 2 else 'uniform')
            tris.append((c, [(uv[v][0] * S, uv[v][1] * S) for v in vs]))

mask = Image.new('L', (S, S), 0)
md = ImageDraw.Draw(mask)
for want, code in (('uniform', 3), ('boots', 2), ('skin', 1)):
    for c, pts in tris:
        if c == want:
            md.polygon(pts, fill=code)
print('tris:', len(tris), {c: sum(1 for t in tris if t[0] == c) for c in ('skin', 'boots', 'uniform')})

base = Image.open(SRC).convert('RGB').resize((S, S), Image.LANCZOS)
out = base.copy()
bp, op, mp = base.load(), out.load(), mask.load()

WOODLAND = [(55, (34, 40, 22)), (100, (55, 66, 34)), (145, (84, 94, 50)),
            (185, (106, 108, 62)), (256, (134, 134, 86))]  # faded 1990s olive tones

def woodland(r, g, b):
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    for limit, col in WOODLAND:
        if lum < limit:
            return tuple(int(col[i] * 0.85 + (r, g, b)[i] * 0.15) for i in range(3))
    return WOODLAND[-1][1]

for y in range(S):
    for x in range(S):
        m = mp[x, y]
        if m == 3:
            op[x, y] = woodland(*bp[x, y])
        elif m == 2:
            r, g, b = bp[x, y]
            op[x, y] = (int(r * 0.32), int(g * 0.30), int(b * 0.28))
        elif m == 1:
            r, g, b = bp[x, y]
            op[x, y] = (min(255, int(r * 1.05)), int(g * 0.99), int(b * 0.93))

blur = out.filter(ImageFilter.GaussianBlur(8))
bl = blur.load()
for y in range(S):
    for x in range(S):
        if mp[x, y] == 0:
            op[x, y] = bl[x, y]

# Patches on the SHOULDERS, using the user's real reference patches
# (textures/flag_patch.png, textures/gis_patch.png), set a bit higher:
# LEFT arm: Algerian flag (rectangular, stitched border).
# RIGHT arm: G.I.S roundel (circular-masked from the square photo).
from PIL import ImageOps
# --- flag on left shoulder (mirrored: the sleeve UV flips it in 3D) ---
# sewn-patch look: fabric backing + stitched dashed border, flag inset
dr = ImageDraw.Draw(out)
bx0, by0, bx1, by1 = 125 - 29, 758 - 22, 125 + 29, 758 + 22
dr.rectangle([bx0, by0, bx1, by1], fill=(52, 58, 40), outline=(24, 27, 19), width=2)
for sx in range(bx0 + 4, bx1 - 4, 6):  # stitch dashes, top/bottom
    dr.line([sx, by0 + 3, sx + 3, by0 + 3], fill=(205, 205, 190), width=1)
    dr.line([sx, by1 - 3, sx + 3, by1 - 3], fill=(205, 205, 190), width=1)
for sy in range(by0 + 4, by1 - 4, 6):  # stitch dashes, sides
    dr.line([bx0 + 3, sy, bx0 + 3, sy + 3], fill=(205, 205, 190), width=1)
    dr.line([bx1 - 3, sy, bx1 - 3, sy + 3], fill=(205, 205, 190), width=1)
flag_img = Image.open('/home/user/black_decade/fidelity/textures/flag_patch.png').convert('RGB')
flag_img = ImageOps.mirror(ImageOps.fit(flag_img, (50, 36), Image.LANCZOS))
out.paste(flag_img, (125 - 25, 758 - 18))
# --- G.I.S roundel on right shoulder ---
gis_img = Image.open('/home/user/black_decade/fidelity/textures/gis_patch.png').convert('RGB')
gis_img = ImageOps.fit(gis_img, (50, 50), Image.LANCZOS)
gis_mask = Image.new('L', (50, 50), 0)
ImageDraw.Draw(gis_mask).ellipse([1, 1, 49, 49], fill=255)
out.paste(gis_img, (385 - 25, 758 - 25), gis_mask)

out = out.filter(ImageFilter.UnsharpMask(radius=2, percent=60, threshold=2))
out.save(DST)
print('wrote', DST)
