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

## v65 additions (smarter AI round)

Also asserted: guard engages/plants/shoots without point-blank charges,
engaged enemies take crouch/prone firing postures, enemies throw grenades,
losing sight triggers a SEARCH with 26 s memory (not amnesia), SPACE tap
jumps (hold = inventory), and the KIA restart is an instant in-page reset
(a window marker proves no reload happened).

## Suites
- `shot3.mjs` — the mission-1 regression suite (44 state assertions: movement,
  stance, AI memory/search, posted sentries, death anims, hearing + contact
  alerts, smart grenades, full weapon audit, working main gate, no
  center-screen kill banner). Run: `node shot3.mjs` (~10 min, exits non-zero
  on failure).
- `shot4.mjs 0|1` — all-mission audit in two halves: every mission loads with
  zero page errors, every data-placed prop resolves, in-game enemy counts
  match the mission data (`max(units.enemies, props.enemiesHLOI)`).
- `probe20.mjs` — v68 squad orders (mission2): four distinct role weapons
  (BOUDIAF carries the PSG-1, not a second M16A2), the squad mirrors the
  leader's stance (stand/crouch/prone), a mate acquires and wounds targets
  at ~33 m, enemy voice lines play in combat.
- `probe21.mjs` — v68 mission-1 chain: wall segments harvested from the
  world geometry stop the player walking through buildings (an open-ground
  control still travels), taking the C4 *before* the rescue no longer
  deadlocks the objective chain (rescue skips straight to PLANT), the C4
  plants and detonates at the bridge, and an enemy grenade produces a real
  explosion. Wall-test note: the bridge is a through-truss — its side
  trusses are solid, so shot3's old "walk west off the deck" became a
  watchtower-platform ledge fall.
- `thumbs.mjs` — captures a mission's live establishing vista (used with an
  NVG grade) for the mission-select pictures of missions whose bitmaps are
  not in the archives we have.
- `../posebake_all.py` + `../skinbake.py` — bake the idle stance into
  data-placed character figures (heroes/NPCs the missions place as scenery);
  the statics system bakes raw geometry, so the pose must live in the
  vertices. Vehicle crew with authored seated bind poses are excluded.

## probe36.mjs — v69 item/pose/balance round

Asserts: wheel only cycles items while SPACE is held; medikit cannot be
aimed, rides one-handed (relaxed pose) and heals after the dressing pause;
knife held one-handed and kills at reach; frags throw once per click;
LAW66 gets the green glass + UPRIGHT_STANCE_WITH_LAW, RPG7 its own optic
(POSE families from the recovered `models/play/animlib.glb` — the original
game's full 79-clip set incl. UPRIGHT_STEALTH_KNIFE, UPRIGHT_USE_BINOCULARS,
KNEELING_PLANT_C4, UPRIGHT_HEADSHOT and the hashed throw/medkit clips
anim_10FF6EC2 / anim_85ABBE9A); binoculars raise the twin-lens mask and the
use-binoculars clip; head shots pay x2.6 but no longer one-shot (enemy HP
100; two M16 body hits = 56 left standing... head-shot kills play
UPRIGHT_HEADSHOT); difficulty EASY/NORMAL/HARD scales enemy HP 75/100/125
(OPTIONS screen, `bd_diff`) plus their accuracy/damage/reactions; a wounded
guard turns and hunts instead of standing in patrol; posted sentries scan
wide arcs and notice a standing man behind them. probe20's voice check now
polls its own window (the wounded-exit raced the contact shout once enemy
HP changed). Run: `cd /tmp/snap && node probe36.mjs`.
