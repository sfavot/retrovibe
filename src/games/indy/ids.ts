import { readWave } from "../../engine/desktop-adventures/data/resources";
import type { SoundCatalog } from "../../engine/desktop-adventures/audio/audio";

/** Identifiants propres à la variante Indy. */
export const IndyIds = {
  heroCharacter: 0,
  fistWeapon: 26,
  mapTile: 443,
  whipTile: 449,
  startupZone: 86,
  townZone: 120,
  winZone: 208,
  loseZone: 209,
  /** Objet posé sur les emplacements « bonus » (hotspot 11). */
  bonusTile: 1085,
  bananasTile: 1133,
  /** Zone « Interior2B » et case de l'œuf de Pâques de l'original (bananes mangées en (3, 4)). */
  easterEggZone: 113,
  easterEggSpot: { x: 3, y: 4 },
} as const;

export const IndySounds = {
  /** SCHWING.WAV : l'original le joue quand le héros mange. */
  Eat: 0,
  Push: 1,
  Switch: 2,
  Hurt: 4,
  Door: 6,
  NoGo: 8,
  Flourish: 14,
  /**
   * THEME.MID. Sous Windows 3.0 / 3.1x seulement, l'original ouvre THEMW3.MID à sa place (`GetVersion` en 1010:d8e6,
   * choix du fichier en 1010:e264) : on suit Windows 95, THEMW3.MID n'est jamais joué.
   */
  Theme: 15,
  Defeat: 16,
  Victory: 17,
  /** EERIE.MID : 22 scripts le jouent, mais la table de sons du DAW s'arrête à l'id 17 (voir `extraSoundFiles`). */
  Eerie: 18,
  /** EEP.WAV : mort d'un monstre (id 19 de l'original, absent du DAW). */
  MonsterDeath: 19,
  /** Ressource WAVE 102 de DESKADV.EXE (« Ugh. Too much fruit! »), absente du DAW (voir `exeSounds`). */
  TooMuchFruit: 20,
} as const;

/**
 * Sons que DESKADV.EXE connaît sans qu'ils figurent dans la table du DAW (ids 0 à 17) : id → nom de fichier.
 * Les ids ≥ 14 sont des musiques MIDI, comme dans le DAW.
 */
export const extraSoundFiles: Readonly<Record<number, string>> = {
  [IndySounds.Eerie]: "EERIE.MID",
  [IndySounds.MonsterDeath]: "EEP.WAV",
};

/** Sons lus dans les ressources WAVE de DESKADV.EXE : id de son → id de la ressource. */
export const exeSounds: Readonly<Record<number, number>> = {
  [IndySounds.TooMuchFruit]: 102,
};

/** Table de sons du DAW complétée des sons supplémentaires (le DAW n'est pas modifié). */
export function soundFileNames(dawSounds: readonly string[]): string[] {
  const names = dawSounds.slice();
  for (const [id, file] of Object.entries(extraSoundFiles)) names[Number(id)] = file;
  return names;
}

/** Sons d'Indy : fichiers de `original/indy/` (WAV, et musiques MIDI), plus les WAVE enfouis dans DESKADV.EXE. */
export function indySoundCatalog(dawSounds: readonly string[], baseUrl: string, exe: ArrayBuffer | Uint8Array): SoundCatalog {
  const names = soundFileNames(dawSounds).map((raw) => raw?.split("\\").pop() ?? null);
  return {
    baseUrl,
    file: (id) => names[id] || null,
    isMusic: (id) => !!names[id]?.toUpperCase().endsWith(".MID"),
    embedded: (id) => (id in exeSounds ? readWave(exe, exeSounds[id]) : null),
  };
}
