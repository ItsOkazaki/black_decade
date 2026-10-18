#!/usr/bin/env python3
"""Unpack a CDS .dat archive to numbered payload files (/tmp/dx/<name>_x/).

Archive layout (reversed from the user's own game files): a 12-byte
(id, offset, size) index at 0 with its copy at 0x79E0; payloads fill
0x8000->EOF. Payload *kinds* are sniffed from magic bytes; the mission
ENV scene (the big text payload containing ENVI lines) drives the build
via tools/build_mp_missions.py.

Named extraction via the .sch chained hash (state=1, LSB-first, uppercase,
per the static DAT review) was verified against mission1.dat: 1502/1502
names matched and payload bytes were identical to the loose files, which
is how we know the MP archives are the game's real remaining data.

Usage: python3 fidelity/tools/dat_extract.py mp_mission2.dat [...]
Output: /tmp/dx/mp_mission2_x/0000.bin ... (0374.evo is the mission ENV)
Extracted game data is never committed — /tmp only.
"""
import os
import struct
import sys


def dump(dat_path):
    base = '/tmp/dx/' + os.path.basename(dat_path)[:-4] + '_x'
    os.makedirs(base, exist_ok=True)
    d = open(dat_path, 'rb').read()
    ents = []
    off = 0
    while off + 12 <= 0x79E0:
        rid, o, s = struct.unpack_from('<III', d, off)
        if rid == 0 and o == 0 and s == 0:
            break
        ents.append((o, s))
        off += 12
    for i, (o, s) in enumerate(ents):
        b = d[o:o + s]
        if b[:4] == b'DDS ':
            ext = 'dds'
        elif b[:4] == b'\x89PNG':
            ext = 'png'
        elif b[:2] == b'BM':
            ext = 'bmp'
        elif b[:4] == b'SLOC':
            ext = 'loc'
        elif b'ENVI' in b[:8192] and s > 50000:
            ext = 'evo'
        else:
            ext = 'bin'
        open(os.path.join(base, f'{i:04d}.{ext}'), 'wb').write(b)
    print(f'{os.path.basename(dat_path)}: {len(ents)} payloads -> {base}')


if __name__ == '__main__':
    for p in sys.argv[1:]:
        dump(p)
