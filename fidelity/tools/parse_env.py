#!/usr/bin/env python3
"""Parse Mission1.env (CDS scene file, text) -> units.json for the web build.

Extracts, in three.js coords (x, y, z=-envZ, metres, yaw rad):
  heroes[]   : first non-cutscene HLOI per hero (Bradley/Connors as Ramirez/Jones/Foley)
  enemies[]  : Iraqi_* HLOI (model IRAQINFANTRY01_SANDY etc.) with per-man
               face/hat prop names + first weapon
  waypoints[]: NEWENVWAYPT chains {id,name,x,y,z,next}
  triggers[] : named REGN spheres/boxes (objectives/extraction)
"""
import re, json, sys

txt = open(sys.argv[1], encoding='latin-1').read()
lines = txt.splitlines()

def env2js(x, y, z):
    return [round(x / 100, 2), round(y / 100, 2), round(-z / 100, 2)]

heroes_want = {'"Bradley"': 'Bradley', '"Ramirez"': 'Connors', '"Jones"': 'Jones', '"Foley"': 'Foley'}
heroes, enemies, waypoints, triggers = {}, [], [], []
seen_inst = set()
for ln in lines:
    if ln.startswith('HLOI'):
        m = re.search(r'"([A-Z0-9_]+)"\s+"[^"]*"\s+"NOTEXTURE"\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)', ln)
        if not m:
            continue
        model, x, y, z, rx, ry, rz = m.group(1), *map(float, m.groups()[1:])
        rest = ln[m.end():]
        unit_m = re.search(r'"(Iraqi_[A-Za-z_]+|[A-Z][a-z]+)"', rest)
        inst_m = re.search(r'\s+\d+\s+-?\d+\s+"([^"]+)"', rest[unit_m.end():]) if unit_m else None
        unit = unit_m.group(1) if unit_m else ''
        inst = inst_m.group(1) if inst_m else ''
        wpns = re.findall(r'"((?:US|IR)_WPN_[A-Za-z0-9_]+)"', rest)
        gear = re.findall(r'"(BIP01 [A-Z0-9]+ CONNECTOR)"\s+0\s+"([A-Z0-9_]+)"', rest)
        pos = env2js(x, y, z)
        yaw = -ry * 3.14159265 / 180.0
        if unit in ('Bradley', 'Ramirez', 'Jones', 'Foley') and not inst.startswith('CS_'):
            key = {'Ramirez': 'Connors'}.get(unit, unit)
            if key not in heroes:  # first live record wins
                heroes[key] = dict(name=key, model=model, pos=pos, yaw=round(yaw, 3),
                                   weapons=wpns, gear=[list(g) for g in gear], inst=inst)
        elif unit.startswith('Iraqi_') and model in ('IRAQINFANTRY01_SANDY','IRAQOFFICER01_SANDY','IRAQTORTURER','IRAQMECHANIC') and not inst.startswith('CS_'):
            if inst in seen_inst:
                continue
            seen_inst.add(inst)
            face = next((g[1] for g in gear if 'FACE' in g[0]), '')
            hat = next((g[1] for g in gear if 'HAT' in g[0]), '')
            enemies.append(dict(unit=unit, inst=inst, pos=pos, yaw=round(yaw, 3),
                                weapon=wpns[0] if wpns else 'IR_WPN_AK47', face=face, hat=hat))
    elif ln.startswith('NEWENVWAYPT'):
        m = re.match(r'NEWENVWAYPT\s+(\d+)\s+\d+\s+"([^"]+)"\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+\d+\s+(-?\d+)', ln)
        if m:
            wid, name = int(m.group(1)), m.group(2)
            x, y, z = float(m.group(3)), float(m.group(4)), float(m.group(5))
            waypoints.append(dict(id=wid, name=name, pos=env2js(x, y, z), next=int(m.group(9))))
    elif ln.startswith('REGN'):
        m = re.match(r'REGN\s+"([^"]+)"\s+(\d+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)', ln)
        if m:
            x, y, z, r = float(m.group(3)), float(m.group(4)), float(m.group(5)), float(m.group(6))
            triggers.append(dict(name=m.group(1), pos=env2js(x, y, z), r=round(r / 100, 1)))

out = dict(start=heroes.get('Bradley'),
           enemies=enemies, waypoints=waypoints, triggers=triggers)
json.dump(out, open(sys.argv[2], 'w'), indent=1)
print('start:', out['start'])
print('enemies:', len(enemies), 'waypoints:', len(waypoints), 'triggers:', len(triggers))
from collections import Counter
print(Counter(e['unit'] for e in enemies))
print('sample enemy:', enemies[0] if enemies else None)
