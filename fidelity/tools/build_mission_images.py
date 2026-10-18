#!/usr/bin/env python3
"""Build per-mission SELECT images: a top-down aerial render of the mission's
own textured zone geometry (the paper topo maps in textures/ui/maps/ stay in
the briefing GPS where they belong).

For every zone GLB of the mission we rasterize its triangles from directly
above, sampling the embedded game textures with a height buffer, so the
picture is the mission as it really looks from the air.
Output: fidelity/textures/ui/missions/<mission>.jpg (960x600).
"""
import json, struct, os, sys, io
import numpy as np
from PIL import Image, ImageEnhance

ROOT = os.path.join(os.path.dirname(__file__), '..')
MISSIONS = json.load(open(os.path.join(ROOT, 'missions.json')))
RW, RH = 640, 400           # render res (upscaled to 960x600 at save)
OUT_W, OUT_H = 960, 600

def load_glb(path):
    d = open(path, 'rb').read()
    if d[:4] != b'glTF':
        return None, None
    ln = struct.unpack('<I', d[12:16])[0]
    js = json.loads(d[20:20 + ln])
    off = 20 + ln
    bln, _ = struct.unpack('<I4s', d[off:off + 8])
    return js, d[off + 8:off + 8 + bln]

def read_accessor(js, binchunk, ai):
    acc = js['accessors'][ai]
    bv = js['bufferViews'][acc['bufferView']]
    start = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
    stride = bv.get('byteStride')
    n = acc['count']
    dt = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8}[acc['componentType']]
    ncomp = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[acc['type']]
    if stride and stride != np.dtype(dt).itemsize * ncomp:
        arr = np.empty((n, ncomp), dtype=dt)
        for i in range(n):
            arr[i] = np.frombuffer(binchunk, dtype=dt, count=ncomp, offset=start + i * stride)
        return arr
    return np.frombuffer(binchunk, dtype=dt, count=n * ncomp, offset=start).reshape(n, ncomp)

def glb_images(js, binchunk):
    imgs = []
    for im in js.get('images', []):
        if 'bufferView' not in im:
            imgs.append(None); continue
        bv = js['bufferViews'][im['bufferView']]
        start = bv.get('byteOffset', 0)
        data = binchunk[start:start + bv['byteLength']]
        try:
            pil = Image.open(io.BytesIO(data)).convert('RGBA')
            imgs.append(np.asarray(pil).astype(np.float32))
        except Exception:
            imgs.append(None)
    return imgs

def prim_texture(js, imgs, prim):
    mi = prim.get('material')
    if mi is None:
        return None
    mat = js.get('materials', [])[mi]
    tex = (mat.get('pbrMetallicRoughness') or {}).get('baseColorTexture')
    if not tex:
        return None
    src = js['textures'][tex['index']].get('source')
    return imgs[src] if src is not None and src < len(imgs) else None

