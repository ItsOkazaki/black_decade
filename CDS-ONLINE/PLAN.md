# CONFLICT: DESERT STORM — RECONSTRUCTION PLAN

*Written before building. Evidence-based: every claim below was verified against
the files on disk this session (see `census.md`). The rule for all work that
follows: **no invented numbers.** Every gameplay value comes from a game file
(with file + line/address recorded) or is marked `UNKNOWN` in the data and
treated as a research task — never silently approximated.*

---

## 0. What went wrong before (and is being deleted)

Two failed approaches, both now frozen/deleted:
- **BLACK DECADE** — a reskin with invented mechanics. Frozen untouched under
  `/home/user/black_decade/fidelity/`, git tag `black-decade-final-v73`. Fallback only.
- **First CDS assembly (`cds.js`)** — real assets but invented engine behaviour:
  approximated movement/AI/camera/combat, CSS-styled menus. Looked wrong because
  it *was* wrong. Deleted from the sandbox (kept only in git history `077c740`).

The map "looked right" in that attempt because it used the original geometry.
Everything else must be rebuilt *from the data that defines it*, below.

## 1. Source census (verified, Phase 0 output in `census.md` / `data/census.json`)

Archives on disk (extracted to `src-extract/`, 4,443 files):
`catalog.dat, frontend.dat, chardata.dat, mission1.dat, training1.dat, mp_mission1.dat`.
Plus loose extracted folders (`Catalog/`, `FrontEnd/`, `Mission1/`, `Training1/`, `Data/`)
and `DesertStorm.exe` + mission DLLs.

| Family | Where | Status |
|---|---|---|
| Text tables (Weaps, HStat, Inven, Units, VStat, +11 more) | `Catalog/*.txt` (26) | ✅ readable; partly decoded |
| State machines (Movement/UpperBody/Vehicle rules) | `Catalog/0006–0008` | ✅ text — **not yet implemented anywhere** |
| UI text (all screens, 6 languages) | `*.loc` SLOC | ✅ decoder written; 8,146 keys (EN) |
| Mission text (briefings/objectives) | `Mission1/M01Strs.loc`, `Training1/T01Strs.loc` | ✅ decoded |
| Mission titles | `TitleStrs.loc` | ✅ "Rescue", "Safe Passage", "SCUD Boulevard", … |
| Geometry (EVO), animations (PRB, 203/archive) | all `.dat` | ✅ evo_convert (ModKit) |
| Mission scenes/placements (zones, statics, units, waypoints, triggers, cutscene cams) | converted `units.json`/`props.json` | ✅ for all 15 SP + training 2/3 |
| Sound banks (.sch/.sbk), UI/menus | `Data/`, archives | ✅ WAV-decodable (bank-name hash) |
| Music (8 tracks) | `Data/Sound/*.psf` | ❌ proprietary `PSF` variant — Research R2 |
| Mission scripts | `Mission1.dll` etc. | ⚠️ strings only; VM bytecode — Research R1 |
| Difficulty effects, movement constants, damage falloff | `DesertStorm.exe` | ⚠️ loaders pinned, numbers sealed — Research R3 |
| Missions 2–15 **raw** archives | — | ❌ **not on disk** (converted survivors only) |

**Consequence:** mission 1 (and training 1) can be assembled 100% from raw
sources. Missions 2–15 assemble from their converted geometry/placements
(same original data, one conversion removed); their `.loc` briefings and
`.sch` banks are a documented GAP until the missing `.dat` files are supplied
(list in §7). Nothing will be faked to hide that gap.

## 2. Architecture (modern, data-driven)

- **Engine:** new TypeScript-free ES-module WebGL engine (Three.js), written
  fresh in `/home/user/cds-og/game/`. No code reused from either failed build.
- **Asset pipeline (owned, rerun from sources):** `src-extract/` EVO+PRB →
  glTF via `evo_convert.py`; DDS → PNG; `.img` banks → sprite atlases
  (imgf format already cracked); `.sch` → WAV; `.loc`/`.txt` → `data/` JSON.
  Every generated file carries provenance in `data/manifest.json`
  (source path + sha). No symlinks into the old project.
- **Data layer:** the game reads *only* `data/*.json` derived from the tables
  (weapons, humans, units, items, vehicles, rules, strings, missions).
  If a value isn't in the data, the feature doesn't ship.
