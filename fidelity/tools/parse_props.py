#!/usr/bin/env python3
"""Parse ALL HLOI placements from Mission1.env -> props.json for the web build.

Unlike parse_env.py (units only), this extracts every placed object:
crates, barrels, tents, the big bridge, gates, trucks, the MiG, BlackHawks,
plus interior scene roots, Foley's exact prison-hut position and sky colours.

Usage: parse_props.py <Mission1.env> <Mid_Day_Sunny.sky> <out.json>
Coords: three.js (x/100, y/100, -z/100), yaw = -rotY.
"""
import json
import re
import sys

env = open(sys.argv[1], encoding='latin-1').read().splitlines()
sky_txt = open(sys.argv[2], encoding='latin-1').read()

HLOI_RE = re.compile(r'"([A-Z0-9_]+)"\s+"[^"]*"\s+"NOTEXTURE"\s+'
                     r'(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+'
                     r'(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)')
VEHICLES = {'BLACKHAWK_UH60': 'hawk', 'A10_SMALL': 'a10'}
HEROES = {'Bradley', 'RAMIREZ', 'JONES', 'Foley'}


def e2j(x, y, z):
    return [round(x / 100, 2), round(y / 100, 2), round(-z / 100, 2)]


statics, vehicles, Foley, enemies = [], {'hawk': [], 'a10': []}, None, []
for ln in env:
    if not ln.startswith('HLOI'):
        continue
    m = HLOI_RE.search(ln)
    if not m:
        continue
    model = m.group(1)
    x, y, z, rx, ry, rz = map(float, m.groups()[1:])
    rest = ln[m.end():]
    unit_m = re.search(r'\s\d+\s-?\d+\s\d+\s"([^"]*)"', rest)
    unit = unit_m.group(1) if unit_m else ''
    inst = ''
    if unit_m:
        im = re.search(r'\s\d+\s-?\d+\s"([^"]*)"', rest[unit_m.end():])
        inst = im.group(1) if im else ''
    pos, yaw = e2j(x, y, z), round(-ry * 3.14159265 / 180, 3)
    if unit == 'Foley' and Foley is None:
        Foley = pos
    if inst.startswith('CS_'):
        continue  # cutscene-only instances (handled separately later)
    if unit.startswith('Iraqi_') or model.startswith('IRAQ'):
        enemies.append({'inst': inst, 'pos': pos, 'yaw': yaw})
    elif unit in HEROES:
        continue
    elif model in VEHICLES:
        vehicles[VEHICLES[model]].append({'pos': pos, 'yaw': yaw})
    else:
        statics.append({'m': model, 'p': [pos[0], pos[2]], 'y': pos[1], 'yaw': yaw})

interiors = []
for ln in env:
    if ln.startswith('ENVI') and '"Root"' in ln and 'INTERIOR' in ln:
        m = re.search(r'"([A-Z0-9_]+)"\s+"NOTEXTURE"\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)', ln)
        if m:
            interiors.append({'m': m.group(1), 'p': e2j(float(m.group(2)), float(m.group(3)), float(m.group(4)))})


def skycol(tag, idx):
    rows = re.findall(tag + r'\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)', sky_txt)
    return [round(float(v), 3) for v in rows[idx]] if len(rows) > idx else None


out = {
    'statics': statics,
    'vehicles': vehicles,
    'interiors': interiors,
    'Foley': Foley,
    'enemiesHLOI': enemies,
    'sky': {'fog': skycol('FOGCOL', 2), 'sunDif': skycol('SUNDIFCOL', 2),
            'sunAmb': skycol('SUNAMBCOL', 2)},
}
with open(sys.argv[3], 'w') as fh:
    json.dump(out, fh)
print(f"statics={len(statics)} unique={len(set(s['m'] for s in statics))} "
      f"hawk={len(vehicles['hawk'])} a10={len(vehicles['a10'])} "
      f"interiors={len(interiors)} Foley={Foley} enemiesHLOI={len(enemies)}")
print('unique static models:', sorted(set(s['m'] for s in statics)))
