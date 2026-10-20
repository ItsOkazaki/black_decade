#!/usr/bin/env python3
"""Parse a mission .ENV (the original scene definition, plain text) into JSON.
Coordinates: ENV is centimetres, left-handed; we emit metres with z negated
and yaw = -ry (validated against known placements: Bradley start, the Foley)."""
import json, os, re, sys

QUOTED = re.compile(r'"([^"]*)"')

def floats(s):
    out = []
    for t in s.replace('\t', ' ').split():
        try: out.append(float(t))
        except ValueError: pass
    return out

def parse(path):
    instances, units, regions, wps, cameras, envsnd = [], [], [], [], [], []
    for line in open(path, encoding='utf-8', errors='replace'):
        line = line.strip('\r\n')
        if line.startswith('ENVI '):
            q = QUOTED.findall(line)
            rest = QUOTED.sub(' ', line)
            nums = floats(rest)
            # ENVI a b "inst" "parent" type "MODEL" "TEX" px py pz rx ry rz sx sy sz ...
            if len(q) >= 4 and len(nums) >= 12:
                instances.append({'inst': q[0], 'parent': q[1], 'model': q[2],
                                  'p': nums[3:6], 'r': nums[6:9], 's': nums[9:12]})
        elif line.startswith('HLOI '):
            q = QUOTED.findall(line)
            rest = QUOTED.sub(' ', line)
            nums = floats(rest)
            # HLOI id "MODEL" "parent" "TEX" px py pz rx ry rz ... "Unit" ... "SCRIPT" ...
            if len(q) >= 3 and len(nums) >= 7:
                u = {'model': q[0], 'parent': q[1],
                     'p': nums[1:4], 'r': nums[4:7],
                     'name': q[3] if len(q) > 3 else '', 'script': q[4] if len(q) > 4 else ''}
                units.append(u)
        elif line.startswith('NEWENVWAYPT '):
            q = QUOTED.findall(line)
            nums = floats(QUOTED.sub(' ', line))
            # NEWENVWAYPT id team "NAME" px py pz rx ry rz link next
            if q and len(nums) >= 9:
                wps.append({'id': int(nums[0]), 'name': q[0], 'p': nums[2:5],
                            'next': int(nums[-1]) if nums else -1})
        elif line.startswith('CAMFREE ') or line.startswith('CAMTARGOBJ '):
            q = QUOTED.findall(line)
            nums = floats(QUOTED.sub(' ', line))
            # CAMFREE "NAME" id flags "parent" px py pz pitch yaw roll ...
            # CAMTARGOBJ "NAME" id flags "parent" px py pz a... "TARGET_INSTANCE" ...
            if q and len(nums) >= 8:
                cam = {'name': q[0], 'kind': 'FREE' if line.startswith('CAMFREE') else 'TARGOBJ',
                       'pos': [round(nums[2] / 100, 2), round(nums[3] / 100, 2), round(-nums[4] / 100, 2)],
                       'ang': [round(nums[5], 2), round(nums[6], 2)]}
                if cam['kind'] == 'TARGOBJ' and len(q) > 2:
                    cam['targ'] = q[2]
                cameras.append(cam)
        elif line.startswith('ENVSND '):
            q = QUOTED.findall(line)
            nums = floats(QUOTED.sub(' ', line))
            # ENVSND "<file>.psf" "<NAME>" px py pz 1 0.0 innerR outerR 1.0 ...
            if len(q) >= 2 and len(nums) >= 7:
                envsnd.append({'file': q[0], 'name': q[1],
                               'pos': [round(nums[0] / 100, 2), round(nums[1] / 100, 2), round(-nums[2] / 100, 2)],
                               'rIn': round(nums[5] / 100, 1), 'rOut': round(nums[6] / 100, 1)})
        elif line.startswith('REGN '):
            q = QUOTED.findall(line)
            rest = QUOTED.sub(' ', line)
            nums = floats(rest)
            if q and len(nums) >= 5:
                if int(nums[0]) == 1:
                    regions.append({'name': q[0], 'p': nums[1:4], 'r': nums[4]})
                else:
                    regions.append({'name': q[0], 'p': nums[1:4], 'r': 0, 'box': [nums[7:10], nums[10:13]]})
    # world positions for instances (compose up the parent chain, yaw-only)
    by_inst = {i['inst']: i for i in instances}
    def world(i, depth=0):
        x, y, z = i['p']
        yaw = i['r'][1] * 3.14159265 / 180
        if depth < 8 and i['parent'] in by_inst and i['parent'] != i['inst']:
            px, py, pz, pyaw = world(by_inst[i['parent']], depth + 1)
            c, s = np_cos(pyaw), np_sin(pyaw)
            return (px + x * c - z * s, py + y, pz + x * s + z * c, yaw + pyaw)
        return (x, y, z, yaw)
    import math
    def np_cos(a): return math.cos(a)
    def np_sin(a): return math.sin(a)
    for i in instances:
        wx, wy, wz, _ = world(i)
        i['w'] = [round(wx / 100, 3), round(wy / 100, 3), round(-wz / 100, 3)]
    def conv(u):
        return {'model': u['model'], 'name': u['name'], 'script': u['script'],
                'pos': [round(u['p'][0] / 100, 3), round(u['p'][1] / 100, 3), round(-u['p'][2] / 100, 3)],
                'yaw': round(-u['r'][1] * 3.14159265 / 180, 4)}
    units = [conv(u) for u in units]
    # the training ENV scripts the player character plainly as "BRADLEY"
    # (no HERO_ prefix); the sim keys the player start off HERO_BRADLEY
    if not any(u['script'] == 'HERO_BRADLEY' for u in units):
        for u in units:
            if u['model'] == 'HERO01_ARMSTRONG' and u['script'] == 'BRADLEY':
                u['script'] = 'HERO_BRADLEY'
    def reg_out(r):
        o = {'name': r['name'], 'pos': [round(r['p'][0] / 100, 2), round(r['p'][1] / 100, 2), round(-r['p'][2] / 100, 2)],
             'r': round(r['r'] / 100, 2)}
        if 'box' in r:  # world-mapped (z negated, re-sorted), metres
            (ax, ay, az), (bx, by, bz) = r['box']
            o['box'] = [[round(min(ax, bx) / 100, 2), round(min(ay, by) / 100, 2), round(-max(az, bz) / 100, 2)],
                        [round(max(ax, bx) / 100, 2), round(max(ay, by) / 100, 2), round(-min(az, bz) / 100, 2)]]
        return o
    regions = [reg_out(r) for r in regions]
    waypoints = [{'id': w['id'], 'name': w['name'],
                  'pos': [round(w['p'][0] / 100, 2), round(w['p'][1] / 100, 2), round(-w['p'][2] / 100, 2)],
                  'next': w['next']} for w in wps]
    return {'instances': instances, 'units': units, 'regions': regions, 'waypoints': waypoints,
            'cameras': cameras, 'envsnd': envsnd}

