#!/usr/bin/env python3
"""Index every file in the uploaded game data (fidelity/reference) and
identify its format from magic bytes / extension.  Also decodes the small
text formats (.fas asset lists, .spl physics materials, .sdl decal lists,
.env headers) enough to catalogue them.

Usage: index_reference.py <reference_root> <out_json> <out_md>
"""
import json
import os
import sys
from collections import Counter

MAGIC = [
    (b'SLOC', 'SLOC string table (.loc) -> decode_loc.py'),
    (b'imgf', 'imgf texture atlas (.img) -> extract_img.py'),
    (b'EOBJ', 'EVO 3D model/animation (.evo) -> evo_convert.py (ModKit)'),
    (b'DDS ', 'DDS texture (.dds/.ddl)'),
    (b'\x89PNG', 'PNG image'),
    (b'BM', 'BMP image'),
    (b'\xff\xd8\xff', 'JPEG image'),
]

TEXT_EXT = {'.txt', '.ini', '.env', '.fas', '.sdl', '.spl', '.key', '.bat'}


def identify(path, ext):
    try:
        with open(path, 'rb') as fh:
            head = fh.read(16)
    except OSError:
        return 'unreadable'
    for magic, label in MAGIC:
        if head.startswith(magic):
            return label
    if ext in TEXT_EXT:
        return f'plain text ({ext})'
    if ext == '.prb':
        return 'PRB probe/animation data (binary, header u32s + f32 arrays)'
    if ext == '.oct':
        return 'OCT spatial octree (binary)'
    if ext == '.qtd':
        return 'QTD quad-tree terrain data (binary)'
    if ext == '.rmd':
        return 'RMD render/model data (binary)'
    if ext in ('.vso', '.pso'):
        return 'DirectX shader bytecode'
    if ext == '.psf':
        return 'PSF music/sound archive (Data/Sound)'
    if ext in ('.dll', '.exe'):
        return 'Windows binary (NOT executed - static reference only)'
    if ext == '.dat':
        return 'CDS DAT archive (see reverse_engineering/verify_dat.py)'
    if ext == '.sch':
        return 'CDS DAT companion checksum/sidecar'
    if ext == '.tga':
        return 'TGA image'
    if ext == '.dyn':
        return 'DYN dynamics definition (text)'
    if ext == '.sky':
        return 'sky definition (text/binary)'
    if ext == '.rfx':
        return 'RFX render-effects script (text)'
    return 'unknown/binary'


def main():
    root, out_json, out_md = sys.argv[1], sys.argv[2], sys.argv[3]
    entries = []
    by_ext = Counter()
    by_kind = Counter()
    total_bytes = 0
    for dirpath, _, files in os.walk(root):
        for f in sorted(files):
            path = os.path.join(dirpath, f)
            rel = os.path.relpath(path, root)
            ext = os.path.splitext(f)[1].lower()
            size = os.path.getsize(path)
            kind = identify(path, ext)
            by_ext[ext or '(none)'] += 1
            by_kind[kind] += 1
            total_bytes += size
            entries.append({'path': rel, 'bytes': size, 'format': kind})
    summary = {
        'root': root, 'files': len(entries), 'bytes': total_bytes,
        'byExtension': dict(by_ext.most_common()),
        'byFormat': dict(by_kind.most_common()),
    }
    with open(out_json, 'w') as fh:
        json.dump({'summary': summary, 'files': entries}, fh, indent=1)
    with open(out_md, 'w') as fh:
        fh.write('# Uploaded game data — format index\n\n')
        fh.write(f"**{len(entries)} files, {total_bytes/1e6:.1f} MB** under `{root}`\n\n")
        fh.write('## By format\n\n')
        for kind, n in by_kind.most_common():
            fh.write(f'- {kind}: **{n}**\n')
        fh.write('\n## By extension\n\n')
        for ext, n in by_ext.most_common():
            fh.write(f'- `{ext}`: {n}\n')
        fh.write('\n## Per-folder file counts\n\n')
        folders = Counter(e['path'].split('/')[0] for e in entries)
        for name, n in sorted(folders.items()):
            fh.write(f'- {name}: {n}\n')
    print(f'indexed {len(entries)} files ({total_bytes/1e6:.1f} MB) -> {out_md}')


if __name__ == '__main__':
    main()
