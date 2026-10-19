#!/usr/bin/env python3
"""CPU-skin the IDLE pose into the geometry of every data-placed humanoid
static, then strip the skeleton: the game's statics system bakes raw
geometry (no skinning), so the pose must live in the vertices themselves."""
import struct, json, os, re, math

ROOT = '/home/user/black_decade/fidelity/models'
SKIP = re.compile(r'^(GOAT\d*|BLACKHAWK_COPILOT|BLACKHAWK_GUNNER|M1ABRAMSCOMMANDER)$')

def load(p):
    d = open(p, 'rb').read()
    ln = struct.unpack('<I', d[12:16])[0]
    j = json.loads(d[20:20 + ln])
    off = 20 + ln
    bln = struct.unpack('<I', d[off:off + 4])[0]
    return j, bytearray(d[off + 8:off + 8 + bln])

def save(p, j, binc):
    jb = json.dumps(j, separators=(',', ':')).encode()
    jb += b' ' * ((4 - len(jb) % 4) % 4)
    total = 12 + 8 + len(jb) + 8 + len(binc)
    out = b'glTF' + struct.pack('<II', 2, total)
    out += struct.pack('<I', len(jb)) + b'JSON' + jb
    out += struct.pack('<I', len(binc)) + b'BIN\x00' + bytes(binc)
    open(p, 'wb').write(out)

# ---------- donor clip ----------
dj, db = load('/home/user/black_decade/fidelity/models/Hero01_Armstrong_anim.glb')
clip = next(a for a in dj['animations'] if a.get('name') == 'IDLE_LOOK_AROUND_WITH_GUN')
donor_names = [n.get('name') for n in dj['nodes']]

def dacc(ai):
    a = dj['accessors'][ai]
    bv = dj['bufferViews'][a['bufferView']]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    nc = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4}[a['type']]
    return [struct.unpack_from('<' + 'f' * nc, db, off + i * 4 * nc) for i in range(a['count'])]

targets = {}
for ch in clip['channels']:
    s = clip['samplers'][ch['sampler']]
    targets.setdefault(donor_names[ch['target']['node']], {})[ch['target']['path']] = dacc(s['output'])[0]

