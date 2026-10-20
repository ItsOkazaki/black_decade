#!/usr/bin/env python3
"""Recover the DS-* music tracks (R2).

The six music files in Data/Sound are NOT the PSF\\x80 stream format the
cutscene decoder eats. They are a container: magic "PSF\\x60", a u32 whose
value counts 12-byte directory entries (header bytes = 8 + 12*n), then the
entries, then a run of ordinary PSF\\x80 stream segments back to back
(the music sequencer's bars). Each segment decodes with the ModKit codec
exactly like a cutscene stream; in file order they are the whole track.

The directory fields we can verify are the segment offsets (every carved
PSF\\x80 magic appears as an entry's third u32). The other two u32s per
entry look like (n<<16)|n counters / sequencing data; we do not need them
to render the track linearly, and we do not invent loop points.

Usage: musicrecover.py [srcDir] [outDir]   (defaults: the game install / game assets)
"""
import os, struct, sys
sys.path.insert(0, '/tmp/modkit')
from conflict_ds_tools import sound

def carve(data):
    assert data[:4] == b'PSF\x60', data[:4]
    n_entries = struct.unpack('<I', data[4:8])[0]
    hdr_end = 8 + 12 * n_entries
    dir_offsets = set()
    for i in range(n_entries):
        off, x, y = struct.unpack_from('<III', data, 8 + 12 * i)
        dir_offsets.add(off)
    magics = []
    i = hdr_end
    while True:
        i = data.find(b'PSF\x80', i)
        if i < 0: break
        magics.append(i); i += 1
    assert magics, 'no segments'
    assert all(m in dir_offsets for m in magics), 'carved offset missing from directory'
    segs = []
    for k, m in enumerate(magics):
        end = magics[k + 1] if k + 1 < len(magics) else len(data)
        segs.append(data[m:end])
    return segs

def recover(path, out):
    data = open(path, 'rb').read()
    segs = carve(data)
    left, right = [], []
    rate = sound.STREAM_RATE
    for s in segs:
        r, l, rr = sound.decode_stream(s)
        left += l; right += rr
    sound.write_wav_stereo(out, rate, left, right)
    return len(segs), len(left) / rate

if __name__ == '__main__':
    src = sys.argv[1] if len(sys.argv) > 1 else '/home/user/black_decade/Data/Sound'
    dst = sys.argv[2] if len(sys.argv) > 2 else 'game/assets/music'
    os.makedirs(dst, exist_ok=True)
    for f in sorted(os.listdir(src)):
        if not f.endswith('.psf'): continue
        head = open(os.path.join(src, f), 'rb').read(4)
        if head != b'PSF\x60': continue
        out = os.path.join(dst, os.path.splitext(f)[0] + '.wav')
        n, secs = recover(os.path.join(src, f), out)
        print(f'{f}: {n} segments -> {os.path.basename(out)} ({secs:.1f}s)')
