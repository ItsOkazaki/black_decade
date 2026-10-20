# CONFLICT: DESERT STORM — browser assembly (plan-first rebuild)

The original game, assembled fresh from its own decoded files. This replaces
nothing: the BLACK DECADE build under `fidelity/` is untouched and remains the
fallback (git tag `black-decade-final-v73`).

## Run it
Served as the root of the sandbox: `/home/user/og-sandbox/index.html`
(the `rework` preview, port 5176). `game/cds.js` is the whole engine;
`game/assets/{models,textures,sounds}`, `game/vendor`, `game/data/og-*.json`
and `game/missions.json` are symlinks into `fidelity/` — the original game's
converted assets and Catalog tables. `game/data/mission-text.json` here is the
decoded English text of `Mission1/M01Strs.loc` (SLOC format: UTF-16LE strings).

## What is original vs new
- Original: title artwork (defload_us), squad (Bradley/Connors/Jones/Foley),
  mission placements (units.json/props.json from the mission files), weapon
  and human stats (Weaps.txt/HStat.txt), briefing + objectives (.loc),
  models, the 79-clip animation library, sound banks, portraits, HUD layout.
- New: only the engine code that assembles those pieces (cds.js, ~860 lines).

## Verified
`tools/p2probe.mjs` — 15/15: title (no BLACK DECADE anywhere), original
briefing text, deploy, 3-man squad + Foley prisoner, 27 hostiles, fire/move/
kill, rescue → C4 → bridge → extraction → MISSION COMPLETE. Missions 2 and 5A
also load their real unit placements with 0 page errors.