# ---------- matrix helpers (column-major, glTF order) ----------
def compose(t, q, s):
    x, y, z, w = q
    x2, y2, z2 = x + x, y + y, z + z
    xx, xy, xz = x * x2, x * y2, x * z2
    yy, yz, zz = y * y2, y * z2, z * z2
    wx, wy, wz = w * x2, w * y2, w * z2
    sx, sy, sz = s
    return [  # column-major
        (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
        (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
        (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
        t[0], t[1], t[2], 1]

def mul(a, b):   # a*b, column-major
    return [sum(a[k * 4 + r] * b[c * 4 + k] for k in range(4)) for c in range(4) for r in range(4)]

def xform(m, v):
    return [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
            m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
            m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]]

def xform_dir(m, v):
    return [m[0] * v[0] + m[4] * v[1] + m[8] * v[2],
            m[1] * v[0] + m[5] * v[1] + m[9] * v[2],
            m[2] * v[0] + m[6] * v[1] + m[10] * v[2]]

IDENT = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]

def process(fp):
    j, binc = load(fp)
    if not j.get('skins'): return 'no-skin'
    nodes = j['nodes']
    # 1. apply pose by name
    for n in nodes:
        t = targets.get(n.get('name'))
        if not t: continue
        n.pop('matrix', None)
        if 'translation' in t: n['translation'] = list(t['translation'])
        if 'rotation' in t: n['rotation'] = list(t['rotation'])
        if 'scale' in t: n['scale'] = list(t['scale'])
    # 2. world matrices
    parent = {}
    for i, n in enumerate(nodes):
        for c in n.get('children', []): parent[c] = i
    world = [None] * len(nodes)
    def get_world(i):
        if world[i] is not None: return world[i]
        n = nodes[i]
        if 'matrix' in n: local = list(n['matrix'])
        else: local = compose(n.get('translation', [0,0,0]), n.get('rotation', [0,0,0,1]), n.get('scale', [1,1,1]))
        world[i] = mul(get_world(parent[i]), local) if i in parent else local
        return world[i]
    for i in range(len(nodes)): get_world(i)
    # safety: no mesh node may be a descendant of a joint
    jointset = set()
    for sk in j['skins']: jointset.update(sk['joints'])
    mesh_nodes = {i for i, n in enumerate(nodes) if 'mesh' in n}
    for mn in mesh_nodes:
        p = mn
        while p in parent:
            p = parent[p]
            if p in jointset: return 'mesh-under-bone-SKIP'
    # 3. skin each skinned mesh
    def acc_view(ai):
        a = j['accessors'][ai]
        bv = j['bufferViews'][a['bufferView']]
        off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        nc = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[a['type']]
        ct = a['componentType']
        return a, off, nc, ct, bv.get('byteStride')
    def read_all(ai):
        a, off, nc, ct, stride = acc_view(ai)
        fmt = {5126: 'f', 5123: 'H', 5121: 'B'}[ct]
        sz = struct.calcsize(fmt)
        st = stride or sz * nc
        out = []
        for i in range(a['count']):
            out.append(struct.unpack_from('<' + fmt * nc, binc, off + i * st))
        return out
    for n in nodes:
        if 'mesh' not in n or 'skin' not in n: continue
        sk = j['skins'][n['skin']]
        joints = sk['joints']
        ibms = read_all(sk['inverseBindMatrices'])
        bone_mats = [mul(world[jt], list(ibms[k])) for k, jt in enumerate(joints)]
        mesh = j['meshes'][n['mesh']]
        for prim in mesh['primitives']:
            attrs = prim['attributes']
            if 'JOINTS_0' not in attrs: continue
            pos = read_all(attrs['POSITION'])
            nor = read_all(attrs['NORMAL']) if 'NORMAL' in attrs else None
            jts = read_all(attrs['JOINTS_0'])
            wts = read_all(attrs['WEIGHTS_0'])
            wct = j['accessors'][attrs['WEIGHTS_0']]['componentType']
            newpos, newnor = [], []
            for vi in range(len(pos)):
                w4 = [w / 255.0 for w in wts[vi]] if wct == 5121 else list(wts[vi])
                tot = sum(w4) or 1.0
                px = py = pz = nx = ny = nz = 0.0
                for k in range(4):
                    w = w4[k] / tot
                    if w == 0: continue
                    m = bone_mats[jts[vi][k]]
                    sp = xform(m, pos[vi]); px += w * sp[0]; py += w * sp[1]; pz += w * sp[2]
                    if nor:
                        sn = xform_dir(m, nor[vi]); nx += w * sn[0]; ny += w * sn[1]; nz += w * sn[2]
                newpos.append((px, py, pz))
                if nor:
                    ln = math.sqrt(nx*nx + ny*ny + nz*nz) or 1.0
                    newnor.append((nx/ln, ny/ln, nz/ln))
            a, off, nc, ct, stride = acc_view(attrs['POSITION'])
            st = stride or 12
            for i, v in enumerate(newpos): struct.pack_into('<3f', binc, off + i * st, *v)
            if nor:
                a, off, nc, ct, stride = acc_view(attrs['NORMAL'])
                st = stride or 12
                for i, v in enumerate(newnor): struct.pack_into('<3f', binc, off + i * st, *v)
            attrs.pop('JOINTS_0', None); attrs.pop('WEIGHTS_0', None)
    # 4. strip skeleton: identity bones, no skins/anims
    for i in jointset:
        for k in ('translation', 'rotation', 'scale', 'matrix'): nodes[i].pop(k, None)
    for n in nodes: n.pop('skin', None)
    j.pop('skins', None); j.pop('animations', None)
    save(fp, j, binc)
    return 'skinned'

done, skipped = [], []
for mid in sorted(os.listdir(ROOT)):
    pp = os.path.join(ROOT, mid, 'props.json')
    if not os.path.exists(pp): continue
    p = json.load(open(pp))
    for name in sorted({s['m'] for s in p.get('statics', [])}):
        if SKIP.match(name): continue
        fp = os.path.join(ROOT, mid, 'props', name + '.glb')
        if not os.path.exists(fp): continue
        j0, _ = load(fp)
        if not j0.get('skins'): continue
        r = process(fp)
        (done if r == 'skinned' else skipped).append(f'{mid}/{name}:{r}')
print('SKIN-BAKED', len(done))
for s in skipped: print('SKIPPED:', s)
