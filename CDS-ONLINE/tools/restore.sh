#!/bin/bash
# Rebuild the whole CDS workspace after a sandbox wipe. Everything needed is
# either in git (this repo: CDS-ONLINE mirror + fidelity survivors + the raw
# .dat archives) or on GitHub (ModKit) / npm (@sparticuz/chromium).
# Usage:  bash tools/restore.sh           (from anywhere; ~5 minutes)
set -e
REPO=/home/user/black_decade
OG=/home/user/cds-og
cd "$REPO"
git fetch -q origin || true
git reset --hard -q origin/arena/bd74b395-black-decade
echo "== repo at $(git log --oneline -1)"

# 1. project tree from the git mirror
mkdir -p "$OG"
cp -r CDS-ONLINE/game CDS-ONLINE/tools CDS-ONLINE/PLAN.md CDS-ONLINE/census.md "$OG/"

# 2. toolchain
[ -d /tmp/modkit ] || git clone -q --depth 1 https://github.com/eSKylezZ/ConflictDesertStormModKit /tmp/modkit
pip install -q --break-system-packages numpy pillow brotli

# 3. assets (idempotent)
cd "$OG"
python3 /tmp/modkit/cli/ds_extract.py -g "$REPO" -o src-extract catalog chardata frontend mission1 mp_mission1 training1 >/dev/null
python3 tools/pipeline.py >/dev/null || true   # DS-*.psf failures are the known R2 block
python3 tools/envparse.py >/dev/null
python3 tools/bankrecover.py >/dev/null
python3 tools/survivors.py >/dev/null
python3 tools/envparse.py src-extract/training1/TRAINING1.ENV game/data/missions/training1.json >/dev/null || true
python3 - <<'PYEOF'
import json
p = 'game/data/missions/training1.json'
d = json.load(open(p))
for u in d['units']:
    if u['model'] == 'HERO01_ARMSTRONG' and u['script'] == 'BRADLEY':
        u['script'] = 'HERO_BRADLEY'
d['objectivesMode'] = 'gap'
d['src'] = 'src-extract/training1/TRAINING1.ENV via tools/envparse.py'
json.dump(d, open(p, 'w'))
PYEOF
mkdir -p game/assets/models/training1
python3 - <<'PYEOF'
import glob, os, subprocess
from concurrent.futures import ThreadPoolExecutor
os.chdir('/home/user/cds-og')
def one(p):
    out = 'game/assets/models/training1/' + os.path.splitext(os.path.basename(p))[0] + '.glb'
    if os.path.exists(out): return out
    subprocess.run(['python3', '/tmp/modkit/cli/evo_convert.py', p, '-o', 'game/assets/models/training1'],
                   capture_output=True, text=True)
    return out if os.path.exists(out) else None
print('training1 GLBs:', len([x for x in ThreadPoolExecutor(4).map(one, sorted(glob.glob('src-extract/training1/*.EVO'))) if x]))
PYEOF
ln -sfn "$REPO/fidelity/models" game/assets/models-survivors
echo "== assets: $(find game/assets/models -name '*.glb' | wc -l) GLBs, $(find game/assets/sounds -name '*.wav' | wc -l) WAVs"

# 4. sandbox shell
mkdir -p /home/user/og-sandbox
ln -sfn "$OG/game" /home/user/og-sandbox/game
printf '<!doctype html><meta charset="utf-8"><title>Conflict: Desert Storm</title>\n<script>location.replace("game/");</script>\n' > /home/user/og-sandbox/index.html
cp "$REPO/CDS-ONLINE/sandbox.html" /home/user/og-sandbox/sandbox.html

# 5. browser probe rig (@sparticuz/chromium + NSS/NSPR libs)
mkdir -p /tmp/snap
cd /tmp/snap
[ -f package.json ] || npm init -y >/dev/null
npm install puppeteer-core @sparticuz/chromium >/dev/null 2>&1
node -e "require('@sparticuz/chromium').default.executablePath().then(()=>{})"
mkdir -p /tmp/snap/libs
if [ ! -f /tmp/snap/libs/libnss3.so ]; then
  [ -d /tmp/cal ] || git clone -q --depth 1 https://github.com/alixaxel/chrome-aws-lambda /tmp/cal
  python3 -c "import brotli; open('/tmp/aws.tar','wb').write(brotli.decompress(open('/tmp/cal/bin/aws.tar.br','rb').read()))"
  tar xf /tmp/aws.tar -C /tmp/snap/libs lib/libnss3.so lib/libnssutil3.so lib/libsoftokn3.so
  cp /tmp/snap/libs/lib/*.so /tmp/snap/libs/
fi
if [ ! -f /tmp/snap/libs/libnspr4.so ]; then
  [ -d /tmp/nspr ] || git clone -q --depth 1 https://github.com/mozilla/nspr /tmp/nspr
  (cd /tmp/nspr && ./configure --enable-64bit >/dev/null 2>&1 && make -j4 >/dev/null 2>&1)
  cp /tmp/nspr/dist/lib/*.so /tmp/snap/libs/
fi
cp "$OG"/tools/p2probe.mjs "$OG"/tools/p34probe.mjs "$OG"/tools/p5probe.mjs /tmp/snap/ 2>/dev/null || true
echo "== restore complete. Serve with:"
echo "   (cd /home/user/og-sandbox && python3 -m http.server 5176 --bind 0.0.0.0)"
echo "   (cd $REPO/fidelity && python3 -m http.server 5175 --bind 0.0.0.0)"
