import {
  type Character,
  type GameData,
  type Puzzle,
  type Tile,
  type Zone,
  CharacterType,
  FrameEntry,
  HotspotType,
  TileFlag,
} from "../data/types";

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

/** Accès typé aux données du jeu, avec quelques index précalculés. */
export class Assets {
  /** Zone parente (porte d'entrée) de chaque pièce. */
  private readonly roomParents = new Map<number, number>();

  constructor(readonly data: GameData) {
    for (const zone of data.zones) {
      for (const h of zone.hotspots) {
        if (h.type === HotspotType.DoorIn && h.argument >= 0 && !this.roomParents.has(h.argument)) {
          this.roomParents.set(h.argument, zone.id);
        }
      }
    }
  }

  tile(id: number): Tile | undefined {
    return id >= 0 ? this.data.tiles[id] : undefined;
  }

  tileName(id: number): string {
    return this.tile(id)?.name || `#${id}`;
  }

  hasFlag(id: number, flag: number): boolean {
    const tile = this.tile(id);
    return !!tile && (tile.attributes & flag) === flag;
  }

  isWeaponTile(id: number): boolean {
    return this.hasFlag(id, TileFlag.Weapon);
  }

  isItemTile(id: number): boolean {
    return this.hasFlag(id, TileFlag.Item);
  }

  isEdible(id: number): boolean {
    return this.hasFlag(id, TileFlag.Item | TileFlag.Edible);
  }

  isDrink(id: number): boolean {
    return this.hasFlag(id, TileFlag.Item | TileFlag.Drink);
  }

  isMapTile(id: number): boolean {
    return this.hasFlag(id, TileFlag.Item | TileFlag.Map);
  }

  isDraggable(id: number): boolean {
    return this.hasFlag(id, TileFlag.Draggable);
  }

  zone(id: number): Zone {
    const zone = this.data.zones[id];
    if (!zone) throw new Error(`Zone ${id} inexistante`);
    return zone;
  }

  character(id: number): Character | undefined {
    return id >= 0 ? this.data.characters[id] : undefined;
  }

  puzzle(id: number): Puzzle | undefined {
    return id >= 0 ? this.data.puzzles[id] : undefined;
  }

  get hero(): Character {
    return this.data.characters[IndyIds.heroCharacter];
  }

  /** Personnage-arme dont l'icône d'inventaire est `tileId`. */
  weaponForTile(tileId: number): Character | undefined {
    return this.data.characters.find(
      (c) => c.type === CharacterType.Weapon && c.frames[0][FrameEntry.ExtensionRight] === tileId,
    );
  }

  /** Zone qui contient la porte menant à `zoneId` (pour les pièces), sinon undefined. */
  parentOf(zoneId: number): number | undefined {
    return this.roomParents.get(zoneId);
  }

  /** Zone et toutes les pièces accessibles par ses portes (parcours en profondeur). */
  *roomsOf(zoneId: number, seen = new Set<number>()): Generator<Zone> {
    if (seen.has(zoneId)) return;
    seen.add(zoneId);
    const zone = this.zone(zoneId);
    yield zone;
    for (const h of zone.hotspots) {
      if (h.type === HotspotType.DoorIn && h.argument >= 0) yield* this.roomsOf(h.argument, seen);
    }
  }
}
