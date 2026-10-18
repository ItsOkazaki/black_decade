// BLACK DECADE — shared squad data, transcribed from the game's own files:
//   Catalog/0071. Weaps.txt   (weapon stats, models, icon names, sound banks)
//   Catalog/0072. Inven.txt   (inventory items + icons)
//   Catalog/0096. Units.txt   (hero roles: RIFLEMAN / HEAVY WEAPONS /
//                              COMBAT ENGINEER / SNIPER)
//   Catalog/0104. UnitWpns.txt(per-man weapons: knife, binoculars, medikit,
//                              frag + smoke grenades for all four)
//   Catalog/0095. ConnObjs.txt + Mission1.env HLOI records (worn gear:
//                              connector -> model, per role, SAS rows)
// Loaded as a classic script before the module scripts; exposes window.BD.
window.BD = (() => {
  const ICON = n => 'textures/ui/gwint/' + n + '.png';

  // guns: key -> Weaps.txt row (mag, reload s, shot interval s, damage class)
  // full display names from decoded InvStrs.loc (Catalog/0003)
  const WEAPONS = {
    M16A2:   { label: 'M16A2',        name: 'Colt M16A2 Assault Rifle',              type: 'GRENADE LAUNCH/RIFLE', mag: 30,  reload: 1.5, interval: 0.086, dmg: 34, burst: 4, acc: 0.38, model: 'models/scene/Rifle02_M16wM203.glb',        icon: 'IMAGE_WEAPON_M16M203',     bank: 'M16A2' },
    SAW:     { label: 'M249 SAW',     name: 'M249 Squad Automatic Weapon',           type: 'MACHINE GUN',          mag: 100, reload: 2.0, interval: 0.10,  dmg: 30, burst: 9, acc: 0.30, model: 'models/weapons/LMG01_M249SAW.glb',       icon: 'IMAGE_WEAPON_SAW',         bank: 'SAW-LIGHTMG' },
    BARRETT: { label: 'BARRETT L50',  name: "M82A1 Barrett 'Light Fifty' Sniper Rifle", type: 'SNIPER RIFLE',      mag: 11,  reload: 1.5, interval: 1.15,  dmg: 95, burst: 1, acc: 0.65, model: 'models/weapons/Sniper01_BarretL50.glb',   icon: 'IMAGE_WEAPON_BARRETSNIPER', bank: 'BARRETTSNIPER' },
    SIGP228: { label: 'SIG P228',     name: 'SIG P-228 Silenced Pistol',             type: 'PISTOL',               mag: 13,  reload: 1.5, interval: 0.20,  dmg: 22, burst: 1, acc: 0.30, model: 'models/weapons/Pistol03_SIGP228.glb',    icon: 'IMAGE_WEAPON_SIG_P228',    bank: 'SIGP228' },
    LAW66:   { label: 'LAW 66',       name: 'LAW 66 Anti-tank Rocket Launcher',      type: 'ANTI TANK',            mag: 1,   reload: 3.0, interval: 1.0,   dmg: 300, burst: 1, acc: 0.90, model: 'models/weapons/Law66_AntiTankLauncher.glb', icon: 'IMAGE_WEAPON_LAW66',    bank: 'LAW66', rocket: true },
    RPG7:    { label: 'RPG-7',        name: 'RPG-7 Anti-Tank Rocket Launcher',       type: 'ANTI TANK',            mag: 1,   reload: 2.6, interval: 1.2,   dmg: 320, burst: 1, acc: 0.90, model: 'models/weapons/RPG7.glb',               icon: 'IMAGE_RPG7_ANTITANKLAUNCHER', bank: 'LAW66', rocket: true },
    PSG1:    { label: 'PSG-1',        name: 'H&K PSG-1 Sniper Rifle',                type: 'SNIPER RIFLE',         mag: 20,  reload: 1.8, interval: 0.75,  dmg: 92,  burst: 1, acc: 0.62, model: 'models/weapons/PSG1.glb',               icon: 'IMAGE_WEAPON_PSG1SNIPER', bank: 'BARRETTSNIPER' },
    KNIFE:   { label: 'COMBAT KNIFE', name: 'Combat Knife',                          type: 'MELEE',                mag: 0,   reload: 0,   interval: 0.55,  dmg: 200, burst: 1, acc: 1.0, model: 'models/weapons/Knife01_Combat.glb',       icon: 'IMAGE_WEAPON_KNIFE',       bank: null, melee: true },
    AK47:    { label: 'AK-47',        name: 'AK-47 Assault Rifle',                   type: 'RIFLE (ENEMY)',        mag: 30,  reload: 2.2, interval: 0.11,  dmg: 26, burst: 5, acc: 0.28, model: 'models/enemy/Rifle05_AK47.glb',            icon: 'IMAGE_WEAPON_AK47',        bank: 'AK47' },
  };

  const ITEMS = {
    FRAG:       { label: 'FRAG GRENADE',  name: 'MK3A2 Concussion Offensive Hand Grenade', icon: 'IMAGE_GRENADE_FRAG',        model: 'models/weapons/Grenade_Frag.glb' },
    SMOKE:      { label: 'SMOKE GRENADE', name: 'Smoke Grenade',                           icon: 'IMAGE_GRENADE_SMOKE',       model: 'models/weapons/Grenade_Smoke.glb' },
    MEDIKIT:    { label: 'MEDI KIT',      name: 'MediKit',                                 icon: 'IMAGE_WEAPON_MEDIPACK',     model: 'models/weapons/MediKit.glb' },
    BINOCULARS: { label: 'BINOCULARS',    name: 'Binoculars',                              icon: 'IMAGE_WEAPON_BINOCULARS',   model: 'models/weapons/Binoculars.glb' },
    C4:         { label: 'C4 CHARGE',     name: 'C4 Plastic Explosive',                    icon: 'IMAGE_WEAPON_C4',           model: 'models/weapons/Explosive01_C4.glb' },
  };

  const NAMES = ['BENALI', 'CHERIF', 'BOUDIAF', 'ZIANI'];
  const FULL = ['YACINE BENALI', 'SOFIANE CHERIF', 'Amine BOUDIAF', 'KARIM ZIANI'];
  const ROLES = ['RIFLEMAN', 'HEAVY WEAPONS', 'COMBAT ENGINEER', 'SNIPER'];

  // held slots per man: UnitWpns.txt + Bradley's Mission1.env live loadout
  // (M16A2 + SIG P228 + frag + smoke + LAW 66). Jones rates C4 (engineer).
  const LOADOUTS = [
    [ { kind: 'gun', key: 'M16A2' }, { kind: 'gun', key: 'SIGP228' }, { kind: 'gun', key: 'KNIFE' },
      { kind: 'item', key: 'FRAG', count: 2 }, { kind: 'item', key: 'SMOKE', count: 2 },
      { kind: 'gun', key: 'LAW66', count: 1 }, { kind: 'item', key: 'MEDIKIT', count: 5 },
      { kind: 'item', key: 'BINOCULARS' } ],
    [ { kind: 'gun', key: 'SAW' }, { kind: 'gun', key: 'SIGP228' }, { kind: 'gun', key: 'KNIFE' },
      { kind: 'item', key: 'FRAG', count: 2 }, { kind: 'item', key: 'SMOKE', count: 1 },
      { kind: 'item', key: 'MEDIKIT', count: 5 } ],
    [ { kind: 'gun', key: 'M16A2' }, { kind: 'gun', key: 'SIGP228' }, { kind: 'gun', key: 'KNIFE' },
      { kind: 'item', key: 'FRAG', count: 2 }, { kind: 'item', key: 'SMOKE', count: 2 },
      { kind: 'item', key: 'C4', count: 2 }, { kind: 'item', key: 'MEDIKIT', count: 5 } ],
    [ { kind: 'gun', key: 'BARRETT' }, { kind: 'gun', key: 'SIGP228' }, { kind: 'gun', key: 'KNIFE' },
      { kind: 'item', key: 'FRAG', count: 2 }, { kind: 'item', key: 'SMOKE', count: 1 },
      { kind: 'item', key: 'MEDIKIT', count: 5 } ],
  ];

  // worn kit: ConnObjs.txt SAS rows + the exact set on Bradley's live
  // Mission1.env record (cap, medium pack, bottle/pouch/ammo on the belt).
  const GEAR = [
    [ ['HAT', 'UK_Cap_Green', 'CAP — GREEN'], ['SPINE1', 'UK_BackpackMedium', 'BACKPACK — MEDIUM'],
      ['SPINE2', 'UK_BottlePouch01', 'BOTTLE POUCH'], ['SPINE2L', 'UK_PouchMedium01', 'POUCH — MEDIUM'],
      ['SPINE2R', 'UK_AmmoPouch01', 'AMMO POUCH'] ],
    [ ['HAT', 'UK_WoollyHat', 'WOOLLY HAT'], ['SPINE1', 'UK_BackpackLarge', 'BACKPACK — LARGE'] ],
    [ ['HAT', 'UK_Helmet_Desert', 'HELMET — DESERT'], ['SPINE1', 'UK_BackpackMedium', 'BACKPACK — MEDIUM'],
      ['SPINE2', 'UK_BottlePouch01', 'BOTTLE POUCH'], ['SPINE2L', 'UK_AmmoPouch01', 'AMMO POUCH'],
      ['SPINE2R', 'UK_AmmoPouch01', 'AMMO POUCH'] ],
    [ ['HAT', 'UK_Hat_Desert', 'HAT — DESERT'], ['SPINE1', 'UK_BackpackMedium', 'BACKPACK — MEDIUM'],
      ['SPINE2', 'UK_PouchMedium01', 'POUCH — MEDIUM'], ['SPINE2L', 'UK_AmmoPouch01', 'AMMO POUCH'],
      ['SPINE2R', 'UK_BottlePouch01', 'BOTTLE POUCH'] ],
  ];
  return { ICON, WEAPONS, ITEMS, NAMES, FULL, ROLES, LOADOUTS, GEAR };
})();