- **Frontend = the original frontend.** Screen flow, labels and layout from
  `TitleStrs/PCStrs/GenStrs.loc` + `frontend.dat` bitmaps + CDSFont glyphs
  (Catalog 0009 imgf) + GWInt interface art (0010). No CSS-invented styling
  where original art exists; DOM text only where the original used text.
- **Simulation = the original state machines.** `MovementStateRules.txt` and
  `UpperBodyStateRules.txt` are implemented *literally* (states, transitions,
  per-state animation mapping), not re-imagined. Weaps `fireOnMove`, stance
  and planted-reload rules come from the tables, not preference.
- **Verification:** headless rig probes per phase (below) + screenshot
  comparison against the original bitmaps + measured-value assertions
  (e.g. run speed measured in-engine vs the exe-mined constant).

## 3. System-by-system assembly

1. **Frontend** — title (original art) → main menu → single player →
   mission select (original mission bitmaps + `MISS*_TITLE`) → **loadout**
   (InvStrs + `Inven.txt` + `UnitWpns.txt`: per-soldier equipment, exactly as
   the original screen works) → briefing (per-mission `.loc`: date, heading,
   body, objectives) → loading screen (bar semantics from `.FAS` manifests)
   → in-game → pause/debrief (GenStrs). Options from PCStrs vocabulary.
2. **Squad & characters** — `Units.txt` roster: Bradley/Connors/Jones/Foley →
   `US_Infantryman00–03` (roles Rifleman/Heavy Weapons/Combat Engineer/Sniper,
   Rookie experience, score values), chardata models + face variants + gear
   attached at the connectors the `.env` gear lists name (hat, backpack,
   pouches). `HStat.txt` health (hero 150, Iraqi 48 — loader-pinned).
3. **Movement & animation** — the two rules files as executable state machines;
   the 79+-clip PRB library mapped per state; stance (stand/crouch/prone),
   crawl, aim-pose, planted rules. Speeds/gravity: Research R3 constants;
   until mined, marked UNKNOWN, tuned only against the rules files' own numbers.
4. **Combat** — `Weaps.txt` complete rows (damage, range, magazine, reload,
   interval, fire-on-move, class), projectile weapons (LAW/RPG per class +
   `VStat` armour: BMP2 500 vs rocket 550), sights from Effects.img
   (binocular FOV 10–35 from `Inven.txt`, scope/AT overlays), grenades/C4/items
   per `Inven.txt`, hit/death animation set, tracers (colour source: exe, R3).
5. **Vehicles** — `VStat.txt` (52 rows), `.DYN` dynamics params,
   `VehicleStateRules.txt`, `ExMods.txt` explosion modifiers.
6. **Structures & interactivity** — `Structs.txt`/`featStat.txt` (structure HP),
   `Doors.txt`, `Switches.txt`, `Targets.txt` wired to env triggers
   (e.g. MAIN_GATE_SWITCH).
7. **AI** — waypoint-graph pathing (367 nodes in M1), guard posts from env
   instance data, perception from HStat fields (semantics via R3 loader
   disassembly: fields after health ≈ 140/90/70/60 currently *inferred*),
   hearing + alert propagation, cover/stance behaviour as the state rules +
   observed OG behaviour dictate. No telepathy: LOS via terrain geometry.
8. **Missions** — objectives from `.loc` + trigger graph; M1's full chain
   (rescue Foley → recover C4 → bridge struts → Black Hawk extraction at the
   PICKUP_BLACKHAWK_TRIGGER, gate switch, MiG flyover trigger), cutscene
   cameras (`props.cutscenes`: FREE/TARGOBJ shots) + `MOV_TXT*` subtitles.
   Scripted extras beyond triggers: R1.
9. **Audio** — all `.sch` banks (weapons, voices, explosions, UI clicks),
   frontend music; in-mission music blocked on R2 (PSF) — interim: the
   decoded menu/cutscene WAVs only, flagged, never synthesized substitutes.
10. **Save/config** — `default.key` bindings honoured as the default control map.

## 4. Research tracks (the genuinely sealed material)

