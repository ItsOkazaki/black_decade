#!/usr/bin/env python3
"""Insurgent repaint of IraqInfantry01_Sandy (the APPROVED first enemy):
bone-classified regions get mismatched civilian clothes — brown jacket
(torso bones), charcoal trousers (leg bones), dark olive sleeves (arm
bones). Face/hands kept (he already has the moustache). No insignia."""
import struct, json
from PIL import Image, ImageDraw, ImageFilter

GLB = '/home/user/black_decade/fidelity/models/enemy/IraqInfantry01_Sandy.glb'
SRC = '/home/user/black_decade/fidelity/textures/IraqInfantry01_Sandy.png'
DST = '/home/user/black_decade/fidelity/textures/Insurgent01.png'
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
    if 'THIGH' in jn or 'CALF' in jn or 'PELVIS' in jn: return 'legs'
    if 'UPPERARM' in jn or 'FOREARM' in jn: return 'arms'
    return 'torso'

CODE = {'skin': 1, 'boots': 2, 'legs': 3, 'arms': 4, 'torso': 5}
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
            dom.append(vclass(joint_names[joints[i][max(range(4), key=lambda k: w[k])]]))
        for i in range(0, len(idx), 3):
            vs = idx[i:i + 3]
            cs = [dom[v] for v in vs]
            c = max(set(cs), key=cs.count)
            tris.append((c, [(uv[v][0] * S, uv[v][1] * S) for v in vs]))

mask = Image.new('L', (S, S), 0)
md = ImageDraw.Draw(mask)
for want in ('torso', 'arms', 'legs', 'boots', 'skin'):
    for c, pts in tris:
        if c == want:
            md.polygon(pts, fill=CODE[c])

base = Image.open(SRC).convert('RGB').resize((S, S), Image.LANCZOS)
out = base.copy()
bp, op, mp = base.load(), out.load(), mask.load()

PALETTES = {
    'torso': [(55, (16, 14, 11)), (100, (28, 24, 18)), (150, (44, 38, 28)), (200, (60, 52, 38)), (256, (78, 68, 50))],
    'legs': [(55, (13, 13, 15)), (100, (24, 24, 27)), (150, (38, 38, 41)), (200, (52, 52, 55)), (256, (68, 68, 70))],
    'arms': [(55, (15, 16, 11)), (100, (27, 29, 19)), (150, (41, 44, 29)), (200, (55, 59, 40)), (256, (70, 74, 52))],
}

def pal_map(palette, r, g, b):
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    for limit, col in palette:
        if lum < limit:
            return tuple(int(col[i] * 0.85 + (r, g, b)[i] * 0.15) for i in range(3))
    return palette[-1][1]

INV = {v: k for k, v in CODE.items()}
for y in range(S):
    for x in range(S):
        m = mp[x, y]
        if m == 0: continue
        c = INV[m]
        r, g, b = bp[x, y]
        if c in PALETTES:
            op[x, y] = pal_map(PALETTES[c], r, g, b)
        elif c == 'boots':
            op[x, y] = (int(r * 0.3), int(g * 0.28), int(b * 0.26))

blur = out.filter(ImageFilter.GaussianBlur(8))
bl = blur.load()
for y in range(S):
    for x in range(S):
        if mp[x, y] == 0:
            op[x, y] = bl[x, y]

out = out.filter(ImageFilter.UnsharpMask(radius=2, percent=60, threshold=2))
out.save(DST)
print('wrote', DST)
