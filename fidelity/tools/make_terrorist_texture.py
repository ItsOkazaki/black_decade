#!/usr/bin/env python3
"""Desert Fighter (replaces the Mujahid): CDS2-DLC-style look on the
IraqInfantry01 body — procedural desert 3-colour camo on all cloth,
full beard painted onto the measured face island (mouth v=537, chin v=595
in 1024 space), dark hair, brown boots. Helmet is 3D gear in play.js."""
import struct, json, random
from PIL import Image, ImageDraw, ImageFilter

GLB = '/home/user/black_decade/fidelity/models/enemy/IraqInfantry01_Sandy.glb'
SRC = '/home/user/black_decade/fidelity/textures/IraqInfantry01_Sandy.png'
DST = '/home/user/black_decade/fidelity/textures/Terrorist01.png'
S = 1024
random.seed(11)

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

CODE = {'skin': 1, 'boots': 2, 'cloth': 3, 'head': 4}
mask = Image.new('L', (S, S), 0)
md = ImageDraw.Draw(mask)
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
            md.polygon([(uv[v][0] * S, uv[v][1] * S) for v in vs], fill=CODE[c])

base = Image.open(SRC).convert('RGB').resize((S, S), Image.LANCZOS)
out = base.copy()
bp, op, mp = base.load(), out.load(), mask.load()

# ---- procedural desert 3-colour camo pattern ----
camo = Image.new('RGB', (S, S), (178, 158, 118))
cd = ImageDraw.Draw(camo)
for _ in range(300):
    x, y = random.randrange(S), random.randrange(S)
    w, h = random.randint(30, 120), random.randint(14, 44)
    cd.ellipse([x, y, x + w, y + h], fill=(148, 126, 88))
for _ in range(210):
    x, y = random.randrange(S), random.randrange(S)
    w, h = random.randint(22, 84), random.randint(10, 32)
    cd.ellipse([x, y, x + w, y + h], fill=(110, 100, 74))
for _ in range(90):
    x, y = random.randrange(S), random.randrange(S)
    w, h = random.randint(12, 44), random.randint(6, 18)
    cd.ellipse([x, y, x + w, y + h], fill=(84, 74, 54))
camo = camo.filter(ImageFilter.GaussianBlur(3))
cp = camo.load()

FACE = (165, 360, 360, 625)  # face island rect in 1024 space (u0, v0, u1, v1)
for y in range(S):
    for x in range(S):
        m = mp[x, y]
        if m == 0: continue
        r, g, b = bp[x, y]
        lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0
        if m == CODE['cloth']:
            op[x, y] = (int(24 + 58 * lum), int(25 + 56 * lum), int(20 + 46 * lum))
        elif m == CODE['boots']:
            op[x, y] = (int(r * 0.36), int(g * 0.28), int(b * 0.20))
        elif m == CODE['head'] and not (FACE[0] < x < FACE[2] and FACE[1] < y < FACE[3]):
            f = 0.25 + 0.5 * lum  # dark hair everywhere except the face
            op[x, y] = (int(52 * f + 8), int(40 * f + 6), int(28 * f + 5))
        elif m in (CODE['skin'], CODE['head']):
            op[x, y] = (int(r * 1.02), int(g * 0.95), int(b * 0.86))

# ---- full beard on the face island (mouth v~537, chin v~595 @1024) ----
noise = Image.effect_noise((S, S), 26)
np_ = noise.load()
CX = 266
for y in range(450, 645):
    for x in range(165, 367):
        dx = (x - CX) / 92.0
        if abs(dx) > 1.0: continue
        boundary = 540 - 50 * dx * dx          # under the lips, high on the cheeks
        ell = ((x - CX) / 94.0) ** 2 + ((y - 548) / 82.0) ** 2
        mustache = 498 < y < 522 and abs(x - CX) < 37
        if (y > boundary and ell < 1.05) or mustache:
            n = np_[x, y] / 255.0
            op[x, y] = (int(9 + 20 * n), int(7 + 15 * n), int(6 + 11 * n))
od = ImageDraw.Draw(out)
for _ in range(2200):  # beard strands
    x = random.randrange(176, 356); y = random.randrange(470, 624)
    dx = (x - CX) / 92.0
    if abs(dx) <= 1.0 and y > 540 - 50 * dx * dx:
        od.line([(x, y), (x + random.randint(-1, 1), y + random.randint(3, 7))],
                fill=(30 + random.randint(0, 18), 24, 18), width=1)

# seam fill
blur = out.filter(ImageFilter.GaussianBlur(8))
bl = blur.load()
for y in range(S):
    for x in range(S):
        if mp[x, y] == 0:
            op[x, y] = bl[x, y]

out = out.filter(ImageFilter.UnsharpMask(radius=2, percent=60, threshold=2))
out.save(DST)
print('wrote', DST)
