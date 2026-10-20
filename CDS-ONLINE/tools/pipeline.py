#!/usr/bin/env python3
"""P1 — owned asset pipeline. Converts the original game's files (src-extract/)
into the new project's assets (game/assets/, game/data/) with a provenance
manifest. Nothing is read from either failed build."""
import csv, glob, hashlib, io, json, os, re, struct, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

ROOT = '/home/user/cds-og'
GAME = os.path.join(ROOT, 'game')
MODKIT = '/tmp/modkit/cli'
CATALOG = '/home/user/black_decade/Catalog'
manifest = []

def sha(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()[:12]

def note(out, src, tool):
    manifest.append({'out': os.path.relpath(out, GAME), 'src': src, 'sha': sha(out) if os.path.exists(out) else None, 'tool': tool})
    print('  ', os.path.relpath(out, GAME), '<-', src)

def run(cmd, **kw):
    r = subprocess.run(cmd, capture_output=True, text=True, **kw)
    if r.returncode != 0:
        print('FAILED:', ' '.join(cmd), '\n', (r.stdout + r.stderr)[-400:])
    return r

# ---------------------------------------------------------------- tables
def parse_csv_table(path):
    rows = []
    with open(path, newline='', encoding='utf-8', errors='replace') as f:
        for row in csv.reader(f):
            if not row or not row[0].strip() or row[0].strip().startswith(('#', 'RANGE')):
                continue
            rows.append([c.strip() for c in row])
    return rows

def nums(cells):
    out = []
    for c in cells:
        try: out.append(float(c))
        except ValueError: pass
    return out

def tables():
    print('== tables -> game/data/tables/')
    outdir = os.path.join(GAME, 'data', 'tables'); os.makedirs(outdir, exist_ok=True)
    def find(name):
        g = glob.glob(os.path.join(CATALOG, f'*. {name}.txt')) or glob.glob(os.path.join(CATALOG, f'*{name}.txt'))
        return g[0] if g else None
    # weapons: full schema from the verified column layout
    wrows = parse_csv_table(find('Weaps'))
    weapons = []
    for r in wrows:
        if len(r) < 60: continue
        weapons.append({'id': r[0], 'model': r[1], 'icon': r[4], 'wclass': r[5],
                        'interval': float(r[10]), 'mag': int(float(r[15])), 'reload': float(r[16]),
                        'damage': float(r[22]), 'range': float(r[23]), 'fireOnMove': r[25] == 'YES',
                        'aimAnim': r[53], 'reloadAnim': r[54], 'proneAim': r[56], 'proneReload': r[57],
                        'bank': r[63], 'raw': r})
    json.dump(weapons, open(os.path.join(outdir, 'weapons.json'), 'w'))
    m16 = next(w for w in weapons if w['id'] == 'US_WPN_M16A2')
    assert (m16['damage'], m16['mag'], m16['range']) == (14, 30, 900.0), m16
    note(os.path.join(outdir, 'weapons.json'), 'Catalog/0071. Weaps.txt', 'pipeline.py csv schema')
    # humans / vehicles: name + ordered numerics (semantics per R3 disassembly later)
    for name, key in [('HStat', 'humans'), ('VStat', 'vehicles')]:
        rows = parse_csv_table(find(name))
        data = [{'name': r[0], 'numbers': nums(r[1:]), 'raw': r} for r in rows if r]
        json.dump(data, open(os.path.join(outdir, key + '.json'), 'w'))
        print(f'   {key}: {len(data)} rows; first numeric = health/hull (loader-pinned)')
        note(os.path.join(outdir, key + '.json'), f'Catalog/{name}.txt', 'pipeline.py csv')
    # units roster
    rows = parse_csv_table(find('Units'))
    units = [{'name': r[0], 'type': r[1], 'model': r[2], 'hstat': r[4], 'score': int(float(r[8])),
              'experience': r[9], 'voiceBank': r[10], 'role': r[11], 'skin': r[12], 'raw': r}
             for r in rows if len(r) > 12]
    json.dump(units, open(os.path.join(outdir, 'units.json'), 'w'))
    heroes = [u['name'] for u in units[:4]]
    print('   roster head:', heroes)
    assert heroes == ['Bradley', 'Ramirez', 'Jones', 'Foley'], heroes
    note(os.path.join(outdir, 'units.json'), 'Catalog/0096. Units.txt', 'pipeline.py csv')
    # remaining tables as generic cell dumps (parsed on demand by later phases)
    for name in ['Inven', 'featStat', 'Structs', 'Feats', 'Doors', 'Targets', 'Switches', 'UnitWpns', 'ExMods']:
        p = find(name)
        if not p: continue
        rows = parse_csv_table(p)
        json.dump([{'id': r[0], 'cells': r} for r in rows if r], open(os.path.join(outdir, name.lower() + '.json'), 'w'))
        print(f'   {name}: {len(rows)} rows')
    # the original state machines, verbatim, as executable data later
    for name in ['MovementStateRules', 'UpperBodyStateRules', 'VehicleStateRules']:
        p = find(name)
        if p:
            txt = open(p, encoding='utf-8', errors='replace').read()
            json.dump({'source': os.path.basename(p), 'text': txt}, open(os.path.join(outdir, name.lower() + '.json'), 'w'))
            print(f'   {name}: {len(txt)} chars captured verbatim')

# ---------------------------------------------------------------- models
def convert(paths, outdir, anims=False, workers=1):
    os.makedirs(outdir, exist_ok=True)
    def one(p):
        pre = os.path.join(outdir, os.path.splitext(os.path.basename(p))[0] + '.glb')
        if os.path.exists(pre): return pre
        cmd = ['python3', os.path.join(MODKIT, 'evo_convert.py'), p, '-o', outdir]
        if anims: cmd.append('--anims')
        r = run(cmd)
        out = os.path.join(outdir, os.path.splitext(os.path.basename(p))[0] + '.glb')
        return out if os.path.exists(out) else None
    if workers > 1:
        with ThreadPoolExecutor(workers) as ex:
            return [x for x in ex.map(one, paths) if x]
    return [x for x in (one(p) for p in paths) if x]

def models():
    print('== EVO -> GLB')
    ex = os.path.join(ROOT, 'src-extract')
    heroes = [f'{ex}/frontend/HERO0{i}_{n}.EVO' for i, n in [(1, 'ARMSTRONG'), (2, 'RAMIREZ'), (3, 'JONES'), (4, 'FOLEY')]]
    iraq = sorted(glob.glob(f'{ex}/frontend/IRAQ*.EVO')) + sorted(glob.glob(f'{ex}/frontend/IR_*.EVO'))
    out = convert(heroes + iraq, os.path.join(GAME, 'assets', 'models', 'characters'), anims=True)
    print(f'   characters: {len(out)} (with full PRB animation sets)')
    for o in out: note(o, 'frontend.dat EVO+PRB', 'evo_convert.py --anims')
    gear = sorted(glob.glob(f'{ex}/chardata/*.EVO'))
    out = convert(gear, os.path.join(GAME, 'assets', 'models', 'gear'))
    print(f'   chardata gear/props: {len(out)}')
    m1 = sorted(glob.glob(f'{ex}/mission1/*.EVO'))
    out = convert(m1, os.path.join(GAME, 'assets', 'models', 'mission1'), workers=4)
    print(f'   mission1 EVOs: {len(out)}')
    fe = [p for p in sorted(glob.glob(f'{ex}/frontend/*.EVO')) if p not in heroes and p not in iraq]
    out = convert(fe, os.path.join(GAME, 'assets', 'models', 'frontend'), workers=4)
    print(f'   frontend EVOs (vehicles/menu props): {len(out)}')
    model_index()

def model_index():
    """Case-correct list of every shipped GLB. The sim refuses URLs that are
    not in it, so ENV zone-children (meshes inside the parent zone GLB) never
    become hundreds of 404s on deploy."""
    urls = []
    for root, dirs, files in os.walk(os.path.join(GAME, 'assets')):
        for f in files:
            if f.lower().endswith('.glb'):
                urls.append(os.path.relpath(os.path.join(root, f), GAME).replace(chr(92), '/'))
    urls.sort()
    os.makedirs(os.path.join(GAME, 'data'), exist_ok=True)
    json.dump(urls, open(os.path.join(GAME, 'data', 'model-index.json'), 'w'))
    print(f'   model index: {len(urls)} glbs')

# ---------------------------------------------------------------- UI art
def img_banks():
    print('== .img banks (imgf) -> sprites')
    try:
        from PIL import Image
    except ImportError:
        run([sys.executable, '-m', 'pip', 'install', '--user', '--break-system-packages', 'pillow'])
        from PIL import Image
    catdir = os.path.join(ROOT, 'src-extract', 'catalog')
    for img in sorted(glob.glob(os.path.join(catdir, '*.IMG'))):
        bank = os.path.splitext(os.path.basename(img))[0].lower()
        data = open(img, 'rb').read()
        assert data[:4] == b'imgf', img
        count = struct.unpack('<H', data[6:8])[0]
        pages = []
        off = 12
        while off < 284:
            name = data[off:off + 16].split(b'\x00')[0].decode('ascii', 'replace')
            if name.lower().endswith('.png'): pages.append(name)
            off += 16
        disk = {f.lower(): os.path.join(catdir, f) for f in os.listdir(catdir)}
        page_imgs = []
        for pn in pages:
            pp = disk.get(pn.lower())
            page_imgs.append(Image.open(pp).convert('RGBA') if pp else None)
        outdir = os.path.join(GAME, 'assets', 'ui', bank); os.makedirs(outdir, exist_ok=True)
        index = {}
        for i in range(count):
            rec = 284 + i * 272
            page = struct.unpack('<H', data[rec:rec + 2])[0]
            name = data[rec + 2:rec + 66].split(b'\x00')[0].decode('ascii', 'replace')
            x, y, w, h = struct.unpack('<4H', data[rec + 260:rec + 268])
            if not name or page >= len(page_imgs) or page_imgs[page] is None or w == 0 or h == 0: continue
            crop = page_imgs[page].crop((x, y, x + w, y + h))
            fn = name + '.png'
            crop.save(os.path.join(outdir, fn))
            index[name] = {'file': fn, 'w': w, 'h': h, 'page': page}
        json.dump(index, open(os.path.join(outdir, 'index.json'), 'w'))
        print(f'   {bank}: {len(index)} sprites from {len(pages)} pages')
        note(os.path.join(outdir, 'index.json'), f'catalog.dat {os.path.basename(img)}', 'pipeline.py imgf')

def ui_art():
    print('== frontend/catalog PNG extraction')
    staging = os.path.join(ROOT, 'staging-ui')
    run(['python3', os.path.join(MODKIT, 'ds_extract.py'), '-g', '/home/user/black_decade', '-o', staging, 'frontend', 'catalog'])
    outdir = os.path.join(GAME, 'assets', 'ui', 'bitmaps'); os.makedirs(outdir, exist_ok=True)
    picked = 0
    for p in glob.glob(os.path.join(staging, '**', '*.png'), recursive=True) + glob.glob(os.path.join(staging, '**', '*.PNG'), recursive=True) + glob.glob(os.path.join(staging, '**', '*.BMP'), recursive=True):
        if p.lower().endswith('.bmp'):
            try:
                from PIL import Image
                dst0 = os.path.join(outdir, os.path.splitext(os.path.basename(p))[0] + '.png')
                if not os.path.exists(dst0): Image.open(p).save(dst0)
            except Exception: pass
            continue
        b = os.path.basename(p)
        if b.startswith('_'): continue
        dst = os.path.join(outdir, b)
        if not os.path.exists(dst):
            import shutil; shutil.copy(p, dst); picked += 1
    print(f'   bitmaps copied: {picked}')
    names = sorted(os.listdir(outdir))
    hits = [n for n in names if any(k in n.upper() for k in ['DEFLOAD', 'MISS', 'TITLE', 'MENU', 'MAP'])]
    print('   key art found:', hits[:24])

def sounds():
    print('== sound banks + PSF music')
    r = run(['python3', os.path.join(MODKIT, 'ds_sound.py'), 'list', '/home/user/black_decade/frontend.sch'])
    hashes = []
    for line in (r.stdout or '').splitlines():
        parts = line.split()
        if len(parts) >= 2 and parts[0] == 'BANK': hashes.append(parts[1])
    sys.path.insert(0, '/tmp/modkit')
    from conflict_ds_tools.sound import elf_hash
    exe = open('/home/user/black_decade/DesertStorm.exe', 'rb').read()
    cands = set(re.findall(rb'[A-Za-z][A-Za-z0-9_]{2,34}', exe))
    import re as _re
    names = {}
    for c in cands:
        s = c.decode('ascii', 'replace')
        for suffix in ('.sbk', ''):
            if f'{elf_hash(s + suffix):08X}' in hashes: names[f'{elf_hash(s + suffix):08X}'] = s
    print(f'   frontend banks: {len(hashes)}, names recovered: {len(names)}', list(names.values())[:14])
    outbase = os.path.join(GAME, 'assets', 'sounds', 'frontend')
    for h, name in names.items():
        out = os.path.join(outbase, name)
        run(['python3', os.path.join(MODKIT, 'ds_sound.py'), 'wav', '/home/user/black_decade/frontend.sch', name, out])
    json.dump({'banks': hashes, 'names': names}, open(os.path.join(GAME, 'data', 'frontend-banks.json'), 'w'), indent=1)
    # PSF music: PSF\x80 streams decode with the ModKit; the six DS-* tracks
    # are PSF\x60 segment containers -> tools/musicrecover.py (R2, solved)
    mus_out = os.path.join(GAME, 'assets', 'music'); os.makedirs(mus_out, exist_ok=True)
    import wave, contextlib
    for psf in sorted(glob.glob('/home/user/black_decade/Data/Sound/*.psf')):
        name = os.path.splitext(os.path.basename(psf))[0]
        out = os.path.join(mus_out, name + '.wav')
        if open(psf, 'rb').read(4) == b'PSF\x60':
            import importlib.util
            spec = importlib.util.spec_from_file_location('musicrecover', os.path.join(ROOT, 'tools', 'musicrecover.py'))
            mr = importlib.util.module_from_spec(spec); spec.loader.exec_module(mr)
            n, secs = mr.recover(psf, out)
            if os.path.exists(out): note(out, f'Data/Sound/{os.path.basename(psf)}', 'musicrecover (PSF\x60 carve)')
            print(f'   music {name}: {n} segments, {secs:.1f}s (PSF\x60)')
            continue
        run(['python3', os.path.join(MODKIT, 'ds_sound.py'), 'stream', psf, out])
        if os.path.exists(out):
            with contextlib.closing(wave.open(out)) as w:
                frames = w.getnframes(); dur = frames / w.getframerate()
            print(f'   music {name}: {dur:.1f}s')
            note(out, f'Data/Sound/{os.path.basename(psf)}', 'ds_sound.py stream')

def default_key():
    # the game's own key config (repo-root default.key): ACTION,slot=DEVICE_KEY
    print('== default.key -> game/data/tables/defaultkey.json')
    binds = {}
    for line in open('/home/user/black_decade/default.key', encoding='utf-8', errors='replace'):
        line = line.strip()
        if not line or '=' not in line: continue
        lhs, tok = line.split('=', 1)
        if ',' not in lhs: continue
        act, slot = lhs.rsplit(',', 1)
        binds.setdefault(act, []).append(tok)
    outdir = os.path.join(GAME, 'data', 'tables'); os.makedirs(outdir, exist_ok=True)
    json.dump(binds, open(os.path.join(outdir, 'defaultkey.json'), 'w'), indent=1)
    note(os.path.join(outdir, 'defaultkey.json'), 'black_decade/default.key', 'pipeline.default_key')
    print(f'   {len(binds)} actions')

def loc_copy():
    print('== loc strings -> game/data/loc')
    import shutil
    dst = os.path.join(GAME, 'data', 'loc'); os.makedirs(dst, exist_ok=True)
    n = 0
    for p in glob.glob(os.path.join(ROOT, 'data', 'loc', '*.json')):
        shutil.copy(p, dst); n += 1
    print(f'   {n} loc files')

if __name__ == '__main__':
    os.makedirs(os.path.join(GAME, 'data'), exist_ok=True)
    tables(); default_key(); models(); img_banks(); ui_art(); sounds(); loc_copy()
    json.dump(manifest, open(os.path.join(GAME, 'data', 'manifest.json'), 'w'), indent=1)
    print(f'\nP1 pipeline done: manifest {len(manifest)} entries')
