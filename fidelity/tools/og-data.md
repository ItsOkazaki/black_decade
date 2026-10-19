# Original-game data mined from the shipped files (static analysis only)

Sources on disk (never executed): `DesertStorm.exe`, `Mission1.dll`,
`FrontEnd.dll`, `Catalog/*.txt`, `default.key`. Extracted with string
xrefs + Capstone disassembly of the exe's own stat loaders
(`loadHumanStats`, `loadWeaponStats`, `loadInventoryStats`).

## Health (Catalog/0074. HStat.txt)
Columns beyond the first are parser-verified only for field 1 so far;
field 1 behaves exactly like a health pool (role-graded):
- ALL Iraqi combatants (regular / elite / officer / bodyguard): **48**
- US_Delta_Force **100**, US_POW 100, US_Infantryman 150
- IR_Saddam 400, Allied_POW 400 (protected/boss)
Fields 7/15: 140 (US) vs 90 (Iraqi); field 8: 70 vs 60 — consistent with
perception range / accuracy, **inferred, not yet proven**.

## Weapons (Catalog/0071. Weaps.txt, `loadWeaponStats`-validated)
Damage / range: M16A2 14/900, SAW 15/850, AK47 14/780, AK74 14/900,
MP5SD 12/700, SIGP228 15/340, Beretta92F 15/385, PSG1 50/1000,
SVD 50/1000, Barrett 80/1000, LAW66 550/90, LAW80 550, RPG7 550.
Fire-intervals: rifles 0.08, LMG 0.10, pistols 0.10-0.20.
Fire-on-move flag: YES for rifles/pistols, NO for SAW/snipers/launchers.
Rows also carry OG animation names (`upright_aim_rifle`,
`prone_reload_LMG`, `kneeling_aim_LAW`) and sight values
(rifle 35/25, sniper 20/8 — inferred zoom FOVs).

## Items (Catalog/0072. Inven.txt, `loadInventoryStats`-validated)
The "damage" column doubles as effect strength / minFOV:
- MediKit: damage = **100** → medikit heals 100 (full).
- Binoculars: minFOV **10**, maxFOV 35.
- Ammo_Frag: roundsPerPack 3.

## Vehicles (Catalog/0075. VStat.txt)
BMP2 hull 500 → one LAW66 rocket (550) kills it. T62/T72 ~500-545.

## Menus / sights in the exe
`DifficultyMenu.cpp` exists (effects not yet extracted — the web
DIFF multipliers remain an approximation). `IMAGE_BINO_SIGHT` /
`IMAGE_SCOPE_SIGHT` are real GWInt artwork names; their pixels live in
an image bank not yet decoded (`.img` banks are metadata-only so far).

## Adopted in the web build (v70)
Enemy HP 48 x difficulty; weapon damage = Weaps.txt values; medikit
heals 100; binocular FOV 10; BMP hp 500; rocket anti-armour 550.
