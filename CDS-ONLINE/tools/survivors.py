#!/usr/bin/env python3
"""P5 — convert the surviving per-mission data (fidelity/models/<id>, converted
from the missions whose raw .dat archives are absent, PLAN section 7) into the
sim's mission JSON schema (game/data/missions/<id>.json).

Provenance: placements/unit rows come from the converted survivors; enemy
spawns are props.enemiesHLOI (the complete HLOI placement list), enriched with
units.enemies (Units.txt row + weapon) where the instance names match.
Unmatched hostiles default to Iraqi_Conscript / IR_WPN_AK47 (marked).
Objectives for these missions live in the mission DLLs (R1) — the JSON marks
objectivesMode 'gap' and the sim says so in-game."""
import json, os, re, sys

ROOT = '/home/user/cds-og'
FID = '/home/user/black_decade/fidelity/models'
TABLES = f'{ROOT}/game/data/tables'
OUT = f'{ROOT}/game/data/missions'

UNITS = {r['name']: r for r in json.load(open(f'{TABLES}/units.json'))}
CHAR_GLBS = {f.lower(): f[:-4] for f in os.listdir(f'{ROOT}/game/assets/models/characters') if f.endswith('.glb')}
DEFAULT_FOE_UNIT = 'Iraqi_Conscript'
DEFAULT_FOE_WEAPON = 'IR_WPN_AK47'

# model basename -> VStat row (armour/hp source). Only unambiguous mappings.
VSTAT_BY_MODEL = {'BMP2': 'BMP2', 'BMP1': 'BMP1', 'BMP1WRECK': None,
                  'T72M1': 'TankStat_T72', 'T62': 'TankStat_T62'}
VEHICLE_WEAPON = {'BMP2': 'IR_VWPN_BMP2_ChainGun', 'BMP1': 'IR_VWNP_BMP1_MAINCANNON',
                  'TankStat_T72': 'IR_VWNP_T72_MAINCANNON', 'TankStat_T62': 'IR_VWPN_T62_MAINCANNON'}


def char_model(model):
    """Units.txt model name -> actual character GLB basename (case-insensitive)."""
    if not model:
        return None
    return CHAR_GLBS.get((model + '.glb').lower()) or CHAR_GLBS.get(model.lower())


