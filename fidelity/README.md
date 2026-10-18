# Asset fidelity tests + playable slice

Everything here is converted from the original archives with the public
ConflictDesertStormModKit (https://github.com/eSKylezZ/ConflictDesertStormModKit)
— `cli/evo_convert.py` for models/animations, `cli/ds_sound.py` for sounds.
No extracted assets leave this machine; this is a private/personal project.

## Pages (serve this folder, e.g. `python3 -m http.server 5175`)

- `index.html` — static fidelity test: Hero01_Armstrong + GuardTower, turntable,
  wireframe, 4 original animations.
- `scene.html` — real scene test: Armstrong with Rifle02_M16wM203 attached at
  `Bip01 GunR Connector`, Mission1 environment corner, original M16A2 sounds.
- `play.html` — **playable slice** (the game-feel testbed):
  WASD move (run default, Ctrl walk, Shift sprint), mouse-move look,
  RMB aim + zoom, LMB fire, R reload, C crouch, X prone.
  Weapon behaviour from Catalog WEAPS.TXT US_WPN_M16A2 (mag 30, 1.5 s reload,
  86 ms interval). Two-handed grip alignment in aim/prone/crouch poses;
  aim-move and reload-move use leg/upper-body blended original animations.

## Conversions used

- Hero: `FrontEnd/Hero01_Armstrong.evo --helpers` + 13 .prb animations
  (idle/aim/walk/run/strafe E-W/reload/crouch-walk/prone aim/crawl/reload/turns).
- Rifle: `FrontEnd/Rifle02_M16wM203.evo` (WEAPS.TXT's visual for US_WPN_M16A2).
- Env: GuardTower, Mission1_GuardHouse_Exterior, M3_Tent01,
  SandBags2_High_Corner, Crate2, Dyn_Barrel1_Static (Mission1).
- Sounds: `ds_sound.py wav mission1.sch M16A2` → click/shot1/shot2/tail.

## Project: BLACK DECADE

Own game on this foundation — theme changed completely from the Gulf War to
Algeria's Black Decade (1990s civil war): new factions, names, scenarios and
characters; the original game's mechanics, animation and asset pipeline
underneath. Extracted assets stay private/personal.

## Polish status

- Animation loop seams: tail-to-head crossfade now baked into cyclic clips
  (walk/run/crouch/crawl/strafe/idle) at load.
- Movement speeds measured from the original clips (planted-foot velocity:
  walk 1.19, run 4.07, crouch 1.01 m/s); animation rate scales with ground
  speed so feet don't slide. Note speeds were NOT in the StateRules tables
  (those are state-transition graphs) — likely hardcoded in game code.
- Textures: enhance = up to 4x canvas upscale + contrast/saturation; real
  quality jump still needs offline AI upscale. Hand/face geometry is 2002
  low-poly regardless.
- No enemies yet — next milestone candidate: a real guard with the game's
  perception/firing behaviour, then a full mission .env scene.
