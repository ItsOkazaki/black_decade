#!/usr/bin/env python3
"""Recover named sound banks from a .sch archive by the game's own elf_hash.

Bank names in CDS .sch files are stored only as 32-bit elf hashes. Candidate
names come from the game's own data: Weaps.txt sound-bank column, Units.txt
voice banks, and ASCII strings in DesertStorm.exe (with/without '.sbk').
Exports each matched bank's samples as WAV and writes a bank->files index.
"""
import json, os, re, subprocess, sys

ROOT = '/home/user/cds-og'
MODKIT = '/tmp/modkit/cli'
sys.path.insert(0, '/tmp/modkit')
from conflict_ds_tools.sound import elf_hash  # noqa: E402


def candidates():
    cands = set()
    exe = open('/home/user/black_decade/DesertStorm.exe', 'rb').read()
    for c in re.findall(rb'[A-Za-z][A-Za-z0-9_]{2,34}', exe):
        cands.add(c.decode('ascii', 'replace'))
    w = json.load(open(f'{ROOT}/game/data/tables/weapons.json'))
    rows = w if isinstance(w, list) else w.get('weapons', [])
    for r in rows:
        if r.get('bank'):
            cands.add(str(r['bank']))
    u = json.load(open(f'{ROOT}/game/data/tables/units.json'))
    urows = u if isinstance(u, list) else u.get('units', [])
    for r in urows:
        for k in ('voiceBank', 'voice', 'bank'):
            if r.get(k):
                cands.add(str(r[k]).replace('.sbk', '').replace('.SBK', ''))
    for extra in ('Explosion', 'Impact', 'Interface', 'C4', 'Iraqi_Soldier',
                  'VehicleWeapon', 'Ambient', 'Footsteps', 'Radio'):
        cands.add(extra)
    return cands


def main(sch, outsub):
    r = subprocess.run(['python3', f'{MODKIT}/ds_sound.py', 'list', sch],
                       capture_output=True, text=True)
    hashes = [p[1] for line in r.stdout.splitlines()
              if (p := line.split()) and len(p) >= 2 and p[0] == 'BANK']
    names = {}
    for c in candidates():
        for variant in (c, c + '.sbk', c.upper(), c.lower()):
            h = f'{elf_hash(variant):08X}'
            if h in hashes:
                names[h] = c
    print(f'{os.path.basename(sch)}: {len(hashes)} banks, {len(names)} named')
    outbase = os.path.join(ROOT, 'game', 'assets', 'sounds', outsub)
    index = {}
    for h, name in sorted(names.items(), key=lambda kv: kv[1]):
        out = os.path.join(outbase, name)
        os.makedirs(out, exist_ok=True)
        subprocess.run(['python3', f'{MODKIT}/ds_sound.py', 'wav', sch, name, out],
                       capture_output=True, text=True)
        files = sorted(f for f in os.listdir(out) if f.endswith('.wav'))
        if files:
            index[name] = files
            print(f'  {name}: {len(files)} samples')
    stem = os.path.splitext(os.path.basename(sch))[0]
    json.dump({'banks': hashes, 'names': names},
              open(f'{ROOT}/game/data/{stem}-banks.json', 'w'), indent=1)
    index_name = 'bank-samples.json' if outsub == 'mission1' else f'bank-samples-{outsub}.json'
    json.dump(index, open(f'{ROOT}/game/data/{index_name}', 'w'), indent=1)
    print(f'index: {len(index)} banks with samples')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else '/home/user/black_decade/mission1.sch',
         sys.argv[2] if len(sys.argv) > 2 else 'mission1')
