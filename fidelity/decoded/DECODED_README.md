# Decoded game data (from the user's "x" upload, commit 36f9313)

The raw extracted game files stay LOCAL ONLY under the repo root
(`Catalog/`, `Chardata/`, `FrontEnd/`, `Mission1/`…`Mission12b/`, `Data/`)
— they are git-ignored and must not be redistributed. Everything in this
`fidelity/decoded/` folder is our own decode output.

## What was cracked

| Format | Tool | Output |
|---|---|---|
| `.loc` (SLOC string tables, 56 files, 8 languages) | `fidelity/tools/decode_loc.py` | `decoded/loc/**` JSON |
| `.img` (imgf texture atlases: GWInt, CDSFont…) | `fidelity/tools/extract_img.py` | `fidelity/textures/ui/` (115 icons, 391 glyphs) |
| `.dat` archives | `reverse_engineering/verify_dat.py` | catalogued in REFERENCE_INDEX.md |
| `.evo` models/anims | ModKit `evo_convert.py` | `fidelity/models/**` GLBs |
| everything else | `fidelity/tools/index_reference.py` | `decoded/REFERENCE_INDEX.md` (3,623 files) |

`.loc` layout: `SLOC`, u32 v1, u32 nLanguages=8, u32 nStrings; `LANG`
(language names + 1-based index) … `LEND`; `STRN` + build stamp; then
records `name\0 text\0` per language (English first). Decoded highlights:
GenStrs (343 strings: menu/HUD/ranks), and per-mission `*Strs.loc` giving
the REAL objectives — e.g. Mission 1 = Rescue Foley → Recover the C4 →
Destroy the bridge → Extraction.

## How the game uses this

- Objective banner text now comes from `M01Strs.loc`.
- HUD/menu strings (OBJECTIVE, SUCCESS…) come from `GenStrs.loc`.
- All future missions (2–12b) already have their string tables decoded in
  `decoded/loc/`, ready to drive `Mission2…Mission12b` builds.
