#!/usr/bin/env python3
"""SLOC (.loc) string-table decoder for Conflict: Desert Storm.

Format (reverse-engineered 2026-10 from the user's own game copy):
  'SLOC' u32 version(1) u32 nLanguages u32 nStrings
  'LANG' u32 zero, then per language: cstring name (NUL-terminated),
         u32 langIndex (1..nLanguages)
  'LEND'
  'STRN' u32 buildStamp, then the string records until 'SEND':
         the whole STRN region is a stream of u16-charCount-prefixed
         UTF-16LE blobs.  Between two neighbouring *names* there are
         nLanguages "slots"; slot k (0-based) of string s holds the pair
             name <00 00 00 00> text <2 junk CJK chars> <u32 marker == k>
         i.e. each blob concatenates all language versions of one string,
         and blob boundaries drift between the two 8-byte marker blocks
         (a blob may start with 8 zero bytes).  Markers are the u32 value
         immediately before each name occurrence; English = marker-lang 0.

Simplification used here (languages are stored English-first in every
observed file): split the STRN byte region on every occurrence of the
next name, take each segment as  name \0 text \0 ...  Language blocks
inside a segment are separated by [2 junk UTF-16 chars][u32 langIndex].

Usage: decode_loc.py <reference_root> <out_dir>
Writes <out_dir>/<relative path>.json with {name: {language: text}}.
Only languages with clean text are kept; English is always languages[0].
"""
import json
import os
import re
import struct
import sys

NAME_RE = re.compile(rb'(?:[\x20-\x7e]\x00){2,}')  # >=2 ASCII UTF-16 chars
SEP = b'\x00\x00\x00\x00'


def parse(data):
    if data[:4] != b'SLOC':
        raise ValueError('not an SLOC file')
    _, nlang, nstrings = struct.unpack_from('<III', data, 4)
    li = data.find(b'LANG')
    si = data.find(b'STRN')
    ei = data.find(b'SEND', si if si >= 0 else 0)
    if li < 0 or si < 0:
        raise ValueError('missing LANG/STRN chunk')
    p = li + 8
    langs = []
    for _ in range(nlang):
        end = data.index(b'\x00', p)
        name = data[p:end].decode('latin-1')
        p = end + 1
        idx = struct.unpack_from('<I', data, p)[0]
        p += 4
        langs.append((idx, name))
    langs = [n for _, n in sorted(langs)]

    region = data[si + 8: ei if ei >= 0 else len(data)]
    # segment the region into per-string records: a record starts at a
    # string-name match whose preceding 8+ bytes are mostly zeros/junk,
    # i.e. simply: every NAME_RE match that is followed by SEP + text and
    # looks like an identifier (uppercase/digits/underscore heavy).
    # Records pair up as (ID, English text): an identifier-like match whose
    # NEXT match is display text is a name; pair them sequentially.  Long
    # display texts are stored as several UTF-16 chunks split by the
    # decoder's [A-Z0-9_] regex, so keep joining continuation fragments.
    raw = []
    for m in NAME_RE.finditer(region):
        s = m.group().decode('utf-16-le', 'replace').strip()
        if 1 <= len(s) <= 60:
            raw.append(s)

    def is_ident(s):
        return bool(re.fullmatch(r'[A-Z0-9_][A-Z0-9_ %\.\-]{0,40}', s)) and \
            not re.search(r'[a-z]', s)

    out = {}
    i = 0
    expect_name = True
    pending = None
    while i < len(raw):
        s = raw[i]
        if expect_name:
            if is_ident(s):
                pending = s
                expect_name = False
            i += 1
        else:
            # s is the text (or its first fragment) — take it as-is, then
            # keep joining fragments until the next identifier-like string.
            parts = [s]
            j = i + 1
            while j < len(raw) and not is_ident(raw[j]):
                parts.append(raw[j])
                j += 1
            if pending and pending not in out:
                out[pending] = {langs[0]: ' '.join(parts)}
            expect_name = True
            i = j
    return {'languages': langs, 'headerStrings': nstrings, 'count': len(out),
            'strings': out}


def main():
    root, outdir = sys.argv[1], sys.argv[2]
    done = 0
    for dirpath, _, files in os.walk(root):
        for f in files:
            if not f.lower().endswith('.loc'):
                continue
            src = os.path.join(dirpath, f)
            rel = os.path.relpath(src, root)
            dst = os.path.join(outdir, rel + '.json')
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            try:
                with open(src, 'rb') as fh:
                    parsed = parse(fh.read())
                with open(dst, 'w', encoding='utf-8') as fh:
                    json.dump(parsed, fh, ensure_ascii=False, indent=1)
                done += 1
                print(f'OK   {rel}: {parsed["count"]} strings (header {parsed["headerStrings"]})')
            except Exception as e:  # noqa: BLE001
                print(f'FAIL {rel}: {e}')
    print(f'decoded {done} .loc files -> {outdir}')


if __name__ == '__main__':
    main()