def convert(mid):
    src = os.path.join(FID, mid)
    units = json.load(open(f'{src}/units.json'))
    props = json.load(open(f'{src}/props.json'))
    glbs = {f.lower(): f[:-4] for f in os.listdir(src) if f.endswith('.glb')}

    def glb(name):
        return glbs.get((name + '.glb').lower()) or glbs.get(name.lower())

    shared = {}
    for d in ('mission1', 'frontend'):
        dd = f'{ROOT}/game/assets/models/{d}'
        for f in os.listdir(dd):
            if f.endswith('.glb'):
                shared[f.lower()] = (d, f[:-4])

    # ---- instances: scene roots (sub-chunk names whose base GLB exists are
    # already inside the base model's geometry) + statics
    instances = []
    for name, t in (props.get('scenes') or {}).items():
        base = re.sub(r'(\d{3,})$', '', name)
        if base != name and glb(base):
            continue                      # sub-chunk of a placed root
        g = glb(name)
        if not g:
            continue
        instances.append({'model': g, 'w': t['p'], 'ry': t.get('yaw', 0), 'src': 'props.scenes'})
    hero_models = {'HERO01_ARMSTRONG', 'HERO02_RAMIREZ', 'HERO03_JONES', 'HERO04_FOLEY'}
    vehicle_units = []
    for s in props.get('statics') or []:
        m = s['m']
        if m in hero_models:
            continue
        pos = [s['p'][0], s.get('y', 0), s['p'][1]]
        g = glb(m)
        if g:
            instances.append({'model': g, 'w': pos, 'ry': s.get('yaw', 0), 'src': 'props.statics'})
        elif (m + '.glb').lower() in shared:
            d, g = shared[(m + '.glb').lower()]
            instances.append({'model': g, 'dir': d, 'w': pos, 'ry': s.get('yaw', 0),
                              'src': 'props.statics(shared)'})

    # ---- units: heroes, prisoner-less Foley (4th man), hostiles
    out_units = []
    st = units['start']
    out_units.append({'script': 'HERO_BRADLEY', 'name': 'Bradley', 'model': st['model'],
                      'pos': st['pos'], 'yaw': st.get('yaw', 0), 'hero': True})
    hero_script = {'HERO02_RAMIREZ': ('HERO_RAMIREZ', 'Ramirez'), 'HERO03_JONES': ('HERO_JONES', 'Jones')}
    for s in props.get('statics') or []:
        if s['m'] in hero_script:
            script, nm = hero_script[s['m']]
            out_units.append({'script': script, 'name': nm, 'model': s['m'],
                              'pos': [s['p'][0], s.get('y', 0), s['p'][1]], 'yaw': s.get('yaw', 0), 'hero': True})
    if props.get('Foley'):
        out_units.append({'script': 'HERO_FOLEY', 'name': 'Foley', 'model': 'HERO04_FOLEY',
                          'pos': props['Foley'], 'yaw': 0, 'hero': True,
                          'note': 'survivor placement: 4th squad member (prisoner role is M1 ENV-script only)'})
    by_inst = {e['inst']: e for e in units.get('enemies') or []}
    n_matched = 0
    for h in props.get('enemiesHLOI') or []:
        e = by_inst.get(h['inst'])
        uname = e['unit'] if e else DEFAULT_FOE_UNIT
        urow = UNITS.get(uname) or UNITS[DEFAULT_FOE_UNIT]
        model = char_model(urow['model']) or char_model('IRAQINFANTRY01_SANDY')
        if e:
            n_matched += 1
        out_units.append({'script': h['inst'], 'name': h['inst'], 'foe': True,
                          'unitName': uname, 'model': model,
                          'weapon': (e or {}).get('weapon', DEFAULT_FOE_WEAPON),
                          'matched': bool(e),
                          'pos': h['pos'], 'yaw': h.get('yaw', 0)})
    # vehicles placed as HLOI/statics (BMPs, tanks) -> live vehicle objects
    for inst in instances:
        vs = VSTAT_BY_MODEL.get(inst['model'].upper())
        if vs:
            vehicle_units.append({'model': inst['model'], 'vstat': vs,
                                  'weapon': VEHICLE_WEAPON.get(vs),
                                  'pos': inst['w'], 'yaw': inst.get('ry', 0),
                                  'team': 'iq', 'src': inst['src']})

    regions = [{'name': t['name'], 'pos': t['pos'], 'r': t.get('r') or 8}
               for t in units.get('triggers') or []]
    vehicles = []
    for kind, lst in (props.get('vehicles') or {}).items():
        for v in lst:
            vehicles.append({'kind': kind, 'pos': v['pos'], 'yaw': v.get('yaw', 0)})
    hawk = next((v for v in vehicles if v['kind'] == 'hawk'), None)
    if hawk:
        regions.append({'name': 'EXTRACTION', 'pos': hawk['pos'], 'r': 25, 'synth': 'props.vehicles.hawk'})

    doc = {'id': mid, 'src': f'survivor: fidelity/models/{mid} (raw {mid}.dat absent — PLAN §7)',
           'instances': instances, 'units': out_units, 'regions': regions,
           'waypoints': units.get('waypoints') or [], 'vehicles': vehicles,
           'vehicleUnits': vehicle_units, 'objectivesMode': 'gap',
           'cutscenes': props.get('cutscenes') or [],
           'counts': {'instances': len(instances), 'hostiles': len([u for u in out_units if u.get('foe')]),
                      'hostilesMatched': n_matched, 'waypoints': len(units.get('waypoints') or [])}}
    os.makedirs(OUT, exist_ok=True)
    json.dump(doc, open(f'{OUT}/{mid}.json', 'w'))
    print(f"{mid:11s} instances={len(instances):4d} hostiles={doc['counts']['hostiles']:3d} "
          f"(unit-matched {n_matched}) waypoints={doc['counts']['waypoints']} vehicles={len(vehicle_units)}")
    return doc


if __name__ == '__main__':
    ids = sys.argv[1:] or ['mission2', 'mission3', 'mission4', 'mission5a', 'mission5b', 'mission6',
                           'mission7', 'mission8', 'mission9', 'mission10', 'mission11a', 'mission11b',
                           'mission12a', 'mission12b', 'training2', 'training3']
    for mid in ids:
        convert(mid)