- **R1 — Mission script VM.** Scripts are bytecode inside the mission DLLs
  (strings visible: "Bridge alarm will start soon", "IRAQI_TORTURER has raised
  the alarm"). Attack: locate the interpreter in `DesertStorm.exe` (xrefs to
  DLL loading + script string table), recover opcode set, write a disassembler,
  translate M1's script first. Until then: triggers + DLL strings are the spec.
- **R2 — PSF music.** Header `PSF`+0x60/0x80 variant ≠ standard PSF. Attack:
  entropy/structure analysis, exe audio-code xrefs (`frontendmusic.psf`,
  `DS-*`), similar Pivotal titles. Fallback: ask user for the tracks from
  their full install in a common format.
- **R3 — Exe constants & tables.** Loaders already pinned statically
  (Weaps 0x411747, Inven 0x4117e4, HStat 0x41188e, `loadHumanStats`
  0x491e5d — field offsets float@0xa/word@0xe/float@0x12/byte@0x16/word@0x18/
  byte@0x1a). Next: difficulty table (DifficultyMenu xrefs 0x413439/0x41349c),
  movement/gravity/camera constants, HStat field semantics, tracer params.
  Static only — the exe cannot run here (no Wine/X/GL in this sandbox).

## 5. Phases (each ends green on its rig probes or it isn't done)

- **P0 — Census & decoders** ✅ (this document; `census.md`, `data/loc/*`,
  manifest started). Exit: every file on disk counted & classified.
- **P1 — Owned asset pipeline.** ✅ DONE (457 GLBs with animation sets, all tables, 391 CDSFont glyphs + GWInt/Effects banks, sound banks, menu music). Rerun conversions from `src-extract/` into
  `game/assets/` with manifest. Exit: mission1 + chardata + frontend trees
  complete, hashes match sources, zero references to the old project.
- **P2 — Frontend.** ✅ DONE (title→main→missions→briefing→loadout→loading, probe 10/10). Original screens end-to-end (no gameplay): title → menus →
  mission select → loadout → briefing → loading. Exit: screenshot set matches
  original bitmap references; all labels from `.loc`; CDSFont rendering.
