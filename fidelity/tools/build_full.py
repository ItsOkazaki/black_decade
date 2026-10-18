#!/usr/bin/env python3
"""Build the layers the loose parsers missed: decoded audio + cutscenes.

* audio — Data/Sound streams decoded with ModKit ds_sound.py. Two PSX
  ADPCM containers live there: "PSF\\x80" speech/cutscene streams
  (44.1 kHz stereo, 16-byte L/R interleaved blocks) and "PSF`" music
  (another layout the ModKit can't decode yet — that family is what
  foobar2000 + foo_input_psf plays on Windows; here we ship only the
  two verified PSF\\x80 tracks):
    frontendmusic  -> fidelity/sounds/music/menu.wav           (78.9 s)
    CS_MENU_S01    -> fidelity/sounds/music/menu_cutscene.wav  (86.4 s)
  The DS-* score tracks follow once their layout is cracked.

* cutscene cameras — CAMFREE / CAMTARGPOS / CAMTARGOBJ records from
  every mission .env, in the parsers' e2j conversion, merged into
  props.json as:
    cutscenes: [{name, kind: FREE|POS|OBJ, pos, look|[x,y,z]|targ}]
  (CS_ HLOI cast: the env's HLOI lines carry tabs and quoted unit
  names the strict regex misses; play.js doesn't need them — the
  cutscene cameras point at world positions/instances directly.
  Mission geometry: build_mission.py / build_mp_missions.py. Mission
  scripting: MissionN.dll — statically decompiled by the ModKit's
  missionflow.py into /tmp/<m>flow.json, never executed.)

Usage: python3 fidelity/tools/build_full.py [sounds|cams|both]
"""
import glob
import json
import os
import re
import shutil
import subprocess
import sys

TOOLS = os.path.dirname(os.path.abspath(__file__))
FID = os.path.dirname(TOOLS)
ROOT = os.path.dirname(FID)
MODKIT_CLI = '/tmp/modkit/cli/ds_sound.py'

AUDIO = [('frontendmusic', 'menu.wav'), ('CS_MENU_S01', 'menu_cutscene.wav')]


def e2j(x, y, z):
    return [round(x / 100, 2), round(y / 100, 2), round(-z / 100, 2)]


CAM_RE = re.compile(
    r'^(CAMFREE|CAMTARGPOS|CAMTARGOBJ)\s+"([^"]+)"\s+(\d+)\s+(\d+)\s+"([^"]*)"\s+'
    r'(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(.*)$')


def parse_cams(path):
    out = []
    for ln in open(path, encoding='latin-1'):
        m = CAM_RE.match(ln.strip())
        if not m:
            continue
        kind, name = m.group(1), m.group(2)
        tail = m.group(9)
        nums = [float(v) for v in re.findall(r'-?\d+\.\d+', tail)]
        pos = e2j(float(m.group(6)), float(m.group(7)), float(m.group(8)))
        rec = {'name': name, 'kind': kind[3:], 'pos': pos}
        if kind == 'CAMFREE':
            yaw, pitch = (nums[0], nums[1]) if len(nums) >= 2 else (0.0, 0.0)
            rec['look'] = [pitch, yaw]
        elif kind == 'CAMTARGPOS':
            rec['look'] = e2j(nums[0], nums[1], nums[2]) if len(nums) >= 3 else pos
        else:  # CAMTARGOBJ: look target = env instance (hero/enemy)
            t = re.search(r'"([^"]+)"', tail)
            rec['targ'] = t.group(1) if t else ''
        out.append(rec)
    return out


def decode_sounds():
    dst_dir = os.path.join(FID, 'sounds', 'music')
    os.makedirs(dst_dir, exist_ok=True)
    for src_name, out_name in AUDIO:
        src = os.path.join(ROOT, 'Data', 'Sound', src_name + '.psf')
        dst = os.path.join(dst_dir, out_name)
        if os.path.exists(dst):
            print(f'[snd] {out_name} cached')
            continue
        if not os.path.exists(src):
            print(f'[snd] missing {src_name}')
            continue
        wav = f'/tmp/{src_name}.wav'
        subprocess.run([sys.executable, MODKIT_CLI, 'stream', src, wav], check=True)
        shutil.copy(wav, dst)
        print(f'[snd] {src_name} -> {out_name}')


def build_cams():
    for mdir in sorted(glob.glob(os.path.join(ROOT, 'Mission*')) +
                        glob.glob(os.path.join(ROOT, 'Training*'))):
        name = os.path.basename(mdir)
        envs = glob.glob(os.path.join(mdir, '*.env')) + glob.glob(os.path.join(mdir, '*.ENV'))
        if not envs:
            continue
        ppath = os.path.join(FID, 'models', name.lower(), 'props.json')
        if not os.path.exists(ppath):
            continue
        p = json.load(open(ppath))
        p['cutscenes'] = parse_cams(envs[0])
        json.dump(p, open(ppath, 'w'))
        print(f'[cam] {name.lower()}: {len(p["cutscenes"])} cams')


if __name__ == '__main__':
    what = sys.argv[1] if len(sys.argv) > 1 else 'both'
    if what in ('sounds', 'both'):
        decode_sounds()
    if what in ('cams', 'both'):
        build_cams()
    print('BUILD FULL DONE')
