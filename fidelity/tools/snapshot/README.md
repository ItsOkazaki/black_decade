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