def render(mid):
    mdir = os.path.join(ROOT, 'models', mid)
    if not os.path.isdir(mdir):
        print(mid, 'no model dir'); return False
    # world layout exactly as the game builds it: every zone entry placed by
    # its props.json scene transform (identity for the baked SP terrain tiles)
    props = {}
    pj = os.path.join(mdir, 'props.json')
    if os.path.exists(pj):
        props = json.load(open(pj))
    scenes = props.get('scenes') or {}
    zones = props.get('zones') or []
    entries = []
    for zn in zones:
        f = zn.get('f'); m = zn.get('m')
        if not f:
            continue
        low = (f + ' ' + (m or '')).lower()
        if 'cave' in low or 'interior' in low or 'invisible' in low or 'blocking' in low:
            continue
        path = os.path.join(mdir, f + '.glb')
        if os.path.exists(path):
            entries.append((path, scenes.get(m)))
    if not entries:   # fallback: any sizeable baked geometry in the folder
        for f in sorted(os.listdir(mdir)):
            if f.endswith('.glb'):
                entries.append((os.path.join(mdir, f), None))
    prims = []
    allpos = []
    for path, tf in entries:
        js, binchunk = load_glb(path)
        if js is None:
            continue
        imgs = glb_images(js, binchunk)
        rot = None; trn = None
        if tf:
            cy, sy = np.cos(tf['yaw']), np.sin(tf['yaw'])
            rot = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]], dtype=np.float32)
            trn = np.array(tf['p'], dtype=np.float32)
        for mesh in js.get('meshes', []):
            for prim in mesh.get('primitives', []):
                pos = read_accessor(js, binchunk, prim['attributes']['POSITION']).astype(np.float32)
                if rot is not None:
                    pos = pos @ rot.T + trn
                uv = read_accessor(js, binchunk, prim['attributes']['TEXCOORD_0']).astype(np.float32) \
                    if 'TEXCOORD_0' in prim['attributes'] else None
                col = None
                if 'COLOR_0' in prim['attributes']:
                    c = read_accessor(js, binchunk, prim['attributes']['COLOR_0'])
                    col = c.astype(np.float32)
                    if col.max() > 1.01:
                        col = col / (65535.0 if c.dtype == np.uint16 else 255.0)
                    if col.shape[1] == 3:
                        col = np.concatenate([col, np.ones((len(col), 1), np.float32)], axis=1)
                if 'indices' in prim:
                    idx = read_accessor(js, binchunk, prim['indices']).reshape(-1).astype(np.int64)
                else:
                    idx = np.arange(len(pos), dtype=np.int64)
                idx = idx[:len(idx) // 3 * 3].reshape(-1, 3)
                prims.append((pos, uv, col, idx, prim_texture(js, imgs, prim)))
                allpos.append(pos)
    if not prims:
        print(mid, 'no geometry'); return False
    v = np.concatenate(allpos)
    # robust framing: some missions carry backdrop/sky geometry thousands of
    # metres out -- centre on the vertex median and clip by distance from it
    med = np.median(v, axis=0)
    dist_xz = np.hypot(v[:, 0] - med[0], v[:, 2] - med[2])
    r = np.percentile(dist_xz, 97.5)
    lo = np.array([max(np.percentile(v[:, 0], 0.5), med[0] - r), np.percentile(v[:, 1], 0.2),
                   max(np.percentile(v[:, 2], 0.5), med[2] - r)], dtype=np.float64)
    hi = np.array([min(np.percentile(v[:, 0], 99.5), med[0] + r), np.percentile(v[:, 1], 99.8),
                   min(np.percentile(v[:, 2], 99.5), med[2] + r)], dtype=np.float64)
    sx = (RW - 24) / max(1.0, hi[0] - lo[0]); sz = (RH - 24) / max(1.0, hi[2] - lo[2])
    sc = min(sx, sz)
    ox = (RW - (hi[0] - lo[0]) * sc) / 2; oz = (RH - (hi[2] - lo[2]) * sc) / 2

    img = np.zeros((RH, RW, 3), np.float32)
    img[:, :] = (150, 122, 82)                       # desert surround
    hbuf = np.full((RH, RW), -1e9, np.float32)
    ntri = 0
    for pos, uv, col, idx, tex in prims:
        xs = (pos[:, 0] - lo[0]) * sc + ox
        zs = (pos[:, 2] - lo[2]) * sc + oz
        ys = pos[:, 1]
        th, tw = (tex.shape[0], tex.shape[1]) if tex is not None else (1, 1)
        for a, b, c in idx:
            x0, x1 = int(max(0, min(xs[a], xs[b], xs[c]))), int(min(RW - 1, max(xs[a], xs[b], xs[c]))) + 1
            z0, z1 = int(max(0, min(zs[a], zs[b], zs[c]))), int(min(RH - 1, max(zs[a], zs[b], zs[c]))) + 1
            if x1 <= x0 or z1 <= z0:
                continue
            gx, gz = np.meshgrid(np.arange(x0, x1), np.arange(z0, z1))
            d = (zs[b] - zs[c]) * (xs[a] - xs[c]) + (xs[c] - xs[b]) * (zs[a] - zs[c])
            if abs(d) < 1e-9:
                continue
            w0 = ((zs[b] - zs[c]) * (gx - xs[c]) + (xs[c] - xs[b]) * (gz - zs[c])) / d
            w1 = ((zs[c] - zs[a]) * (gx - xs[c]) + (xs[a] - xs[c]) * (gz - zs[c])) / d
            w2 = 1 - w0 - w1
            inside = (w0 >= -0.02) & (w1 >= -0.02) & (w2 >= -0.02)
            if not inside.any():
                continue
            h = w0 * ys[a] + w1 * ys[b] + w2 * ys[c]
            win = inside & (h > hbuf[z0:z1, x0:x1])
            if not win.any():
                continue
            if tex is not None and uv is not None:
                u = (w0 * uv[a, 0] + w1 * uv[b, 0] + w2 * uv[c, 0]) % 1.0
                vv = (w0 * uv[a, 1] + w1 * uv[b, 1] + w2 * uv[c, 1]) % 1.0
                tx = np.clip((u * tw).astype(np.int32), 0, tw - 1)
                ty = np.clip((vv * th).astype(np.int32), 0, th - 1)
                sample = tex[ty, tx]
                rgb = sample[:, :, :3]
                if col is not None:
                    vc = w0[:, :, None] * col[a, :3] + w1[:, :, None] * col[b, :3] + w2[:, :, None] * col[c, :3]
                    rgb = rgb * np.clip(vc, 0, 1.6)
                alpha = sample[:, :, 3] > 110
                win = win & alpha
                if not win.any():
                    continue
            else:
                shade = 0.55 + 0.45 * float(np.clip((ys[a] + ys[b] + ys[c]) / 3.0 / 30.0, 0, 1))
                rgb = np.zeros((z1 - z0, x1 - x0, 3), np.float32) + np.array([168, 142, 98]) * shade
            sub = img[z0:z1, x0:x1]
            sub[win] = rgb[win]
            img[z0:z1, x0:x1] = sub
            hb = hbuf[z0:z1, x0:x1]
            hb[win] = h[win]
            hbuf[z0:z1, x0:x1] = hb
            ntri += 1
    coverage = float((hbuf > -1e8).mean())
    if coverage < 0.05:
        # archive MP/training maps have no converted terrain geometry to fly
        # over yet -- use a graded crop of the cover art as keyart instead of
        # an empty desert (never the topo map; that belongs in the briefing)
        cover = Image.open(os.path.join(ROOT, 'textures', 'ui', 'menu_cover.jpg')).convert('RGB')
        k = abs(hash(mid)) % 3
        cw = cover.width // 2
        crop = cover.crop((k * cw // 2, 0, k * cw // 2 + cw, cover.height)).resize((OUT_W, OUT_H), Image.LANCZOS)
        crop = ImageEnhance.Color(crop).enhance(0.92)
        crop = ImageEnhance.Brightness(crop).enhance(0.94)
        odir = os.path.join(ROOT, 'textures', 'ui', 'missions')
        os.makedirs(odir, exist_ok=True)
        crop.save(os.path.join(odir, mid + '.jpg'), quality=87)
        print(mid, 'keyart fallback (coverage %.3f)' % coverage)
        return True
    out = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).resize((OUT_W, OUT_H), Image.LANCZOS)
    if (hi[2] - lo[2]) > (hi[0] - lo[0]) * 1.1:
        # long north-south theatres: present the aerial side-on so the mission fills the frame
        out = out.transpose(Image.ROTATE_90)
        sc2 = max(OUT_W / out.width, OUT_H / out.height)
        out = out.resize((round(out.width * sc2), round(out.height * sc2)), Image.LANCZOS)
        x = (out.width - OUT_W) // 2; y = (out.height - OUT_H) // 2
        out = out.crop((x, y, x + OUT_W, y + OUT_H))
    out = ImageEnhance.Color(out).enhance(1.06)
    out = ImageEnhance.Contrast(out).enhance(1.04)
    odir = os.path.join(ROOT, 'textures', 'ui', 'missions')
    os.makedirs(odir, exist_ok=True)
    out.save(os.path.join(odir, mid + '.jpg'), quality=87)
    print(mid, 'ok', len(entries), 'entries,', ntri, 'tris drawn, coverage %.3f' % coverage)
    return True

if __name__ == '__main__':
    ids = [m['id'] for m in MISSIONS]
    if len(sys.argv) > 1:
        ids = sys.argv[1:]
    for mid in ids:
        render(mid)
