#!/usr/bin/env python3
"""Bake the IDLE_LOOK_AROUND_WITH_GUN first frame into every data-placed
humanoid static (they otherwise render in bind-pose T-pose). Vehicle crew
with authored bind poses (Blackhawk crew, Abrams commander) and animals
are left alone."""
import struct, json, os, re, sys

ROOT = '/home/user/black_decade/fidelity/models'
SKIP = re.compile(r'^(GOAT\d*|BLACKHAWK_COPILOT|BLACKHAWK_GUNNER|M1ABRAMSCOMMANDER)$')

def load(p):
    d = open(p, 'rb').read()
    ln = struct.unpack('<I', d[12:16])[0]
    j = json.loads(d[20:20 + ln])
    off = 20 + ln
    bln = struct.unpack('<I', d[off:off + 4])[0]
    return j, d[off + 8:off + 8 + bln], d

def save(p, j, binc):
    jb = json.dumps(j, separators=(',', ':')).encode()
    jb += b' ' * ((4 - len(jb) % 4) % 4)
    total = 12 + 8 + len(jb) + 8 + len(binc)
    out = b'glTF' + struct.pack('<II', 2, total)
    out += struct.pack('<I', len(jb)) + b'JSON' + jb
    out += struct.pack('<I', len(binc)) + b'BIN\x00' + binc
    open(p, 'wb').write(out)

dj, db, _ = load('/home/user/black_decade/fidelity/models/Hero01_Armstrong_anim.glb')
clip = next(a for a in dj['animations'] if a.get('name') == 'IDLE_LOOK_AROUND_WITH_GUN')
donor_names = [n.get('name') for n in dj['nodes']]

def acc_data(ai):
    a = dj['accessors'][ai]
    bv = dj['bufferViews'][a['bufferView']]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    ncomp = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4}[a['type']]
    fmt = '<' + 'f' * ncomp
    return [struct.unpack_from(fmt, db, off + i * 4 * ncomp) for i in range(a['count'])]

targets = []   # (node name, path, first-frame value)
for ch in clip['channels']:
    s = clip['samplers'][ch['sampler']]
    targets.append((donor_names[ch['target']['node']], ch['target']['path'], acc_data(s['output'])[0]))

done, weak = [], []
for mid in sorted(os.listdir(ROOT)):
    pp = os.path.join(ROOT, mid, 'props.json')
    if not os.path.exists(pp): continue
    p = json.load(open(pp))
    for name in sorted({s['m'] for s in p.get('statics', [])}):
        if SKIP.match(name): continue
        fp = os.path.join(ROOT, mid, 'props', name + '.glb')
        if not os.path.exists(fp): continue
        j, binc, _ = load(fp)
        if not j.get('skins'): continue
        by_name = {n.get('name'): n for n in j['nodes']}
        posed = 0
        for nm, path, v in targets:
            node = by_name.get(nm)
            if node is None: continue
            node[path] = list(v)
            posed += 1
        j.pop('animations', None)
        save(fp, j, binc)
        (done if posed >= 30 else weak).append(f'{mid}/{name} ({posed})')
print('BAKED', len(done))
for w in weak: print('WEAK (few channels matched):', w)