if __name__ == '__main__':
    src = sys.argv[1] if len(sys.argv) > 1 else 'src-extract/mission1/MISSION1.ENV'
    dst = sys.argv[2] if len(sys.argv) > 2 else 'game/data/missions/mission1.json'
    d = parse(src)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    json.dump(d, open(dst, 'w'))
    heroes = [u for u in d['units'] if u['script'].startswith('HERO')]
    foes = [u for u in d['units'] if u['model'].startswith(('IRAQ', 'IR_')) and not u['script'].startswith('CS')]
    print(f"instances {len(d['instances'])}  units {len(d['units'])}  regions {len(d['regions'])}  waypoints {len(d['waypoints'])}")
    print(f"cameras {len(d['cameras'])}  envsnd {len(d['envsnd'])}")
    print('heroes:', [(h['name'], h['script'], h['pos']) for h in heroes])
    print('hostiles:', len(foes), '| CS actors:', len([u for u in d['units'] if u['script'].startswith('CS')]))
    start = next((h for h in heroes if h['script'] == 'HERO_BRADLEY'), None)
    if dst.endswith('mission1.json'):
        assert start and abs(start['pos'][0] + 120.12) < 0.5 and abs(start['pos'][2] + 233.92) < 0.5, start
        print('start validated:', start['pos'], 'yaw', start['yaw'])
