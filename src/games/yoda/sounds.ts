/**
 * Sons de Yoda Stories : index dans la table SNDS de YODESK.DTA (noms de WebFun). Les fichiers sont dans `SFX/`.
 * Les ids 13, 28 et 30 répètent banglrg, switch-4 et moverock ; l'entrée 45 est vide.
 */
export const YodaSounds = {
  Schwing: 0,
  Push: 1,
  Switch7: 2,
  Shpoonk: 3,
  Hurt: 4,
  Eep: 5,
  NoGo: 6,
  Blaster: 7,
  Rifle: 8,
  SaberSwing: 9,
  Force: 10,
  BangLarge: 11,
  BangMedium: 12,
  BangHuge: 14,
  DoorElectric: 15,
  DoorPneumatic: 16,
  HugeDoor: 17,
  SaberOut: 31,
  Armed: 32,
  Grenade: 33,
  Locator: 34,
  MapClose: 35,
  XWingIn: 38,
  XWingOut: 39,
  R2D2a: 42,
  R2D2b: 43,
  ArmForce: 52,
  // Musiques (WAV)
  Cantina: 55,
  Flourish: 58,
  EmpireTheme: 59,
  Mystery: 60,
  Opening: 61,
  TryAgain: 62,
  YouWin: 63,
} as const;

/** Les musiques sont des WAV comme les bruitages : elles se distinguent par leur id (une seule joue à la fois). */
export const YODA_MUSIC: ReadonlySet<number> = new Set([
  YodaSounds.Cantina,
  YodaSounds.Flourish,
  YodaSounds.EmpireTheme,
  YodaSounds.Mystery,
  YodaSounds.Opening,
  YodaSounds.TryAgain,
  YodaSounds.YouWin,
]);
