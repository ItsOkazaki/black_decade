#!/usr/bin/env python3
"""Build the MP missions + extra training levels from the raw .dat archives.

The archives (mp_mission2-6.dat, training2-3.dat — commit "more", each
with its .sch) unpack to numbered payloads (tools/dat_extract.py).
Exactly one payload per archive is the mission ENV: a full text scene
(ENVI scene graph + HLOI placements + NEWENVWAYPT chains + REGN
triggers), the same dialect as the loose MissionN/*.env files, so the
stock parsers build it unchanged.

MP/training envs carry no single-player hero/enemy HLOI cast, so the
spawn falls back to the first patrol waypoint and the maps play as
skirmish/exploration with the full squad (ELIMINATE -> EXTRACTION generic
objectives in play.js). Zone/prop geometry resolves against the unpacked
mission folders at the repo root — the archives hold no loose .evo
models. The archive's 800x600 loading BMP becomes the briefing map and
the map registers in fidelity/missions.json.

Usage: python3 fidelity/tools/build_mp_missions.py [mpmission2 ...]
Data stays in /tmp (never committed). Requires /tmp/modkit.
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

MAPS = {
    'mpmission2': ('mp_mission2.dat', 'MP MISSION 2 — BUNKER'),
    'mpmission3': ('mp_mission3.dat', 'MP MISSION 3'),
    'mpmission4': ('mp_mission4.dat', 'MP MISSION 4 — HOUSE'),
    'mpmission5': ('mp_mission5.dat', 'MP MISSION 5 — OFFICE'),
    'mpmission6': ('mp_mission6.dat', 'MP MISSION 6'),
    'training2': ('training2.dat', 'TRAINING 2'),
    'training3': ('training3.dat', 'TRAINING 3'),
}


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
    subprocess.run([sys.executable, MODKIT, src, '-o', dst],
                   capture_output=True, text=True)
    return os.path.exists(dst)


def payload_dir(arc):
    xdir = '/tmp/dx/' + arc[:-4] + '_x'
    if not os.path.isdir(xdir):
        subprocess.run([sys.executable, os.path.join(TOOLS, 'dat_extract.py'),
                        os.path.join(ROOT, arc)], check=True)
    return xdir


def build(lower):
    arc, disp = MAPS[lower]
    xdir = payload_dir(arc)
    out = os.path.join(FID, 'models', lower)
    os.makedirs(os.path.join(out, 'props'), exist_ok=True)
    envs = [f for f in os.listdir(xdir) if f.endswith('.evo')]
    env_path = os.path.join(xdir, max(envs, key=lambda f: os.path.getsize(os.path.join(xdir, f))))
    sky = os.path.join(ROOT, 'Mission1', 'Mid_Day_Sunny.sky')
    subprocess.run([sys.executable, os.path.join(TOOLS, 'parse_env.py'), env_path,
                    os.path.join(out, 'units.json')], capture_output=True, text=True)
    subprocess.run([sys.executable, os.path.join(TOOLS, 'parse_props.py'), env_path, sky,
                    os.path.join(out, 'props.json')], capture_output=True, text=True)
    lib = evo_index([os.path.join(ROOT, d) for d in os.listdir(ROOT)
                     if os.path.isdir(os.path.join(ROOT, d)) and not d.startswith('.')])
    props = json.load(open(os.path.join(out, 'props.json')))
    zones = []
    for model in props.get('scenes', {}):
        if 'INTERIOR' in model or re.search(r'INVISIBLE|BLOCKING|BLOCKER', model, re.I):
            continue
        if re.search(r'HERO|Bradley|RAMIREZ|JONES|Foley|IRAQ|BLACKHAWK|A10_', model, re.I):
            continue
        src = lib.get(model.upper())
        if not src:
            continue
        base = os.path.basename(src)[:-4]
        if convert(src, os.path.join(out, base + '.glb')):
            zones.append({'f': base, 'm': model})
    props['zones'] = zones
    want = sorted(set(s['m'] for s in props['statics']))
    want += sorted(set(i['m'] for i in props['interiors']))
    want += ['BLACKHAWK_UH60', 'A10_SMALL']
    ok = 0
    for m in want:
        src = lib.get(m.upper())
        if src and convert(src, os.path.join(out, 'props', m + '.glb')):
            ok += 1
    json.dump(props, open(os.path.join(out, 'props.json'), 'w'))

    # spawn fallback: first patrol waypoint (MP envs have no SP cast)
    u = json.load(open(os.path.join(out, 'units.json')))
    wps = sorted(u.get('waypoints', []), key=lambda w: w['id'])
    if not u.get('start') and wps:
        u['start'] = {'name': 'Bradley', 'model': 'HERO01_ARMSTRONG',
                      'pos': wps[0]['pos'], 'yaw': 0.0,
                      'weapons': ['US_WPN_M16'], 'gear': [], 'inst': 'MP_SPAWN'}
        json.dump(u, open(os.path.join(out, 'units.json'), 'w'), indent=1)

    # briefing map from the archive loading screen
    bmps = glob.glob(os.path.join(xdir, '*.bmp'))
    if bmps:
        from PIL import Image
        os.makedirs(os.path.join(FID, 'textures', 'ui', 'maps'), exist_ok=True)
        Image.open(bmps[0]).save(os.path.join(FID, 'textures', 'ui', 'maps', lower + '.png'))

    mj = os.path.join(FID, 'missions.json')
    lst = json.load(open(mj))
    lst = [e for e in lst if e['id'] != lower] + [{'id': lower, 'name': disp}]
    json.dump(lst, open(mj, 'w'), indent=1)
    print(f'[{lower}] zones={len(zones)} props={ok}/{len(want)} start={bool(u.get("start"))}', flush=True)


if __name__ == '__main__':
    for lower in (sys.argv[1:] or list(MAPS)):
        try:
            build(lower)
        except Exception as e:
            print(f'[{lower}] FAILED: {e}', flush=True)
    print('MP BUILD DONE', flush=True)
