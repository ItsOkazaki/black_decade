#!/usr/bin/env python3
"""Insurgent look for IraqInfantry01_Sandy, v2 — the classic fighter:
cream Afghan thobe (torso+arms+legs) with subtle vertical pinstripes,
keffiyeh headscarf on all head triangles except the face, long dark beard
on jaw/chin/neck triangles, striped waist sash + AK ammo bandolier painted
across the chest island. Moustache already exists in the source face."""
import struct, json, random
from PIL import Image, ImageDraw, ImageFilter

GLB = '/home/user/black_decade/fidelity/models/enemy/IraqInfantry01_Sandy.glb'
SRC = '/home/user/black_decade/fidelity/textures/IraqInfantry01_Sandy.png'
DST = '/home/user/black_decade/fidelity/textures/Mujahid01.png'
S = 1024
random.seed(7)

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
    if 'HEAD' in jn: return 'head'
    if 'NECK' in jn or 'HAND' in jn: return 'skin'
    if 'FOOT' in jn or 'TOE' in jn: return 'boots'
    return 'cloth'

tris = []
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
            dom.append(vclass(joint_names[joints[i][max(range(4), key=lambda k: w[k])]]))
        for i in range(0, len(idx), 3):
            vs = idx[i:i + 3]
            cs = [dom[v] for v in vs]
            c = max(set(cs), key=cs.count)
            bc = tuple(sum(pos[v][k] for v in vs) / 3 for k in range(3))
            tris.append({'c': c, 'pts': [(uv[v][0] * S, uv[v][1] * S) for v in vs], 'bind': bc})

def make_mask(selector):
    im = Image.new('L', (S, S), 0)
    dr = ImageDraw.Draw(im)
    for t in tris:
        if selector(t):
            dr.polygon(t['pts'], fill=255)
    return im

head_mask = make_mask(lambda t: t['c'] == 'head')
face_mask = make_mask(lambda t: t['c'] == 'head' and t['bind'][2] > 0.015 and 1.48 < t['bind'][1] < 1.72)
beard_mask = make_mask(lambda t: t['c'] in ('head', 'skin') and t['bind'][2] > 0.02 and 1.40 < t['bind'][1] < 1.565)
cloth_mask = make_mask(lambda t: t['c'] == 'cloth')
boot_mask = make_mask(lambda t: t['c'] == 'boots')
skin_mask = make_mask(lambda t: t['c'] in ('head', 'skin'))

base = Image.open(SRC).convert('RGB').resize((S, S), Image.LANCZOS)
out = base.copy()
bp, op = base.load(), out.load()
cm, bm, sm = cloth_mask.load(), boot_mask.load(), skin_mask.load()

THOBE = [(55, (78, 74, 64)), (100, (110, 104, 90)), (150, (144, 136, 116)), (200, (174, 166, 144)), (256, (202, 194, 170))]

def pal_map(palette, r, g, b):
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    for limit, col in palette:
        if lum < limit:
            return tuple(int(col[i] * 0.88 + (r, g, b)[i] * 0.12) for i in range(3))
    return palette[-1][1]

for y in range(S):
    for x in range(S):
        if cm[x, y]:
            col = pal_map(THOBE, *bp[x, y])
            if (x % 26) < 3:  # subtle vertical pinstripe (UV-space approximation)
                col = tuple(int(v * 0.86) for v in col)
            op[x, y] = col
        elif bm[x, y]:
            r, g, b = bp[x, y]
            op[x, y] = (int(r * 0.32), int(g * 0.26), int(b * 0.2))
        elif sm[x, y]:
            r, g, b = bp[x, y]
            op[x, y] = (int(r * 1.03), int(g * 0.96), int(b * 0.88))  # sun-weathered

# ---- keffiyeh: head minus face, check pattern ----
scarf = Image.new('RGB', (S, S), (226, 220, 204))
sd = ImageDraw.Draw(scarf)
for yy in range(0, S, 22):
    sd.line([(0, yy), (S, yy)], fill=(168, 160, 142), width=3)
    sd.line([(0, yy + 11), (S, yy + 11)], fill=(198, 190, 168), width=1)
