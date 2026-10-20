# PHASE 0 CENSUS — every Conflict: Desert Storm file on disk (verified 2026-10-20)

## Archives extracted (`src-extract/`, ds_extract.py): 4,443 files, 126 MB
| archive | files | named | top contents |
|---|---|---|---|
| catalog.dat | 110 | 50 | 60 .bin, 26 .txt (the stat/rule tables), 17 .png, 5 .img (CDSFont, GWInt, Effects…) |
| frontend.dat | 725 | 521 | 359 .dds, 203 .prb (animations), 132 .evo, menu bitmaps, FRONTEND.FAS |
| chardata.dat | 564 | 142 | 459 .dds, 37 .tga, 35 .evo (heroes/soldiers), CHARACTERS_*.RFX, WEAPONS.RFX |
| mission1.dat | 1,271 | 842 | 729 .dds, 290 .evo, 213 .prb, 13 .dyn, MISSION1.FAS |
| training1.dat | 909 | 664 | same families |
| mp_mission1.dat | 858 | 628 | same families + DEFAULT.SPL |

Loose folders from the player's own unpacking also on disk: `Catalog/` (146 files,
incl. 30 `.loc` = 5 string files × 6 languages), `FrontEnd/`, `Mission1/`
(`M01Strs.loc`), `Training1/`, `Data/` (8 PSF music tracks, `.sch` banks).

## Decoded this phase
- **All 42 `.loc` files** (SLOC = UTF-16LE string tables) → `data/loc/*.json`,
  8,146 English keys: GenStrs 612, PCStrs 144, InvStrs 87, MPStrs 143,
  TitleStrs 20 (mission titles!), M01Strs 47, T01Strs 51.
- `.FAS` = text asset manifests ("Loading Bar" + counts). `.DYN` = text vehicle
  dynamics. `.RFX` = text material/effect definitions. No script files exist —
  mission logic is bytecode inside the mission DLLs (Research R1).
- Pivotal `PSF` music (8 files, magic `PSF`+0x60/0x80): proprietary, Research R2.

## Mission-source survival
- **Complete from raw:** mission1, training1 (+ catalog/frontend/chardata).
- **Converted survivors only** (units.json + props.json + zone GLBs, no raw
  archive): mission2–12b (all 15 SP), training2/3. Their `.loc`/`.sch` are
  missing with the archives → briefings GAP until supplied (PLAN §7).
- **Absent entirely:** mp_mission2–6 landscapes.

## Stat/rule tables present (Catalog, plain text)
Weaps (76 weapons), Inven (39), HStat (23), VStat (52), Units (47),
featStat, Structs, Feats, Doors, Targets, Switches, UnitWpns, ExMods,
**MovementStateRules, UpperBodyStateRules, VehicleStateRules** (the original
state machines — the core of the faithful rebuild).
