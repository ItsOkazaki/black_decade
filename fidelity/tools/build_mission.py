#!/usr/bin/env python3
"""Build a mission folder (Mission2, Mission3, ...) into fidelity/models/<lower>/.

Runs the env parsers, converts the zone scenes + placed props + interiors to
GLB with the ModKit converter, copies the briefing map, and registers the
mission in fidelity/missions.json (name from the decoded M##Strs brief title).

Usage: build_mission.py Mission2 [Mission3 ...]     (resumable: skips GLBs
that already exist). Run from anywhere; paths are resolved from this file.
"""
import glob
import json
import os
import re
import subprocess
import sys

TOOLS = os.path.dirname(os.path.abspath(__file__))
FID = os.path.dirname(TOOLS)
ROOT = os.path.dirname(FID)
MODKIT = '/tmp/modkit/cli/evo_convert.py'
ORDER = ['Mission1', 'Mission2', 'Mission3', 'Mission4', 'Mission5a', 'Mission5b',
         'Mission6', 'Mission7', 'Mission8', 'Mission9', 'Mission10',
         'Mission11a', 'Mission11b', 'Mission12a', 'Mission12b']


def evo_index(dirs):
    idx = {}
    for d in dirs:
        if not os.path.isdir(d):
            continue
        for f in os.listdir(d):
            if f.lower().endswith('.evo'):
                idx[f[:-4].upper()] = os.path.join(d, f)
    return idx


def convert(src, dst):
    if os.path.exists(dst):
        return True
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    r = subprocess.run([sys.executable, MODKIT, src, '-o', dst],
                       capture_output=True, text=True)
    return os.path.exists(dst)


def brief_name(mdir):
    for f in glob.glob(os.path.join(FID, 'decoded', 'loc', mdir, 'M*Strs.loc.json')):
        try:
            d = json.load(open(f))
        except Exception:
            continue
        for k, v in (d.get('strings') or {}).items():
            if k.endswith('_BRF_HD'):
                en = (v or {}).get('English', '')
                if en and '_' not in en and len(en) > 2:
                    return en.title()
    return ''


def build(mdir):
    src_dir = os.path.join(ROOT, mdir)
    lower = mdir.lower()
    out = os.path.join(FID, 'models', lower)
    os.makedirs(os.path.join(out, 'props'), exist_ok=True)
    envs = glob.glob(os.path.join(src_dir, '*.env'))
    if not envs:
        print(f'[{mdir}] no .env — skipped', flush=True)
        return
    env = envs[0]
    skies = glob.glob(os.path.join(src_dir, '*.sky'))
    sky = skies[0] if skies else env
    subprocess.run([sys.executable, os.path.join(TOOLS, 'parse_env.py'), env,
                    os.path.join(out, 'units.json')], capture_output=True, text=True)
    subprocess.run([sys.executable, os.path.join(TOOLS, 'parse_props.py'), env, sky,
                    os.path.join(out, 'props.json')], capture_output=True, text=True)
    props = json.load(open(os.path.join(out, 'props.json')))
    idx = evo_index([src_dir, os.path.join(ROOT, 'FrontEnd'), os.path.join(ROOT, 'Chardata')])

    # zone scenes: ENVI scene nodes whose model is a ZONE scene with an EVO
    zones = []
    for model in props.get('scenes', {}):
        # every ENVI scene node with its own EVO is a placed scene (terrain
        # zones hold terrain only; buildings/bridges/patches are scenes too)
        if 'INTERIOR' in model or re.search(r'HERO|Bradley|RAMIREZ|JONES|Foley|IRAQ|BLACKHAWK|A10_', model, re.I):
            continue
        src = idx.get(model.upper())
        if not src:
            continue
        base = os.path.basename(src)[:-4]
        if convert(src, os.path.join(out, base + '.glb')):
            zones.append({'f': base, 'm': model})
    props['zones'] = zones

    # placed props + interiors + vehicles
    want = sorted(set(s['m'] for s in props['statics']))
    want += sorted(set(i['m'] for i in props['interiors']))
    want += ['BLACKHAWK_UH60', 'A10_SMALL']
    ok = 0
    for m in want:
        src = idx.get(m.upper())
        if src and convert(src, os.path.join(out, 'props', m + '.glb')):
            ok += 1
    json.dump(props, open(os.path.join(out, 'props.json'), 'w'))

    # briefing map
    maps = glob.glob(os.path.join(src_dir, 'GWMission*.png'))
    if maps:
        os.makedirs(os.path.join(FID, 'textures', 'ui', 'maps'), exist_ok=True)
        dst = os.path.join(FID, 'textures', 'ui', 'maps', lower + '.png')
        if not os.path.exists(dst):
            with open(maps[0], 'rb') as a, open(dst, 'wb') as b:
                b.write(a.read())

    # register in missions.json
    mj = os.path.join(FID, 'missions.json')
    lst = json.load(open(mj)) if os.path.exists(mj) else []
    lst = [e for e in lst if e['id'] != lower]
    hd = brief_name(mdir)
    num = mdir.replace('Mission', '')
    disp = f'MISSION {num.upper()}' + (f' — {hd}' if hd else '')
    lst.append({'id': lower, 'name': disp})
    lst.sort(key=lambda e: ORDER.index(next(o for o in ORDER if o.lower() == e['id'])))
    json.dump(lst, open(mj, 'w'), indent=1)
    units = json.load(open(os.path.join(out, 'units.json')))
    print(f'[{mdir}] zones={len(zones)} props={ok}/{len(want)} '
          f'enemies={len(units.get("enemies", []))} name={disp}', flush=True)


if __name__ == '__main__':
    for m in sys.argv[1:]:
        try:
            build(m)
        except Exception as e:
            print(f'[{m}] FAILED: {e}', flush=True)
    print('BUILD DONE', flush=True)