- **P3 — M1 vertical slice.** ✅ DONE (probe 17/17 jointly with P4: ENV world incl. HLOI statics/bridge, literal MovementStateRules machine — RUNNING/KNEELING/CRAWL verified; speeds PROVISIONAL (clips are in-place; exe constants = R3). Landscape + statics + squad + movement state
  machine + one rifle, faithful by the rules files. Exit: movement probes
  (speeds/stances/fire-on-move measured), screenshot pass, 0 errors.
- **P4 — Combat & AI complete (M1).** ✅ DONE (same probe: Weaps damage exact 48→34, mag burn, waypoint/post/alert/engage AI, rescue→C4→bridge→extraction chain, mission complete; 25/40 mission1 sound banks recovered by name). All M1 weapons/enemies, perception,
  waypoint AI, objectives chain, Black Hawk extraction, gate switch.
  Exit: full-arc probe green; difficulty = OG Normal table values.
- **P5 — All missions + vehicles + interactivity.** ✅ DONE (probe suite:
  15/15 SP missions boot with placement-exact hostile counts — survivor
  `enemiesHLOI` as spawn source, unit-matched where instance names survive;
  training1 from its real ENV + training2/3; VStat vehicles live: BMP2
  armour 500 / HP 1000 vs LAW66 550 penetration math exact, VehicleStateRules
  tank machine drives `STATE_TANK_MOVING_FORWARDS`, enemy BMP engages with
  `IR_VWPN_BMP2_ChainGun`; Doors.txt sliding gates paired to `*_SWITCH`
  regions (MAIN_GATE_SWITCH → Mission1Gate, 800 cm travel). Survivor-mission
  objectives are honestly GAP (mission script = DLL, R1): free combat —
  clear all hostiles, or reach the Black Hawk after contact. Vehicle speeds
  and player-driving marked PROVISIONAL (`.DYN` semantics = R3).
- **P6 — Audio & cutscenes.** ✅ DONE (probe: p6probe 16/16; regressions
  p34 17/17, p5 veh 12/12 + train 7/7 + SP sample). What shipped:
  `tools/envparse.py` now also parses the ENV `CAMFREE`/`CAMTARGOBJ`
  camera records (M1: 24 cameras incl. `PLAYERVIEW` + `CS_*` scenes) and
  the 38 `ENVSND` ambient emitters; survivors carry `props.cutscenes`.
  The sim plays a skippable intro cutscene from those records (CS_*
  actors placed for the scene and removed at its end, MOV_TXT1-3 title
  cards from the mission's own `.loc`, the decoded `CS_MENU_S01.wav`
  stream under M1's intro). Every sound the sim makes is logged
  (`CDS_SIM.audio()`); weapon fire, enemy first-contact barks
  (`Iraqi_Soldier` bank), Foley's rescue line (`Foley …follow_me…`) and
  HQ radio on the bridge kill (`Mission1` bank) all play the game's own
  hash-recovered bank samples, picked by the lines' own semantic
  suffixes. Voice banks are per-mission (`.sch` recovery: mission1 33,
  training1 14 banks). Known gaps, stated not filled: the `ENVSND`
  `.psf` stream files are absent from the supplied archives (emitters
  exposed via `CDS_SIM.envsnd()`, silent); the six `DS-*` music tracks
  remain R2; survivor-mission cutscenes have cameras but no title cards
  (their `.loc` files were not supplied).
- **P7 — Hardening.** ✅ DONE (exit gate green: p7probe 28/28, p34 17/17,
  p6 16/16, p5 veh 12/12 + train 7/7 + SP 46/46, p2 10/10, zero page
  errors). Controls are now the game's own `default.key` (74 actions,
  `tools/pipeline.py` -> `data/tables/defaultkey.json`): FORWARD/BACKWARD/
  STRAFE (W/S/A/D), TURN (comma/period; rate PROVISIONAL), WALK hold
  (LCTRL), STANCE cycle (SPACE), GRUNT_1..4 (1-4), NEXT/PREV_GRUNT
  (PAGEUP/PAGEDOWN), ACTION (R — the OG use key; with no prompt showing
  it reloads, as the OG has no separate reload key), FIRE (MOUSE 0 /
  KP_0), OBJECTIVES (F1), PAUSE (ESC), MOVIE_CANCEL (ESC/MOUSE 0), and
  the hold-SHIFT inventory (W/S navigate, release equips) that replaces
  the invented Q/E/wheel weapon switching. JOY_* bindings are parsed
  but have no browser analogue. Pause/restart/death flows speak GenStrs
  (Catalog_0001): "GAME PAUSED", "RESTART LEVEL", QUITTER->"RESUME",
  "MISSION FAILED", "MAIN MENU"; the failure screen gained its
  RESTART LEVEL flow. Perf, measured headless (SwiftShader CPU —
  a real GPU machine does far better; stated, not spun): Mission 1
  build is 1,952 placements / 3,356 terrain meshes after single-mesh
  instancing merged the repeated props (445 placements, e.g. 138 trees;
  worst-vantage draw calls 1,730 -> 1,684 at ~53-60k triangles — the
  trade is fewer calls for coarser culling, recorded as such), 4,632
  static world matrices frozen (doors/vehicles excluded), and all
  distinct models preload concurrently instead of serialized awaits
  (sim-side load ~4.6 s here, GLB-parse bound). One genuine bug fell
  out: transition clips (START_*/STOPPING/DYING) looped forever, so
  MSR_ANIM_FINISHED could never fire and a prone soldier could never
  stand — they now play once, per the rules file's own semantics.
  Remaining honest gaps: full R1 script VM (survivor objectives),
  R2 music layout, R3 exe constants (speeds/turn rate PROVISIONAL).
- **R-tracks run in parallel**; their outputs land as data updates (no rewrites).

## 6. Kill list & boundaries

- Deleted: prior `cds.js` attempt (sandbox copy). Frozen: BLACK DECADE.
- The sandbox (`rework`, port 5176) shows: the original title art, this plan,
  phase status, original-file downloads, and the frozen fallback — until P2
  lands, when the frontend replaces the placeholder *at the same address*.
- Nothing merges to `main`; work stays on the session branch / in `cds-og/`.

## 7. Needed from the user (non-blocking)

To close the M2–15 gap completely, the missing archives from a full install:
`mission2.dat … mission12b.dat` (incl. 5a/5b, 11a/11b, 12a/12b),
`training2.dat`, `training3.dat`, `mp_mission2–6.dat`. Until then those
missions run on their surviving converted data with briefings marked GAP.
