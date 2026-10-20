#!/usr/bin/env python3
"""R1 recon: characterize the mission DLLs (DesertStorm mission logic).

Findings encoded here (Mission1.dll, verified by disassembly):
- Each mission DLL exports exactly one function, LevelSetup(api), imports
  only KERNEL32. The exe passes a table of engine function pointers
  (calls go up to [api+0x3ec]); the DLL registers animation-state -> .prs
  pairs through [api+4], stores the table, then runs its script body.
- So mission logic is native x86 compiled from a C-like script, NOT data
  bytecode. Full logic recovery = disassembling each DLL's .text with the
  API table's semantics recovered from DesertStorm.exe — a long project;
  this tool extracts the parts that are data: mission-specific strings
  (audio refs, sky, map, next mission, chatter) and the registry size.

Usage: dllrecon.py  ->  game/data/tables/missiondll.json + report
"""
import json, os, re, struct

INSTALL = '/home/user/black_decade'
OUT = 'game/data/tables/missiondll.json'

def dll_strings(path):
    d = open(path, 'rb').read()
    strs = [m.group().decode() for m in re.finditer(rb'[ -~]{4,}', d)]
    specific, registry = [], 0
    for i, s in enumerate(strs):
        if s.endswith('.prs'):
            registry += 1
        elif not re.fullmatch(r'[A-Z0-9_]{3,}', s or ' '):
            specific.append(s)
    audio = [s for s in specific if re.search(r'\.(wav|psf|sbk)$', s, re.I)]
    files = [s for s in specific if re.search(r'\.(env|loc|img|sky|bmp)$', s, re.I)]
    chatter = [s for s in specific if ' ' in s and not s.endswith(('.prs',)) and len(s) > 12]
    return {'audioRefs': sorted(set(audio)), 'fileRefs': sorted(set(files)),
            'chatter': sorted(set(chatter)), 'prsRegistryEntries': registry}

if __name__ == '__main__':
    out = {}
    for f in sorted(os.listdir(INSTALL)):
        if f.endswith('.dll'):
            info = dll_strings(os.path.join(INSTALL, f))
            out[f] = info
            print(f"{f}: prs-registry {info['prsRegistryEntries']}, audio {info['audioRefs']}")
            print(f"   files: {info['fileRefs']}")
            print(f"   chatter: {info['chatter']}")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(out, open(OUT, 'w'), indent=1)
    print('wrote', OUT)