for xx in range(0, S, 22):
    sd.line([(xx, 0), (xx, S)], fill=(168, 160, 142), width=3)
    sd.line([(xx + 11, 0), (xx + 11, S)], fill=(198, 190, 168), width=1)
sp = scarf.load()
hm, fm = head_mask.load(), face_mask.load()
for y in range(S):
    for x in range(S):
        if False:  # headscarf is real 3D geometry now, not paint
            r, g, b = sp[x, y]
            lr, lg, lb = bp[x, y]
            lum = (0.299 * lr + 0.587 * lg + 0.114 * lb) / 255.0
            op[x, y] = tuple(int(v * (0.75 + 0.45 * lum)) for v in (r, g, b))

# ---- long beard: jaw/chin/front-neck triangles, noisy dark brown ----
noise = Image.effect_noise((S, S), 30)
np_ = noise.load()
bd = beard_mask.load()
for y in range(S):
    for x in range(S):
        if bd[x, y]:
            n = np_[x, y] / 255.0
            op[x, y] = (int(26 + 42 * n), int(20 + 32 * n), int(15 + 22 * n))
# stroked hair strands
od = ImageDraw.Draw(out)
for _ in range(2600):
    x = random.randrange(S); y = random.randrange(S)
    if bd[x, y]:
        od.line([(x, y), (x + random.randint(-1, 1), y + random.randint(3, 8))],
                fill=(64 + random.randint(0, 30), 50, 36), width=1)

# ---- chest items over the front-torso island ----
front = [t for t in tris if t['c'] == 'cloth' and t['bind'][2] > 0.05 and 0.95 < t['bind'][1] < 1.55]
if front:
    us = [p[0] for t in front for p in t['pts']]
    vs = [p[1] for t in front for p in t['pts']]
    u0, u1, v0, v1 = min(us), max(us), min(vs), max(vs)
    dr = ImageDraw.Draw(out)
    # striped waist sash at bottom of the chest island
    sash_y0 = v1 - (v1 - v0) * 0.16
    cols = [(122, 44, 36), (70, 58, 46), (150, 118, 66), (70, 58, 46)]
    yy = sash_y0
    k = 0
    while yy < v1:
        dr.rectangle([u0 + 4, yy, u1 - 4, min(yy + 7, v1)], fill=cols[k % 4])
        yy += 7; k += 1
    # AK ammo bandolier: diagonal strap with brass cartridges
    ax, ay = u0 + (u1 - u0) * 0.10, v0 + (v1 - v0) * 0.78
    bx, by = u0 + (u1 - u0) * 0.88, v0 + (v1 - v0) * 0.16
    dr.line([(ax, ay), (bx, by)], fill=(44, 42, 30), width=44)
    dr.line([(ax, ay), (bx, by)], fill=(64, 60, 42), width=36)
    steps = 9
    for i in range(steps):
        t = (i + 0.5) / steps
        cx = ax + (bx - ax) * t
        cy = ay + (by - ay) * t
        dr.rectangle([cx - 6, cy - 13, cx + 6, cy + 13], fill=(172, 140, 78), outline=(70, 54, 26))
        dr.rectangle([cx - 6, cy - 13, cx + 6, cy - 6], fill=(216, 182, 112))

# seam fill
blur = out.filter(ImageFilter.GaussianBlur(8))
bl = blur.load()
allmask = Image.new('L', (S, S), 0)
am = ImageDraw.Draw(allmask)
for t in tris:
    am.polygon(t['pts'], fill=255)
amp = allmask.load()
for y in range(S):
    for x in range(S):
        if not amp[x, y]:
            op[x, y] = bl[x, y]

out = out.filter(ImageFilter.UnsharpMask(radius=2, percent=60, threshold=2))
out.save(DST)
print('wrote', DST)
