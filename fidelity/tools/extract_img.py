#!/usr/bin/env python3
"""Parse CDS 'imgf' texture-atlas definitions and extract every named image.

Format (reverse-engineered from Catalog/0010. GWInt.img):
  header: 'imgf', u16 version, u16 image_count, u16 ?, u16 page_count
  then page_count texture filenames (NUL-padded)
  then image_count fixed 272-byte records:
    +0   u16  page index
    +2   char name (NUL-terminated, 0xCC padded)
    +260 u16 x, +262 u16 y, +264 u16 w, +266 u16 h   (pixels, page space)
    +268 i16 anchor_x, +270 i16 anchor_y
Crops are written as PNGs named after the image (e.g. IMAGE_WEAPON_M16A2.png),
plus a manifest.json with name -> {page,x,y,w,h,ax,ay,file}.
"""
import struct, re, sys, os, json
from PIL import Image

def parse_img(path):
    d = open(path, 'rb').read()
    assert d[:4] == b'imgf', path
    ver, count, _unk, npages = struct.unpack('<4H', d[4:12])
    # page texture names follow the 12-byte header
    pages, p = [], 12
    raw = d[p:p + npages * 64]
    for m in re.finditer(rb'[\x20-\x7e]+\.png', raw, re.I):
        pages.append(m.group().decode())
    offs = [m.start() for m in re.finditer(rb'IMAGE_[A-Z0-9_]+', d)]
    imgs = {}
    for o in offs:
        s = o - 2
        name = d[o:d.index(b'\x00', o)].decode()
        page = struct.unpack('<H', d[s:s + 2])[0]
        x, y, w, h, ax, ay = struct.unpack('<4H2h', d[s + 260:s + 272])
        imgs[name] = dict(page=page, x=x, y=y, w=w, h=h, ax=ax, ay=ay)
    return pages, imgs

def main():
    img_path, page_dir, out_dir = sys.argv[1], sys.argv[2], sys.argv[3]
    pages, imgs = parse_img(img_path)
    os.makedirs(out_dir, exist_ok=True)
    sheets = []
    for pg in pages:
        cand = os.path.join(page_dir, pg)
        if not os.path.exists(cand):  # case-insensitive fallback
            for f in os.listdir(page_dir):
                if f.lower().endswith(pg.lower()):
                    cand = os.path.join(page_dir, f); break
        sheets.append(Image.open(cand).convert('RGBA'))
    manifest = {}
    for name, r in imgs.items():
        sheet = sheets[r['page']]
        crop = sheet.crop((r['x'], r['y'], r['x'] + r['w'], r['y'] + r['h']))
        fn = name + '.png'
        crop.save(os.path.join(out_dir, fn))
        r['file'] = fn
        manifest[name] = r
    json.dump(manifest, open(os.path.join(out_dir, 'manifest.json'), 'w'), indent=1)
    print(f"{img_path}: {len(pages)} pages {pages} -> {len(manifest)} images in {out_dir}")

if __name__ == '__main__':
    main()
