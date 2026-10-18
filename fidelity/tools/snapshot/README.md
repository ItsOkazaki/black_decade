# Snapshot self-review system

Headless-Chromium screenshots of the real game (WebGL via SwiftShader), so
changes can be *seen* without a local browser.

## Sandbox setup (already done once in /tmp/snap)
- `npm i puppeteer-core @sparticuz/chromium` (in /tmp/snap)
- Chromium needs libnss3/libnssutil3 (from chrome-aws-lambda's aws.tar.br)
  and libnspr4/libplc4/libplds4 (NSPR built from github.com/mozilla/nspr
  with CPATH=/tmp/fakeinc:/usr/include/x86_64-linux-gnu and -m64 forced)
  in /tmp/snap/libs, passed via LD_LIBRARY_PATH.
- Serve fidelity/ on :5175, then `node shot.mjs` (full pass: menu, force,
  mission slider, briefing, cutscene, gameplay, walked, aim) or `shot2.mjs`
  (cutscene/gameplay/inventory/sprint verification). Shots land in
  /tmp/snap/shots*/ and can be read back as images for review.

Note: SwiftShader runs at a few FPS, so game-time (dt-clamped) advances
slower than wall time — allow generous waits.

## shot3.mjs — state-assertion tests (v64 bug round)

Drives the game through `window.BD_TEST` hooks and asserts behaviour, not
just pixels: no pre-carried C4, pickups work with E + flash, tank patrols,
finite ammo (reload drains reserve exactly), guards shoot from their post,
falls hurt/kill, LAW sight + rocket damages armour (900→560), death shows
the KIA screen, restart resets HP/ammo, bridge deck crossable + gorge
passable underneath. SwiftShader runs game-time ~20x slower than wall
clock, so every wait polls game state — never fixed sleeps. Exit code 0 =
all passed. Run: `cd /tmp/snap && node shot3.mjs` (game must be served on
:5175 as above).
